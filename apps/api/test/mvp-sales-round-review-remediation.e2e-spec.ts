import {
  CanActivate,
  ConflictException,
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
  const currentHoldAt = '2026-08-26T00:00:00.000Z';
  const state: Record<string, any> = {
    orderStatus: 'NONE',
    reservationStatus: 'NONE',
    heldOrderCount: 0,
    driverId: 'driver-1',
    deliveryHold: null,
    redeliveryChargeId: null,
    redeliveryChargeHoldAt: null,
    orderCharge: null,
    paymentsDocument: null,
    notifications: [],
    operationIssues: [],
    requiresOperationalReview: false,
    providerInvocationCount: 0,
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
        dto: { status: string; deliveryHold?: Record<string, unknown> },
      ) => {
        if (dto.status === 'DELIVERY_HELD' && state.orderStatus !== 'DELIVERY_HELD') {
          state.heldOrderCount += 1;
          state.deliveryHold = {
            ...dto.deliveryHold,
            heldAt: currentHoldAt,
            resolvedAt: null,
          };
          state.orderStatus = dto.status;
          return { orderId: 'order-1', status: dto.status };
        }

        if (dto.status === 'PREPARING' && state.orderStatus === 'DELIVERY_HELD') {
          state.orderStatus = dto.status;
          if (
            state.deliveryHold?.customerResponsible === true &&
            state.deliveryHold.redeliveryFee > 0
          ) {
            state.deliveryHold.resolvedAt = null;
            state.notifications.push('ORDER_REDELIVERY_PAYMENT_REQUESTED');
          }
          return { orderId: 'order-1', status: dto.status };
        }

        if (dto.status === 'DELIVERING') {
          const paymentRequired =
            state.deliveryHold?.customerResponsible === true &&
            state.deliveryHold.redeliveryFee > 0 &&
            state.deliveryHold.resolvedAt === null;
          const currentCharge =
            state.orderCharge?.id === state.redeliveryChargeId &&
            state.orderCharge?.orderId === 'order-1' &&
            state.orderCharge?.storeId === 'store-1' &&
            state.orderCharge?.userId === 'user-1' &&
            state.orderCharge?.type === 'REDELIVERY_FEE' &&
            state.orderCharge?.holdAt === currentHoldAt &&
            state.redeliveryChargeHoldAt === currentHoldAt;
          if (paymentRequired && (!currentCharge || state.orderCharge.status !== 'PAID')) {
            throw new ConflictException('유료 재배송 결제가 완료되지 않았습니다.');
          }
          if (state.orderStatus !== 'PREPARING') {
            throw new ForbiddenException('현재 주문 상태에서는 배송을 재개할 수 없습니다.');
          }
          state.orderStatus = dto.status;
          state.deliveryHold = { ...state.deliveryHold, resolvedAt: currentHoldAt };
          if (state.heldOrderCount > 0) state.heldOrderCount -= 1;
          state.notifications.push('ORDER_REDELIVERY_SCHEDULED');
          return { orderId: 'order-1', status: dto.status };
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
        state.paymentsDocument = { id: 'payment-1', orderId: 'order-1', status: 'PAID' };
      }
      return { ok: true, status: state.orderStatus };
    }),
  };

  const orderCharges = {
    createRedeliveryFeeCharge: jest.fn(
      async ({
        storeId,
        orderId,
        requesterId,
      }: {
        storeId: string;
        orderId: string;
        requesterId: string;
        idempotencyKey: string;
      }) => {
        if (!state.orderCharge) {
          state.redeliveryChargeId = 'charge-1';
          state.redeliveryChargeHoldAt = currentHoldAt;
          state.orderCharge = {
            id: 'charge-1',
            orderId,
            storeId,
            userId: requesterId,
            type: 'REDELIVERY_FEE',
            status: 'PENDING',
            amount: 5_000,
            customerResponsible: true,
            holdAt: currentHoldAt,
            portonePaymentId: 'order-charge-charge-1',
          };
        }
        return state.orderCharge;
      },
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SaleRoundsController, OrdersController, PaymentsController],
      providers: [
        { provide: SaleRoundsService, useValue: saleRounds },
        { provide: OrdersService, useValue: orders },
        { provide: PaymentsService, useValue: payments },
        { provide: OrderChargesService, useValue: orderCharges },
        { provide: PortoneClient, useValue: { verifyWebhookSignature: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestAuthGuard)
      .overrideGuard(RolesGuard)
      .useClass(TestAuthGuard)
      .compile();

    app = module.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  beforeEach(() => {
    state.orderStatus = 'NONE';
    state.reservationStatus = 'NONE';
    state.heldOrderCount = 0;
    state.driverId = 'driver-1';
    state.deliveryHold = null;
    state.redeliveryChargeId = null;
    state.redeliveryChargeHoldAt = null;
    state.orderCharge = null;
    state.paymentsDocument = null;
    state.notifications = [];
    state.operationIssues = [];
    state.requiresOperationalReview = false;
    state.providerInvocationCount = 0;
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
      .set('webhook-id', 'webhook-test-1')
      .set('webhook-timestamp', String(Math.floor(Date.now() / 1000)))
      .set('webhook-signature', 'v1,test-signature')
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

    const charge = await request(app.getHttpServer())
      .post('/stores/store-1/orders/order-1/redelivery-fee')
      .set('x-test-user', 'user-1')
      .set('x-test-role', 'consumer')
      .send({ idempotencyKey: 'redelivery-review-001' })
      .expect(200);
    expect(charge.body).toMatchObject({
      id: 'charge-1',
      orderId: 'order-1',
      storeId: 'store-1',
      userId: 'user-1',
      type: 'REDELIVERY_FEE',
      status: 'PENDING',
      holdAt: currentHoldAt,
    });

    await request(app.getHttpServer())
      .patch('/stores/store-1/orders/order-1/status')
      .set('x-test-user', 'seller-1')
      .set('x-test-role', 'seller')
      .send({ status: 'PREPARING' })
      .expect(200);
    expect(state).toMatchObject({
      orderStatus: 'PREPARING',
      heldOrderCount: 1,
      deliveryHold: { heldAt: currentHoldAt, resolvedAt: null },
      redeliveryChargeId: 'charge-1',
      redeliveryChargeHoldAt: currentHoldAt,
      orderCharge: {
        id: 'charge-1',
        orderId: 'order-1',
        storeId: 'store-1',
        userId: 'user-1',
        type: 'REDELIVERY_FEE',
        status: 'PENDING',
        holdAt: currentHoldAt,
      },
    });

    const beforeUnpaidResume = structuredClone(state);
    await request(app.getHttpServer())
      .patch('/stores/store-1/orders/order-1/status')
      .set('x-test-user', 'driver-1')
      .set('x-test-role', 'driver')
      .send({ status: 'DELIVERING' })
      .expect(409);
    expect(state).toEqual(beforeUnpaidResume);
    expect(state.notifications).toEqual(['ORDER_REDELIVERY_PAYMENT_REQUESTED']);
    expect(state.operationIssues).toEqual([]);
    expect(state.providerInvocationCount).toBe(0);

    state.orderCharge.status = 'PAID';
    await request(app.getHttpServer())
      .patch('/stores/store-1/orders/order-1/status')
      .set('x-test-user', 'driver-1')
      .set('x-test-role', 'driver')
      .send({ status: 'DELIVERING' })
      .expect(200);
    expect(state).toMatchObject({
      orderStatus: 'DELIVERING',
      heldOrderCount: 0,
      deliveryHold: { heldAt: currentHoldAt, resolvedAt: currentHoldAt },
      redeliveryChargeId: 'charge-1',
      redeliveryChargeHoldAt: currentHoldAt,
    });
    expect(state.notifications).toEqual([
      'ORDER_REDELIVERY_PAYMENT_REQUESTED',
      'ORDER_REDELIVERY_SCHEDULED',
    ]);

    const afterResume = structuredClone(state);
    await request(app.getHttpServer())
      .patch('/stores/store-1/orders/order-1/status')
      .set('x-test-user', 'driver-1')
      .set('x-test-role', 'driver')
      .send({ status: 'DELIVERING' })
      .expect(403);
    expect(state).toEqual(afterResume);

    state.orderStatus = 'ACCEPTED';
    await request(app.getHttpServer())
      .patch('/stores/store-1/orders/order-1/cancel')
      .set('x-test-user', 'user-1')
      .send({ reason: '고객 요청' })
      .expect(200);
    expect(state).toMatchObject({ orderStatus: 'CANCELLED', reservationStatus: 'RELEASED' });
  });
});
