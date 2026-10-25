import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as admin from 'firebase-admin';
import * as bcrypt from 'bcrypt';
import type { AuditService } from '../common/audit/audit.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { AuthService } from './auth.service';
import type { KakaoClient } from './kakao.client';
import { hashRefreshToken } from './refresh-token-store';
import { REFRESH_SESSION_MAX_COUNT } from './refresh-sessions';
import { JwtStrategy } from './strategies/jwt.strategy';
import type { JwtPayload } from './types/jwt-payload.type';

jest.mock('firebase-admin', () => ({ auth: jest.fn() }));

const JWT_SECRET = 'per-device-access-secret';
const JWT_REFRESH_SECRET = 'per-device-refresh-secret';
const PASSWORD = 'password-123';
const SELLER = { id: 'seller-1', email: 'seller@example.com', role: 'seller', storeId: 'store-1' };

type Data = Record<string, unknown>;

// 문서 경로 → 데이터. 트랜잭션은 읽기를 즉시 하고 쓰기를 콜백이 끝난 뒤 순서대로 반영한다.
function makeInMemoryFirestore() {
  const docs = new Map<string, Data>();
  const timestamp = (millis: number) => ({ toMillis: () => millis });

  function ref(path: string) {
    return {
      path,
      get: () => {
        const data = docs.get(path);
        return Promise.resolve({ exists: data !== undefined, data: () => data });
      },
      set: (data: Data) => {
        docs.set(path, { ...data });
        return Promise.resolve();
      },
      update: (data: Data) => {
        const current = docs.get(path);
        if (current === undefined) return Promise.reject(new Error(`no document: ${path}`));
        docs.set(path, { ...current, ...data });
        return Promise.resolve();
      },
      delete: () => {
        docs.delete(path);
        return Promise.resolve();
      },
    };
  }
  type Ref = ReturnType<typeof ref>;

  const firestore = {
    doc: (path: string) => ref(path),
    collection: (name: string) => {
      const filters: Array<[string, unknown]> = [];
      const query = {
        where: (field: string, _op: string, value: unknown) => {
          filters.push([field, value]);
          return query;
        },
        limit: () => query,
        get: () => {
          const matches = [...docs.entries()]
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([, data]) => data)
            .filter((data) => filters.every(([field, value]) => data[field] === value));
          return Promise.resolve({
            empty: matches.length === 0,
            docs: matches.map((data) => ({ data: () => data })),
          });
        },
      };
      return query;
    },
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const writes: Array<() => Promise<void>> = [];
      const result = await fn({
        get: (r: Ref) => r.get(),
        set: (r: Ref, data: Data) => writes.push(() => r.set(data)),
        update: (r: Ref, data: Data) => writes.push(() => r.update(data)),
        delete: (r: Ref) => writes.push(() => r.delete()),
      });
      for (const write of writes) await write();
      return result;
    },
    Timestamp: {
      now: () => timestamp(Date.now()),
      fromMillis: (millis: number) => timestamp(millis),
    },
  };
  return { docs, firestore };
}

describe('기기별 refresh 세션', () => {
  let nowMillis: number;
  let nowSpy: jest.SpyInstance;
  const firebaseAuth = { revokeRefreshTokens: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    firebaseAuth.revokeRefreshTokens.mockResolvedValue(undefined);
    (admin.auth as jest.Mock).mockReturnValue(firebaseAuth);
    // JWT iat는 초 단위다. 단계마다 시계를 넘겨 같은 세션의 토큰이 서로 다르게 만든다.
    nowMillis = Date.UTC(2026, 9, 15, 0, 0, 0);
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMillis);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  function advance(ms: number) {
    nowMillis += ms;
  }

  async function setup() {
    const { docs, firestore } = makeInMemoryFirestore();
    docs.set(`users/${SELLER.id}`, {
      ...SELLER,
      suspended: false,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
    });
    const config = new ConfigService({
      JWT_SECRET,
      JWT_REFRESH_SECRET,
      JWT_EXPIRES_IN: '1h',
      JWT_REFRESH_EXPIRES_IN: '30d',
    });
    const jwt = new JwtService({});
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      firestore as unknown as FirestoreService,
      jwt,
      config,
      { getUser: jest.fn() } as unknown as KakaoClient,
      audit as unknown as AuditService,
    );
    const strategy = new JwtStrategy(config, firestore as unknown as FirestoreService);

    // passport-jwt와 같이 서명·만료를 검증한 payload를 JwtStrategy에 넘긴다.
    const authenticate = (accessToken: string) =>
      strategy.validate(jwt.verify<JwtPayload>(accessToken, { secret: JWT_SECRET }));
    const login = async () => {
      advance(1_000);
      return service.login({ email: SELLER.email, password: PASSWORD });
    };
    const refresh = async (refreshToken: string) => {
      advance(2_000);
      return service.refresh(refreshToken);
    };
    const sessionIds = () =>
      Object.keys((docs.get(`refreshTokens/${SELLER.id}`)?.['sessions'] as Data) ?? {});
    const stolenAudits = () =>
      audit.log.mock.calls.filter(([action]) => action === 'auth.token.stolen');

    return { audit, authenticate, docs, jwt, login, refresh, service, sessionIds, stolenAudits };
  }

  it('두 기기가 로그인해도 각자 여러 번 회전하며 갱신하고, 서로를 재사용으로 만들지 않는다', async () => {
    const { authenticate, login, refresh, service, sessionIds, stolenAudits } = await setup();

    let a = await login();
    let b = await login();
    expect(sessionIds()).toHaveLength(2);

    for (let i = 0; i < 3; i += 1) {
      const nextA = await refresh(a.refreshToken);
      expect(nextA.refreshToken).not.toBe(a.refreshToken);
      a = { ...a, ...nextA };
      const nextB = await refresh(b.refreshToken);
      expect(nextB.refreshToken).not.toBe(b.refreshToken);
      b = { ...b, ...nextB };
    }

    const userA = await authenticate(a.accessToken);
    const userB = await authenticate(b.accessToken);
    expect(userA.sid).not.toBe(userB.sid);
    await expect(service.getSession(userA)).resolves.toMatchObject({ sub: SELLER.id });
    await expect(service.getSession(userB)).resolves.toMatchObject({ sub: SELLER.id });
    expect(stolenAudits()).toHaveLength(0);
    expect(firebaseAuth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('A의 로그아웃은 A의 refresh와 access token만 끝내고 B는 계속 쓴다', async () => {
    const { authenticate, docs, login, refresh, service, stolenAudits } = await setup();
    const a = await login();
    const b = await login();

    await service.logout(SELLER.id, (await authenticate(a.accessToken)).sid);

    await expect(refresh(a.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(a.accessToken)).rejects.toMatchObject({ status: 401 });

    const userB = await authenticate(b.accessToken);
    await expect(service.getSession(userB)).resolves.toMatchObject({ sub: SELLER.id });
    const nextB = await refresh(b.refreshToken);
    await expect(authenticate(nextB.accessToken)).resolves.toMatchObject({ sub: SELLER.id });

    // 기기 로그아웃은 사용자 단위 폐기·Firebase 폐기·재사용 기록을 남기지 않는다.
    expect(docs.get(`users/${SELLER.id}`)?.['sessionsRevokedAt']).toBeUndefined();
    expect(firebaseAuth.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(stolenAudits()).toHaveLength(0);
  });

  it('A의 이미 회전된 refresh token이 다시 오면 모든 세션을 끊고 재사용을 기록한다', async () => {
    const { authenticate, docs, login, refresh, stolenAudits } = await setup();
    const a0 = await login();
    const b = await login();
    const a1 = await refresh(a0.refreshToken);
    const sidA = (await authenticate(a1.accessToken)).sid;

    advance(61_000); // 회전 유예(60초) 밖
    await expect(refresh(a0.refreshToken)).rejects.toMatchObject({ status: 401 });

    expect(stolenAudits()).toEqual([
      ['auth.token.stolen', { userId: SELLER.id, detail: { sessionId: sidA } }],
    ]);
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith(SELLER.id);
    expect(docs.has(`refreshTokens/${SELLER.id}`)).toBe(false);
    // 선택한 범위: 사용자의 모든 세션(A·B)의 refresh와 access token이 끊긴다.
    await expect(refresh(a1.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(refresh(b.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(a1.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(b.accessToken)).rejects.toMatchObject({ status: 401 });

    // 끊긴 뒤 다시 로그인하면 정상 세션을 받는다.
    const again = await login();
    await expect(authenticate(again.accessToken)).resolves.toMatchObject({ sub: SELLER.id });
  });

  it('같은 세션의 동시 갱신(유예 안의 직전 토큰)은 재사용으로 보지 않는다', async () => {
    const { login, refresh, stolenAudits } = await setup();
    const a0 = await login();
    const a1 = await refresh(a0.refreshToken);

    await expect(refresh(a0.refreshToken)).resolves.toMatchObject({
      refreshToken: a1.refreshToken,
    });
    expect(stolenAudits()).toHaveLength(0);
  });

  it(`세션이 ${REFRESH_SESSION_MAX_COUNT}개를 넘으면 가장 오래 쓰이지 않은 세션을 끊는다`, async () => {
    const { authenticate, login, refresh, sessionIds, stolenAudits } = await setup();
    const oldest = await login();
    const second = await login();
    for (let i = 2; i < REFRESH_SESSION_MAX_COUNT; i += 1) await login();
    // 두 번째 세션만 최근에 갱신해, 생성 순서가 아니라 마지막 사용 순서로 고르는지 확인한다.
    const secondNext = await refresh(second.refreshToken);
    expect(sessionIds()).toHaveLength(REFRESH_SESSION_MAX_COUNT);

    const newest = await login();

    expect(sessionIds()).toHaveLength(REFRESH_SESSION_MAX_COUNT);
    await expect(refresh(oldest.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(oldest.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(refresh(secondNext.refreshToken)).resolves.toBeDefined();
    await expect(refresh(newest.refreshToken)).resolves.toBeDefined();
    // 상한 초과로 끊긴 세션은 재사용 신호가 아니다.
    expect(stolenAudits()).toHaveLength(0);
  });

  it('sid 없는 이전 refresh token은 기록·감사 변경 없이 401로 다시 로그인하게 한다', async () => {
    const { audit, docs, jwt, refresh } = await setup();
    const legacyRefresh = jwt.sign(
      { sub: SELLER.id, role: SELLER.role, storeId: SELLER.storeId, typ: 'refresh' },
      { secret: JWT_REFRESH_SECRET, expiresIn: '30d', audience: 'greenhub-api' },
    );
    const legacyRecord = { token: hashRefreshToken(legacyRefresh), updatedAt: 'before' };
    docs.set(`refreshTokens/${SELLER.id}`, legacyRecord);

    await expect(refresh(legacyRefresh)).rejects.toMatchObject({ status: 401 });

    expect(docs.get(`refreshTokens/${SELLER.id}`)).toEqual(legacyRecord);
    expect(audit.log).not.toHaveBeenCalled();
    expect(firebaseAuth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('이전 단일 기록 형식이 남아 있어도 새 로그인은 세션 맵으로 다시 쓴다', async () => {
    const { authenticate, docs, login, refresh } = await setup();
    docs.set(`refreshTokens/${SELLER.id}`, { token: hashRefreshToken('legacy'), updatedAt: 'x' });

    const a = await login();

    expect(Object.keys(docs.get(`refreshTokens/${SELLER.id}`) ?? {}).sort()).toEqual([
      'sessions',
      'updatedAt',
    ]);
    await expect(refresh(a.refreshToken)).resolves.toBeDefined();
    await expect(authenticate(a.accessToken)).resolves.toMatchObject({ sub: SELLER.id });
  });

  it('sid 없는 이전 access token은 세션 확인에서 거부되고, 그 logout은 모든 세션을 끊는다', async () => {
    const { authenticate, jwt, login, refresh, service } = await setup();
    const current = await login();
    const legacyAccess = jwt.sign(
      { sub: SELLER.id, role: SELLER.role, storeId: SELLER.storeId, typ: 'access' },
      { secret: JWT_SECRET, expiresIn: '1h', audience: 'greenhub-api' },
    );

    const legacyUser = await authenticate(legacyAccess);
    expect(legacyUser.sid).toBeUndefined();
    await expect(service.getSession(legacyUser)).rejects.toMatchObject({ status: 401 });

    advance(1_000);
    await service.logout(legacyUser.sub, legacyUser.sid);

    await expect(refresh(current.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(current.accessToken)).rejects.toMatchObject({ status: 401 });
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith(SELLER.id);
  });

  it('가게 등록 전에 받은 토큰은 등록 뒤에도 세션 확인·refresh가 이어지고 새 토큰에 매장을 담는다', async () => {
    const { authenticate, docs, jwt, login, refresh, service, stolenAudits } = await setup();
    docs.set(`users/${SELLER.id}`, { ...docs.get(`users/${SELLER.id}`), storeId: null });
    const before = await login();
    expect(jwt.decode(before.accessToken)).not.toHaveProperty('storeId');

    // POST /stores는 users.storeId만 갱신하고 토큰을 다시 발급하지 않는다.
    docs.set(`users/${SELLER.id}`, { ...docs.get(`users/${SELLER.id}`), storeId: 'store-new' });

    const principal = await authenticate(before.accessToken);
    expect(principal).toMatchObject({ sub: SELLER.id, role: 'seller', storeId: 'store-new' });
    await expect(service.getSession(principal)).resolves.toBeDefined();

    const after = await refresh(before.refreshToken);
    expect(jwt.decode(after.accessToken)).toMatchObject({ storeId: 'store-new' });
    expect(jwt.decode(after.refreshToken)).toMatchObject({ storeId: 'store-new' });
    await expect(authenticate(after.accessToken)).resolves.toMatchObject({ storeId: 'store-new' });
    expect(stolenAudits()).toHaveLength(0);
  });

  it('다른 매장으로 옮겨진 판매자의 이전 토큰은 세션 확인·refresh 모두 거부한다', async () => {
    const { authenticate, docs, login, refresh } = await setup();
    const before = await login();
    docs.set(`users/${SELLER.id}`, { ...docs.get(`users/${SELLER.id}`), storeId: 'store-2' });

    await expect(authenticate(before.accessToken)).rejects.toThrow();
    await expect(refresh(before.refreshToken)).rejects.toThrow();
  });

  it('살아 있는 세션 목록은 GET /auth/me 응답에 넣지 않는다', async () => {
    const { login, service } = await setup();
    await login();
    const a = await login();

    expect(a.user).not.toHaveProperty('activeSessionIds');
    await expect(service.getMe(SELLER.id)).resolves.not.toHaveProperty('activeSessionIds');
  });
});
