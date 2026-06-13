import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
// biome-ignore lint/style/useImportType: Nest ValidationPipe가 DTO 클래스 메타타입을 런타임에 사용한다.
import { CreateOrderDto } from './dto/create-order.dto';
// biome-ignore lint/style/useImportType: Nest ValidationPipe가 DTO 클래스 메타타입을 런타임에 사용한다.
import { UpdateStatusDto } from './dto/update-status.dto';
// biome-ignore lint/style/useImportType: Nest DI가 생성자 메타데이터에서 클래스 값을 사용한다.
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersPublicController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  getMyOrders(@CurrentUser() user: JwtPayload) {
    return this.ordersService.getMyOrders(user.sub);
  }

  @Get(':orderId')
  getOrderById(@Param('orderId') orderId: string, @CurrentUser() user: JwtPayload) {
    return this.ordersService.getOrderById(orderId, user.sub);
  }
}

@Controller('stores/:storeId/orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  createOrder(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(storeId, user.sub, dto);
  }

  @Get()
  getOrders(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: { userId?: string; status?: string; saleType?: string },
  ) {
    return this.ordersService.getOrders(storeId, user.sub, query);
  }

  @Get(':orderId')
  getOrder(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.getOrder(storeId, orderId, user.sub);
  }

  @Patch(':orderId/status')
  updateStatus(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.ordersService.updateStatus(storeId, orderId, user.sub, dto, user.role);
  }

  @Patch(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelOrder(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body('reason') reason?: string,
  ) {
    return this.ordersService.cancelOrder(storeId, orderId, user.sub, reason);
  }

  @Patch(':orderId/review')
  @HttpCode(HttpStatus.OK)
  reviewOrder(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.reviewOrder(storeId, orderId, user.sub);
  }

  @Patch(':orderId/pickup-confirm')
  @HttpCode(HttpStatus.OK)
  confirmPickup(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body('pickupCode') pickupCode: string,
  ) {
    return this.ordersService.confirmPickup(storeId, orderId, user.sub, pickupCode);
  }

  @Patch(':orderId/hub-confirm')
  @HttpCode(HttpStatus.OK)
  hubConfirmPickup(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body('pickupCode') pickupCode: string,
  ) {
    return this.ordersService.hubConfirmPickup(storeId, orderId, user, pickupCode);
  }
}
