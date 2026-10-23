// 매장 옵션 재고 품목(직접 출력한 화분 등)을 HTTP 경계에서 증명한다.
// 실제 JWT 인증·역할 가드·전역 ValidationPipe를 띄우고, 저장은 in-memory Firestore에 실제로 쓴다.

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ADMIN_AUDIT_COLLECTION, AuditService } from '../common/audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
import { OptionStocksController } from './option-stocks.controller';
import { OptionStocksService, assertOptionStocksBelongToStore } from './option-stocks.service';

const JWT_SECRET = 'option-stocks-test-secret';
type Actor = 'admin' | 'seller' | 'otherSeller' | 'consumer';
const ACTORS: Record<Actor, { sub: string; role: string; storeId: string | null }> = {
  admin: { sub: 'admin-1', role: 'admin', storeId: null },
  seller: { sub: 'seller-1', role: 'seller', storeId: 'store-1' },
  otherSeller: { sub: 'seller-2', role: 'seller', storeId: 'store-2' },
  consumer: { sub: 'consumer-1', role: 'consumer', storeId: null },
};

describe('매장 옵션 재고 품목', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let memory: ReturnType<typeof createInMemoryFirestore>;

  beforeEach(async () => {
    memory = createInMemoryFirestore({
      ...Object.fromEntries(
        Object.values(ACTORS).map((actor) => [
          `users/${actor.sub}`,
          { role: actor.role, storeId: actor.storeId },
        ]),
      ),
      'stores/store-1': { ownerId: 'seller-1', name: '디어 오키드' },
      'stores/store-2': { ownerId: 'seller-2', name: '다른 가게' },
    });
    const config = new ConfigService({ JWT_SECRET });
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [OptionStocksController],
      providers: [
        OptionStocksService,
        AuditService,
        { provide: FirestoreService, useValue: memory.firestore },
        { provide: ConfigService, useValue: config },
        JwtAuthGuard,
        RolesGuard,
        JwtStrategy,
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
    jwt = app.get(JwtService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function auth(test: request.Test, actor?: Actor) {
    if (!actor) return test;
    const { sub, role, storeId } = ACTORS[actor];
    return test.set('Authorization', `Bearer ${jwt.sign({ sub, role, storeId })}`);
  }
  const server = () => request(app.getHttpServer());
  const get = (path: string, actor?: Actor) => auth(server().get(path), actor);
  const post = (path: string, body: unknown, actor?: Actor) =>
    auth(server().post(path).send(body as object), actor);
  const patch = (path: string, body: unknown, actor?: Actor) =>
    auth(server().patch(path).send(body as object), actor);

  const auditLogs = () =>
    [...memory.records.entries()]
      .filter(([path]) => path.startsWith(`${ADMIN_AUDIT_COLLECTION}/`))
      .map(([, data]) => data);

  async function createPot(quantity = 10) {
    const res = await post(
      '/stores/store-1/option-stocks',
      { name: ' 흰색 출력 화분 ', quantity },
      'seller',
    ).expect(201);
    return res.body.stock as { id: string };
  }

  it('판매자는 자기 가게에 재고 품목을 만들고 목록으로 본다', async () => {
    const stock = await createPot(10);

    expect(memory.read(`optionStocks/${stock.id}`)).toEqual(
      expect.objectContaining({
        storeId: 'store-1',
        name: '흰색 출력 화분',
        stockQuantity: 10,
        reservedQuantity: 0,
        orderedQuantity: 0,
        updatedBy: 'seller-1',
      }),
    );
    const list = await get('/stores/store-1/option-stocks', 'seller').expect(200);
    expect(list.body.stocks).toEqual([
      expect.objectContaining({ id: stock.id, name: '흰색 출력 화분', remainingQuantity: 10 }),
    ]);
    expect(auditLogs()).toEqual([
      expect.objectContaining({
        action: 'store.option_stock.created',
        actorId: 'seller-1',
        targetType: 'store',
        targetId: 'store-1',
        after: { stockId: stock.id, name: '흰색 출력 화분', stockQuantity: 10 },
      }),
    ]);
  });

  it('새로 출력한 개수를 더한다', async () => {
    const stock = await createPot(3);
    const res = await patch(`/stores/store-1/option-stocks/${stock.id}`, { addQuantity: 5 }, 'seller').expect(200);
    expect(res.body.stock).toEqual(expect.objectContaining({ stockQuantity: 8, remainingQuantity: 8 }));
  });

  it('남은 수량을 맞춰도 결제 중·결제 완료 수량은 그대로 둔다', async () => {
    const stock = await createPot(10);
    const path = `optionStocks/${stock.id}`;
    memory.records.set(path, { ...memory.read(path)!, reservedQuantity: 2, orderedQuantity: 3 });

    const res = await patch(
      `/stores/store-1/option-stocks/${stock.id}`,
      { remainingQuantity: 4 },
      'seller',
    ).expect(200);

    expect(res.body.stock).toEqual(
      expect.objectContaining({
        stockQuantity: 9,
        reservedQuantity: 2,
        orderedQuantity: 3,
        remainingQuantity: 4,
      }),
    );
    expect(auditLogs().at(-1)).toEqual(
      expect.objectContaining({
        action: 'store.option_stock.updated',
        before: { stockId: stock.id, name: '흰색 출력 화분', stockQuantity: 10, remainingQuantity: 5 },
        after: { stockId: stock.id, name: '흰색 출력 화분', stockQuantity: 9, remainingQuantity: 4 },
      }),
    );
  });

  it('더할 수량과 남은 수량을 같이 보내거나 아무것도 안 보내면 거절한다', async () => {
    const stock = await createPot();
    await patch(
      `/stores/store-1/option-stocks/${stock.id}`,
      { addQuantity: 1, remainingQuantity: 1 },
      'seller',
    ).expect(400);
    await patch(`/stores/store-1/option-stocks/${stock.id}`, {}, 'seller').expect(400);
  });

  it('수량·이름 형식이 틀리면 거절한다', async () => {
    await post('/stores/store-1/option-stocks', { name: '화분', quantity: -1 }, 'seller').expect(400);
    await post('/stores/store-1/option-stocks', { name: '화분', quantity: 1.5 }, 'seller').expect(400);
    await post('/stores/store-1/option-stocks', { name: '   ', quantity: 1 }, 'seller').expect(400);
    await post('/stores/store-1/option-stocks', { name: '화\n분', quantity: 1 }, 'seller').expect(400);
    const stock = await createPot();
    await patch(`/stores/store-1/option-stocks/${stock.id}`, { addQuantity: 0 }, 'seller').expect(400);
  });

  it('다른 가게 판매자·소비자·비로그인은 다루지 못한다', async () => {
    const stock = await createPot();
    await get('/stores/store-1/option-stocks', 'otherSeller').expect(403);
    await post('/stores/store-1/option-stocks', { name: '화분', quantity: 1 }, 'otherSeller').expect(403);
    await patch(`/stores/store-1/option-stocks/${stock.id}`, { addQuantity: 1 }, 'otherSeller').expect(403);
    await get('/stores/store-1/option-stocks', 'consumer').expect(403);
    await get('/stores/store-1/option-stocks').expect(401);
  });

  it('다른 가게 품목 id로는 고칠 수 없다', async () => {
    const stock = await createPot();
    await patch(`/stores/store-2/option-stocks/${stock.id}`, { addQuantity: 1 }, 'otherSeller').expect(404);
    expect(memory.read(`optionStocks/${stock.id}`)?.['stockQuantity']).toBe(10);
  });

  it('관리자는 모든 가게의 재고를 다룬다', async () => {
    await post('/stores/store-2/option-stocks', { name: '화분', quantity: 2 }, 'admin').expect(201);
    const list = await get('/stores/store-2/option-stocks', 'admin').expect(200);
    expect(list.body.stocks).toHaveLength(1);
  });

  it('상품 옵션은 같은 가게 재고 품목만 가리킬 수 있다', async () => {
    const stock = await createPot();
    const options = (stockId: string) => [
      { id: 'pot', choices: [{ id: 'printed', stockId }, { id: 'plain' }] },
    ];
    await expect(
      assertOptionStocksBelongToStore(memory.firestore as never, 'store-1', options(stock.id)),
    ).resolves.toBeUndefined();
    await expect(
      assertOptionStocksBelongToStore(memory.firestore as never, 'store-2', options(stock.id)),
    ).rejects.toThrow('옵션에 연결한 재고 품목을 찾을 수 없습니다.');
    await expect(
      assertOptionStocksBelongToStore(memory.firestore as never, 'store-1', options('missing')),
    ).rejects.toThrow('옵션에 연결한 재고 품목을 찾을 수 없습니다.');
  });
});
