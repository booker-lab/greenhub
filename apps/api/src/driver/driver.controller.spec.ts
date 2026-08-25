import { GUARDS_METADATA } from '@nestjs/common/constants';
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
});
