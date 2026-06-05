import { createInviteTokenPrefixes, getInvitesPage } from './admin-invites.helpers';

function createInviteDocs(tokens: string[]) {
  return tokens.map((token, index) => ({
    data: () => ({
      token,
      createdAt: { toDate: () => new Date(Date.UTC(2026, 5, 4, 3, index)) },
    }),
  }));
}

function createFirestore(tokens: string[]) {
  const query = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    startAfter: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: createInviteDocs(tokens) }),
  };
  const firestore = {
    collection: jest.fn().mockReturnValue(query),
    Timestamp: {
      fromDate: jest.fn((date: Date) => date),
    },
  };
  return { firestore, query };
}

describe('admin invite helpers', () => {
  it('토큰 검색 prefix를 4자부터 전체 길이까지 생성한다', () => {
    expect(createInviteTokenPrefixes('abcd1234')).toEqual([
      'ABCD',
      'ABCD1',
      'ABCD12',
      'ABCD123',
      'ABCD1234',
    ]);
  });

  it('4자 이상 검색은 tokenPrefixes와 createdAt desc 커서를 사용한다', async () => {
    const { firestore, query } = createFirestore(['ABCD000000000001', 'ABCD000000000002']);

    const result = await getInvitesPage(firestore as never, {
      q: 'abcd',
      limit: 1,
      cursor: '2026-06-04T01:00:00.000Z',
    });

    expect(result.invites).toHaveLength(1);
    expect(result.nextCursor).toBe('2026-06-04T03:00:00.000Z');
    expect(query.where).toHaveBeenCalledWith('tokenPrefixes', 'array-contains', 'ABCD');
    expect(query.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(firestore.Timestamp.fromDate).toHaveBeenCalledWith(new Date('2026-06-04T01:00:00.000Z'));
    expect(query.startAfter).toHaveBeenCalledWith(new Date('2026-06-04T01:00:00.000Z'));
    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it('4자 미만 검색은 기존 최신순 목록으로 처리한다', async () => {
    const { firestore, query } = createFirestore(['INVITE0000000001']);

    await getInvitesPage(firestore as never, { q: 'INV' });

    expect(query.where).not.toHaveBeenCalled();
    expect(query.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });
});
