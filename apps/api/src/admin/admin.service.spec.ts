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
    const firestore = {
      doc: jest.fn().mockReturnValue(userRef),
      Timestamp: { now: jest.fn(() => 'now') },
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
      ),
      userRef,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    firebaseAuth.revokeRefreshTokens.mockResolvedValue(undefined);
    (admin.auth as jest.Mock).mockReturnValue(firebaseAuth);
  });

  it('driver 정지 시 Firebase refresh token을 폐기한다', async () => {
    const { service, userRef } = makeService({ id: 'driver-1', role: 'driver' });

    await expect(service.suspendDriver('driver-1', { suspended: true })).resolves.toEqual({
      userId: 'driver-1',
      suspended: true,
    });
    expect(userRef.update).toHaveBeenCalledWith({ suspended: true, updatedAt: 'now' });
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith('driver-1');
  });

  it('driver 정지 해제 시 refresh token 폐기를 다시 호출하지 않는다', async () => {
    const { service } = makeService({ id: 'driver-1', role: 'driver' });

    await service.suspendDriver('driver-1', { suspended: false });

    expect(firebaseAuth.revokeRefreshTokens).not.toHaveBeenCalled();
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
  );
  return { records, firestore, payments, settlements, roundLifecycle, service };
}

describe('AdminService 강제 환불 수렴', () => {
  it.each(['PENDING', 'DELIVERING', 'HUB_ARRIVED', 'PICKED_UP', 'DELIVERED', 'REVIEWED'])(
    '%s 상태는 legacy 관리자 환불을 거부하고 모든 부수효과를 차단한다',
    async (status) => {
      const fixture = makeLegacyForceRefundFixture({ status });

      await expect(fixture.service.forceRefund('order-1', {})).rejects.toThrow(
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

    await fixture.service.forceRefund('order-1', {});
    await fixture.service.forceRefund('order-1', {});

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

    await fixture.service.forceRefund('order-1', {});

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

    await fixture.service.forceRefund('order-1', {});

    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(0);
  });

  it('환불 실패 시 주문·capacity·정산을 변경하지 않는다', async () => {
    const fixture = makeLegacyForceRefundFixture();
    fixture.payments.processRefundByOrderId.mockRejectedValueOnce(new Error('환불 실패'));

    await expect(fixture.service.forceRefund('order-1', {})).rejects.toThrow('환불 실패');

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

    const first = fixture.service.forceRefund('order-1', {});
    await providerStartedPromise;

    await expect(fixture.service.forceRefund('order-1', {})).rejects.toThrow(
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

    await expect(fixture.service.forceRefund('order-1', {})).rejects.toThrow(
      'legacy daily capacity 문서가 없습니다',
    );
    expect(providerRefund).toHaveBeenCalledTimes(1);
    expect(fixture.records.get('orders/order-1')).toMatchObject({
      status: 'ACCEPTED',
      cancellation: { status: 'LOCAL_FAILED' },
    });
    expect(fixture.settlements.cancelSettlement).not.toHaveBeenCalled();

    fixture.records.set('dailyCaps/store-1_2026-08-25', { totalCap: 10, usedSlots: 1 });
    await expect(fixture.service.forceRefund('order-1', {})).resolves.toEqual({
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

    await expect(fixture.service.forceRefund('order-1', { reason: '관리자 사유' })).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });

    expect(fixture.roundLifecycle.cancelForRound).toHaveBeenCalledWith({
      storeId: 'store-1',
      orderId: 'order-1',
      expectedStatus: 'ACCEPTED',
      reason: '관리자 사유',
    });
    expect(fixture.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(1);
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
