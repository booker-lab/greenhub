import { DriverService } from './driver.service';

describe('DriverService 주문 노출 범위', () => {
  it('미배정 수거 가능 주문과 본인 배정 주문만 반환한다', async () => {
    const query = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        docs: [
          {
            id: 'pickup-direct',
            data: () => ({ status: 'PREPARING', deliveryMethod: 'direct', driverId: null }),
          },
          {
            id: 'pickup-parcel',
            data: () => ({ status: 'PREPARING', deliveryMethod: 'parcel', driverId: null }),
          },
          {
            id: 'assigned',
            data: () => ({ status: 'DELIVERING', deliveryMethod: 'direct', driverId: 'driver-1' }),
          },
          {
            id: 'other-driver',
            data: () => ({ status: 'DELIVERING', deliveryMethod: 'direct', driverId: 'driver-2' }),
          },
        ],
      }),
    };
    const firestore = { collection: jest.fn().mockReturnValue(query) };
    const service = new DriverService(firestore as never);

    await expect(service.getOrders('driver-1')).resolves.toEqual([
      { id: 'pickup-direct', status: 'PREPARING', deliveryMethod: 'direct', driverId: null },
      { id: 'assigned', status: 'DELIVERING', deliveryMethod: 'direct', driverId: 'driver-1' },
    ]);
  });
});
