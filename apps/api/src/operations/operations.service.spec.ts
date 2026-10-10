import { ConflictException } from '@nestjs/common';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import {
  type ListOperationIssuesOptions,
  OperationsService as OperationsServiceClass,
} from './operations.service';

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
  // 실제 환불 경로처럼 주문 결제를 CANCELLED로 바꾼다. 조치 결과는 이 상태를 다시 읽어 확인한다.
  const markRefunded = (orderId: string) => {
    for (const [path, data] of store.records) {
      if (path.startsWith('payments/') && data['orderId'] === orderId) {
        store.records.set(path, { ...data, status: 'CANCELLED', refundedAt: 'refunded-at' });
      }
    }
  };
  const payments = {
    requeryPayment: jest.fn().mockResolvedValue({ status: 'PAID' }),
    processRefundByOrderId: jest.fn(async (orderId: string) => markRefunded(orderId)),
  };
  const notifications = {
    resendSms: jest.fn().mockResolvedValue({ success: true }),
  };
  const service = new OperationsService(store.firestore, payments, notifications);
  return { ...store, markRefunded, notifications, payments, service };
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
    const { service, payments, markRefunded } = makeService({
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
      (orderId: string) =>
        new Promise<void>((resolve) => {
          release = () => {
            markRefunded(orderId);
            resolve();
          };
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
      status: 'OPEN',
      actionClaim: null,
      actions: [
        expect.objectContaining({
          actorId: 'seller-1',
          actionType: 'RETRY_REFUND',
          status: 'FAILED',
          failureReason: '환불 제공자 일시 오류',
          failureCode: 'Error',
        }),
      ],
    });
    expect(JSON.stringify(saved)).not.toMatch(
      /authorization|bearer|token|secret|phone|address|messageBody/i,
    );
  });
});

describe('환불 재시도는 실제 환불을 확인했을 때만 해결한다', () => {
  const openRefundIssue = {
    'operationIssues/issue-1': { ...baseIssue, id: 'issue-1', status: 'OPEN', actions: [] },
    'orders/order-1': { id: 'order-1', status: 'CANCELLED' },
    'payments/payment-1': { id: 'payment-1', orderId: 'order-1', status: 'PAID' },
  };
  const retry = { issueId: 'issue-1', actorId: 'seller-1', actionType: 'RETRY_REFUND' };

  it('환불 경로를 부른 뒤 결제가 환불됐으면 RESOLVED로 기록한다', async () => {
    const { service, payments, records } = makeService(openRefundIssue);

    const result = await service.executeAction(retry);

    expect(payments.processRefundByOrderId).toHaveBeenCalledWith(
      'order-1',
      '운영 예외 환불 재시도',
    );
    expect(result).toMatchObject({ status: 'RESOLVED' });
    expect(records.get('operationIssues/issue-1')).toMatchObject({
      status: 'RESOLVED',
      resolvedAt: '2026-07-17T10:00:00.000+09:00',
      actionClaim: null,
      actions: [expect.objectContaining({ actionType: 'RETRY_REFUND', status: 'SUCCEEDED' })],
    });
  });

  it('환불 경로가 아무 일 없이 끝나 결제가 그대로면 OPEN을 유지하고 실패 시도와 코드를 남긴다', async () => {
    const { service, payments, records } = makeService(openRefundIssue);
    payments.processRefundByOrderId.mockResolvedValueOnce(undefined);

    const attempt = service.executeAction(retry);

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow('환불 완료를 확인하지 못했습니다(결제 상태 PAID).');
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    const saved = records.get('operationIssues/issue-1');
    expect(saved).toMatchObject({
      status: 'OPEN',
      actionClaim: null,
      actions: [
        expect.objectContaining({
          actorId: 'seller-1',
          actionType: 'RETRY_REFUND',
          status: 'FAILED',
          failureCode: 'REFUND_NOT_CONFIRMED',
          failureReason: '환불 완료를 확인하지 못했습니다(결제 상태 PAID).',
        }),
      ],
    });
    expect(saved?.['resolvedAt']).toBeUndefined();
  });

  it('다른 환불 시도가 결제를 점유 중이면 REFUND_PENDING으로 남기고 OPEN을 유지한다', async () => {
    const { service, payments, records } = makeService({
      ...openRefundIssue,
      'payments/payment-1': {
        id: 'payment-1',
        orderId: 'order-1',
        status: 'PAID',
        refundClaim: { owner: 'payment-refund', status: 'CLAIMED' },
      },
    });
    payments.processRefundByOrderId.mockResolvedValueOnce(undefined);

    await expect(service.executeAction(retry)).rejects.toBeInstanceOf(ConflictException);

    expect(records.get('operationIssues/issue-1')).toMatchObject({
      status: 'OPEN',
      actions: [expect.objectContaining({ status: 'FAILED', failureCode: 'REFUND_PENDING' })],
    });
  });

  it('환불 제공자 오류는 오류 클래스와 유형을 코드로 남기고 OPEN을 유지한다', async () => {
    const { service, payments, records } = makeService(openRefundIssue);
    class ProviderError extends Error {
      constructor(readonly type: string) {
        super('PortOne 환불 실패');
        this.name = 'PortoneError';
      }
    }
    payments.processRefundByOrderId.mockRejectedValueOnce(new ProviderError('PG_PROVIDER_ERROR'));

    await expect(service.executeAction(retry)).rejects.toThrow('PortOne 환불 실패');

    expect(records.get('operationIssues/issue-1')).toMatchObject({
      status: 'OPEN',
      actionClaim: null,
      actions: [
        expect.objectContaining({
          status: 'FAILED',
          failureCode: 'PortoneError:PG_PROVIDER_ERROR',
          failureReason: 'PortOne 환불 실패',
        }),
      ],
    });
  });

  it.each([
    ['결제 문서가 없으면', {}, 'PAYMENT_NOT_FOUND'],
    [
      '결제가 다른 주문의 것이면',
      { 'payments/payment-1': { id: 'payment-1', orderId: 'order-2', status: 'PAID' } },
      'PAYMENT_ORDER_MISMATCH',
    ],
  ])('%s 주문 결제를 환불하지 않고 OPEN을 유지한다', async (_label, payment, failureCode) => {
    const { service, payments, records } = makeService({
      'operationIssues/issue-1': openRefundIssue['operationIssues/issue-1'],
      'orders/order-1': openRefundIssue['orders/order-1'],
      ...payment,
    });

    await expect(service.executeAction(retry)).rejects.toBeInstanceOf(ConflictException);

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(records.get('operationIssues/issue-1')).toMatchObject({
      status: 'OPEN',
      actionClaim: null,
      actions: [expect.objectContaining({ status: 'FAILED', failureCode })],
    });
  });

  it('확인 실패 뒤 다시 시도해 환불이 확인되면 그때 RESOLVED로 바뀐다', async () => {
    const { service, payments, records } = makeService(openRefundIssue);
    payments.processRefundByOrderId.mockResolvedValueOnce(undefined);

    await expect(service.executeAction(retry)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.executeAction(retry)).resolves.toMatchObject({ status: 'RESOLVED' });

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(2);
    expect(records.get('operationIssues/issue-1')?.['actions']).toEqual([
      expect.objectContaining({ status: 'FAILED', failureCode: 'REFUND_NOT_CONFIRMED' }),
      expect.objectContaining({ status: 'SUCCEEDED' }),
    ]);
  });

  it('이미 환불된 결제는 환불을 다시 부르지 않고 해결하며, 반복 요청은 아무것도 바꾸지 않는다', async () => {
    const { service, payments, records } = makeService({
      ...openRefundIssue,
      'payments/payment-1': {
        id: 'payment-1',
        orderId: 'order-1',
        status: 'CANCELLED',
        refundedAt: 'refunded-at',
      },
    });

    await expect(service.executeAction(retry)).resolves.toMatchObject({ status: 'RESOLVED' });
    const afterFirst = records.get('operationIssues/issue-1');
    await expect(service.executeAction(retry)).resolves.toMatchObject({ status: 'RESOLVED' });

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(records.get('operationIssues/issue-1')).toEqual(afterFirst);
    expect(afterFirst?.['actions']).toEqual([expect.objectContaining({ status: 'SUCCEEDED' })]);
  });
});

describe('운영 예외 목록 한도와 주문 필터', () => {
  function issueDoc(id: string, overrides: Data = {}): Data {
    return {
      ...baseIssue,
      id,
      status: 'RESOLVED',
      actions: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      resolvedAt: '2026-09-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeListService(issues: Data[]) {
    const occ = createOccFirestore();
    occ.seed('stores/store-1', { ownerId: 'seller-1' });
    for (const issue of issues) occ.seed(`operationIssues/${String(issue['id'])}`, issue);
    const collection = jest.spyOn(occ.firestore, 'collection');
    const service = new OperationsServiceClass(occ.firestore as never, {} as never, {} as never);
    return { collection, service };
  }

  const list = (service: OperationsServiceClass, options?: ListOperationIssuesOptions) =>
    service.listIssuesForStore('store-1', 'seller-1', 'seller', options);

  const manyResolved = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      issueDoc(`issue-${String(index).padStart(3, '0')}`),
    );

  it('한도가 없으면 기본 100건만 돌려주고 더 있음을 hasMore로 알린다', async () => {
    const { service } = makeListService(manyResolved(105));

    const result = await list(service);

    expect(result.items).toHaveLength(100);
    expect(result.hasMore).toBe(true);
    // 기존 항목 모양은 그대로다(hasMore만 응답에 추가).
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'actions',
      'createdAt',
      'id',
      'latestSnapshot',
      'orderId',
      'paymentId',
      'resolvedAt',
      'severity',
      'status',
      'storeId',
      'type',
      'updatedAt',
    ]);
  });

  it('쿼리 문자열 한도를 받고 최대 200건으로 제한한다', async () => {
    const { service } = makeListService(manyResolved(205));

    const small = await list(service, { limit: '3' });
    expect(small.items).toHaveLength(3);
    expect(small.hasMore).toBe(true);
    expect((await list(service, { limit: 1000 })).items).toHaveLength(200);
  });

  it('해결된 기록이 한도를 채워도 열린 기록을 먼저 포함하고 최근 갱신 순으로 정렬한다', async () => {
    const { service } = makeListService([
      issueDoc('resolved-old', { updatedAt: '2026-09-01T00:00:00.000Z' }),
      issueDoc('resolved-new', { updatedAt: '2026-09-05T00:00:00.000Z' }),
      issueDoc('resolved-mid', { updatedAt: '2026-09-03T00:00:00.000Z' }),
      issueDoc('open-warning', { status: 'OPEN', resolvedAt: null }),
      issueDoc('open-critical', { status: 'OPEN', severity: 'critical', resolvedAt: null }),
    ]);

    const limited = await list(service, { limit: 3 });
    expect(limited.items.map((item) => item['id'])).toEqual([
      'open-critical',
      'open-warning',
      'resolved-new',
    ]);
    expect(limited.hasMore).toBe(true);

    const all = await list(service);
    expect(all.items.map((item) => item['id'])).toEqual([
      'open-critical',
      'open-warning',
      'resolved-new',
      'resolved-mid',
      'resolved-old',
    ]);
    expect(all.hasMore).toBe(false);
  });

  it('한도보다 기록이 많아도 문서 ID 순서가 아니라 최근 갱신 기록을 돌려준다', async () => {
    // 문서 ID 순으로는 맨 뒤지만 가장 최근에 갱신된 기록이 한도 안에 들어와야 한다.
    const { service } = makeListService([
      ...manyResolved(150),
      issueDoc('zzz-latest', { updatedAt: '2026-09-30T00:00:00.000Z' }),
    ]);

    const result = await list(service, { limit: 10 });

    expect(result.items[0]['id']).toBe('zzz-latest');
    expect(result.items).toHaveLength(10);
    expect(result.hasMore).toBe(true);
  });

  it('orderId를 주면 같은 가게의 그 주문 기록만 돌려준다', async () => {
    const { service } = makeListService([
      issueDoc('order-1-refund', { orderId: 'order-1' }),
      issueDoc('order-1-notice', { orderId: 'order-1', type: 'CUSTOMER_NOTICE_FAILED' }),
      issueDoc('order-2-refund', { orderId: 'order-2' }),
      issueDoc('other-store-order-1', { orderId: 'order-1', storeId: 'store-2' }),
    ]);

    const result = await list(service, { orderId: 'order-1' });

    expect(result.items.map((item) => item['id']).sort()).toEqual([
      'order-1-notice',
      'order-1-refund',
    ]);
    expect(result.items.every((item) => item['storeId'] === 'store-1')).toBe(true);
    expect(result.hasMore).toBe(false);
  });

  it('권한이 없는 셀러는 목록을 읽기 전에 거부한다', async () => {
    const { collection, service } = makeListService([issueDoc('issue-1')]);

    await expect(
      service.listIssuesForStore('store-1', 'seller-2', 'seller', { orderId: 'order-1' }),
    ).rejects.toThrow('권한이 없습니다.');
    expect(collection).not.toHaveBeenCalled();
  });
});
