import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DriverService } from './driver.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('driver')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('driver', 'seller')
export class DriverController {
  constructor(private readonly driver: DriverService) {}

  // GET /driver/orders?status=PREPARING,DELIVERING
  // 드라이버는 storeId 불문 자신에게 할당된(또는 수거 대기 중인) 주문 조회
  @Get('orders')
  getOrders(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
  ) {
    return this.driver.getOrders(user.sub, status);
  }
}
