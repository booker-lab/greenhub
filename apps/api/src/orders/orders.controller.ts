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
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  AttachDeliveryPhotoDto,
  CreateRedeliveryFeeDto,
  HoldDeliveryDto,
  UpdateStatusDto,
} from './dto/update-status.dto';
import { OrderChargesService } from './order-charges.service';
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
    return this.ordersService.getOrderById(orderId, user);
  }
}

@Controller('stores/:storeId/orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderCharges: OrderChargesService,
  ) {}

  @Post('validate-cart')
  @HttpCode(HttpStatus.OK)
  validateCart(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.validateCart(storeId, user.sub, dto);
  }

  @Post()
  createOrder(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(storeId, user.sub, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('seller', 'admin')
  getOrders(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: { userId?: string; status?: string; saleType?: string },
  ) {
    return this.ordersService.getOrders(storeId, user, query);
  }

  @Get(':orderId')
  @UseGuards(RolesGuard)
  @Roles('seller', 'admin')
  getOrder(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.getOrder(storeId, orderId, user);
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

  @Patch(':orderId/delivery-hold')
  @HttpCode(HttpStatus.OK)
  holdDelivery(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: HoldDeliveryDto,
  ) {
    return this.ordersService.updateStatus(
      storeId,
      orderId,
      user.sub,
      {
        status: 'DELIVERY_HELD',
        deliveryHold: dto.deliveryHold,
      } as never,
      user.role,
    );
  }

  @Post(':orderId/redelivery-fee')
  @HttpCode(HttpStatus.OK)
  createRedeliveryFee(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRedeliveryFeeDto,
  ) {
    return this.orderCharges.createRedeliveryFeeCharge({
      storeId,
      orderId,
      requesterId: user.sub,
      idempotencyKey: dto.idempotencyKey ?? 'first',
    });
  }

  @Patch(':orderId/delivery-photo')
  @HttpCode(HttpStatus.OK)
  attachDeliveryPhoto(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: AttachDeliveryPhotoDto,
  ) {
    return this.ordersService.updateStatus(
      storeId,
      orderId,
      user.sub,
      { status: 'DELIVERED', photoUrl: dto.photoUrl } as never,
      user.role,
    );
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
    return this.ordersService.hubConfirmPickup(storeId, orderId, user.sub, pickupCode);
  }
}
