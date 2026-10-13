import 'reflect-metadata';
import { type INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PARAMTYPES_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { PickupCodeDto } from './dto/pickup-code.dto';
import { QueryStoreOrdersDto, SearchStoreOrdersByPhoneDto } from './dto/query-orders.dto';
import { OrderChargesService } from './order-charges.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('판매자 매장 주문 조회 권한', () => {
  it('목록·상세·전화 검색은 인증 후 판매자 또는 관리자 역할만 통과한다', () => {
    for (const handler of [
      OrdersController.prototype.getOrders,
      OrdersController.prototype.getOrder,
      OrdersController.prototype.searchOrdersByPhone,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['seller', 'admin']);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(RolesGuard);
    }
    expect(Reflect.getMetadata(GUARDS_METADATA, OrdersController)).toContain(JwtAuthGuard);
  });

  it('전화 검색은 POST phone-search 고정 경로이고 200을 돌려준다', () => {
    const handler = OrdersController.prototype.searchOrdersByPhone;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('phone-search');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
  });

  it('원시 본문·쿼리 대신 DTO 클래스로 받는다', () => {
    const paramTypes = (method: keyof OrdersController) =>
      Reflect.getMetadata(PARAMTYPES_METADATA, OrdersController.prototype, method) as unknown[];

    expect(paramTypes('getOrders')).toContain(QueryStoreOrdersDto);
    expect(paramTypes('searchOrdersByPhone')).toContain(SearchStoreOrdersByPhoneDto);
    expect(paramTypes('cancelOrder')).toContain(CancelOrderDto);
    expect(paramTypes('confirmPickup')).toContain(PickupCodeDto);
    expect(paramTypes('hubConfirmPickup')).toContain(PickupCodeDto);
  });
});

describe('매장 주문 HTTP 입력 검증', () => {
  let app: INestApplication;
  const ordersService = {
    getOrders: jest.fn(),
    createOrder: jest.fn(),
    cancelOrder: jest.fn(),
    confirmPickup: jest.fn(),
    hubConfirmPickup: jest.fn(),
  };
  const user = { sub: 'seller-1', role: 'seller' };

  beforeEach(async () => {
    ordersService.getOrders.mockResolvedValue([{ id: 'order-1' }]);
    ordersService.cancelOrder.mockResolvedValue({ orderId: 'order-1', status: 'CANCELLED' });
    ordersService.confirmPickup.mockResolvedValue({ orderId: 'order-1', status: 'PICKED_UP' });
    ordersService.hubConfirmPickup.mockResolvedValue({ orderId: 'order-1', status: 'PICKED_UP' });

    const module = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: ordersService },
        { provide: OrderChargesService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.use((req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.user = user;
      next();
    });
    // 운영 부트스트랩(main.ts)과 같은 전역 파이프 옵션.
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  const http = () => request(app.getHttpServer());

  describe('PATCH :orderId/cancel', () => {
    const cancel = () => http().patch('/stores/store-1/orders/order-1/cancel');

    it('고객 화면이 보내는 사유를 그대로 넘긴다', async () => {
      await cancel().send({ reason: '고객 요청' }).expect(200);
      expect(ordersService.cancelOrder).toHaveBeenCalledWith(
        'store-1',
        'order-1',
        'seller-1',
        '고객 요청',
      );
    });

    it.each([
      ['본문 없음', undefined],
      ['빈 객체', {}],
      ['null 사유', { reason: null }],
    ])('%s이면 사유 없이 넘긴다', async (_label, body) => {
      const req = cancel();
      await (body === undefined ? req : req.send(body)).expect(200);
      expect(ordersService.cancelOrder).toHaveBeenCalledWith(
        'store-1',
        'order-1',
        'seller-1',
        body === undefined || !('reason' in body) ? undefined : null,
      );
    });

    it('100자 사유는 받는다', async () => {
      await cancel()
        .send({ reason: '가'.repeat(100) })
        .expect(200);
      expect(ordersService.cancelOrder).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['객체 사유', { reason: { x: 1 } }],
      ['배열 사유', { reason: ['a', 'b'] }],
      ['숫자 사유', { reason: 1 }],
      ['101자 사유', { reason: '가'.repeat(101) }],
      ['줄바꿈 사유', { reason: '고객\n요청' }],
      ['제어문자 사유', { reason: '고객\u0000요청' }],
      ['알 수 없는 필드', { reason: '고객 요청', refundAmount: 1000 }],
    ])('%s는 400이고 서비스에 닿지 않는다', async (_label, body) => {
      await cancel().send(body).expect(400);
      expect(ordersService.cancelOrder).not.toHaveBeenCalled();
    });
  });

  describe('GET 목록 쿼리', () => {
    it('쿼리 없이 부르면 빈 필터로 넘긴다', async () => {
      await http().get('/stores/store-1/orders').expect(200);
      expect(ordersService.getOrders).toHaveBeenCalledWith('store-1', user, {});
    });

    it('상태·판매 방식·고객 필터를 문자열로 넘긴다', async () => {
      await http()
        .get('/stores/store-1/orders')
        .query({ status: 'PREPARING', saleType: 'group', userId: 'user-1' })
        .expect(200);
      expect(ordersService.getOrders).toHaveBeenCalledWith('store-1', user, {
        status: 'PREPARING',
        saleType: 'group',
        userId: 'user-1',
      });
    });

    it('이전 판매자 배포의 ?phone= 검색도 계속 받는다', async () => {
      await http().get('/stores/store-1/orders?phone=01012345678').expect(200);
      expect(ordersService.getOrders).toHaveBeenCalledWith('store-1', user, {
        phone: '01012345678',
      });
    });

    it.each([
      ['알 수 없는 상태', '?status=SHIPPED'],
      ['소문자 상태', '?status=preparing'],
      ['빈 상태', '?status='],
      ['상태 중복', '?status=PREPARING&status=DELIVERING'],
      ['알 수 없는 판매 방식', '?saleType=direct'],
      ['문자가 섞인 전화', '?phone=abc1234'],
      ['너무 긴 전화', `?phone=${'1'.repeat(33)}`],
      ['너무 긴 고객 id', `?userId=${'u'.repeat(129)}`],
      ['알 수 없는 쿼리', '?limit=10'],
    ])('%s는 400이고 서비스에 닿지 않는다', async (_label, query) => {
      await http().get(`/stores/store-1/orders${query}`).expect(400);
      expect(ordersService.getOrders).not.toHaveBeenCalled();
    });
  });

  describe('POST phone-search', () => {
    const search = () => http().post('/stores/store-1/orders/phone-search');

    it('판매자 화면이 보내는 숫자를 본문으로 받아 전화 필터로만 넘긴다', async () => {
      const response = await search().send({ phone: '5678' }).expect(200);
      expect(response.body).toEqual([{ id: 'order-1' }]);
      expect(ordersService.getOrders).toHaveBeenCalledWith('store-1', user, { phone: '5678' });
      expect(ordersService.createOrder).not.toHaveBeenCalled();
    });

    it('하이픈이 섞인 번호도 받아 서비스가 숫자만 비교하게 한다', async () => {
      await search().send({ phone: '010-1234-5678' }).expect(200);
      expect(ordersService.getOrders).toHaveBeenCalledWith('store-1', user, {
        phone: '010-1234-5678',
      });
    });

    it.each([
      ['본문 없음', undefined],
      ['전화 없음', {}],
      ['숫자 전화', { phone: 5678 }],
      ['배열 전화', { phone: ['5678'] }],
      ['객체 전화', { phone: { $gt: '' } }],
      ['빈 전화', { phone: '' }],
      ['문자가 섞인 전화', { phone: '56a78' }],
      ['너무 긴 전화', { phone: '1'.repeat(33) }],
      ['다른 필터 동봉', { phone: '5678', status: 'PREPARING' }],
    ])('%s는 400이고 서비스에 닿지 않는다', async (_label, body) => {
      const req = search();
      await (body === undefined ? req : req.send(body)).expect(400);
      expect(ordersService.getOrders).not.toHaveBeenCalled();
      expect(ordersService.createOrder).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['pickup-confirm', 'confirmPickup'],
    ['hub-confirm', 'hubConfirmPickup'],
  ] as const)('PATCH :orderId/%s', (path, method) => {
    const confirm = () => http().patch(`/stores/store-1/orders/order-1/${path}`);

    it('숫자 6자리 코드를 그대로 넘긴다', async () => {
      await confirm().send({ pickupCode: '012345' }).expect(200);
      expect(ordersService[method]).toHaveBeenCalledWith(
        'store-1',
        'order-1',
        'seller-1',
        '012345',
      );
    });

    it.each([
      ['본문 없음', undefined],
      ['코드 없음', {}],
      ['숫자 타입 코드', { pickupCode: 123456 }],
      ['5자리', { pickupCode: '12345' }],
      ['7자리', { pickupCode: '1234567' }],
      ['문자 포함', { pickupCode: '12a456' }],
      ['공백 포함', { pickupCode: ' 123456' }],
      ['배열 코드', { pickupCode: ['123456'] }],
      ['알 수 없는 필드', { pickupCode: '123456', orderId: 'order-2' }],
    ])('%s는 400이고 서비스에 닿지 않는다', async (_label, body) => {
      const req = confirm();
      const response = await (body === undefined ? req : req.send(body)).expect(400);
      expect(response.body.statusCode).toBe(400);
      expect(ordersService[method]).not.toHaveBeenCalled();
    });

    it('형식 오류 메시지는 판매자 화면에 그대로 보여줄 한국어 한 문장이다', async () => {
      const response = await confirm().send({ pickupCode: '12345' }).expect(400);
      expect(response.body.message).toEqual(['픽업 코드는 숫자 6자리여야 합니다.']);
    });
  });
});
