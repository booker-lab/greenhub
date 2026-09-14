import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Kakao from 'next-auth/providers/kakao';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { isAdmittedLoginCredentials } from '@/auth-credentials';

const API = getApiBaseUrl();
// accessToken 만료 55분 후 갱신 (Railway 기본값 1h 기준)
const ACCESS_TOKEN_TTL = 55 * 60 * 1000;

type CredentialsFailureCode =
  | 'authorize-rejected'
  | 'authorize-rejected__g1-secret-missing'
  | 'authorize-rejected__g2-secret-mismatch'
  | 'authorize-rejected__g3-credential-admission-rejected'
  | 'upstream-rejected'
  | 'api-binding-failure';

class DiagnosticCredentialsSignin extends CredentialsSignin {
  constructor(code: CredentialsFailureCode | string) {
    super();
    this.code = code;
  }
}

// PILOT-AUTH-CALLBACK-UPSTREAM-DIAGNOSTIC-PROJECTION-29A.
// Non-sensitive diagnostic projection for upstream non-2xx: the actual
// upstream HTTP status plus a stable fingerprint of the upstream origin are
// embedded in the Auth.js `code` channel as
// `upstream-rejected__s<status>__o<fp16>` (status 100-599, fp = first 16 hex
// chars of SHA-256 over the canonical origin). Top-level classification stays
// `upstream-rejected` (prefix). Credentials, tokens, and response bodies
// never enter the code.
export const UPSTREAM_DIAGNOSTIC_CODE_PREFIX = 'upstream-rejected';
export const UPSTREAM_ORIGIN_FINGERPRINT_HEX_LENGTH = 16;

export function canonicalUpstreamOrigin(value: string): string | null {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    // WHATWG `origin`: protocol + '//' + hostname + optional non-default
    // port. Path, query, fragment, and userinfo are structurally excluded.
    return url.origin;
  } catch {
    return null;
  }
}

export async function fingerprintUpstreamOrigin(
  canonicalOrigin: string,
): Promise<string | null> {
  try {
    if (typeof canonicalOrigin !== 'string' || !canonicalOrigin) return null;
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalOrigin),
    );
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return hex.slice(0, UPSTREAM_ORIGIN_FINGERPRINT_HEX_LENGTH);
  } catch {
    return null;
  }
}

export function buildUpstreamRejectedCode(
  status: number,
  originFingerprint: string | null,
): string {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return UPSTREAM_DIAGNOSTIC_CODE_PREFIX;
  }
  if (
    typeof originFingerprint !== 'string' ||
    originFingerprint.length !== UPSTREAM_ORIGIN_FINGERPRINT_HEX_LENGTH ||
    !/^[0-9a-f]+$/.test(originFingerprint)
  ) {
    return UPSTREAM_DIAGNOSTIC_CODE_PREFIX;
  }
  return `${UPSTREAM_DIAGNOSTIC_CODE_PREFIX}__s${status}__o${originFingerprint}`;
}

async function refreshAccessToken(token: Record<string, unknown>) {
  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token.refreshToken }),
    });
    if (!res.ok) throw new Error('refresh failed');
    const data = await res.json();
    return {
      ...token,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessTokenExpires: Date.now() + ACCESS_TOKEN_TTL,
      error: undefined,
    };
  } catch {
    return { ...token, error: 'RefreshTokenError' };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  providers: [
    Kakao({
      clientId: process.env.KAKAO_CLIENT_ID!,
      clientSecret: process.env.KAKAO_CLIENT_SECRET!,
    }),
    // E2E 헤더 게이팅 — 일치하는 x-e2e-test-token 없으면 즉시 거부.
    // SECRET 미설정 시 모든 credentials 요청 차단(안전 기본값).
    // PILOT-AUTH-CONSUMER-PREUPSTREAM-DIAGNOSTIC-PROJECTION-38C: the three
    // pre-upstream gates emit deterministic static codes only (no values,
    // lengths, hashes, timing, headers, or env contents). Top-level class
    // stays `authorize-rejected` (prefix). Ordering is fixed:
    //   S1 g1-secret-missing (runtime E2E secret missing),
    //   S2 g2-secret-mismatch (x-e2e-test-token != runtime secret),
    //   S3 g3-credential-admission-rejected (LoginDto admission rejected).
    // S1/S2/S3 are all fail-closed with zero upstream calls.
    Credentials({
      credentials: {
        email: { label: '이메일', type: 'email' },
        password: { label: '비밀번호', type: 'password' },
      },
      async authorize(credentials, request) {
        const expected = process.env.E2E_TEST_SECRET;
        if (!expected)
          throw new DiagnosticCredentialsSignin('authorize-rejected__g1-secret-missing');
        const got = request?.headers?.get('x-e2e-test-token');
        if (got !== expected)
          throw new DiagnosticCredentialsSignin('authorize-rejected__g2-secret-mismatch');

        // PILOT-AUTH-CALLBACK-EMAIL-ADMISSION-CONVERGENCE-34A: fail closed
        // before any upstream call when the credentials would be rejected by
        // API LoginDto (email @IsEmail). No value is logged or embedded in
        // the rejection; the admitted pair is forwarded verbatim with the
        // exact {email,password} shape (no extra keys, no normalization).
        if (!isAdmittedLoginCredentials(credentials)) {
          throw new DiagnosticCredentialsSignin(
            'authorize-rejected__g3-credential-admission-rejected',
          );
        }
        const email = credentials.email;
        const password = credentials.password;

        let res: Response;
        try {
          res = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              password,
            }),
          });
        } catch {
          throw new DiagnosticCredentialsSignin('api-binding-failure');
        }
        if (!res.ok) {
          // Diagnostic projection (29A): preserve the actual upstream status
          // plus a fingerprint of the upstream origin. The actual response
          // target (`res.url`, redirect-aware) is preferred; the configured
          // request origin is the fallback when the response URL is
          // absent/unparseable. Only the canonical origin (no path, query,
          // or credentials) is fingerprinted — never bodies or secrets.
          const status = res.status;
          const fingerprint = await fingerprintUpstreamOrigin(
            canonicalUpstreamOrigin(res.url) ?? canonicalUpstreamOrigin(API) ?? '',
          );
          throw new DiagnosticCredentialsSignin(
            buildUpstreamRejectedCode(status, fingerprint),
          );
        }

        let data: {
          accessToken?: unknown;
          refreshToken?: unknown;
          user?: { id?: unknown; email?: unknown; name?: unknown; role?: unknown };
        };
        try {
          data = await res.json();
        } catch {
          throw new DiagnosticCredentialsSignin('api-binding-failure');
        }
        if (
          !data.user ||
          !['consumer', 'admin'].includes(String(data.user.role)) ||
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
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== 'kakao') return true;
      if (!account.access_token) return false;

      const res = await fetch(`${API}/auth/kakao-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kakaoAccessToken: account.access_token,
          targetRole: 'consumer',
        }),
      });
      if (!res.ok) return false;

      const data = await res.json();
      if (!['consumer', 'admin'].includes(data.user.role)) return false;

      user.id = data.user.id;
      user.email = data.user.email ?? user.email;
      user.accessToken = data.accessToken;
      user.refreshToken = data.refreshToken;
      user.role = data.user.role;
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        return {
          ...token,
          id: user.id,
          role: user.role,
          accessToken: user.accessToken,
          refreshToken: user.refreshToken,
          accessTokenExpires: Date.now() + ACCESS_TOKEN_TTL,
        };
      }
      if (Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }
      return refreshAccessToken(token);
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.email = (token.email as string) ?? session.user.email;
      session.user.accessToken = token.accessToken as string;
      session.user.role = token.role as string;
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
