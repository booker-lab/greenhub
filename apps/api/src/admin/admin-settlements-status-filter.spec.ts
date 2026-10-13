// 어드민 정산 목록 status 필터(settlements T4b)를 HTTP 경계에서 증명한다.
// 실제 AdminController·AdminService·전역 ValidationPipe를 띄우고, 쿼리는 in-memory Firestore가 실제로 거른다.
// 인증·역할 가드는 admin-privileged-mutation.spec이 따로 고정하므로 여기서는 통과시킨다.

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SETTLEMENT_STATUSES } from '@greenhub/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

const SETTLEMENTS = {
  'settlements/s-pending': {
    id: 's-pending',
    storeId: 'store-1',
    status: 'pending',
    settledAt: new Date('2026-08-24T01:00:00.000Z'),
  },
  'settlements/s-confirmed-a': {
    id: 's-confirmed-a',
    storeId: 'store-1',
    status: 'confirmed',
    settledAt: new Date('2026-08-24T02:00:00.000Z'),
  },
  'settlements/s-confirmed-b': {
    id: 's-confirmed-b',
    storeId: 'store-2',
    status: 'confirmed',
    settledAt: new Date('2026-08-25T02:00:00.000Z'),
  },
  'settlements/s-paid': {
    id: 's-paid',
    storeId: 'store-2',
    status: 'paid',
    settledAt: new Date('2026-08-26T02:00:00.000Z'),
  },
  'settlements/s-cancelled': {
    id: 's-cancelled',
    storeId: 'store-1',
    status: 'cancelled',
    settledAt: new Date('2026-08-23T02:00:00.000Z'),
  },
};

describe('GET /admin/settlements status 필터', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const memory = createInMemoryFirestore(SETTLEMENTS);
    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [AdminService, { provide: FirestoreService, useValue: memory.firestore }],
    })
      .useMocker(() => ({}))
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function list(query: Record<string, string> = {}) {
    return request(app.getHttpServer()).get('/admin/settlements').query(query);
  }

  function ids(body: { settlements: Array<{ id: string }> }) {
    return body.settlements.map((settlement) => settlement.id);
  }

  it('status 미지정이면 기존처럼 모든 status를 settledAt 내림차순으로 돌려준다', async () => {
    const response = await list().expect(200);

    expect(ids(response.body)).toEqual([
      's-paid',
      's-confirmed-b',
      's-confirmed-a',
      's-pending',
      's-cancelled',
    ]);
    expect(response.body.total).toBe(5);
  });

  it.each(SETTLEMENT_STATUSES)('status=%s이면 그 상태만 돌려준다', async (status) => {
    const response = await list({ status }).expect(200);

    const expected = Object.values(SETTLEMENTS)
      .filter((settlement) => settlement.status === status)
      .sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime())
      .map((settlement) => settlement.id);
    expect(ids(response.body)).toEqual(expected);
    expect(response.body.total).toBe(expected.length);
  });

  it('status는 storeId·기간 필터와 함께 적용된다', async () => {
    const byStore = await list({ status: 'confirmed', storeId: 'store-1' }).expect(200);
    expect(ids(byStore.body)).toEqual(['s-confirmed-a']);

    const byPeriod = await list({
      status: 'confirmed',
      from: '2026-08-25',
      to: '2026-08-25',
    }).expect(200);
    expect(ids(byPeriod.body)).toEqual(['s-confirmed-b']);
  });

  it.each([
    'PAID',
    'unknown',
    'suspended',
    '',
  ])('정산 status SSOT에 없는 값(%p)은 400으로 거부한다', async (status) => {
    const response = await list({ status }).expect(400);

    expect(response.body.statusCode).toBe(400);
  });
});
