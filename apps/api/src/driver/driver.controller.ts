import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DriverService } from './driver.service';
import { DriverOrdersQueryDto } from './dto/driver-orders-query.dto';

@Controller('driver')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('driver')
export class DriverController {
  constructor(private readonly driver: DriverService) {}

  // GET /driver/orders?status=PREPARING,DELIVERING
  // 드라이버는 storeId 불문 자신에게 할당된(또는 수거 대기 중인) 주문 조회
  @Get('orders')
  getOrders(@CurrentUser() user: JwtPayload, @Query() query: DriverOrdersQueryDto) {
    return this.driver.getOrders(user.sub, query.status);
  }

  @Get('orders/:orderId')
  getOrder(@Param('orderId') orderId: string, @CurrentUser() user: JwtPayload) {
    return this.driver.getOrder(user.sub, orderId);
  }
}
