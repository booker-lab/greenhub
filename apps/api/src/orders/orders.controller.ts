import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

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
    return this.ordersService.updateStatus(storeId, orderId, user.sub, dto);
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

  @Patch(':orderId/pickup-confirm')
  @HttpCode(HttpStatus.OK)
  confirmPickup(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body('pickupCode') pickupCode: string,
  ) {
    return this.ordersService.confirmPickup(
      storeId,
      orderId,
      user.sub,
      pickupCode,
    );
  }
}
