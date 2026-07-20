type Data = Record<string, unknown>;

interface OperationsServiceContract {
  createOrMergeIssue(input: Data): Promise<Data>;
  executeAction(input: Data): Promise<Data>;
}

type OperationsServiceConstructor = new (
  firestore: Data,
  payments: Data,
  notifications: Data,
) => OperationsServiceContract;

function loadOperationsService(): OperationsServiceConstructor | null {
  try {
    return (
      (
        require('./operations.service') as {
          OperationsService?: OperationsServiceConstructor;
        }
      ).OperationsService ?? null
    );
  } catch {
    return null;
  }
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map<string, Data>(Object.entries(initial));
  const writes: Array<{ path: string; data: Data }> = [];
  const reads: string[] = [];

  const doc = (path: string) => ({
    path,
    get: jest.fn(async () => {
      reads.push(path);
      return {
        exists: records.has(path),
        data: () => records.get(path),
      };
    }),
    set: jest.fn(async (data: Data) => {
      writes.push({ path, data });
      records.set(path, data);
    }),
    update: jest.fn(async (data: Data) => {
      writes.push({ path, data });
      records.set(path, { ...(records.get(path) ?? {}), ...data });
    }),
  });
  const tx = {
    get: jest.fn((ref: { get: () => Promise<unknown> }) => ref.get()),
    set: jest.fn((ref: { set: (data: Data) => Promise<void> }, data: Data) => ref.set(data)),
    update: jest.fn((ref: { update: (data: Data) => Promise<void> }, data: Data) =>
      ref.update(data),
    ),
  };
  let transactionQueue = Promise.resolve();
  const firestore = {
    doc,
    collection: jest.fn((name: string) => ({
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn(async () => ({
        empty: true,
        docs: Array.from(records.entries())
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([path, data]) => ({ id: path.split('/')[1], data: () => data, ref: doc(path) })),
      })),
    })),
    runTransaction: jest.fn((callback: (transaction: typeof tx) => Promise<unknown>) => {
      const result = transactionQueue.then(() => callback(tx));
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => '2026-07-17T10:00:00.000+09:00'),
    },
  };

  return { firestore, reads, records, writes };
}

function makeService(initial: Record<string, Data> = {}) {
  const OperationsService = loadOperationsService();
  if (!OperationsService) {
    throw new Error('Task 3.6의 OperationsService 구현이 아직 없습니다.');
  }
  const store = makeFirestore(initial);
  const payments = {
    requeryPayment: jest.fn().mockResolvedValue({ status: 'PAID' }),
    processRefundByOrderId: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = {
    resendSms: jest.fn().mockResolvedValue({ success: true }),
  };
  const service = new OperationsService(store.firestore, payments, notifications);
  return { ...store, notifications, payments, service };
}

const baseIssue = {
  storeId: 'store-1',
  orderId: 'order-1',
  paymentId: 'payment-1',
  type: 'AUTO_REFUND_FAILED',
  severity: 'warning',
  title: '환불 실패',
  message: '자동 환불 실패로 운영 확인이 필요합니다.',
  idempotencyKey: 'refund-failed:order-1:payment-1',
  latestSnapshot: {
    orderStatus: 'CANCELLED',
    paymentStatus: 'PAID',
  },
};

describe('운영 예외 통합과 조치 계약', () => {
  it('해결된 같은 실패가 재발하면 최신 스냅샷을 병합하고 OPEN으로 재개방한다', async () => {
    const { service, records } = makeService({
      'operationIssues/9086bece37771d5d18f42a12e5174f08': {
        ...baseIssue,
        id: '9086bece37771d5d18f42a12e5174f08',
        status: 'RESOLVED',
        latestSnapshot: { orderStatus: 'CANCELLED', paymentStatus: 'PAID' },
        actions: [{ actionType: 'RETRY_REFUND', status: 'SUCCEEDED' }],
        resolvedAt: '2026-07-16T10:00:00.000+09:00',
        createdAt: '2026-07-16T09:00:00.000+09:00',
      },
    });

    const reopened = await service.createOrMergeIssue({
      ...baseIssue,
      latestSnapshot: { paymentStatus: 'REFUND_FAILED', failureStage: 'provider' },
    });

    expect(reopened).toMatchObject({
      status: 'OPEN',
      resolvedAt: null,
      createdAt: '2026-07-16T09:00:00.000+09:00',
      latestSnapshot: {
        orderStatus: 'CANCELLED',
        paymentStatus: 'REFUND_FAILED',
        failureStage: 'provider',
      },
      actions: [{ actionType: 'RETRY_REFUND', status: 'SUCCEEDED' }],
    });
    expect(records.get(`operationIssues/${reopened.id}`)).toMatchObject(reopened);
  });

  it('같은 실패 원인과 업무 대상은 하나의 열린 운영 예외로 통합한다', async () => {
    const { service, writes } = makeService();

    const first = await service.createOrMergeIssue(baseIssue);
    const retried = await service.createOrMergeIssue({
      ...baseIssue,
      latestSnapshot: { orderStatus: 'CANCELLED', paymentStatus: 'REFUND_FAILED' },
    });

    expect(first.id).toBe(retried.id);
    expect(
      new Set(
        writes.filter(({ path }) => path.startsWith('operationIssues/')).map(({ path }) => path),
      ),
    ).toHaveProperty('size', 1);
    expect(retried).toMatchObject({
      idempotencyKey: baseIssue.idempotencyKey,
      status: 'OPEN',
    });
  });

  it('같은 idempotencyKey의 동시 생성은 단일 문서 식별자로 수렴한다', async () => {
    const { service, writes } = makeService();

    const [first, second] = await Promise.all([
      service.createOrMergeIssue(baseIssue),
      service.createOrMergeIssue({
        ...baseIssue,
        latestSnapshot: { paymentStatus: 'REFUND_FAILED' },
      }),
    ]);

    expect(first.id).toBe(second.id);
    expect(
      new Set(
        writes.filter(({ path }) => path.startsWith('operationIssues/')).map(({ path }) => path),
      ).size,
    ).toBe(1);
  });

  it('서로 다른 주문·결제·실패 유형은 같은 운영 예외로 잘못 통합하지 않는다', async () => {
    const { service, writes } = makeService();

    await service.createOrMergeIssue(baseIssue);
    await service.createOrMergeIssue({
      ...baseIssue,
      orderId: 'order-2',
      idempotencyKey: 'refund-failed:order-2:payment-1',
    });
    await service.createOrMergeIssue({
      ...baseIssue,
      type: 'CUSTOMER_NOTICE_FAILED',
      idempotencyKey: 'customer-notice-failed:order-1:ORDER_DELIVERING',
    });

    expect(writes.filter(({ path }) => path.startsWith('operationIssues/'))).toHaveLength(3);
  });

  it('조치 직전에 주문과 결제의 최신 상태를 다시 읽고 자동 복구된 환불을 반복하지 않는다', async () => {
    const { service, reads, payments, records } = makeService({
      'operationIssues/issue-1': {
        ...baseIssue,
        id: 'issue-1',
        status: 'OPEN',
        actions: [],
      },
      'orders/order-1': { id: 'order-1', status: 'CANCELLED' },
      'payments/payment-1': { id: 'payment-1', orderId: 'order-1', status: 'REFUNDED' },
    });

    await service.executeAction({
      issueId: 'issue-1',
      actorId: 'seller-1',
      actionType: 'RETRY_REFUND',
    });

    expect(reads).toEqual(
      expect.arrayContaining(['operationIssues/issue-1', 'orders/order-1', 'payments/payment-1']),
    );
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(records.get('operationIssues/issue-1')).toMatchObject({
      status: 'RESOLVED',
    });
  });

  it('문자 재발송도 최신 주문과 운영 예외 상태를 확인해 해결된 항목에는 발송하지 않는다', async () => {
    const { service, notifications, reads } = makeService({
      'operationIssues/issue-1': {
        ...baseIssue,
        id: 'issue-1',
        type: 'CUSTOMER_NOTICE_FAILED',
        status: 'RESOLVED',
        actions: [],
      },
      'orders/order-1': { id: 'order-1', status: 'DELIVERED' },
    });

    await service.executeAction({
      issueId: 'issue-1',
      actorId: 'seller-1',
      actionType: 'RESEND_SMS',
    });

    expect(reads).toEqual(expect.arrayContaining(['operationIssues/issue-1', 'orders/order-1']));
    expect(notifications.resendSms).not.toHaveBeenCalled();
  });

  it.each([
    ['PAYMENT_LOOKUP_FAILED', 'RETRY_REFUND'],
    ['AUTO_REFUND_FAILED', 'RESEND_SMS'],
    ['CUSTOMER_NOTICE_FAILED', 'RETRY_REFUND'],
    ['REDELIVERY_FAILED', 'RESEND_SMS'],
  ])('%s에는 허용되지 않은 %s 조치를 외부 호출 전에 거부한다', async (type, actionType) => {
    const { service, notifications, payments } = makeService({
      'operationIssues/issue-1': {
        ...baseIssue,
        id: 'issue-1',
        type,
        status: 'OPEN',
        actions: [],
      },
      'orders/order-1': { id: 'order-1', status: 'CANCELLED' },
      'payments/payment-1': { id: 'payment-1', orderId: 'order-1', status: 'PAID' },
    });

    await expect(
      service.executeAction({ issueId: 'issue-1', actorId: 'seller-1', actionType }),
    ).rejects.toThrow('허용되지 않은 운영 조치입니다.');
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(notifications.resendSms).not.toHaveBeenCalled();
  });

  it('같은 조치를 동시에 요청해도 claim을 획득한 한 요청만 외부 호출한다', async () => {
    const { service, payments } = makeService({
      'operationIssues/issue-1': {
        ...baseIssue,
        id: 'issue-1',
        type: 'AUTO_REFUND_FAILED',
        status: 'OPEN',
        actions: [],
      },
      'orders/order-1': { id: 'order-1', status: 'CANCELLED' },
      'payments/payment-1': { id: 'payment-1', orderId: 'order-1', status: 'PAID' },
    });
    let release!: () => void;
    payments.processRefundByOrderId.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const first = service.executeAction({
      issueId: 'issue-1',
      actorId: 'seller-1',
      actionType: 'RETRY_REFUND',
    });
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    const second = service.executeAction({
      issueId: 'issue-1',
      actorId: 'seller-2',
      actionType: 'RETRY_REFUND',
    });
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await Promise.all([first, second]);

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
  });

  it('성공한 조치의 수행자·유형·시각·결과를 기존 actions에 감사 기록한다', async () => {
    const { service, records } = makeService({
      'operationIssues/issue-1': {
        ...baseIssue,
        id: 'issue-1',
        status: 'OPEN',
        actions: [],
      },
      'orders/order-1': { id: 'order-1', status: 'CANCELLED' },
      'payments/payment-1': { id: 'payment-1', orderId: 'order-1', status: 'PAID' },
    });

    await service.executeAction({
      issueId: 'issue-1',
      actorId: 'seller-1',
      actionType: 'RETRY_REFUND',
    });

    expect(records.get('operationIssues/issue-1')).toMatchObject({
      actions: [
        expect.objectContaining({
          actorId: 'seller-1',
          actionType: 'RETRY_REFUND',
          performedAt: '2026-07-17T10:00:00.000+09:00',
          status: 'SUCCEEDED',
        }),
      ],
    });
  });

  it('실패한 조치도 실패 결과를 남기되 개인정보와 비밀값은 감사 기록하지 않는다', async () => {
    const { service, payments, records } = makeService({
      'operationIssues/issue-1': {
        ...baseIssue,
        id: 'issue-1',
        status: 'OPEN',
        actions: [],
      },
      'orders/order-1': { id: 'order-1', status: 'CANCELLED' },
      'payments/payment-1': { id: 'payment-1', orderId: 'order-1', status: 'PAID' },
    });
    payments.processRefundByOrderId.mockRejectedValueOnce(new Error('환불 제공자 일시 오류'));

    await expect(
      service.executeAction({
        issueId: 'issue-1',
        actorId: 'seller-1',
        actionType: 'RETRY_REFUND',
      }),
    ).rejects.toThrow('환불 제공자 일시 오류');

    const saved = records.get('operationIssues/issue-1');
    expect(saved).toMatchObject({
      actions: [
        expect.objectContaining({
          actorId: 'seller-1',
          actionType: 'RETRY_REFUND',
          status: 'FAILED',
          failureReason: '환불 제공자 일시 오류',
        }),
      ],
    });
    expect(JSON.stringify(saved)).not.toMatch(
      /authorization|bearer|token|secret|phone|address|messageBody/i,
    );
  });
});
