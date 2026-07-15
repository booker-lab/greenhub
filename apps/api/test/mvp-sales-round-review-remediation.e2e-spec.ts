import {
  CanActivate,
  ForbiddenException,
  INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditService } from '../src/common/audit/audit.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { OrderChargesService } from '../src/orders/order-charges.service';
import { OrdersController } from '../src/orders/orders.controller';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentsController } from '../src/payments/payments.controller';
import { PaymentsService } from '../src/payments/payments.service';
import { PortoneClient } from '../src/payments/portone.client';
import { SaleRoundsController } from '../src/sale-rounds/sale-rounds.controller';
import { SaleRoundsService } from '../src/sale-rounds/sale-rounds.service';

@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.user = {
      sub: request.headers['x-test-user'] ?? 'user-1',
      role: request.headers['x-test-role'] ?? 'consumer',
    };
    return true;
  }
}

describe('회차 직배송 리뷰 보정 API 통합 계약', () => {
  let app: INestApplication;
  const state = {
    orderStatus: 'NONE',
    reservationStatus: 'NONE',
    heldOrderCount: 0,
  };

  const saleRounds = {
    updateStatus: jest.fn(
      async (_storeId: string, _roundId: string, userId: string, role: string) => {
        if (role !== 'admin' && userId !== 'seller-1') {
          throw new ForbiddenException('해당 스토어의 회차를 관리할 권한이 없습니다.');
        }
        return { id: 'round-1', status: 'OPEN' };
      },
    ),
  };

  const orders = {
    createOrder: jest.fn(async () => {
      state.orderStatus = 'PENDING';
      state.reservationStatus = 'HELD';
      return { orderId: 'order-1', reservationId: 'reservation-1' };
    }),
    cancelOrder: jest.fn(async () => {
      state.orderStatus = 'CANCELLED';
      state.reservationStatus = 'RELEASED';
      return { orderId: 'order-1', status: 'CANCELLED' };
    }),
    updateStatus: jest.fn(
      async (
        _storeId: string,
        _orderId: string,
        _userId: string,
        dto: { status: string },
      ) => {
        if (dto.status === 'DELIVERY_HELD' && state.orderStatus !== 'DELIVERY_HELD') {
          state.heldOrderCount += 1;
        } else if (state.orderStatus === 'DELIVERY_HELD') {
          state.heldOrderCount -= 1;
        }
        state.orderStatus = dto.status;
        return { orderId: 'order-1', status: dto.status };
      },
    ),
  };

  const payments = {
    handleWebhook: jest.fn(async () => {
      if (state.orderStatus === 'PENDING') {
        state.orderStatus = 'ACCEPTED';
        state.reservationStatus = 'CONSUMED';
      }
      return { ok: true, status: state.orderStatus };
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SaleRoundsController, OrdersController, PaymentsController],
      providers: [
        { provide: SaleRoundsService, useValue: saleRounds },
        { provide: OrdersService, useValue: orders },
        { provide: PaymentsService, useValue: payments },
        { provide: OrderChargesService, useValue: { createRedeliveryFeeCharge: jest.fn() } },
        { provide: PortoneClient, useValue: { verifyWebhookSignature: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestAuthGuard)
      .overrideGuard(RolesGuard)
      .useClass(TestAuthGuard)
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  beforeEach(() => {
    state.orderStatus = 'NONE';
    state.reservationStatus = 'NONE';
    state.heldOrderCount = 0;
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('다른 판매자의 회차 상태 변경을 서비스 계층에서 403으로 거부한다', async () => {
    await request(app.getHttpServer())
      .patch('/stores/store-1/sale-rounds/round-1/status')
      .set('x-test-user', 'seller-2')
      .set('x-test-role', 'seller')
      .send({ status: 'OPEN' })
      .expect(403);
  });

  it('주문 생성·결제 소비·보류 해소·고객 취소가 한 API 계약으로 이어진다', async () => {
    await request(app.getHttpServer())
      .post('/stores/store-1/orders')
      .set('x-test-user', 'user-1')
      .send({
        productId: 'product-1',
        quantity: 1,
        saleType: 'normal',
        deliveryMethod: 'direct',
        requestedDeliveryDate: '2026-07-21',
        roundId: 'round-1',
        roundItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
        deliveryPhone: '010-1234-5678',
        deliveryAddress: {
          address: '경기도 이천시 중리천로 1',
          addressDetail: '101호',
          zipCode: '17373',
        },
      })
      .expect(201);
    expect(state.reservationStatus).toBe('HELD');

    await request(app.getHttpServer())
      .post('/payments/webhook/portone')
      .send({
        type: 'Transaction.Paid',
        data: { paymentId: 'order-1', storeId: 'store-1' },
      })
      .expect(200);
    expect(state.reservationStatus).toBe('CONSUMED');

    state.orderStatus = 'PREPARING';
    await request(app.getHttpServer())
      .patch('/stores/store-1/orders/order-1/delivery-hold')
      .set('x-test-user', 'seller-1')
      .set('x-test-role', 'seller')
      .send({
        deliveryHold: {
          reasonCode: 'ACCESS_UNAVAILABLE',
          reasonMessage: '공동현관 출입 불가',
          customerResponsible: true,
          redeliveryFee: 5000,
          nextContactAt: '2026-07-22T00:00:00.000Z',
        },
      })
      .expect(200);
    expect(state.heldOrderCount).toBe(1);

    await request(app.getHttpServer())
      .patch('/stores/store-1/orders/order-1/status')
      .set('x-test-user', 'seller-1')
      .set('x-test-role', 'seller')
      .send({ status: 'PREPARING' })
      .expect(200);
    expect(state.heldOrderCount).toBe(0);

    state.orderStatus = 'ACCEPTED';
    await request(app.getHttpServer())
      .patch('/stores/store-1/orders/order-1/cancel')
      .set('x-test-user', 'user-1')
      .send({ reason: '고객 요청' })
      .expect(200);
    expect(state).toMatchObject({ orderStatus: 'CANCELLED', reservationStatus: 'RELEASED' });
  });
});
