import { type INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
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

  it('오늘 완료 요약 경로를 같은 controller guard 아래에 노출하고 요청 기사 ID만 넘긴다', async () => {
    const driver = {
      getSummary: jest.fn().mockResolvedValue({ completedToday: 3 }),
    };
    const controller = new DriverController(driver as never);

    expect(Reflect.getMetadata(PATH_METADATA, DriverController.prototype.getSummary)).toBe(
      'summary',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, DriverController.prototype.getSummary)).toBe(
      RequestMethod.GET,
    );
    await expect(controller.getSummary({ sub: 'driver-1', role: 'driver' })).resolves.toEqual({
      completedToday: 3,
    });
    expect(driver.getSummary).toHaveBeenCalledWith('driver-1');
  });

  it('오늘 완료 내역·사진 경로를 같은 controller guard 아래에 노출하고 메서드별 역할을 바꾸지 않는다', async () => {
    const driver = {
      getCompletedToday: jest.fn().mockResolvedValue({ date: '2026-11-11', orders: [] }),
      getCompletedTodayPhoto: jest
        .fn()
        .mockResolvedValue({ url: 'https://signed', expiresAt: '2026-11-11T00:15:00.000Z' }),
    };
    const controller = new DriverController(driver as never);
    const { getCompletedToday, getCompletedTodayPhoto } = DriverController.prototype;

    expect(Reflect.getMetadata(PATH_METADATA, getCompletedToday)).toBe('completed-today');
    expect(Reflect.getMetadata(PATH_METADATA, getCompletedTodayPhoto)).toBe(
      'completed-today/:orderId/photo',
    );
    for (const handler of [getCompletedToday, getCompletedTodayPhoto]) {
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
    }
    await expect(
      controller.getCompletedToday({ sub: 'driver-1', role: 'driver' }),
    ).resolves.toEqual({ date: '2026-11-11', orders: [] });
    expect(driver.getCompletedToday).toHaveBeenCalledWith('driver-1');
    await controller.getCompletedTodayPhoto('order-1', { sub: 'driver-1', role: 'driver' });
    expect(driver.getCompletedTodayPhoto).toHaveBeenCalledWith('driver-1', 'order-1');
  });
});

describe('GET /driver/completed-today 경로', () => {
  let app: INestApplication;
  const driver = {
    getOrder: jest.fn(),
    getCompletedToday: jest.fn(),
    getCompletedTodayPhoto: jest.fn(),
  };
  let currentUser: Record<string, unknown> | undefined;

  async function createApp(options: { realAuth: boolean }) {
    let builder = Test.createTestingModule({
      imports: options.realAuth
        ? [PassportModule, JwtModule.register({ secret: 'test-secret' })]
        : [],
      controllers: [DriverController],
      providers: [
        { provide: DriverService, useValue: driver },
        ...(options.realAuth
          ? [
              {
                provide: ConfigService,
                useValue: new ConfigService({ JWT_SECRET: 'test-secret' }),
              },
              { provide: FirestoreService, useValue: { doc: jest.fn() } },
              JwtStrategy,
            ]
          : []),
      ],
    });
    if (!options.realAuth) {
      builder = builder.overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true });
    }
    const module = await builder.compile();
    app = module.createNestApplication();
    if (!options.realAuth) {
      app.use((req: Record<string, unknown>, _res: unknown, next: () => void) => {
        req.user = currentUser;
        next();
      });
    }
    await app.init();
  }

  beforeEach(() => {
    currentUser = { sub: 'driver-1', role: 'driver' };
    driver.getCompletedToday.mockResolvedValue({ date: '2026-11-11', orders: [] });
    driver.getCompletedTodayPhoto.mockResolvedValue({
      url: 'https://signed',
      expiresAt: '2026-11-11T00:15:00.000Z',
    });
  });

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('완료 내역·사진 경로는 orders/:orderId 상세에 가려지지 않는다', async () => {
    await createApp({ realAuth: false });

    await request(app.getHttpServer())
      .get('/driver/completed-today')
      .expect(200, { date: '2026-11-11', orders: [] });
    await request(app.getHttpServer())
      .get('/driver/completed-today/order-1/photo')
      .expect(200, { url: 'https://signed', expiresAt: '2026-11-11T00:15:00.000Z' });

    expect(driver.getCompletedToday).toHaveBeenCalledWith('driver-1');
    expect(driver.getCompletedTodayPhoto).toHaveBeenCalledWith('driver-1', 'order-1');
    expect(driver.getOrder).not.toHaveBeenCalled();
  });

  it.each([['/driver/completed-today'], ['/driver/completed-today/order-1/photo']])(
    '%s — driver 역할이 아니면 서비스에 닿기 전에 403',
    async (path) => {
      currentUser = { sub: 'consumer-1', role: 'consumer' };
      await createApp({ realAuth: false });

      await request(app.getHttpServer()).get(path).expect(403);
      expect(driver.getCompletedToday).not.toHaveBeenCalled();
      expect(driver.getCompletedTodayPhoto).not.toHaveBeenCalled();
    },
  );

  it.each([['/driver/completed-today'], ['/driver/completed-today/order-1/photo']])(
    '%s — 토큰이 없으면 401',
    async (path) => {
      await createApp({ realAuth: true });

      await request(app.getHttpServer()).get(path).expect(401);
      expect(driver.getCompletedToday).not.toHaveBeenCalled();
      expect(driver.getCompletedTodayPhoto).not.toHaveBeenCalled();
    },
  );
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

  it.each([['PREPARING'], ['PREPARING,DELIVERING'], ['PREPARING,DELIVERING,DELIVERY_HELD']])(
    '기사 노출 상태 목록 %s는 문자열 그대로 넘긴다',
    async (status) => {
      await list(`?status=${status}`).expect(200);
      expect(driver.getOrders).toHaveBeenCalledWith('driver-1', status);
    },
  );

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
