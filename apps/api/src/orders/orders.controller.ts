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
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { PickupCodeDto } from './dto/pickup-code.dto';
import { QueryStoreOrdersDto, SearchStoreOrdersByPhoneDto } from './dto/query-orders.dto';
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

  // 판매자 주문 전화 검색. 전화번호가 URL·접속 로그에 남지 않도록 본문으로 받는다.
  // 고정 경로라 POST / 와 :orderId 하위 경로와 겹치지 않는다.
  @Post('phone-search')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('seller', 'admin')
  searchOrdersByPhone(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SearchStoreOrdersByPhoneDto,
  ) {
    return this.ordersService.getOrders(storeId, user, { phone: dto.phone });
  }

  @Post()
  createOrder(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(storeId, user.sub, dto);
  }

  // @deprecated query.phone(?phone=) 전화 검색: 판매자 앱은 POST phone-search를 쓴다.
  // API와 판매자 앱이 따로 배포되는 동안 양방향 호환을 위해서만 남기며, 둘 다 배포된 뒤 제거한다.
  @Get()
  @UseGuards(RolesGuard)
  @Roles('seller', 'admin')
  getOrders(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryStoreOrdersDto,
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
    // 본문 없는 취소 요청도 받는다(검증 통과 후 dto가 undefined로 온다).
    @Body() dto?: CancelOrderDto,
  ) {
    return this.ordersService.cancelOrder(storeId, orderId, user.sub, dto?.reason);
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
    @Body() dto: PickupCodeDto,
  ) {
    return this.ordersService.confirmPickup(storeId, orderId, user.sub, dto.pickupCode);
  }

  @Patch(':orderId/hub-confirm')
  @HttpCode(HttpStatus.OK)
  hubConfirmPickup(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PickupCodeDto,
  ) {
    return this.ordersService.hubConfirmPickup(storeId, orderId, user.sub, dto.pickupCode);
  }
}
