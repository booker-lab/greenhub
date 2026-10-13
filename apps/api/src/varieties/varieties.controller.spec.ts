import 'reflect-metadata';
import { type ExecutionContext, type INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ROLES_KEY, type UserRole } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { VARIETY_CATEGORY_VALUES } from './dto/variety-query.dto';
import { VarietiesController } from './varieties.controller';
import { VarietiesService } from './varieties.service';

type Handler = 'findAll' | 'findOne' | 'create' | 'update';

function handlerOf(name: Handler) {
  return VarietiesController.prototype[name];
}

function contextFor(name: Handler, role: UserRole): ExecutionContext {
  return {
    getHandler: () => handlerOf(name),
    getClass: () => VarietiesController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'user-1', role } }) }),
  } as unknown as ExecutionContext;
}

describe('VarietiesController 접근 제어', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(['create', 'update'] as const)('%s는 JWT와 역할 가드를 함께 건다', (name) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handlerOf(name))).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, handlerOf(name))).toEqual(['admin']);
  });

  it.each(['create', 'update'] as const)('%s는 consumer·seller·driver에게 거부된다', (name) => {
    for (const role of ['consumer', 'seller', 'driver'] as const) {
      expect(guard.canActivate(contextFor(name, role))).toBe(false);
    }
  });

  it.each(['create', 'update'] as const)('%s는 admin에게 허용된다', (name) => {
    expect(guard.canActivate(contextFor(name, 'admin'))).toBe(true);
  });

  it.each(['findAll', 'findOne'] as const)('%s 조회는 공개 상태를 유지한다', (name) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handlerOf(name))).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, handlerOf(name))).toBeUndefined();
  });
});

describe('VarietiesController GET /varieties category 검증', () => {
  let app: INestApplication<App>;
  const varietiesService = { findAll: jest.fn().mockResolvedValue([{ id: 'v-1' }]) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [VarietiesController],
      providers: [{ provide: VarietiesService, useValue: varietiesService }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it.each(VARIETY_CATEGORY_VALUES)('category=%s는 그 카테고리로 조회한다', async (category) => {
    await request(app.getHttpServer())
      .get('/varieties')
      .query({ category })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([{ id: 'v-1' }]);
      });
    expect(varietiesService.findAll).toHaveBeenCalledWith(category);
  });

  // service는 falsy category를 필터 없음(전체 목록)으로 처리한다.
  it.each([
    ['없음', '/varieties', undefined],
    ['빈 값', '/varieties?category=', ''],
  ])('category %s이면 지금처럼 필터 없이 넘긴다', async (_label, url, expected) => {
    await request(app.getHttpServer()).get(url).expect(200);
    expect(varietiesService.findAll).toHaveBeenCalledTimes(1);
    expect(varietiesService.findAll).toHaveBeenCalledWith(expected);
  });

  it.each([
    ['정의되지 않은 값', '/varieties?category=tree'],
    ['배열', '/varieties?category=orchid&category=foliage'],
    ['긴 문자열', `/varieties?category=${'a'.repeat(2000)}`],
    ['알 수 없는 쿼리', '/varieties?category=orchid&extra=x'],
  ])('%s는 400이고 조회하지 않는다', async (_label, url) => {
    await request(app.getHttpServer()).get(url).expect(400);
    expect(varietiesService.findAll).not.toHaveBeenCalled();
  });
});
