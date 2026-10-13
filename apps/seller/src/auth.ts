import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Kakao from 'next-auth/providers/kakao';
import {
  authUpstreamSignal,
  isLoopbackApiUrl,
  isTestCredentialsProviderEnabled,
  revokeApiSession,
  testSecretsMatch,
} from '@/auth-runtime';
import { getApiBaseUrl } from '@/lib/api-base-url';

const API = getApiBaseUrl();
const ACCESS_TOKEN_TTL = 55 * 60 * 1000;

type CredentialsFailureCode =
  | 'authorize-rejected'
  | 'upstream-rejected'
  | 'api-binding-failure';

class DiagnosticCredentialsSignin extends CredentialsSignin {
  constructor(code: CredentialsFailureCode) {
    super();
    this.code = code;
  }
}

// Local pilot runtime 전용 Credentials 진입.
// launcher가 고정하는 marker + localhost API에서만 E2E 헤더 게이트를 생략한다.
// 그 외 환경에서는 기존 E2E 헤더 게이트를 그대로 적용한다 (fail-closed).
function isLocalCredentialRuntime(): boolean {
  if (process.env.GREENHUB_LOCAL_RUNTIME !== 'true') return false;
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.VERCEL_ENV === 'production') return false;
  if (process.env.RAILWAY_ENVIRONMENT_NAME === 'production') return false;
  if (!isLoopbackApiUrl(API)) return false;
  return true;
}

// PILOT-AUTH-SAME-DEPLOYMENT-SESSION-REVOCATION-48A.
// Same-deployment session authority. Canonical owner is API GET /auth/session
// (JwtStrategy revalidation + refresh binding). Cookie-local values are never
// authority. 401/403 = explicit revocation -> fail closed (jwt returns null,
// Auth.js deletes the session cookie and auth() resolves to null). Network
// throw, timeout, 5xx, and 429 = transient -> preserve the token and retry on
// the next invocation; never mistake transient for a global logout.
// TTL expiry alone is not revocation: a verify-revoked token always attempts
// POST /auth/refresh once to disambiguate access expiry (refresh succeeds)
// from true revocation (refresh explicitly rejects).
const SESSION_ALLOWED_ROLES = ['seller', 'admin'];

function isExplicitSessionRevocationStatus(status: unknown): boolean {
  return status === 401 || status === 403;
}

// 세션의 storeId는 이 응답(현재 사용자 문서 기준)만 반영한다. 클라이언트 update() 값은 쓰지 않는다.
async function verifySessionAuthority(
  accessToken: string,
): Promise<{ kind: 'ok'; storeId: string | null } | { kind: 'revoked' } | { kind: 'transient' }> {
  try {
    const res = await fetch(`${API}/auth/session`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: authUpstreamSignal(),
    });
    if (res.ok) {
      let data: { role?: unknown; storeId?: unknown } | null = null;
      try {
        data = (await res.json()) as { role?: unknown; storeId?: unknown };
      } catch {
        return { kind: 'transient' };
      }
      if (!SESSION_ALLOWED_ROLES.includes(data?.role as string)) {
        return { kind: 'revoked' };
      }
      return { kind: 'ok', storeId: typeof data?.storeId === 'string' ? data.storeId : null };
    }
    if (isExplicitSessionRevocationStatus(res.status)) return { kind: 'revoked' };
    return { kind: 'transient' };
  } catch {
    return { kind: 'transient' };
  }
}

async function refreshAccessToken(token: Record<string, unknown>) {
  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token.refreshToken }),
      signal: authUpstreamSignal(),
    });
    if (!res.ok) {
      if (isExplicitSessionRevocationStatus(res.status)) {
        return null as unknown as Record<string, unknown>;
      }
      return { ...token };
    }
    const data = await res.json();
    return {
      ...token,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessTokenExpires: Date.now() + ACCESS_TOKEN_TTL,
      error: undefined,
    };
  } catch {
    return { ...token };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  providers: [
    Kakao({
      // biome-ignore lint/style/noNonNullAssertion: KAKAO_CLIENT_ID는 서버 env로 배포 시점 보장
      clientId: process.env.KAKAO_CLIENT_ID!,
      // biome-ignore lint/style/noNonNullAssertion: KAKAO_CLIENT_SECRET는 서버 env로 배포 시점 보장
      clientSecret: process.env.KAKAO_CLIENT_SECRET!,
    }),
    // 테스트 전용 Credentials provider는 운영 런타임에 등록하지 않는다(isTestCredentialsProviderEnabled).
    // E2E 헤더 게이팅 — 일치하는 x-e2e-test-token 없으면 즉시 거부.
    // SECRET 미설정 시 모든 credentials 요청 차단(안전 기본값).
    ...(isTestCredentialsProviderEnabled()
      ? [
          Credentials({
            credentials: {
              email: { label: '이메일', type: 'email' },
              password: { label: '비밀번호', type: 'password' },
            },
            async authorize(credentials, request) {
              // E2E 헤더 게이팅 — 일치하는 x-e2e-test-token 없으면 즉시 거부.
              // SECRET 미설정 시 모든 credentials 요청 차단(안전 기본값).
              // 단, local pilot runtime에서는 launcher가 E2E secret을 제거하므로
              // local marker가 있을 때만 헤더 게이트를 생략하고 API 실경로로 검증한다.
              if (!isLocalCredentialRuntime()) {
                const expected = process.env.E2E_TEST_SECRET;
                if (!expected) throw new DiagnosticCredentialsSignin('authorize-rejected');
                const got = request?.headers?.get('x-e2e-test-token');
                if (!(await testSecretsMatch(got, expected))) {
                  throw new DiagnosticCredentialsSignin('authorize-rejected');
                }
              }

              let res: Response;
              try {
                res = await fetch(`${API}/auth/login`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email: credentials.email,
                    password: credentials.password,
                  }),
                  signal: authUpstreamSignal(),
                });
              } catch {
                throw new DiagnosticCredentialsSignin('api-binding-failure');
              }
              if (!res.ok) throw new DiagnosticCredentialsSignin('upstream-rejected');

              let data: {
                accessToken?: unknown;
                refreshToken?: unknown;
                user?: {
                  id?: unknown;
                  email?: unknown;
                  name?: unknown;
                  role?: unknown;
                  storeId?: unknown;
                };
              };
              try {
                data = await res.json();
              } catch {
                throw new DiagnosticCredentialsSignin('api-binding-failure');
              }
              if (
                !data.user ||
                !['seller', 'admin'].includes(String(data.user.role)) ||
                typeof data.user.id !== 'string' ||
                typeof data.accessToken !== 'string' ||
                typeof data.refreshToken !== 'string'
              ) {
                throw new DiagnosticCredentialsSignin('api-binding-failure');
              }
              return {
                id: data.user.id,
                email: typeof data.user.email === 'string' ? data.user.email : undefined,
                name: typeof data.user.name === 'string' ? data.user.name : undefined,
                role: String(data.user.role),
                storeId: typeof data.user.storeId === 'string' ? data.user.storeId : null,
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
              };
            },
          }),
        ]
      : []),
  ],
  events: {
    // 로그아웃하면 쿠키 삭제와 함께 API의 refresh token도 폐기한다. 실패해도 로그아웃은 계속한다.
    async signOut(message) {
      const token = 'token' in message ? message.token : null;
      if (!token) return;
      await revokeApiSession({
        apiBaseUrl: API,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
      });
    },
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== 'kakao') return true;
      if (!account.access_token) return false;

      // API 응답이 없거나 늦으면(시간 제한 초과 포함) 세션을 만들지 않는다.
      let data: {
        accessToken: string;
        refreshToken: string;
        user: { id: string; role: string; storeId?: string | null };
      };
      try {
        const res = await fetch(`${API}/auth/kakao-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kakaoAccessToken: account.access_token,
            targetRole: 'seller',
          }),
          signal: authUpstreamSignal(),
        });
        if (!res.ok) return false;
        data = await res.json();
      } catch {
        return false;
      }
      if (!['seller', 'admin'].includes(data?.user?.role)) return false;

      user.id = data.user.id;
      user.accessToken = data.accessToken;
      user.refreshToken = data.refreshToken;
      user.role = data.user.role;
      user.storeId = data.user.storeId ?? null;
      return true;
    },
    // update() 요청(trigger 'update')의 클라이언트 값은 토큰에 넣지 않는다.
    // storeId는 로그인 응답과 /auth/session 응답만 반영한다.
    jwt: async ({ token, user }) => {
      if (user) {
        return {
          ...token,
          accessToken: user.accessToken,
          refreshToken: user.refreshToken,
          accessTokenExpires: Date.now() + ACCESS_TOKEN_TTL,
          role: user.role,
          storeId: user.storeId,
          error: undefined,
        };
      }
      const accessToken = token.accessToken;
      const refreshToken = token.refreshToken;
      if (
        typeof accessToken !== 'string' ||
        !accessToken ||
        typeof refreshToken !== 'string' ||
        !refreshToken
      ) {
        return token;
      }
      const authority = await verifySessionAuthority(accessToken as string);
      if (authority.kind === 'revoked') {
        return refreshAccessToken(token as unknown as Record<string, unknown>);
      }
      if (authority.kind === 'ok') {
        const bound = { ...token, storeId: authority.storeId };
        if (Date.now() < (token.accessTokenExpires as number)) {
          const { error: _revokedError, ...rest } = bound as unknown as Record<string, unknown>;
          void _revokedError;
          return rest;
        }
        return refreshAccessToken(bound as unknown as Record<string, unknown>);
      }
      if (Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }
      return refreshAccessToken(token as unknown as Record<string, unknown>);
    },
    session({ session, token }) {
      session.user.accessToken = token.accessToken as string;
      session.user.role = token.role as string;
      session.user.storeId = token.storeId as string | null;
      // name이 없거나 placeholder인 경우 email 앞부분 사용
      const rawName = token.name as string | undefined;
      session.user.name =
        rawName && rawName !== '???' ? rawName : (session.user.email?.split('@')[0] ?? '사용자');
      if (token.error) {
        session.user.accessToken = '';
        session.user.tokenError = true;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
