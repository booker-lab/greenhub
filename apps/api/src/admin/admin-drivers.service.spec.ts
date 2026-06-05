import { AdminService } from './admin.service';

function createDriverDocs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    data: () => ({
      id: `driver-${index + 1}`,
      name: `드라이버 ${index + 1}`,
      email: index === 0 ? 'driver@example.com' : null,
      phone: index === 0 ? '010-1111-2222' : undefined,
      vehicleType: index === 0 ? '냉장 탑차' : undefined,
      vehicleNumber: index === 0 ? '서울12가3456' : undefined,
      driverApproved: index % 2 === 0,
      suspended: false,
      createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 29, 3, index)) },
      passwordHash: 'secret',
    }),
  }));
}

function createDriversService(count = 2) {
  const docs = createDriverDocs(count);
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

describe('AdminService.getDrivers', () => {
  it('기본 최신순 100건 조회와 다음 커서를 반환한다', async () => {
    const { service, query } = createDriversService(101);

    const result = await service.getDrivers({});

    expect(result.drivers).toHaveLength(100);
    expect(result.total).toBe(100);
    expect(result.nextCursor).toBe('2026-05-29T04:39:00.000Z');
    expect(query.where).toHaveBeenCalledWith('role', '==', 'driver');
    expect(query.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(query.limit).toHaveBeenCalledWith(101);
  });

  it('status, 오래된순, limit, cursor를 Firestore 쿼리에 적용한다', async () => {
    const { service, query, firestore } = createDriversService();

    await service.getDrivers({
      status: 'approved',
      sort: 'createdAt_asc',
      limit: 1,
      cursor: '2026-05-29T01:00:00.000Z',
    });

    expect(query.where).toHaveBeenCalledWith('role', '==', 'driver');
    expect(query.where).toHaveBeenCalledWith('driverApproved', '==', true);
    expect(query.orderBy).toHaveBeenCalledWith('createdAt', 'asc');
    expect(firestore.Timestamp.fromDate).toHaveBeenCalledWith(new Date('2026-05-29T01:00:00.000Z'));
    expect(query.startAfter).toHaveBeenCalledWith(new Date('2026-05-29T01:00:00.000Z'));
    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it('연락처와 선택 차량 정보를 포함하고 비밀번호 해시는 제외한다', async () => {
    const { service } = createDriversService();

    const result = await service.getDrivers({});

    expect(result.drivers[0]).toEqual(
      expect.objectContaining({
        id: 'driver-1',
        phone: '010-1111-2222',
        vehicleType: '냉장 탑차',
        vehicleNumber: '서울12가3456',
      }),
    );
    expect(result.drivers[1]).toEqual(
      expect.objectContaining({
        id: 'driver-2',
        phone: null,
        vehicleType: null,
        vehicleNumber: null,
      }),
    );
    expect(result.drivers[0]).not.toHaveProperty('passwordHash');
  });
});
