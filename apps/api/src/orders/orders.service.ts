import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { OrdersCreateService } from './orders-create.service';
import { OrdersQueryService, type StoreOrdersQuery } from './orders-query.service';
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

  validateCart(storeId: string, userId: string, dto: CreateOrderDto) {
    return this.create.validateCart(storeId, userId, dto);
  }

  getOrder(storeId: string, orderId: string, requester: JwtPayload) {
    return this.query.getOrder(storeId, orderId, requester);
  }

  getOrders(storeId: string, requester: JwtPayload, query: StoreOrdersQuery) {
    return this.query.getOrders(storeId, requester, query);
  }

  getArchivedOrders(storeId: string, requester: JwtPayload, query: StoreOrdersQuery) {
    return this.query.getArchivedOrders(storeId, requester, query);
  }

  getArchivedOrderCounts(storeId: string, requester: JwtPayload) {
    return this.query.getArchivedOrderCounts(storeId, requester);
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

  getOrderById(orderId: string, requester: JwtPayload) {
    return this.query.getOrderById(orderId, requester);
  }

  getMyOrders(requesterId: string) {
    return this.query.getMyOrders(requesterId);
  }
}
