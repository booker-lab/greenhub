// 관리자 정산 목록 "더 보기"·행 보강·서버 합계(결정 ⑦)를 HTTP 경계에서 증명한다.
// 실제 AdminController·AdminService·전역 ValidationPipe를 띄우고, 쿼리는 in-memory Firestore가 실제로 거른다.
// 인증·역할 가드는 admin-privileged-mutation.spec이 따로 고정하므로 여기서는 통과시킨다.

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
import {
  ADMIN_SETTLEMENT_LIST_DEFAULT_LIMIT,
  ADMIN_SETTLEMENT_LIST_MAX_LIMIT,
  resolveAdminSettlementListLimit,
} from './_lib/admin-settlements-query';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

type Data = Record<string, unknown>;

function settlement(
  id: string,
  storeId: string,
  status: string,
  hour: number,
  extra: Data = {},
): [string, Data] {
  return [
    `settlements/${id}`,
    {
      id,
      orderId: id,
      storeId,
      status,
      orderNumber: `N-${id}`,
      totalAmount: 10000,
      platformFee: 500,
      netAmount: 9500,
      settledAt: new Date(Date.UTC(2026, 9, 20, hour)),
      ...extra,
    },
  ];
}

// settledAt 최신순: s7(7시) → s1(1시)
const FIXTURE: Record<string, Data> = Object.fromEntries([
  settlement('s1', 'store-1', 'pending', 1),
  settlement('s2', 'store-1', 'confirmed', 2, { orderNumber: null }),
  settlement('s3', 'store-2', 'confirmed', 3, { netAmount: 18000, platformFee: 2000 }),
  settlement('s4', 'store-1', 'paid', 4),
  settlement('s5', 'store-2', 'paid', 5, {
    netAmount: 27000,
    platformFee: 3000,
    recoveryRequired: true,
    recoveryAmount: 27000,
  }),
  settlement('s6', 'store-1', 'cancelled', 6),
  settlement('s7', 'store-1', 'confirmed', 7),
  ['stores/store-1', { ownerId: 'seller-1', name: '난플렉스' }],
  ['stores/store-2', { ownerId: 'seller-2', name: '디어 오키드' }],
  ['orders/s2', { orderNumber: 'OLD-0002', storeId: 'store-1' }],
  [
    'storePayoutAccounts/store-1',
    { bankName: '국민은행', accountHolder: '김그린', accountNumber: '110-123-456789' },
  ],
  [
    'operationIssues/issue-open',
    { orderId: 's7', type: 'PROVIDER_REVERSAL_DETECTED', status: 'OPEN', storeId: 'store-1' },
  ],
  [
    'operationIssues/issue-resolved',
    { orderId: 's2', type: 'PROVIDER_REVERSAL_DETECTED', status: 'RESOLVED', storeId: 'store-1' },
  ],
  [
    'operationIssues/issue-paid',
    { orderId: 's4', type: 'PROVIDER_REVERSAL_DETECTED', status: 'OPEN', storeId: 'store-1' },
  ],
]);

describe('GET /admin/settlements 더 보기·행 보강과 /summary 서버 합계', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const memory = createInMemoryFirestore(FIXTURE);
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

  const list = (query: Record<string, string> = {}) =>
    request(app.getHttpServer()).get('/admin/settlements').query(query);
  const summary = (query: Record<string, string> = {}) =>
    request(app.getHttpServer()).get('/admin/settlements/summary').query(query);
  const ids = (body: { settlements: Array<{ id: string }> }) => body.settlements.map((s) => s.id);
  const row = (body: { settlements: Data[] }, id: string) =>
    body.settlements.find((s) => s['id'] === id) as Data;

  describe('더 보기', () => {
    it('limit만큼 주고 남은 건이 있으면 hasMore·nextCursor로 이어 받는다(겹침·빠짐 없음)', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const query: Record<string, string> = { limit: '3' };
        if (cursor) query['cursor'] = cursor;
        const res = await list(query).expect(200);
        seen.push(...ids(res.body));
        expect(res.body.total).toBe(res.body.settlements.length);
        if (!res.body.hasMore) {
          expect(res.body.nextCursor).toBeNull();
          break;
        }
        expect(res.body.nextCursor).toBe(seen.at(-1));
        cursor = res.body.nextCursor;
      }
      expect(seen).toEqual(['s7', 's6', 's5', 's4', 's3', 's2', 's1']);
    });

    it('상태·가게 조건과 함께 이어 받는다', async () => {
      const first = await list({ status: 'confirmed', limit: '1' }).expect(200);
      expect(ids(first.body)).toEqual(['s7']);
      expect(first.body.hasMore).toBe(true);

      const second = await list({
        status: 'confirmed',
        limit: '5',
        cursor: first.body.nextCursor,
      }).expect(200);
      expect(ids(second.body)).toEqual(['s3', 's2']);
      expect(second.body).toEqual(expect.objectContaining({ hasMore: false, nextCursor: null }));

      const byStore = await list({ storeId: 'store-2' }).expect(200);
      expect(ids(byStore.body)).toEqual(['s5', 's3']);
    });

    it('조건이 끝까지 한 페이지에 들어가면 hasMore=false', async () => {
      const res = await list().expect(200);
      expect(ids(res.body)).toHaveLength(7);
      expect(res.body).toEqual(expect.objectContaining({ hasMore: false, nextCursor: null }));
    });

    it.each([
      ['형식이 틀린 cursor', { cursor: '../stores/store-1' }],
      ['없는 정산 cursor', { cursor: 'missing-1' }],
      ['다른 가게 정산 cursor', { storeId: 'store-2', cursor: 's7' }],
      ['0 이하 limit', { limit: '0' }],
      ['숫자가 아닌 limit', { limit: 'many' }],
    ])('%s은 400', async (_label, query) => {
      await list(query).expect(400);
    });

    it('limit 생략은 기본값, 상한을 넘으면 상한으로 줄인다', () => {
      expect(resolveAdminSettlementListLimit(undefined)).toBe(ADMIN_SETTLEMENT_LIST_DEFAULT_LIMIT);
      expect(resolveAdminSettlementListLimit(10_000)).toBe(ADMIN_SETTLEMENT_LIST_MAX_LIMIT);
      expect(resolveAdminSettlementListLimit('20')).toBe(20);
    });
  });

  describe('행 보강', () => {
    it('가게 이름·주문번호를 붙이고, 주문번호가 없는 옛 정산은 주문 문서에서 읽는다', async () => {
      const res = await list().expect(200);
      expect(row(res.body, 's7')).toEqual(
        expect.objectContaining({ storeName: '난플렉스', orderNumber: 'N-s7' }),
      );
      expect(row(res.body, 's3')['storeName']).toBe('디어 오키드');
      expect(row(res.body, 's2')['orderNumber']).toBe('OLD-0002');
    });

    it('열린 결제사 취소·분쟁 기록이 있는 지급 전 정산만 보류 사유를 붙인다', async () => {
      const res = await list().expect(200);
      expect(row(res.body, 's7')['holdReason']).toBe('PROVIDER_REVERSAL');
      // 처리된(RESOLVED) 기록은 막지 않는다.
      expect(row(res.body, 's2')['holdReason']).toBeNull();
      // 이미 지급된 정산은 보류 대상이 아니다.
      expect(row(res.body, 's4')['holdReason']).toBeNull();
    });

    it('정산 계좌는 지급 대상(confirmed) 행에만 붙고, 계좌 없는 가게는 null', async () => {
      const res = await list().expect(200);
      expect(row(res.body, 's7')['payoutAccount']).toEqual({
        bankName: '국민은행',
        accountHolder: '김그린',
        accountNumber: '110-123-456789',
      });
      expect(row(res.body, 's4')['payoutAccount']).toBeNull();
      expect(row(res.body, 's1')['payoutAccount']).toBeNull();
      expect(row(res.body, 's3')['payoutAccount']).toBeNull();
    });

    it('지급 뒤 환불된 정산은 회수 필요와 금액을 보인다', async () => {
      const res = await list().expect(200);
      expect(row(res.body, 's5')).toEqual(
        expect.objectContaining({ status: 'paid', recoveryRequired: true, recoveryAmount: 27000 }),
      );
      expect(row(res.body, 's4')).toEqual(
        expect.objectContaining({ recoveryRequired: false, recoveryAmount: null }),
      );
    });
  });

  describe('서버 합계', () => {
    it('목록 페이지와 무관하게 조건 전체의 지급 대기·지급 완료·수수료·회수 필요를 계산한다', async () => {
      const res = await summary().expect(200);
      expect(res.body).toEqual({
        count: 7,
        byStatus: { pending: 1, confirmed: 3, paid: 2, cancelled: 1 },
        // confirmed s2·s3·s7
        payable: { count: 3, netAmount: 9500 + 18000 + 9500 },
        // paid s4·s5
        paid: { count: 2, netAmount: 9500 + 27000 },
        // confirmed + paid 수수료
        platformFee: 500 + 2000 + 500 + 500 + 3000,
        recovery: { count: 1, amount: 27000 },
        truncated: false,
      });
    });

    it('가게·상태·기간 조건을 목록과 같게 적용한다', async () => {
      const byStore = await summary({ storeId: 'store-2' }).expect(200);
      expect(byStore.body.payable).toEqual({ count: 1, netAmount: 18000 });
      expect(byStore.body.paid).toEqual({ count: 1, netAmount: 27000 });

      const paidOnly = await summary({ status: 'paid' }).expect(200);
      expect(paidOnly.body.payable).toEqual({ count: 0, netAmount: 0 });
      expect(paidOnly.body.count).toBe(2);

      const outside = await summary({ from: '2026-10-22', to: '2026-10-22' }).expect(200);
      expect(outside.body.count).toBe(0);
    });

    it('합계는 이어받기 값을 받지 않는다(400)', async () => {
      await summary({ cursor: 's7' }).expect(400);
      await summary({ limit: '1' }).expect(400);
    });
  });
});
