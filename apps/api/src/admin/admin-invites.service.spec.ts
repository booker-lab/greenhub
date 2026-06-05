import { AdminService } from './admin.service';

function createInviteRevokeService(invite: Record<string, unknown> | null) {
  const tx = {
    get: jest.fn().mockResolvedValue({
      exists: invite !== null,
      data: () => invite,
    }),
    set: jest.fn(),
  };
  const ref = { path: 'invites/INVITE1234567890' };
  const firestore = {
    doc: jest.fn().mockReturnValue(ref),
    runTransaction: jest.fn((handler) => handler(tx)),
    Timestamp: {
      now: jest.fn(() => 'now'),
    },
  };
  const service = new AdminService(firestore as never, {} as never);
  return { service, tx, ref };
}

function createInviteRollbackService(
  invite: Record<string, unknown> | null,
  user: Record<string, unknown> | null,
  options: {
    store?: Record<string, unknown> | null;
    hasOrders?: boolean;
    hasSettlements?: boolean;
  } = {},
) {
  const inviteRef = { path: 'invites/INVITE1234567890' };
  const userRef = { path: 'users/seller-1' };
  const storeRef = { path: 'stores/store-1' };
  const refreshRef = { path: 'refreshTokens/seller-1' };
  const orderQuery = { kind: 'orders-query' };
  const settlementQuery = { kind: 'settlements-query' };
  const tx = {
    get: jest.fn((ref) => {
      if (ref === inviteRef) {
        return Promise.resolve({ exists: invite !== null, data: () => invite });
      }
      if (ref === userRef) {
        return Promise.resolve({ exists: user !== null, data: () => user });
      }
      if (ref === storeRef) {
        const store = options.store === undefined ? { id: 'store-1' } : options.store;
        return Promise.resolve({ exists: store !== null, data: () => store });
      }
      if (ref === orderQuery) {
        return Promise.resolve({ empty: options.hasOrders !== true });
      }
      if (ref === settlementQuery) {
        return Promise.resolve({ empty: options.hasSettlements !== true });
      }
      return Promise.resolve({ exists: false, data: () => null });
    }),
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const firestore = {
    doc: jest.fn((path: string) => {
      if (path === 'invites/INVITE1234567890') return inviteRef;
      if (path === 'users/seller-1') return userRef;
      if (path === 'stores/store-1') return storeRef;
      if (path === 'refreshTokens/seller-1') return refreshRef;
      return { path };
    }),
    collection: jest.fn((name: string) => ({
      where: jest.fn().mockReturnThis(),
      limit: jest.fn(() => (name === 'orders' ? orderQuery : settlementQuery)),
    })),
    runTransaction: jest.fn((handler) => handler(tx)),
    Timestamp: {
      now: jest.fn(() => 'now'),
    },
  };
  const service = new AdminService(firestore as never, {} as never);
  return { service, tx, inviteRef, userRef, storeRef, refreshRef };
}

function createGenerateInviteService(nowDate = new Date('2026-06-04T00:00:00.000Z')) {
  const set = jest.fn().mockResolvedValue(undefined);
  const fromDate = jest.fn((date: Date) => ({ iso: date.toISOString() }));
  const firestore = {
    doc: jest.fn().mockReturnValue({ set }),
    Timestamp: {
      now: jest.fn(() => ({ iso: nowDate.toISOString(), toDate: () => nowDate })),
      fromDate,
    },
  };
  const service = new AdminService(firestore as never, {} as never);
  return { service, set, fromDate };
}

function createInviteDocs(tokens: string[]) {
  return tokens.map((token, index) => ({
    data: () => ({
      token,
      createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 29, 3, index)) },
    }),
  }));
}

function createInvitesService(tokens: string[]) {
  const docs = createInviteDocs(tokens);
  const query = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    startAfter: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs }),
  };
  const firestore = {
    collection: jest.fn().mockReturnValue(query),
    Timestamp: {
      fromDate: jest.fn((date: Date) => date),
    },
  };
  const service = new AdminService(firestore as never, {} as never);
  return { service, query, firestore };
}

describe('AdminService.revokeInvite', () => {
  const validInvite = {
    usedAt: null,
    revokedAt: null,
    expiresAt: { toMillis: () => Date.now() + 60_000 },
  };

  it('유효한 토큰에 취소 시각과 취소 관리자를 기록한다', async () => {
    const { service, tx, ref } = createInviteRevokeService(validInvite);

    await expect(service.revokeInvite('INVITE1234567890', 'admin-1')).resolves.toEqual({
      ok: true,
    });

    expect(tx.set).toHaveBeenCalledWith(
      ref,
      { revokedAt: 'now', revokedBy: 'admin-1' },
      { merge: true },
    );
  });

  it('이미 사용된 토큰은 409 reason으로 거절한다', async () => {
    const { service, tx } = createInviteRevokeService({ ...validInvite, usedAt: 'used' });

    await expect(service.revokeInvite('INVITE1234567890', 'admin-1')).rejects.toMatchObject({
      status: 409,
      response: { reason: 'already_used' },
    });
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('이미 취소된 토큰은 409 reason으로 거절한다', async () => {
    const { service, tx } = createInviteRevokeService({ ...validInvite, revokedAt: 'revoked' });

    await expect(service.revokeInvite('INVITE1234567890', 'admin-1')).rejects.toMatchObject({
      status: 409,
      response: { reason: 'already_revoked' },
    });
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('만료된 토큰은 409 reason으로 거절한다', async () => {
    const { service, tx } = createInviteRevokeService({
      ...validInvite,
      expiresAt: { toMillis: () => Date.now() - 60_000 },
    });

    await expect(service.revokeInvite('INVITE1234567890', 'admin-1')).rejects.toMatchObject({
      status: 409,
      response: { reason: 'expired' },
    });
    expect(tx.set).not.toHaveBeenCalled();
  });
});

describe('AdminService.rollbackInviteSeller', () => {
  const usedInvite = {
    usedAt: 'used',
    usedBy: 'seller-1',
    sellerRollbackAt: null,
  };
  const sellerUser = {
    id: 'seller-1',
    role: 'seller',
    storeId: null,
    suspended: false,
  };

  it('스토어가 없는 판매자 계정을 정지하고 초대 rollback 감사 필드를 기록한다', async () => {
    const { service, tx, inviteRef, userRef, refreshRef } = createInviteRollbackService(
      usedInvite,
      sellerUser,
    );

    await expect(service.rollbackInviteSeller('INVITE1234567890', 'admin-1')).resolves.toEqual({
      ok: true,
      userId: 'seller-1',
    });

    expect(tx.update).toHaveBeenCalledWith(userRef, {
      suspended: true,
      sellerRolledBackAt: 'now',
      sellerRolledBackBy: 'admin-1',
      updatedAt: 'now',
    });
    expect(tx.set).toHaveBeenCalledWith(
      inviteRef,
      { sellerRollbackAt: 'now', sellerRollbackBy: 'admin-1' },
      { merge: true },
    );
    expect(tx.delete).toHaveBeenCalledWith(refreshRef);
  });

  it('사용 전 토큰은 409 not_used로 거절한다', async () => {
    const { service, tx } = createInviteRollbackService(
      { ...usedInvite, usedAt: null, usedBy: null },
      sellerUser,
    );

    await expect(service.rollbackInviteSeller('INVITE1234567890', 'admin-1')).rejects.toMatchObject(
      {
        status: 409,
        response: { reason: 'not_used' },
      },
    );
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('이미 rollback된 토큰은 409 already_rolled_back으로 거절한다', async () => {
    const { service, tx } = createInviteRollbackService(
      { ...usedInvite, sellerRollbackAt: 'rolled-back' },
      sellerUser,
    );

    await expect(service.rollbackInviteSeller('INVITE1234567890', 'admin-1')).rejects.toMatchObject(
      {
        status: 409,
        response: { reason: 'already_rolled_back' },
      },
    );
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('판매자가 아닌 계정은 409 not_seller로 거절한다', async () => {
    const { service, tx } = createInviteRollbackService(usedInvite, {
      ...sellerUser,
      role: 'consumer',
    });

    await expect(service.rollbackInviteSeller('INVITE1234567890', 'admin-1')).rejects.toMatchObject(
      {
        status: 409,
        response: { reason: 'not_seller' },
      },
    );
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('스토어가 연결됐어도 주문·정산 기록이 없으면 스토어를 보존 아카이브하고 판매자를 정지한다', async () => {
    const { service, tx, storeRef } = createInviteRollbackService(usedInvite, {
      ...sellerUser,
      storeId: 'store-1',
    });

    await expect(service.rollbackInviteSeller('INVITE1234567890', 'admin-1')).resolves.toEqual({
      ok: true,
      userId: 'seller-1',
    });

    expect(tx.update).toHaveBeenCalledWith(
      storeRef,
      expect.objectContaining({
        status: 'archived',
        archivedAt: 'now',
        archivedBy: 'admin-1',
        archiveReason: 'invite_seller_rollback',
      }),
    );
  });

  it('스토어가 연결됐고 주문 기록이 있으면 409 store_has_records로 거절한다', async () => {
    const { service, tx } = createInviteRollbackService(
      usedInvite,
      {
        ...sellerUser,
        storeId: 'store-1',
      },
      { hasOrders: true },
    );

    await expect(service.rollbackInviteSeller('INVITE1234567890', 'admin-1')).rejects.toMatchObject(
      {
        status: 409,
        response: { reason: 'store_has_records' },
      },
    );
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('스토어 문서가 없으면 409 store_not_found로 거절한다', async () => {
    const { service, tx } = createInviteRollbackService(
      usedInvite,
      {
        ...sellerUser,
        storeId: 'store-1',
      },
      { store: null },
    );

    await expect(service.rollbackInviteSeller('INVITE1234567890', 'admin-1')).rejects.toMatchObject(
      {
        status: 409,
        response: { reason: 'store_not_found' },
      },
    );
    expect(tx.update).not.toHaveBeenCalled();
  });
});

describe('AdminService.generateInvite', () => {
  it('만료기간을 지정하지 않으면 기존 7일 만료로 발급한다', async () => {
    const { service, set, fromDate } = createGenerateInviteService();

    const result = await service.generateInvite('admin-1');

    expect(result.token).toHaveLength(16);
    expect(result.expiresAt).toBe('2026-06-11T00:00:00.000Z');
    expect(fromDate).toHaveBeenCalledWith(new Date('2026-06-11T00:00:00.000Z'));
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        token: result.token,
        tokenPrefixes: expect.arrayContaining([result.token.slice(0, 4), result.token]),
        createdBy: 'admin-1',
        expiresAt: { iso: '2026-06-11T00:00:00.000Z' },
      }),
    );
  });

  it('요청한 만료기간 일수로 expiresAt을 계산한다', async () => {
    const { service, fromDate } = createGenerateInviteService();

    const result = await service.generateInvite('admin-1', 14);

    expect(result.expiresAt).toBe('2026-06-18T00:00:00.000Z');
    expect(fromDate).toHaveBeenCalledWith(new Date('2026-06-18T00:00:00.000Z'));
  });
});

describe('AdminService.getInvites', () => {
  it('기본 최신순 50건 조회와 다음 커서를 반환한다', async () => {
    const { service, query } = createInvitesService(
      Array.from({ length: 51 }, (_, index) => `INVITE${String(index + 1).padStart(10, '0')}`),
    );

    const result = await service.getInvites({});

    expect(result.invites).toHaveLength(50);
    expect(result.nextCursor).toBe('2026-05-29T03:49:00.000Z');
    expect(query.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(query.limit).toHaveBeenCalledWith(51);
  });

  it('4자 이상 prefix 검색은 tokenPrefixes와 최신순 커서를 사용한다', async () => {
    const { service, query } = createInvitesService(['ABCD000000000001', 'ABCD000000000002']);

    const result = await service.getInvites({
      q: 'abcd',
      limit: 1,
      cursor: '2026-05-29T01:00:00.000Z',
    });

    expect(result.invites).toHaveLength(1);
    expect(result.nextCursor).toBe('2026-05-29T03:00:00.000Z');
    expect(query.where).toHaveBeenCalledWith('tokenPrefixes', 'array-contains', 'ABCD');
    expect(query.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(query.startAfter).toHaveBeenCalledWith(new Date('2026-05-29T01:00:00.000Z'));
    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it('4자 미만 q는 검색하지 않고 최신순 커서를 사용한다', async () => {
    const { service, query, firestore } = createInvitesService(['INVITE0000000001']);

    await service.getInvites({ q: 'INV', cursor: '2026-05-29T01:00:00.000Z' });

    expect(query.where).not.toHaveBeenCalled();
    expect(query.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(firestore.Timestamp.fromDate).toHaveBeenCalledWith(new Date('2026-05-29T01:00:00.000Z'));
    expect(query.startAfter).toHaveBeenCalledWith(new Date('2026-05-29T01:00:00.000Z'));
  });
});
