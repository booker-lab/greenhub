import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrdersController } from './orders.controller';

describe('판매자 매장 주문 조회 권한', () => {
  it('목록·상세는 인증 후 판매자 또는 관리자 역할만 통과한다', () => {
    for (const handler of [
      OrdersController.prototype.getOrders,
      OrdersController.prototype.getOrder,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['seller', 'admin']);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(RolesGuard);
    }
    expect(Reflect.getMetadata(GUARDS_METADATA, OrdersController)).toContain(JwtAuthGuard);
  });
});
