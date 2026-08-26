import 'reflect-metadata';
import { COLOR_OPTIONS } from '@greenhub/shared';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { PARAMTYPES_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsController } from './products.controller';
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
