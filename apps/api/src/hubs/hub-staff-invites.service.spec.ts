import { ConflictException, ForbiddenException } from '@nestjs/common';
import { HubStaffInvitesService } from './hub-staff-invites.service';

type DocMap = Record<string, Record<string, unknown>>;

function createFirestoreMock(docs: DocMap) {
  const collection = jest.fn((name: string) => {
    const state = {
      filters: [] as Array<[string, unknown]>,
    };
    const query: any = {
      where(field: string, _op: string, value: unknown) {
        state.filters.push([field, value]);
        return query;
      },
      orderBy() {
        return query;
      },
      async get() {
        const rows = Object.entries(docs)
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([_path, data]) => data)
          .filter((data) => state.filters.every(([field, value]) => data[field] === value));

        return { docs: rows.map((data) => ({ data: () => data })) };
      },
    };
    return query;
  });

  const doc = jest.fn((path: string) => ({
    async get() {
      const data = docs[path];
      return { exists: !!data, data: () => data };
    },
    async update(data: Record<string, unknown>) {
      docs[path] = { ...docs[path], ...data };
    },
  }));

  return {
    collection,
    doc,
    Timestamp: {
      now: jest.fn(() => ({ toDate: () => new Date('2026-06-05T00:00:00.000Z') })),
    },
  };
}

describe('HubStaffInvitesService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-05T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('판매자 소유자는 해당 거점 초대 목록을 조회할 수 있다', async () => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1' },
      'hubStaffInvites/TOKEN1': {
        token: 'TOKEN1',
        storeId: 'store-1',
        hubId: 'hub-1',
        expiresAt: new Date('2026-06-12T00:00:00.000Z'),
        createdAt: new Date('2026-06-05T00:00:00.000Z'),
      },
      'hubStaffInvites/TOKEN2': {
        token: 'TOKEN2',
        storeId: 'store-1',
        hubId: 'hub-2',
        expiresAt: new Date('2026-06-12T00:00:00.000Z'),
        createdAt: new Date('2026-06-05T00:00:00.000Z'),
      },
    });
    const service = new HubStaffInvitesService(firestore as any);

    const result = await service.getHubStaffInvites('store-1', 'hub-1', 'seller-1', 'seller');

    expect(result.invites).toEqual([
      expect.objectContaining({
        token: 'TOKEN1',
        inviteUrl: expect.stringContaining('/staff-invite?token=TOKEN1'),
        revokedAt: null,
        usedAt: null,
      }),
    ]);
  });

  it('판매자 소유자가 아니면 초대 목록을 조회할 수 없다', async () => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1' },
    });
    const service = new HubStaffInvitesService(firestore as any);

    await expect(
      service.getHubStaffInvites('store-1', 'hub-1', 'staff-1', 'hub_staff'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('미사용 초대 취소는 감사 필드를 기록한다', async () => {
    const docs = {
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1' },
      'hubStaffInvites/TOKEN1': {
        token: 'TOKEN1',
        storeId: 'store-1',
        hubId: 'hub-1',
        expiresAt: new Date('2026-06-12T00:00:00.000Z'),
        createdAt: new Date('2026-06-05T00:00:00.000Z'),
      },
    };
    const firestore = createFirestoreMock(docs);
    const service = new HubStaffInvitesService(firestore as any);

    await service.revokeHubStaffInvite('store-1', 'hub-1', 'TOKEN1', 'seller-1', 'seller');

    expect(docs['hubStaffInvites/TOKEN1']).toEqual(
      expect.objectContaining({
        revokedAt: expect.any(Object),
        revokedBy: 'seller-1',
        updatedAt: expect.any(Object),
      }),
    );
  });

  it.each([
    ['이미 사용된 초대', { usedAt: new Date('2026-06-05T00:00:00.000Z') }],
    ['이미 취소된 초대', { revokedAt: new Date('2026-06-05T00:00:00.000Z') }],
    ['만료된 초대', { expiresAt: new Date('2026-06-04T00:00:00.000Z') }],
  ])('%s는 취소할 수 없다', async (_label, invitePatch) => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1' },
      'hubStaffInvites/TOKEN1': {
        token: 'TOKEN1',
        storeId: 'store-1',
        hubId: 'hub-1',
        expiresAt: new Date('2026-06-12T00:00:00.000Z'),
        createdAt: new Date('2026-06-05T00:00:00.000Z'),
        ...invitePatch,
      },
    });
    const service = new HubStaffInvitesService(firestore as any);

    await expect(
      service.revokeHubStaffInvite('store-1', 'hub-1', 'TOKEN1', 'seller-1', 'seller'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
