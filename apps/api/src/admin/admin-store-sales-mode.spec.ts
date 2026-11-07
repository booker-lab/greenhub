import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { AdminService } from './admin.service';
import { SetSalesModeDto } from './dto/admin.dto';

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({ revokeRefreshTokens: jest.fn().mockResolvedValue(undefined) })),
}));

// 관리자 판매 방식 전환: 회차 확인과 변경이 한 트랜잭션이고, 끝나지 않은 회차가 있으면 예전 방식으로 바꾸지 않는다.
function makeFixture() {
  const occ = createOccFirestore();
  const audit = { logAdmin: jest.fn().mockResolvedValue(undefined), listAdmin: jest.fn() };
  const service = new AdminService(
    occ.firestore as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
  );
  return { occ, audit, service };
}

describe('AdminService 판매 방식 전환', () => {
  it.each([
    [undefined, 'round_direct'],
    ['legacy', 'round_direct'],
    ['round_direct', 'legacy'],
  ] as const)('저장값 %p 가게를 %p로 바꾸고 사유와 함께 기록한다', async (stored, target) => {
    const { occ, audit, service } = makeFixture();
    occ.seed('stores/s-1', {
      id: 's-1',
      status: 'active',
      ...(stored ? { salesMode: stored } : {}),
    });

    await expect(
      service.setSalesMode('s-1', { salesMode: target, reason: '회차 판매 시작' }, 'admin-1'),
    ).resolves.toEqual({ storeId: 's-1', salesMode: target, changed: true });

    expect(occ.getData('stores/s-1')).toMatchObject({ salesMode: target, status: 'active' });
    expect(audit.logAdmin).toHaveBeenCalledTimes(1);
    expect(audit.logAdmin).toHaveBeenCalledWith({
      action: 'admin.store.sales_mode_changed',
      actorId: 'admin-1',
      targetType: 'store',
      targetId: 's-1',
      before: { salesMode: stored ?? null },
      after: { salesMode: target },
      reason: '회차 판매 시작',
    });
  });

  it.each([
    [undefined, 'legacy'],
    ['legacy', 'legacy'],
    ['round_direct', 'round_direct'],
  ] as const)(
    '저장값 %p 가게를 같은 값 %p로 보내면 쓰지 않고 200(멱등)',
    async (stored, target) => {
      const { occ, audit, service } = makeFixture();
      occ.seed('stores/s-1', { id: 's-1', ...(stored ? { salesMode: stored } : {}) });

      await expect(service.setSalesMode('s-1', { salesMode: target }, 'admin-1')).resolves.toEqual({
        storeId: 's-1',
        salesMode: target,
        changed: false,
      });
      expect(occ.getVersion('stores/s-1')).toBe(0);
      expect(audit.logAdmin).not.toHaveBeenCalled();
    },
  );

  it.each(['SCHEDULED', 'OPEN', 'CLOSED'])(
    '끝나지 않은 회차(%s)가 있으면 예전 방식 전환을 409로 막고 바꾸지 않는다',
    async (status) => {
      const { occ, audit, service } = makeFixture();
      occ.seed('stores/s-1', { id: 's-1', salesMode: 'round_direct' });
      occ.seed('saleRounds/r-1', { id: 'r-1', storeId: 's-1', status });

      const error = await service
        .setSalesMode('s-1', { salesMode: 'legacy' }, 'admin-1')
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 409 });
      expect((error as Error).message).toContain('끝나지 않은 회차');
      expect(occ.getData('stores/s-1')).toMatchObject({ salesMode: 'round_direct' });
      expect(occ.getVersion('stores/s-1')).toBe(0);
      expect(audit.logAdmin).not.toHaveBeenCalled();
    },
  );

  it('끝난 회차(완료·취소)·작성 중 회차와 다른 가게 회차는 막지 않는다', async () => {
    const { occ, service } = makeFixture();
    occ.seed('stores/s-1', { id: 's-1', salesMode: 'round_direct' });
    occ.seed('saleRounds/r-1', { id: 'r-1', storeId: 's-1', status: 'COMPLETED' });
    occ.seed('saleRounds/r-2', { id: 'r-2', storeId: 's-1', status: 'CANCELLED' });
    occ.seed('saleRounds/r-3', { id: 'r-3', storeId: 's-1', status: 'DRAFT' });
    occ.seed('saleRounds/r-4', { id: 'r-4', storeId: 's-2', status: 'OPEN' });

    await expect(service.setSalesMode('s-1', { salesMode: 'legacy' }, 'admin-1')).resolves.toEqual({
      storeId: 's-1',
      salesMode: 'legacy',
      changed: true,
    });
    expect(occ.getData('stores/s-1')).toMatchObject({ salesMode: 'legacy' });
  });

  it('회차 판매로 바꿀 때는 회차를 확인하지 않는다(열린 회차가 있어도 통과)', async () => {
    const { occ, service } = makeFixture();
    occ.seed('stores/s-1', { id: 's-1', salesMode: 'legacy' });
    occ.seed('saleRounds/r-1', { id: 'r-1', storeId: 's-1', status: 'OPEN' });

    await expect(
      service.setSalesMode('s-1', { salesMode: 'round_direct' }, 'admin-1'),
    ).resolves.toMatchObject({ changed: true });
  });

  it('커밋 직전에 다른 관리자가 먼저 바꾸면 다시 읽어 멱등으로 끝나고 기록을 겹쳐 남기지 않는다', async () => {
    const { occ, audit, service } = makeFixture();
    occ.seed('stores/s-1', { id: 's-1', salesMode: 'round_direct' });
    occ.setBeforeCommit(() => {
      occ.updateOutsideTransaction('stores/s-1', { salesMode: 'legacy' });
    });

    await expect(service.setSalesMode('s-1', { salesMode: 'legacy' }, 'admin-1')).resolves.toEqual({
      storeId: 's-1',
      salesMode: 'legacy',
      changed: false,
    });
    expect(occ.getData('stores/s-1')).toMatchObject({ salesMode: 'legacy' });
    expect(audit.logAdmin).not.toHaveBeenCalled();
  });

  it('치운 가게도 바꿀 수 있고 status는 그대로 둔다', async () => {
    const { occ, service } = makeFixture();
    occ.seed('stores/s-1', { id: 's-1', status: 'archived', archivedFromStatus: 'active' });

    await expect(
      service.setSalesMode('s-1', { salesMode: 'round_direct' }, 'admin-1'),
    ).resolves.toMatchObject({ changed: true });
    expect(occ.getData('stores/s-1')).toMatchObject({
      status: 'archived',
      archivedFromStatus: 'active',
      salesMode: 'round_direct',
    });
  });

  it('없는 가게는 404', async () => {
    const { audit, service } = makeFixture();

    await expect(
      service.setSalesMode('none', { salesMode: 'round_direct' }, 'admin-1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(audit.logAdmin).not.toHaveBeenCalled();
  });
});

describe('SetSalesModeDto', () => {
  function errorsOf(plain: Record<string, unknown>) {
    return validateSync(plainToInstance(SetSalesModeDto, plain), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  it('legacy·round_direct만 받고 사유는 선택(200자까지)', () => {
    expect(errorsOf({ salesMode: 'legacy' })).toHaveLength(0);
    expect(errorsOf({ salesMode: 'round_direct', reason: '가'.repeat(200) })).toHaveLength(0);
    expect(errorsOf({})).not.toHaveLength(0);
    expect(errorsOf({ salesMode: 'ROUND_DIRECT' })).not.toHaveLength(0);
    expect(errorsOf({ salesMode: 'group' })).not.toHaveLength(0);
    expect(errorsOf({ salesMode: 'legacy', reason: '가'.repeat(201) })).not.toHaveLength(0);
    expect(errorsOf({ salesMode: 'legacy', extra: true })).not.toHaveLength(0);
  });
});
