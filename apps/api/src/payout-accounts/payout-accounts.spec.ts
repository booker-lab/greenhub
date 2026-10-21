// 판매자 정산 계좌(결정 ⑤)를 HTTP 경계에서 증명한다.
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
import { accountNumberLast4, maskAccountNumber } from './payout-account.fields';
import { PayoutAccountsController } from './payout-accounts.controller';
import { PayoutAccountsService } from './payout-accounts.service';

const JWT_SECRET = 'payout-accounts-test-secret';
type Actor = 'admin' | 'seller' | 'otherSeller' | 'consumer' | 'driver';
const ACTORS: Record<Actor, { sub: string; role: string; storeId: string | null }> = {
  admin: { sub: 'admin-1', role: 'admin', storeId: null },
  seller: { sub: 'seller-1', role: 'seller', storeId: 'store-1' },
  otherSeller: { sub: 'seller-2', role: 'seller', storeId: 'store-2' },
  consumer: { sub: 'consumer-1', role: 'consumer', storeId: null },
  driver: { sub: 'driver-1', role: 'driver', storeId: null },
};

const VALID = { bankName: '국민은행', accountHolder: '김그린', accountNumber: '110-123-456789' };

describe('판매자 정산 계좌', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let memory: ReturnType<typeof createInMemoryFirestore>;

  beforeEach(async () => {
    memory = createInMemoryFirestore({
      ...Object.fromEntries(
        Object.values(ACTORS).map((actor) => [
          `users/${actor.sub}`,
          { role: actor.role, storeId: actor.storeId, driverApproved: actor.role === 'driver' },
        ]),
      ),
      'stores/store-1': { ownerId: 'seller-1', name: '난플렉스' },
      'stores/store-2': { ownerId: 'seller-2', name: '다른 가게' },
    });
    const config = new ConfigService({ JWT_SECRET });
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [PayoutAccountsController],
      providers: [
        PayoutAccountsService,
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
  const get = (path: string, actor?: Actor) => auth(request(app.getHttpServer()).get(path), actor);
  const put = (path: string, body: unknown, actor?: Actor) =>
    auth(request(app.getHttpServer()).put(path).send(body as object), actor);

  const auditLogs = () =>
    [...memory.records.entries()]
      .filter(([path]) => path.startsWith(`${ADMIN_AUDIT_COLLECTION}/`))
      .map(([, data]) => data);

  it('판매자는 자기 가게 계좌를 저장하고, 계좌번호는 끝 4자리 외를 가려 돌려받는다', async () => {
    const saved = await put('/stores/store-1/payout-account', VALID, 'seller').expect(200);

    expect(saved.body.account).toEqual(
      expect.objectContaining({
        bankName: '국민은행',
        accountHolder: '김그린',
        accountNumberMasked: '***-***-**6789',
        accountNumberLast4: '6789',
      }),
    );
    expect(JSON.stringify(saved.body)).not.toContain('456789');
    expect(memory.read('storePayoutAccounts/store-1')).toEqual(
      expect.objectContaining({ storeId: 'store-1', ...VALID, updatedBy: 'seller-1' }),
    );

    const read = await get('/stores/store-1/payout-account', 'seller').expect(200);
    expect(read.body.account.accountNumberMasked).toBe('***-***-**6789');
    expect(JSON.stringify(read.body)).not.toContain('456789');
  });

  it('앞뒤 공백은 지워 저장한다', async () => {
    await put(
      '/stores/store-1/payout-account',
      { ...VALID, accountHolder: '  김그린 ' },
      'seller',
    ).expect(200);

    expect(memory.read('storePayoutAccounts/store-1')?.accountHolder).toBe('김그린');
  });

  it('계좌가 없으면 account: null', async () => {
    const res = await get('/stores/store-1/payout-account', 'seller').expect(200);
    expect(res.body).toEqual({ account: null });
  });

  it('저장은 행동 기록에 은행과 끝 4자리만 남긴다(예금주·전체 번호 없음)', async () => {
    await put('/stores/store-1/payout-account', VALID, 'seller').expect(200);
    await put(
      '/stores/store-1/payout-account',
      { ...VALID, bankName: '신한은행', accountNumber: '3333012345678' },
      'seller',
    ).expect(200);

    const logs = auditLogs();
    expect(logs).toHaveLength(2);
    const second = logs.find((log) => log['before'] !== null);
    expect(second).toEqual(
      expect.objectContaining({
        action: 'store.payout_account.updated',
        actorId: 'seller-1',
        targetType: 'store',
        targetId: 'store-1',
        before: { bankName: '국민은행', accountNumberLast4: '6789' },
        after: { bankName: '신한은행', accountNumberLast4: '5678' },
      }),
    );
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('김그린');
    expect(serialized).not.toContain('456789');
    expect(serialized).not.toContain('3333012345678');
  });

  it('다른 가게 판매자는 조회·저장할 수 없고 문서도 바뀌지 않는다', async () => {
    await put('/stores/store-1/payout-account', VALID, 'seller').expect(200);

    await get('/stores/store-1/payout-account', 'otherSeller').expect(403);
    await put(
      '/stores/store-1/payout-account',
      { ...VALID, accountNumber: '999-999-999999' },
      'otherSeller',
    ).expect(403);

    expect(memory.read('storePayoutAccounts/store-1')?.accountNumber).toBe(VALID.accountNumber);
  });

  it.each(['consumer', 'driver'] as const)('%s 역할은 판매자 경로를 쓸 수 없다', async (actor) => {
    await get('/stores/store-1/payout-account', actor).expect(403);
    await put('/stores/store-1/payout-account', VALID, actor).expect(403);
  });

  it('인증이 없으면 401', async () => {
    await get('/stores/store-1/payout-account').expect(401);
    await put('/stores/store-1/payout-account', VALID).expect(401);
    await get('/admin/stores/store-1/payout-account').expect(401);
  });

  it('관리자 경로는 전체 계좌번호를 돌려주고, 판매자는 관리자 경로를 쓸 수 없다', async () => {
    await put('/stores/store-1/payout-account', VALID, 'seller').expect(200);

    const res = await get('/admin/stores/store-1/payout-account', 'admin').expect(200);
    expect(res.body.account).toEqual(expect.objectContaining(VALID));
    expect(Object.keys(res.body.account).sort()).toEqual(
      ['accountHolder', 'accountNumber', 'bankName', 'updatedAt'].sort(),
    );

    await get('/admin/stores/store-1/payout-account', 'seller').expect(403);
  });

  it('없는 가게에 저장하면 404이고 문서를 만들지 않는다', async () => {
    await put('/stores/store-x/payout-account', VALID, 'admin').expect(404);
    expect(memory.read('storePayoutAccounts/store-x')).toBeUndefined();
  });

  it.each([
    ['은행 이름 빈칸', { bankName: '' }],
    ['은행 이름 특수문자', { bankName: '국민<script>' }],
    ['은행 이름 21자', { bankName: '가'.repeat(21) }],
    ['예금주 공백만', { accountHolder: '   ' }],
    ['예금주 줄바꿈', { accountHolder: '김\n그린' }],
    ['예금주 31자', { accountHolder: '가'.repeat(31) }],
    ['계좌번호 문자', { accountNumber: '110-abc-456789' }],
    ['계좌번호 7자리', { accountNumber: '1234567' }],
    ['계좌번호 21자리', { accountNumber: '1'.repeat(21) }],
    ['계좌번호 하이픈 시작', { accountNumber: '-110123456789' }],
    ['계좌번호 하이픈 연속', { accountNumber: '110--123456789' }],
    ['계좌번호 공백', { accountNumber: '110 123 456789' }],
  ])('%s은 400으로 거부하고 저장하지 않는다', async (_label, patch) => {
    await put('/stores/store-1/payout-account', { ...VALID, ...patch }, 'seller').expect(400);
    expect(memory.read('storePayoutAccounts/store-1')).toBeUndefined();
  });

  it('허용하지 않은 필드는 400으로 거부한다', async () => {
    await put(
      '/stores/store-1/payout-account',
      { ...VALID, updatedBy: 'someone-else' },
      'seller',
    ).expect(400);
  });
});

describe('계좌번호 가림', () => {
  it('끝 4자리 숫자만 남기고 하이픈 자리는 그대로 둔다', () => {
    expect(maskAccountNumber('110-123-456789')).toBe('***-***-**6789');
    expect(maskAccountNumber('3333012345678')).toBe('*********5678');
    expect(accountNumberLast4('110-123-456789')).toBe('6789');
  });
});
