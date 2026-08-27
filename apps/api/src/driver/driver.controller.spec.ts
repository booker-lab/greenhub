import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DriverController } from './driver.controller';

describe('DriverController 권한 계약', () => {
  it('driver 역할만 전용 주문 목록 API를 호출할 수 있다', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, DriverController) as string[];
    const guards = Reflect.getMetadata(GUARDS_METADATA, DriverController) as unknown[];

    expect(roles).toEqual(['driver']);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('driver 전용 주문 상세 경로를 같은 controller guard 아래에 노출한다', async () => {
    const driver = {
      getOrder: jest.fn().mockResolvedValue({ id: 'order-1' }),
    };
    const controller = new DriverController(driver as never);

    expect(Reflect.getMetadata(PATH_METADATA, DriverController.prototype.getOrder)).toBe(
      'orders/:orderId',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, DriverController.prototype.getOrder)).toBe(
      RequestMethod.GET,
    );
    await expect(
      controller.getOrder('order-1', { sub: 'driver-1', role: 'driver' }),
    ).resolves.toEqual({ id: 'order-1' });
    expect(driver.getOrder).toHaveBeenCalledWith('driver-1', 'order-1');
  });
});
