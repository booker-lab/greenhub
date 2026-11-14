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

  // GET /driver/summary → { completedToday }: 본인 배정 주문 중 오늘(서울 날짜) 배송 완료된 수
  @Get('summary')
  getSummary(@CurrentUser() user: JwtPayload) {
    return this.driver.getSummary(user.sub);
  }

  // GET /driver/completed-today → { date, orders }: 오늘(서울 날짜) 완료 내역. 길이는 completedToday와 같다.
  // orders/:orderId와 겹치지 않도록 별도 접두사를 쓴다.
  @Get('completed-today')
  getCompletedToday(@CurrentUser() user: JwtPayload) {
    return this.driver.getCompletedToday(user.sub);
  }

  // GET /driver/completed-today/:orderId/photo → { url, expiresAt }: 오늘 완료 주문의 배송 사진 서명 URL
  @Get('completed-today/:orderId/photo')
  getCompletedTodayPhoto(@Param('orderId') orderId: string, @CurrentUser() user: JwtPayload) {
    return this.driver.getCompletedTodayPhoto(user.sub, orderId);
  }

  @Get('orders/:orderId')
  getOrder(@Param('orderId') orderId: string, @CurrentUser() user: JwtPayload) {
    return this.driver.getOrder(user.sub, orderId);
  }
}
