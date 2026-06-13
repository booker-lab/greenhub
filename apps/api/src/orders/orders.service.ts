import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { UpdateStatusDto } from './dto/update-status.dto';
// biome-ignore lint/style/useImportType: Nest DI가 생성자 메타데이터에서 클래스 값을 사용한다.
import { OrdersCreateService } from './orders-create.service';
// biome-ignore lint/style/useImportType: Nest DI가 생성자 메타데이터에서 클래스 값을 사용한다.
import { OrdersLifecycleService } from './orders-lifecycle.service';
// biome-ignore lint/style/useImportType: Nest DI가 생성자 메타데이터에서 클래스 값을 사용한다.
import { OrdersQueryService } from './orders-query.service';

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

  hubConfirmPickup(storeId: string, orderId: string, requester: JwtPayload, pickupCode: string) {
    return this.lifecycle.hubConfirmPickup(storeId, orderId, requester.sub, pickupCode, {
      role: requester.role,
      storeId: requester.storeId,
      hubId: requester.hubId,
      hubIds: requester.hubIds,
    });
  }

  getOrderById(orderId: string, requesterId: string) {
    return this.query.getOrderById(orderId, requesterId);
  }

  getMyOrders(requesterId: string) {
    return this.query.getMyOrders(requesterId);
  }
}
