import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { AdminService } from './admin.service';

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({ revokeRefreshTokens: jest.fn().mockResolvedValue(undefined) })),
}));

const FIELD_DELETED = '__deleted__';

// 판매자 치우기·복구: 기록 확인과 상태 변경이 한 트랜잭션이고, 치우기 전 상태로 되돌린다.
function makeFixture() {
  const occ = createOccFirestore();
  const firestore = {
    ...occ.firestore,
    FieldValue: { ...occ.firestore.FieldValue, delete: () => FIELD_DELETED },
  };
  const audit = { logAdmin: jest.fn().mockResolvedValue(undefined), listAdmin: jest.fn() };
  const service = new AdminService(
    firestore as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
  );
  return { occ, audit, service };
}

describe('AdminService 판매자 치우기', () => {
  it.each([
    ['invited', 'invited'],
    ['active', 'active'],
    [undefined, 'active'],
  ])('상태 %p 판매자를 치우면 archivedFromStatus=%p로 남기고 기록한다', async (status, from) => {
    const { occ, audit, service } = makeFixture();
    occ.seed('stores/s-1', { id: 's-1', ...(status ? { status } : {}) });

    await expect(service.archiveStore('s-1', 'admin-1')).resolves.toEqual({
      storeId: 's-1',
      status: 'archived',
    });

    expect(occ.getData('stores/s-1')).toMatchObject({
      status: 'archived',
      archivedFromStatus: from,
    });
    expect(audit.logAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.store.archived',
        before: { status: status ?? null },
        after: { status: 'archived' },
      }),
    );
  });

  it.each([
    ['orders/o-1', { id: 'o-1', storeId: 's-1' }],
    ['settlements/o-1', { id: 'o-1', storeId: 's-1' }],
  ])('%s 기록이 있으면 400으로 막고 바꾸지 않는다', async (path, data) => {
    const { occ, audit, service } = makeFixture();
    occ.seed('stores/s-1', { id: 's-1', status: 'active' });
    occ.seed(path, data);

    await expect(service.archiveStore('s-1', 'admin-1')).rejects.toMatchObject({ status: 400 });
    expect(occ.getData('stores/s-1')).toEqual({ id: 's-1', status: 'active' });
    expect(audit.logAdmin).not.toHaveBeenCalled();
  });

  it('이미 치운 판매자는 409로 거절해 이전 상태를 덮어쓰지 않는다', async () => {
    const { occ, service } = makeFixture();
    occ.seed('stores/s-1', { id: 's-1', status: 'archived', archivedFromStatus: 'invited' });

    await expect(service.archiveStore('s-1', 'admin-1')).rejects.toMatchObject({ status: 409 });
    expect(occ.getData('stores/s-1')).toMatchObject({ archivedFromStatus: 'invited' });
  });

  it('커밋 직전에 다른 관리자가 먼저 치우면 다시 읽어 409로 끝난다', async () => {
    const { occ, service } = makeFixture();
    occ.seed('stores/s-1', { id: 's-1', status: 'invited' });
    occ.setBeforeCommit(() => {
      occ.updateOutsideTransaction('stores/s-1', {
        status: 'archived',
        archivedFromStatus: 'invited',
      });
    });

    await expect(service.archiveStore('s-1', 'admin-1')).rejects.toMatchObject({ status: 409 });
    expect(occ.getData('stores/s-1')).toMatchObject({ archivedFromStatus: 'invited' });
  });
});

describe('AdminService 판매자 복구', () => {
  it.each([
    ['invited', 'invited'],
    ['active', 'active'],
    [undefined, 'active'],
    ['archived', 'active'],
  ])('archivedFromStatus=%p 이면 %p로 되돌리고 표시를 지운다', async (from, restored) => {
    const { occ, audit, service } = makeFixture();
    occ.seed('stores/s-1', {
      id: 's-1',
      status: 'archived',
      archivedAt: 'then',
      ...(from ? { archivedFromStatus: from } : {}),
    });

    await expect(service.restoreStore('s-1', 'admin-1')).resolves.toEqual({
      storeId: 's-1',
      status: restored,
    });
    expect(occ.getData('stores/s-1')).toMatchObject({
      status: restored,
      archivedAt: FIELD_DELETED,
      archivedFromStatus: FIELD_DELETED,
    });
    expect(audit.logAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.store.restored',
        before: { status: 'archived' },
        after: { status: restored },
      }),
    );
  });

  it.each(['active', 'invited', undefined])(
    '치운 상태가 아닌 판매자(status=%p)는 409로 거부하고 바꾸지 않는다',
    async (status) => {
      const { occ, service } = makeFixture();
      occ.seed('stores/s-1', { id: 's-1', ...(status ? { status } : {}) });

      await expect(service.restoreStore('s-1', 'admin-1')).rejects.toMatchObject({ status: 409 });
      expect(occ.getVersion('stores/s-1')).toBe(0);
    },
  );

  it('없는 판매자는 404', async () => {
    const { service } = makeFixture();

    await expect(service.restoreStore('none', 'admin-1')).rejects.toMatchObject({ status: 404 });
  });
});
