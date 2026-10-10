import { type INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';

describe('DriverController 권한 계약', () => {
  it('driver 역할만 전용 주문 목록 API를 호출할 수 있다', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, DriverController) as string[];
    const guards = Reflect.getMetadata(GUARDS_METADATA, DriverController) as unknown[];

    expect(roles).toEqual(['driver']);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('driver 전용 주문 상세 경로를 같은 controller guard 아래에 노출한다', async () => {
    const driver = {
      getOrder: jest.fn().mockResolvedValue({ id: 'order-1' }),
    };
    const controller = new DriverController(driver as never);

    expect(Reflect.getMetadata(PATH_METADATA, DriverController.prototype.getOrder)).toBe(
      'orders/:orderId',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, DriverController.prototype.getOrder)).toBe(
      RequestMethod.GET,
    );
    await expect(
      controller.getOrder('order-1', { sub: 'driver-1', role: 'driver' }),
    ).resolves.toEqual({ id: 'order-1' });
    expect(driver.getOrder).toHaveBeenCalledWith('driver-1', 'order-1');
  });
});

describe('GET /driver/orders status 쿼리 검증', () => {
  let app: INestApplication;
  const driver = { getOrders: jest.fn(), getOrder: jest.fn() };

  beforeEach(async () => {
    driver.getOrders.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      controllers: [DriverController],
      providers: [{ provide: DriverService, useValue: driver }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.use((req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.user = { sub: 'driver-1', role: 'driver' };
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

  const list = (query = '') => request(app.getHttpServer()).get(`/driver/orders${query}`);

  it('기사 앱처럼 쿼리 없이 부르면 status 없이 넘긴다', async () => {
    await list().expect(200);
    expect(driver.getOrders).toHaveBeenCalledWith('driver-1', undefined);
  });

  it.each([
    ['PREPARING'],
    ['PREPARING,DELIVERING'],
    ['PREPARING,DELIVERING,DELIVERY_HELD'],
  ])('기사 노출 상태 목록 %s는 문자열 그대로 넘긴다', async (status) => {
    await list(`?status=${status}`).expect(200);
    expect(driver.getOrders).toHaveBeenCalledWith('driver-1', status);
  });

  it.each([
    ['기사 노출 대상이 아닌 상태', '?status=PICKED_UP'],
    ['허용 상태에 섞인 다른 값', '?status=PREPARING,CANCELLED'],
    ['소문자', '?status=preparing'],
    ['빈 값', '?status='],
    ['빈 항목', '?status=PREPARING,'],
    ['공백 포함', '?status=PREPARING,%20DELIVERING'],
    ['중복 파라미터', '?status=PREPARING&status=DELIVERING'],
    ['너무 긴 목록', `?status=${Array(8).fill('PREPARING').join(',')}`],
    ['알 수 없는 쿼리', '?storeId=store-1'],
  ])('%s는 400이고 서비스에 닿지 않는다', async (_label, query) => {
    await list(query).expect(400);
    expect(driver.getOrders).not.toHaveBeenCalled();
  });
});
