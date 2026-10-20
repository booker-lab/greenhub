import { AdminService } from './admin.service';

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({ revokeRefreshTokens: jest.fn().mockResolvedValue(undefined) })),
}));

// 어드민 쓰기 작업이 누가·무엇을·어떻게 바꿨는지 adminAuditLogs에 남기는지 확인한다.
function makeFixture(docs: Record<string, Record<string, unknown> | undefined>) {
  const store = new Map(Object.entries(docs));
  const refs = new Map<string, any>();
  const doc = jest.fn((path: string) => {
    if (!refs.has(path)) {
      refs.set(path, {
        // 실제 Firestore 스냅샷처럼 읽은 시점의 값을 고정한다.
        get: jest.fn(async () => {
          const value = store.get(path);
          const frozen = value === undefined ? undefined : { ...value };
          return { exists: frozen !== undefined, data: () => frozen };
        }),
        update: jest.fn(async (patch: Record<string, unknown>) => {
          store.set(path, { ...(store.get(path) ?? {}), ...patch });
        }),
        set: jest.fn(async (value: Record<string, unknown>) => {
          store.set(path, { ...(store.get(path) ?? {}), ...value });
        }),
        delete: jest.fn(async () => undefined),
      });
    }
    return refs.get(path);
  });
  const firestore = {
    doc,
    Timestamp: { now: jest.fn(() => 'now'), fromMillis: jest.fn((ms: number) => ({ ms })) },
    FieldValue: { delete: jest.fn(() => 'DELETE') },
  };
  const audit = { logAdmin: jest.fn().mockResolvedValue(undefined), listAdmin: jest.fn() };
  const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
  const roundLifecycle = { cancelForRound: jest.fn().mockResolvedValue({ ok: true }) };
  const service = new AdminService(
    firestore as never,
    {} as never,
    settlements as never,
    roundLifecycle as never,
    audit as never,
  );
  return { audit, roundLifecycle, service };
}

describe('AdminService 어드민 행동 기록', () => {
  it('수수료 변경은 이전 값과 새 값을 어드민 ID와 함께 남긴다', async () => {
    const { audit, service } = makeFixture({ 'stores/store-1': { commissionRate: 0.1 } });

    await service.setCommission('store-1', { rate: 0.15 }, 'admin-1');

    expect(audit.logAdmin).toHaveBeenCalledWith({
      action: 'admin.store.commission_changed',
      actorId: 'admin-1',
      targetType: 'store',
      targetId: 'store-1',
      before: { commissionRate: 0.1 },
      after: { commissionRate: 0.15 },
    });
  });

  it('소비자 정지는 사유를 함께 남기고, 해제는 별도 행동으로 남긴다', async () => {
    const { audit, service } = makeFixture({ 'users/user-1': { role: 'consumer' } });

    await service.suspendUser('user-1', { suspended: true, reason: '결제 분쟁 확인' }, 'admin-1');
    await service.suspendUser('user-1', { suspended: false }, 'admin-1');

    expect(audit.logAdmin.mock.calls.map((call) => call[0].action)).toEqual([
      'admin.user.suspended',
      'admin.user.unsuspended',
    ]);
    expect(audit.logAdmin.mock.calls[0][0]).toMatchObject({
      targetId: 'user-1',
      before: { suspended: false },
      after: { suspended: true },
      reason: '결제 분쟁 확인',
    });
  });

  it('없는 대상이면 작업도 기록도 하지 않는다', async () => {
    const { audit, service } = makeFixture({});

    await expect(service.archiveStore('store-x', 'admin-1')).rejects.toThrow(
      '스토어를 찾을 수 없습니다.',
    );
    await expect(service.approveDriver('driver-x', 'admin-1')).rejects.toThrow(
      '드라이버를 찾을 수 없습니다.',
    );
    expect(audit.logAdmin).not.toHaveBeenCalled();
  });

  it('강제 환불은 성공했을 때만 사유와 함께 남긴다', async () => {
    const order = { schemaVersion: 2, roundId: 'round-1', storeId: 'store-1', status: 'ACCEPTED' };
    const ok = makeFixture({ 'orders/order-1': order });
    await ok.service.forceRefund('order-1', { reason: '꽃 상태 불량' }, 'admin-1');
    expect(ok.audit.logAdmin).toHaveBeenCalledWith({
      action: 'admin.order.force_refunded',
      actorId: 'admin-1',
      targetType: 'order',
      targetId: 'order-1',
      before: { status: 'ACCEPTED' },
      after: { status: 'CANCELLED' },
      reason: '꽃 상태 불량',
    });

    const failed = makeFixture({ 'orders/order-1': order });
    failed.roundLifecycle.cancelForRound.mockRejectedValue(new Error('환불 실패'));
    await expect(failed.service.forceRefund('order-1', {}, 'admin-1')).rejects.toThrow('환불 실패');
    expect(failed.audit.logAdmin).not.toHaveBeenCalled();
  });

  it('배너 수정은 바꾼 칸만 이전 값과 함께 남긴다', async () => {
    const { audit, service } = makeFixture({
      'banners/main_hero': { headline: '옛 문구', imageUrl: 'https://img/old.jpg' },
    });

    await service.upsertBanner({ headline: '새 문구' } as never, 'admin-1');

    expect(audit.logAdmin).toHaveBeenCalledWith({
      action: 'admin.banner.updated',
      actorId: 'admin-1',
      targetType: 'banner',
      targetId: 'main_hero',
      before: { headline: '옛 문구' },
      after: { headline: '새 문구' },
    });
  });

  it('기록 저장이 실패해도 이미 끝난 작업은 성공으로 돌려준다', async () => {
    const { audit, service } = makeFixture({ 'stores/store-1': { status: 'archived' } });
    audit.logAdmin.mockRejectedValue(new Error('firestore down'));

    await expect(service.restoreStore('store-1', 'admin-1')).resolves.toEqual({
      storeId: 'store-1',
      status: 'active',
    });
  });
});
