import 'reflect-metadata';
import { COLOR_OPTIONS } from '@greenhub/shared';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { PARAMTYPES_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateProductDto } from './dto/update-product.dto';
import { DailyCapsController, ProductsController } from './products.controller';
import { ProductsService } from './products.service';

describe('상품 PATCH 런타임 검증', () => {
  let app: INestApplication;
  const productsService = { updateProduct: jest.fn() };

  beforeEach(async () => {
    productsService.updateProduct.mockResolvedValue({ id: 'product-1' });
    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: productsService },
        JwtAuthGuard,
        RolesGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.use((request, _response, next) => {
      Object.assign(request, { user: { sub: 'seller-1', role: 'seller' } });
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  function patch(body: Record<string, unknown>) {
    return request(app.getHttpServer()).patch('/stores/store-1/products/product-1').send(body);
  }

  const validSelection = {
    colors: [COLOR_OPTIONS[0]],
    stemType: '외대',
    fragrance: 'none',
    bloomCondition: 'half',
    bundleUnit: '1단',
  };

  it('컨트롤러의 body metatype이 Object가 아닌 UpdateProductDto다', () => {
    const parameterTypes = Reflect.getMetadata(
      PARAMTYPES_METADATA,
      ProductsController.prototype,
      'updateProduct',
    );

    expect(parameterTypes[3]).toBe(UpdateProductDto);
    expect(parameterTypes[3]).not.toBe(Object);
  });

  it.each([
    ['잘못된 색상', { selection: { ...validSelection, colors: ['알 수 없는 색상'] } }],
    ['direct 판매 방식', { saleType: 'direct' }],
    ['임의 판매 방식', { saleType: 'legacy' }],
  ])('유효하지 않은 PATCH %s는 400이고 service에 도달하지 않는다', async (_label, body) => {
    const response = await patch(body);

    expect(response.status).toBe(400);
    expect(productsService.updateProduct).not.toHaveBeenCalled();
  });

  it.each([
    ['유효한 색상', { selection: validSelection }],
    ['normal 판매 방식', { saleType: 'normal' }],
    ['group 판매 방식', { saleType: 'group' }],
    ['기존 상품 수정 필드', { name: '수정 상품' }],
  ])('유효한 PATCH %s는 통과하고 service를 호출한다', async (_label, body) => {
    const response = await patch(body);

    expect(response.status).toBe(200);
    expect(productsService.updateProduct).toHaveBeenCalledWith(
      'store-1',
      'product-1',
      'seller-1',
      expect.objectContaining(body),
      'seller',
    );
  });
});

const UNIT_BUCKET = 'greenhub-api-unit-test.appspot.com';

function productImageUrl(storeId: string, fileName = '1700000000000_a.jpg') {
  return `https://firebasestorage.googleapis.com/v0/b/${UNIT_BUCKET}/o/${encodeURIComponent(
    `products/${storeId}/${fileName}`,
  )}?alt=media&token=t`;
}

async function createValidatedApp(controller: unknown, provider: Record<string, jest.Mock>) {
  const module = await Test.createTestingModule({
    controllers: [controller as never],
    providers: [{ provide: ProductsService, useValue: provider }, JwtAuthGuard, RolesGuard],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = module.createNestApplication();
  app.use((request, _response, next) => {
    Object.assign(request, { user: { sub: 'seller-1', role: 'seller' } });
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  return app;
}

describe('상품 생성·수정 이미지와 금액 런타임 검증', () => {
  let app: INestApplication;
  const productsService = { createProduct: jest.fn(), updateProduct: jest.fn() };
  const validCreate = {
    name: '호접란',
    images: [productImageUrl('store-1')],
    price: 12000,
    category: 'orchid',
    saleType: 'normal',
    deliverySize: 'small',
  };

  beforeEach(async () => {
    productsService.createProduct.mockResolvedValue({ id: 'product-1' });
    productsService.updateProduct.mockResolvedValue({ id: 'product-1' });
    app = await createValidatedApp(ProductsController, productsService);
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('자기 매장 Storage 이미지와 정수 가격으로 생성한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/stores/store-1/products')
      .send(validCreate);

    expect(response.status).toBe(201);
    expect(productsService.createProduct).toHaveBeenCalledWith(
      'store-1',
      'seller-1',
      expect.objectContaining({ images: validCreate.images, price: 12000 }),
      'seller',
    );
  });

  it.each([
    ['외부 호스트 이미지', { images: ['https://example.com/a.jpg'] }],
    ['다른 매장 경로 이미지', { images: [productImageUrl('store-2')] }],
    ['소수 가격', { price: 12000.5 }],
  ])('생성 요청의 %s는 400이고 service에 도달하지 않는다', async (_label, patch) => {
    const response = await request(app.getHttpServer())
      .post('/stores/store-1/products')
      .send({ ...validCreate, ...patch });

    expect(response.status).toBe(400);
    expect(productsService.createProduct).not.toHaveBeenCalled();
  });

  it.each([
    ['외부 호스트 이미지', { images: ['https://example.com/a.jpg'] }],
    ['다른 매장 경로 이미지', { images: [productImageUrl('store-1'), productImageUrl('store-2')] }],
    ['소수 가격', { price: 0.1 }],
  ])('수정 요청의 %s는 400이고 service에 도달하지 않는다', async (_label, body) => {
    const response = await request(app.getHttpServer())
      .patch('/stores/store-1/products/product-1')
      .send(body);

    expect(response.status).toBe(400);
    expect(productsService.updateProduct).not.toHaveBeenCalled();
  });

  it('이미지를 바꾸지 않는 수정은 이미지 경로 검사 없이 통과한다', async () => {
    const response = await request(app.getHttpServer())
      .patch('/stores/store-1/products/product-1')
      .send({ price: 15000 });

    expect(response.status).toBe(200);
    expect(productsService.updateProduct).toHaveBeenCalled();
  });
});

describe('daily cap 날짜·수량 런타임 검증', () => {
  let app: INestApplication;
  const productsService = { getDailyCaps: jest.fn(), updateDailyCap: jest.fn() };

  beforeEach(async () => {
    productsService.getDailyCaps.mockResolvedValue({ caps: [] });
    productsService.updateDailyCap.mockResolvedValue({ totalCap: 10 });
    app = await createValidatedApp(DailyCapsController, productsService);
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('유효한 날짜와 정수 totalCap을 service로 넘긴다', async () => {
    const response = await request(app.getHttpServer())
      .patch('/stores/store-1/daily-caps/2026-08-25')
      .send({ totalCap: 10 });

    expect(response.status).toBe(200);
    expect(productsService.updateDailyCap).toHaveBeenCalledWith(
      'store-1',
      '2026-08-25',
      'seller-1',
      10,
      'seller',
    );
  });

  it.each([
    ['형식이 다른 날짜', '20260825', { totalCap: 10 }],
    ['없는 날짜', '2026-02-30', { totalCap: 10 }],
    ['구분자가 섞인 날짜', '2026-08-25%2Fx', { totalCap: 10 }],
    ['소수 totalCap', '2026-08-25', { totalCap: 1.5 }],
    ['객체 totalCap', '2026-08-25', { totalCap: { x: 1 } }],
    ['누락된 totalCap', '2026-08-25', {}],
    ['허용되지 않은 필드', '2026-08-25', { totalCap: 10, usedSlots: 0 }],
  ])('%s는 400이고 service에 도달하지 않는다', async (_label, date, body) => {
    const response = await request(app.getHttpServer())
      .patch(`/stores/store-1/daily-caps/${date}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(productsService.updateDailyCap).not.toHaveBeenCalled();
  });

  it('조회 기간이 없거나 유효하면 통과한다', async () => {
    const withoutRange = await request(app.getHttpServer()).get('/stores/store-1/daily-caps');
    const withRange = await request(app.getHttpServer()).get(
      '/stores/store-1/daily-caps?from=2026-08-01&to=2026-08-31',
    );

    expect(withoutRange.status).toBe(200);
    expect(withRange.status).toBe(200);
    expect(productsService.getDailyCaps).toHaveBeenLastCalledWith(
      'store-1',
      'seller-1',
      '2026-08-01',
      '2026-08-31',
      'seller',
    );
  });

  it.each([
    'from=2026-8-1',
    'to=2026-02-30',
    'from=2026-08-01&from=2026-08-02',
  ])('잘못된 조회 기간 %s는 400이다', async (query) => {
    const response = await request(app.getHttpServer()).get(`/stores/store-1/daily-caps?${query}`);

    expect(response.status).toBe(400);
    expect(productsService.getDailyCaps).not.toHaveBeenCalled();
  });
});
