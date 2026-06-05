import { ForbiddenException } from '@nestjs/common';
import { HubsService } from './hubs.service';

type DocMap = Record<string, Record<string, unknown>>;

function createFirestoreMock(docs: DocMap) {
  const collection = jest.fn((name: string) => {
    const state = {
      filters: [] as Array<[string, unknown]>,
      orderField: null as string | null,
    };
    const query: any = {
      where(field: string, _op: string, value: unknown) {
        state.filters.push([field, value]);
        return query;
      },
      orderBy(field: string) {
        state.orderField = field;
        return query;
      },
      async get() {
        const rows = Object.entries(docs)
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([_path, data]) => data)
          .filter((data) => state.filters.every(([field, value]) => data[field] === value));

        const orderField = state.orderField;
        if (orderField) {
          rows.sort((a, b) =>
            String(a[orderField] ?? '').localeCompare(String(b[orderField] ?? '')),
          );
        }

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
    async set(data: Record<string, unknown>) {
      docs[path] = data;
    },
    async update(data: Record<string, unknown>) {
      docs[path] = { ...docs[path], ...data };
    },
    async delete() {
      delete docs[path];
    },
  }));

  return {
    collection,
    doc,
    FieldValue: {
      arrayRemove: jest.fn((value: unknown) => ({ arrayRemove: value })),
      arrayUnion: jest.fn((value: unknown) => ({ arrayUnion: value })),
      serverTimestamp: jest.fn(() => 'server-now'),
    },
    Timestamp: {
      now: jest.fn(() => ({ toDate: () => new Date('2026-06-05T00:00:00.000Z') })),
      fromDate: jest.fn((date: Date) => ({ iso: date.toISOString() })),
    },
  };
}

describe('HubsService hub_staff 권한', () => {
  it('판매자 소유자는 기존처럼 모든 거점을 조회할 수 있다', async () => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1', name: 'A', createdAt: '2026-01-01' },
      'hubs/hub-2': { id: 'hub-2', storeId: 'store-1', name: 'B', createdAt: '2026-01-02' },
    });
    const service = new HubsService(firestore as any);

    const result = await service.getHubs('store-1', 'seller-1', 'seller');

    expect(result.hubs).toHaveLength(2);
  });

  it('hub_staff는 배정된 거점만 목록에 볼 수 있다', async () => {
    const firestore = createFirestoreMock({
      'hubs/hub-1': {
        id: 'hub-1',
        storeId: 'store-1',
        name: 'A',
        staffIds: ['staff-1'],
        createdAt: '2026-01-01',
      },
      'hubs/hub-2': {
        id: 'hub-2',
        storeId: 'store-1',
        name: 'B',
        staffIds: [],
        createdAt: '2026-01-02',
      },
    });
    const service = new HubsService(firestore as any);

    const result = await service.getHubs('store-1', 'staff-1', 'hub_staff');

    expect(result.hubs).toEqual([expect.objectContaining({ id: 'hub-1', staffIds: ['staff-1'] })]);
  });

  it('hub_staff는 JWT storeId와 다른 store 경로의 거점 목록을 조회할 수 없다', async () => {
    const firestore = createFirestoreMock({
      'hubs/hub-1': {
        id: 'hub-1',
        storeId: 'store-2',
        name: 'A',
        staffIds: ['staff-1'],
        createdAt: '2026-01-01',
      },
    });
    const service = new HubsService(firestore as any);

    await expect(
      service.getHubs('store-2', 'staff-1', 'hub_staff', {
        storeId: 'store-1',
        hubId: 'hub-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hub_staff는 JWT hubId와 다른 거점 상세를 조회할 수 없다', async () => {
    const firestore = createFirestoreMock({
      'hubs/hub-2': { id: 'hub-2', storeId: 'store-1', name: 'B', staffIds: ['staff-1'] },
    });
    const service = new HubsService(firestore as any);

    await expect(
      service.getHub('store-1', 'hub-2', 'staff-1', 'hub_staff', {
        storeId: 'store-1',
        hubId: 'hub-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hub_staff는 배정되지 않은 거점 상세를 조회할 수 없다', async () => {
    const firestore = createFirestoreMock({
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1', name: 'A', staffIds: [] },
    });
    const service = new HubsService(firestore as any);

    await expect(service.getHub('store-1', 'hub-1', 'staff-1', 'hub_staff')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('hub_staff는 거점을 생성할 수 없다', async () => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
    });
    const service = new HubsService(firestore as any);

    await expect(
      service.createHub('store-1', 'staff-1', 'hub_staff', {
        name: '새 거점',
        address: '서울시 강남구',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('판매자 소유자는 거점 스태프 초대 링크를 발급할 수 있다', async () => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1', name: 'A', staffIds: [] },
    });
    const service = new HubsService(firestore as any);

    const result = await service.createHubStaffInvite('store-1', 'hub-1', 'seller-1', 'seller', {
      expiresInDays: 14,
    });

    expect(result.token).toHaveLength(16);
    expect(result.inviteUrl).toContain(`/staff-invite?token=${result.token}`);
    expect(firestore.doc).toHaveBeenCalledWith(`hubStaffInvites/${result.token}`);
  });

  it('판매자 소유자는 배정된 거점 스태프 목록을 조회할 수 있다', async () => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1', name: 'A', staffIds: ['staff-1'] },
      'users/staff-1': {
        id: 'staff-1',
        name: '거점 스태프',
        email: 'staff@example.com',
        role: 'hub_staff',
        storeId: 'store-1',
        hubId: 'hub-1',
      },
    });
    const service = new HubsService(firestore as any);

    const result = await service.getHubStaff('store-1', 'hub-1', 'seller-1', 'seller');

    expect(result.staff).toEqual([
      { id: 'staff-1', name: '거점 스태프', email: 'staff@example.com', suspended: false },
    ]);
  });

  it('판매자 소유자는 거점 스태프 권한을 회수할 수 있다', async () => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1', name: 'A', staffIds: ['staff-1'] },
      'users/staff-1': {
        id: 'staff-1',
        name: '거점 스태프',
        role: 'hub_staff',
        storeId: 'store-1',
        hubId: 'hub-1',
      },
      'refreshTokens/staff-1': { token: 'old-refresh' },
    });
    const service = new HubsService(firestore as any);

    await service.revokeHubStaff('store-1', 'hub-1', 'staff-1', 'seller-1', 'seller');

    expect(firestore.FieldValue.arrayRemove).toHaveBeenCalledWith('staff-1');
    expect(firestore.doc).toHaveBeenCalledWith('refreshTokens/staff-1');
  });

  it('hub_staff는 JWT hubIds에 포함된 배정 거점 목록만 조회한다', async () => {
    const firestore = createFirestoreMock({
      'hubs/hub-1': {
        id: 'hub-1',
        storeId: 'store-1',
        name: 'A',
        staffIds: ['staff-1'],
        createdAt: '2026-01-01',
      },
      'hubs/hub-2': {
        id: 'hub-2',
        storeId: 'store-1',
        name: 'B',
        staffIds: ['staff-1'],
        createdAt: '2026-01-02',
      },
      'hubs/hub-3': {
        id: 'hub-3',
        storeId: 'store-1',
        name: 'C',
        staffIds: ['staff-1'],
        createdAt: '2026-01-03',
      },
    });
    const service = new HubsService(firestore as any);

    const result = await service.getHubs('store-1', 'staff-1', 'hub_staff', {
      storeId: 'store-1',
      hubIds: ['hub-1', 'hub-3'],
    });

    expect(result.hubs.map((hub) => hub.id)).toEqual(['hub-1', 'hub-3']);
  });

  it('다중 거점 배정 스태프는 일부 거점 회수 시 계정을 정지하지 않는다', async () => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1', name: 'A', staffIds: ['staff-1'] },
      'users/staff-1': {
        id: 'staff-1',
        role: 'hub_staff',
        storeId: 'store-1',
        hubId: 'hub-1',
        hubIds: ['hub-1', 'hub-2'],
      },
    });
    const service = new HubsService(firestore as any);

    await service.revokeHubStaff('store-1', 'hub-1', 'staff-1', 'seller-1', 'seller');

    expect(firestore.doc).not.toHaveBeenCalledWith('refreshTokens/staff-1');
  });

  it('기존 hub_staff 중 현재 거점에 없는 계정만 추가 배정 후보로 조회한다', async () => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1', name: 'A', staffIds: ['staff-1'] },
      'users/staff-1': {
        id: 'staff-1',
        role: 'hub_staff',
        storeId: 'store-1',
        hubIds: ['hub-1'],
      },
      'users/staff-2': {
        id: 'staff-2',
        name: '추가 스태프',
        email: 'staff2@example.com',
        role: 'hub_staff',
        storeId: 'store-1',
        hubIds: ['hub-2'],
      },
      'users/staff-3': {
        id: 'staff-3',
        role: 'hub_staff',
        storeId: 'store-2',
        hubIds: ['hub-3'],
      },
    });
    const service = new HubsService(firestore as any);

    const result = await service.getHubStaffCandidates('store-1', 'hub-1', 'seller-1', 'seller');

    expect(result.staff).toEqual([
      {
        id: 'staff-2',
        name: '추가 스태프',
        email: 'staff2@example.com',
        hubIds: ['hub-2'],
      },
    ]);
  });

  it('판매자는 기존 hub_staff를 추가 거점에 배정할 수 있다', async () => {
    const firestore = createFirestoreMock({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'hubs/hub-1': { id: 'hub-1', storeId: 'store-1', name: 'A', staffIds: [] },
      'users/staff-1': {
        id: 'staff-1',
        role: 'hub_staff',
        storeId: 'store-1',
        hubId: 'hub-2',
        hubIds: ['hub-2'],
      },
    });
    const service = new HubsService(firestore as any);

    await service.assignHubStaff('store-1', 'hub-1', 'staff-1', 'seller-1', 'seller');

    expect(firestore.FieldValue.arrayUnion).toHaveBeenCalledWith('staff-1');
  });
});
