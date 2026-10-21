import type { FirestoreService } from '../firestore/firestore.service';
import * as admin from 'firebase-admin';
import { AdminService } from './admin.service';

jest.mock('firebase-admin', () => ({
  auth: jest.fn(),
}));

describe('AdminService driver session 보강', () => {
  const firebaseAuth = { revokeRefreshTokens: jest.fn() };

  function makeService(user: Record<string, unknown>, exists = true) {
    const userRef = {
      get: jest.fn().mockResolvedValue({ exists, data: () => user }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const refreshTokenRef = { delete: jest.fn().mockResolvedValue(undefined) };
    const firestore = {
      doc: jest.fn((path: string) =>
        path.startsWith('refreshTokens/') ? refreshTokenRef : userRef,
      ),
      Timestamp: {
        now: jest.fn(() => 'now'),
        fromMillis: jest.fn((millis: number) => ({ millis })),
      },
    };
    const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
    const roundLifecycle = { cancelForRound: jest.fn() };
    return {
      firestore,
      service: new AdminService(
        firestore as unknown as FirestoreService,
        {} as never,
        settlements as never,
        roundLifecycle as never,
        { logAdmin: jest.fn().mockResolvedValue(undefined), listAdmin: jest.fn() } as never,
      ),
      refreshTokenRef,
      userRef,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    firebaseAuth.revokeRefreshTokens.mockResolvedValue(undefined);
    (admin.auth as jest.Mock).mockReturnValue(firebaseAuth);
  });

  it('driver 정지 시 Firebase refresh token을 폐기한다', async () => {
    const { firestore, refreshTokenRef, service, userRef } = makeService({
      id: 'driver-1',
      role: 'driver',
    });

    await expect(service.suspendDriver('driver-1', { suspended: true }, 'admin-1')).resolves.toEqual({
      userId: 'driver-1',
      suspended: true,
    });
    expect(userRef.update).toHaveBeenCalledWith({
      suspended: true,
      sessionsRevokedAt: expect.anything(),
      updatedAt: 'now',
    });
    expect(firestore.doc).toHaveBeenCalledWith('refreshTokens/driver-1');
    expect(refreshTokenRef.delete).toHaveBeenCalledTimes(1);
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith('driver-1');
  });

  it('driver 정지 해제 시 refresh token 폐기를 다시 호출하지 않는다', async () => {
    const { refreshTokenRef, service, userRef } = makeService({ id: 'driver-1', role: 'driver' });

    await service.suspendDriver('driver-1', { suspended: false }, 'admin-1');

    expect(userRef.update).toHaveBeenCalledWith({ suspended: false, updatedAt: 'now' });
    expect(refreshTokenRef.delete).not.toHaveBeenCalled();
    expect(firebaseAuth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('일반 사용자 정지 시 세션 폐기 시각을 초 단위로 기록하고 refresh 기록과 Firebase 세션을 끊는다', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_987);
    const { firestore, refreshTokenRef, service, userRef } = makeService({
      id: 'consumer-1',
      role: 'consumer',
    });

    try {
      await expect(service.suspendUser('consumer-1', { suspended: true }, 'admin-1')).resolves.toEqual({
        userId: 'consumer-1',
        suspended: true,
      });
    } finally {
      nowSpy.mockRestore();
    }
    expect(firestore.Timestamp.fromMillis).toHaveBeenCalledWith(1_700_000_000_000);
    expect(userRef.update).toHaveBeenCalledWith({
      suspended: true,
      sessionsRevokedAt: { millis: 1_700_000_000_000 },
      updatedAt: 'now',
    });
    expect(firestore.doc).toHaveBeenCalledWith('refreshTokens/consumer-1');
    expect(refreshTokenRef.delete).toHaveBeenCalledTimes(1);
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith('consumer-1');
  });

  it('Firebase 사용자 기록이 없어도 일반 사용자 정지는 완료된다', async () => {
    firebaseAuth.revokeRefreshTokens.mockRejectedValue(
      Object.assign(new Error('no user'), { code: 'auth/user-not-found' }),
    );
    const { refreshTokenRef, service } = makeService({ id: 'consumer-1', role: 'consumer' });

    await expect(service.suspendUser('consumer-1', { suspended: true }, 'admin-1')).resolves.toEqual({
      userId: 'consumer-1',
      suspended: true,
    });
    expect(refreshTokenRef.delete).toHaveBeenCalledTimes(1);
  });

  it('일반 사용자 정지 해제는 세션을 다시 폐기하지 않는다', async () => {
    const { refreshTokenRef, service, userRef } = makeService({
      id: 'consumer-1',
      role: 'consumer',
    });

    await service.suspendUser('consumer-1', { suspended: false }, 'admin-1');

    expect(userRef.update).toHaveBeenCalledWith({ suspended: false, updatedAt: 'now' });
    expect(refreshTokenRef.delete).not.toHaveBeenCalled();
    expect(firebaseAuth.revokeRefreshTokens).not.toHaveBeenCalled();
  });
});

describe('AdminService 소비자 정지 대상 검사', () => {
  function makeService(user: Record<string, unknown>) {
    const userRef = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => user }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const refreshTokenRef = { delete: jest.fn().mockResolvedValue(undefined) };
    const firestore = {
      doc: jest.fn((path: string) =>
        path.startsWith('refreshTokens/') ? refreshTokenRef : userRef,
      ),
      Timestamp: { now: jest.fn(() => 'now'), fromMillis: jest.fn() },
    };
    const service = new AdminService(firestore as never, {} as never, {} as never, {} as never);
    return { firestore, refreshTokenRef, service, userRef };
  }

  it.each(['seller', 'driver', 'admin'])(
    '소비자가 아닌 %s 계정은 정지하지 않고 400으로 거부한다',
    async (role) => {
      const { refreshTokenRef, service, userRef } = makeService({ id: 'user-1', role });

      await expect(
        service.suspendUser('user-1', { suspended: true }, 'admin-1'),
      ).rejects.toMatchObject({ status: 400 });
      expect(userRef.update).not.toHaveBeenCalled();
      expect(refreshTokenRef.delete).not.toHaveBeenCalled();
    },
  );

  it('관리자 자기 자신은 정지할 수 없다(문서를 읽기 전에 거부)', async () => {
    const { firestore, service, userRef } = makeService({ id: 'admin-1', role: 'admin' });

    await expect(
      service.suspendUser('admin-1', { suspended: true }, 'admin-1'),
    ).rejects.toMatchObject({ status: 400 });
    expect(firestore.doc).not.toHaveBeenCalled();
    expect(userRef.update).not.toHaveBeenCalled();
  });
});

// 저장 문서에는 있지만 관리자 목록 화면이 쓰지 않는 필드(응답에서 빠져야 함).
const NON_LIST_USER_FIELDS = {
  passwordHash: 'hash',
  savedAddresses: [{ address: '서울시 어딘가 1', detail: '101호' }],
  kakaoId: 'kakao-123',
  activeSessionIds: ['session-a'],
  fcmToken: 'fcm-token',
  role: 'consumer',
  sessionsRevokedAt: 'revoked',
};

describe('AdminService 소비자 목록 응답 최소화', () => {
  it('화면이 쓰는 필드(id·email·name·phone·suspended·createdAt)만 돌려준다', async () => {
    const createdAt = { _seconds: 1_700_000_000 };
    const docs = [
      {
        data: () => ({
          id: 'consumer-1',
          email: 'c1@example.com',
          name: '소비자',
          phone: '010-0000-0000',
          suspended: false,
          createdAt,
          ...NON_LIST_USER_FIELDS,
        }),
      },
    ];
    const query = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs, size: docs.length }),
    };
    const firestore = { collection: jest.fn().mockReturnValue(query) };
    const service = new AdminService(firestore as never, {} as never, {} as never, {} as never);

    const result = await service.getUsers();

    expect(result).toEqual({
      users: [
        {
          id: 'consumer-1',
          email: 'c1@example.com',
          name: '소비자',
          phone: '010-0000-0000',
          suspended: false,
          createdAt,
        },
      ],
      total: 1,
    });
  });

  it('탈퇴한 소비자(withdrawnAt 있음)는 목록과 개수에서 뺀다', async () => {
    const docs = [
      { data: () => ({ id: 'consumer-1', role: 'consumer', name: '소비자' }) },
      { data: () => ({ id: 'consumer-2', role: 'consumer', withdrawnAt: { _seconds: 1 } }) },
    ];
    const query = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs, size: docs.length }),
    };
    const firestore = { collection: jest.fn().mockReturnValue(query) };
    const service = new AdminService(firestore as never, {} as never, {} as never, {} as never);

    await expect(service.getUsers()).resolves.toEqual({
      users: [{ id: 'consumer-1', name: '소비자' }],
      total: 1,
    });
  });
});

type Data = Record<string, any>;

function makeSnapshot(data: Data | null, ref: Data) {
  return { exists: data !== null, data: () => data, ref };
}

function makeLegacyForceRefundFixture(orderOverrides: Data = {}) {
  const records = new Map<string, Data>([
    [
      'orders/order-1',
      {
        id: 'order-1',
        storeId: 'store-1',
        status: 'ACCEPTED',
        schemaVersion: 1,
        saleType: 'normal',
        deliveryMethod: 'direct',
        quantity: 1,
        requestedDeliveryDate: '2026-08-25',
        ...orderOverrides,
      },
    ],
    [
      'dailyCaps/store-1_2026-08-25',
      { totalCap: 10, usedSlots: 1 },
    ],
  ]);
  const refs = new Map<string, Data>();
  const doc = jest.fn((path: string) => {
    if (!refs.has(path)) {
      const ref = {
        path,
        get: jest.fn(async () => makeSnapshot(records.get(path) ?? null, ref)),
        update: jest.fn(async (data: Data) => {
          records.set(path, { ...(records.get(path) ?? {}), ...data });
        }),
      };
      refs.set(path, ref);
    }
    return refs.get(path);
  });
  const firestore = {
    doc,
    runTransaction: jest.fn(async (callback: (tx: Data) => Promise<unknown>) => {
      const pending = new Map<string, Data>();
      const tx = {
        get: jest.fn(async (ref: Data) =>
          makeSnapshot(pending.get(ref.path) ?? records.get(ref.path) ?? null, ref),
        ),
        update: jest.fn((ref: Data, data: Data) => {
          pending.set(ref.path, { ...(pending.get(ref.path) ?? records.get(ref.path) ?? {}), ...data });
        }),
      };
      const result = await callback(tx);
      for (const [path, data] of pending) records.set(path, data);
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => new Date('2026-08-25T00:00:00.000Z')),
      fromDate: jest.fn((date: Date) => date),
    },
  };
  const payments = { processRefundByOrderId: jest.fn().mockResolvedValue(undefined) };
  const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
  const roundLifecycle = { cancelForRound: jest.fn() };
  const service = new AdminService(
    firestore as never,
    payments as never,
    settlements as never,
    roundLifecycle as never,
    { logAdmin: jest.fn().mockResolvedValue(undefined), listAdmin: jest.fn() } as never,
  );
  return { records, firestore, payments, settlements, roundLifecycle, service };
}

describe('AdminService 강제 환불 수렴', () => {
  it.each(['PENDING', 'DELIVERING', 'HUB_ARRIVED', 'PICKED_UP', 'DELIVERED', 'REVIEWED'])(
    '%s 상태는 legacy 관리자 환불을 거부하고 모든 부수효과를 차단한다',
    async (status) => {
      const fixture = makeLegacyForceRefundFixture({ status });

      await expect(fixture.service.forceRefund('order-1', {}, 'admin-1')).rejects.toThrow(
        '현재 주문 상태에서는 관리자 환불을 처리할 수 없습니다.',
      );

      expect(fixture.payments.processRefundByOrderId).not.toHaveBeenCalled();
      expect(fixture.settlements.cancelSettlement).not.toHaveBeenCalled();
      expect(fixture.records.get('orders/order-1')?.status).toBe(status);
      expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(1);
    },
  );

  it.each([
    ['direct', { deliveryMethod: 'direct' }],
    ['hub', { deliveryMethod: 'hub' }],
  ])('legacy normal %s는 daily capacity를 한 번 반환한다', async (_name, overrides) => {
    const fixture = makeLegacyForceRefundFixture(overrides);

    await fixture.service.forceRefund('order-1', {}, 'admin-1');
    await fixture.service.forceRefund('order-1', {}, 'admin-1');

    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(0);
    expect(fixture.records.get('orders/order-1')?.legacyDailyCapacity).toMatchObject({
      status: 'RELEASED',
      quantity: 1,
    });
    expect(fixture.settlements.cancelSettlement).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['legacy normal parcel', { saleType: 'normal', deliveryMethod: 'parcel' }],
    ['legacy group direct', { saleType: 'group', deliveryMethod: 'direct' }],
    ['legacy group hub', { saleType: 'group', deliveryMethod: 'hub' }],
    ['schemaVersion 2', { schemaVersion: 2, deliveryMethod: 'direct' }],
  ])('%s는 legacy daily capacity를 변경하지 않는다', async (_name, overrides) => {
    const fixture = makeLegacyForceRefundFixture(overrides);

    await fixture.service.forceRefund('order-1', {}, 'admin-1');

    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(1);
    expect(fixture.records.get('orders/order-1')?.legacyDailyCapacity).toBeUndefined();
  });

  it('이미 반환된 legacy capacity를 다시 감소시키지 않는다', async () => {
    const fixture = makeLegacyForceRefundFixture({
      status: 'CANCELLED',
      legacyDailyCapacity: {
        status: 'RELEASED',
        date: '2026-08-25',
        quantity: 1,
      },
    });
    fixture.records.set('dailyCaps/store-1_2026-08-25', { totalCap: 10, usedSlots: 0 });

    await fixture.service.forceRefund('order-1', {}, 'admin-1');

    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(0);
  });

  it('환불 실패 시 주문·capacity·정산을 변경하지 않는다', async () => {
    const fixture = makeLegacyForceRefundFixture();
    fixture.payments.processRefundByOrderId.mockRejectedValueOnce(new Error('환불 실패'));

    await expect(fixture.service.forceRefund('order-1', {}, 'admin-1')).rejects.toThrow('환불 실패');

    expect(fixture.records.get('orders/order-1')?.status).toBe('ACCEPTED');
    expect(fixture.records.get('orders/order-1')?.cancellation).toMatchObject({
      status: 'REFUND_FAILED',
    });
    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(1);
    expect(fixture.settlements.cancelSettlement).not.toHaveBeenCalled();
  });

  it('활성 refund claim을 만난 두 번째 요청은 local 취소를 선행하지 않는다', async () => {
    const fixture = makeLegacyForceRefundFixture();
    let releaseProvider!: () => void;
    let providerStarted!: () => void;
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const providerReleasePromise = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    fixture.payments.processRefundByOrderId.mockImplementationOnce(async () => {
      providerStarted();
      await providerReleasePromise;
    });

    const first = fixture.service.forceRefund('order-1', {}, 'admin-1');
    await providerStartedPromise;

    await expect(fixture.service.forceRefund('order-1', {}, 'admin-1')).rejects.toThrow(
      '주문 환불이 이미 처리 중입니다.',
    );
    expect(fixture.payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(fixture.settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(fixture.records.get('orders/order-1')?.status).toBe('ACCEPTED');
    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(1);

    releaseProvider();
    await expect(first).resolves.toEqual({ ok: true, orderId: 'order-1' });
    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(0);
    expect(fixture.settlements.cancelSettlement).toHaveBeenCalledTimes(1);
  });

  it('provider 성공 뒤 local 실패는 LOCAL_FAILED로 남고 재시도에서 provider를 반복하지 않는다', async () => {
    const fixture = makeLegacyForceRefundFixture();
    const providerRefund = jest.fn();
    let providerAlreadyRefunded = false;
    fixture.payments.processRefundByOrderId.mockImplementation(async () => {
      if (providerAlreadyRefunded) return;
      providerAlreadyRefunded = true;
      providerRefund();
    });
    fixture.records.delete('dailyCaps/store-1_2026-08-25');

    await expect(fixture.service.forceRefund('order-1', {}, 'admin-1')).rejects.toThrow(
      'legacy daily capacity 문서가 없습니다',
    );
    expect(providerRefund).toHaveBeenCalledTimes(1);
    expect(fixture.records.get('orders/order-1')).toMatchObject({
      status: 'ACCEPTED',
      cancellation: { status: 'LOCAL_FAILED' },
    });
    expect(fixture.settlements.cancelSettlement).not.toHaveBeenCalled();

    fixture.records.set('dailyCaps/store-1_2026-08-25', { totalCap: 10, usedSlots: 1 });
    await expect(fixture.service.forceRefund('order-1', {}, 'admin-1')).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
    });

    expect(providerRefund).toHaveBeenCalledTimes(1);
    expect(fixture.payments.processRefundByOrderId).toHaveBeenCalledTimes(2);
    expect(fixture.records.get('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(0);
    expect(fixture.settlements.cancelSettlement).toHaveBeenCalledTimes(1);
  });

  it('schemaVersion 2 회차는 기존 round cancellation lifecycle에 위임한다', async () => {
    const fixture = makeLegacyForceRefundFixture({
      schemaVersion: 2,
      roundId: 'round-1',
      reservationId: 'reservation-1',
    });
    fixture.roundLifecycle.cancelForRound.mockResolvedValue({
      orderId: 'order-1',
      status: 'CANCELLED',
    });

    await expect(fixture.service.forceRefund('order-1', { reason: '관리자 사유' }, 'admin-1')).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });

    expect(fixture.roundLifecycle.cancelForRound).toHaveBeenCalledWith({
      storeId: 'store-1',
      orderId: 'order-1',
      expectedStatus: 'ACCEPTED',
      reason: '관리자 사유',
      customerNotice: 'ADMIN_REFUND',
    });
    expect(fixture.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(1);
  });

  it('지급 완료된 정산의 legacy 주문을 환불하면 회수 필요 금액을 응답에 싣는다', async () => {
    const fixture = makeLegacyForceRefundFixture();
    fixture.settlements.cancelSettlement.mockResolvedValue({
      recoveryRequired: true,
      recoveryAmount: 9500,
    });

    await expect(fixture.service.forceRefund('order-1', {}, 'admin-1')).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
      recoveryRequired: true,
      recoveryAmount: 9500,
    });
  });

  it('지급 완료된 정산의 회차 주문을 환불하면 회수 필요 금액을 응답에 싣는다', async () => {
    const fixture = makeLegacyForceRefundFixture({ schemaVersion: 2, roundId: 'round-1' });
    fixture.roundLifecycle.cancelForRound.mockResolvedValue({
      orderId: 'order-1',
      status: 'CANCELLED',
    });
    fixture.settlements.cancelSettlement.mockResolvedValue({
      recoveryRequired: true,
      recoveryAmount: 12000,
    });

    await expect(fixture.service.forceRefund('order-1', {}, 'admin-1')).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
      recoveryRequired: true,
      recoveryAmount: 12000,
    });
  });

  it('지급 전 정산이면 회수 필요 없음으로 응답한다', async () => {
    const fixture = makeLegacyForceRefundFixture();
    fixture.settlements.cancelSettlement.mockResolvedValue({
      recoveryRequired: false,
      recoveryAmount: 0,
    });

    await expect(fixture.service.forceRefund('order-1', {}, 'admin-1')).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
      recoveryRequired: false,
      recoveryAmount: 0,
    });
  });
});

describe('AdminService 정산 KST 날짜 범위', () => {
  function makeSettlementService(records: Data[] = []) {
    const calls: unknown[][] = [];
    const query = {
      where: jest.fn((...args: unknown[]) => {
        calls.push(args);
        return query;
      }),
      orderBy: jest.fn((...args: unknown[]) => {
        calls.push(args);
        return query;
      }),
      limit: jest.fn((...args: unknown[]) => {
        calls.push(args);
        return query;
      }),
      get: jest.fn().mockImplementation(async () => ({
        docs: records
          .filter((record) =>
            calls.every(([field, operator, expected]) => {
              if (field !== 'settledAt' || !(expected instanceof Date)) return true;
              const actual = record['settledAt'];
              if (!(actual instanceof Date)) return false;
              if (operator === '>=') return actual.getTime() >= expected.getTime();
              if (operator === '<') return actual.getTime() < expected.getTime();
              return true;
            }),
          )
          .map((record) => ({ data: () => record })),
      })),
    };
    const firestore = {
      collection: jest.fn().mockReturnValue(query),
      Timestamp: { fromDate: jest.fn((date: Date) => date) },
    };
    const service = new AdminService(
      firestore as never,
      {} as never,
      {} as never,
      {} as never,
      { logAdmin: jest.fn().mockResolvedValue(undefined), listAdmin: jest.fn() } as never,
    );
    return { calls, service };
  }

  it('동일 날짜를 KST start inclusive와 next-day start exclusive로 조회한다', async () => {
    const fixture = makeSettlementService();

    await fixture.service.getSettlements({ from: '2026-08-24', to: '2026-08-24' });

    expect(fixture.calls).toContainEqual([
      'settledAt',
      '>=',
      new Date('2026-08-23T15:00:00.000Z'),
    ]);
    expect(fixture.calls).toContainEqual([
      'settledAt',
      '<',
      new Date('2026-08-24T15:00:00.000Z'),
    ]);
  });

  it('여러 날짜는 from 시작부터 to 다음 날 시작 전까지 조회한다', async () => {
    const fixture = makeSettlementService();

    await fixture.service.getSettlements({ from: '2026-08-24', to: '2026-08-26' });

    expect(fixture.calls).toContainEqual([
      'settledAt',
      '>=',
      new Date('2026-08-23T15:00:00.000Z'),
    ]);
    expect(fixture.calls).toContainEqual([
      'settledAt',
      '<',
      new Date('2026-08-26T15:00:00.000Z'),
    ]);
  });

  it('시작 시각은 포함하고 끝 시각은 제외하며 끝 직전은 포함한다', async () => {
    const fixture = makeSettlementService([
      { id: 'at-start', settledAt: new Date('2026-08-23T15:00:00.000Z') },
      { id: 'before-end', settledAt: new Date('2026-08-24T14:59:59.999Z') },
      { id: 'at-end', settledAt: new Date('2026-08-24T15:00:00.000Z') },
    ]);

    const result = await fixture.service.getSettlements({
      from: '2026-08-24',
      to: '2026-08-24',
    });

    expect(result.settlements.map((settlement: Data) => settlement['id'])).toEqual([
      'at-start',
      'before-end',
    ]);
  });
});
