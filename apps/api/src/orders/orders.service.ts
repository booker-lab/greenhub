import { Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { OrdersCreateService } from './orders-create.service';
import { OrdersQueryService } from './orders-query.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly create: OrdersCreateService,
    private readonly query: OrdersQueryService,
    private readonly lifecycle: OrdersLifecycleService,
  ) {}

  createOrder(storeId: string, userId: string, dto: CreateOrderDto) {
    return this.create.createOrder(storeId, userId, dto);
  }

  getOrder(storeId: string, orderId: string, requesterId: string) {
    return this.query.getOrder(storeId, orderId, requesterId);
  }

  getOrders(
    storeId: string,
    requesterId: string,
    query: { userId?: string; status?: string; saleType?: string },
  ) {
    return this.query.getOrders(storeId, requesterId, query);
  }

  updateStatus(
    storeId: string,
    orderId: string,
    requesterId: string,
    dto: UpdateStatusDto,
    requesterRole?: string,
  ) {
    return this.lifecycle.updateStatus(storeId, orderId, requesterId, dto, requesterRole);
  }

  cancelOrder(storeId: string, orderId: string, userId: string, reason?: string) {
    return this.lifecycle.cancelOrder(storeId, orderId, userId, reason);
  }

  reviewOrder(storeId: string, orderId: string, userId: string) {
    return this.lifecycle.reviewOrder(storeId, orderId, userId);
  }

  confirmPickup(storeId: string, orderId: string, userId: string, pickupCode: string) {
    return this.lifecycle.confirmPickup(storeId, orderId, userId, pickupCode);
  }

  hubConfirmPickup(storeId: string, orderId: string, requesterId: string, pickupCode: string) {
    return this.lifecycle.hubConfirmPickup(storeId, orderId, requesterId, pickupCode);
  }
}
