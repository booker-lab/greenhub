import { createHash, timingSafeEqual } from 'node:crypto';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Kakao from 'next-auth/providers/kakao';
import { getApiBaseUrl } from '@/lib/api-base-url';

const API = getApiBaseUrl();
const ACCESS_TOKEN_TTL = 55 * 60 * 1000;
const E2E_ACCESS_TOKEN_TTL = 15 * 60 * 1000;

// PILOT-AUTH-DRIVER-PREUPSTREAM-DIAGNOSTIC-PROJECTION-38D.
// Pre-upstream admission (B/C/D) previously collapsed to bare `return null`
// (`EXPECTED_APPLICATION_REJECTION` with no stage distinction). Project each
// stage into a distinct static Auth.js `code` via the repository's safe
// diagnostic mechanism (DiagnosticCredentialsSignin, cf. 29A
// `upstream-rejected__...` projection). Codes are static literals only —
// no email, secret, header, env, allowlist, hash, length, or timing material.
// Policy is unchanged: conditions, timing-safe compare semantics, allowlist
// membership, password presence, Preview-only gate, and upstream contract
// stay exactly as before; only the rejection projection changes.
//
// PILOT-AUTH-DRIVER-AUTHORIZE-GATE-CLASS-DIAGNOSTIC-38B (extends 38D, preserves it).
// Full authorize gate-class observability: every Preview E2E authorize()
// source branch maps to ONE closed-enum gate. Existing 38D codes (g2/g3/g4)
// are preserved verbatim for backward compat; 38B refines g4 (splits shape
// vs allowlist) and adds g5-g10 for the previously NOT_OBSERVABLE
// upstream/contract branches. All codes stay static literals in the existing
// Auth.js `code` channel (reused mechanism, cf. seller/consumer), closed
// enum only, no values/hashes/lengths/plaintext, no new endpoint, no UI,
// no production logging. Top-level class stays `authorize-rejected` for all
// driver gates so existing `authErrorClass` meaning is preserved; exact gate
// is carried verbatim in the code suffix and projected by the role probe as
// `gateClass` (38B enum) + `preUpstreamDiagnosticCode` (verbatim code).
//
// 38B enum mapping (minimum contract):
//   RUNTIME_DISABLED            <-> authorize-rejected__driver-g2-enabled
//   APP_SECRET_GATE_REJECTED    <-> authorize-rejected__driver-g3-secret-mismatch
//   DRIVER_ALLOWLIST_REJECTED   <-> authorize-rejected__driver-g4-allowlist-rejected
//                                 (narrowed to well-shaped but non-allowlisted email;
//                                  previously lumped password-shape into g4)
//   CREDENTIAL_SHAPE_REJECTED   <-> authorize-rejected__driver-g5-credential-shape-rejected
//   API_BASE_UNRESOLVED         <-> (defined for contract completeness; NOT EMITTED —
//                                 API is module-load `getApiBaseUrl()` const with no
//                                 separate authorize-time branch; adding a branch
//                                 would change runtime behavior, forbidden)
//   UPSTREAM_DISPATCH_FAILED    <-> authorize-rejected__driver-g6-upstream-dispatch-failed
//                                 (fetch threw; no response obtained — distinct from non-ok)
//   UPSTREAM_NON_OK             <-> authorize-rejected__driver-g7-upstream-non-ok
//                                 (response received but res.ok == false)
//   UPSTREAM_RESPONSE_INVALID   <-> authorize-rejected__driver-g8-upstream-response-invalid
//                                 (2xx but JSON parse or user-contract failed)
//   ROLE_REJECTED               <-> authorize-rejected__driver-g9-role-rejected
//   APPROVAL_REJECTED           <-> authorize-rejected__driver-g10-approval-rejected
//   AUTHORIZED                  <-> (no code; success return — observed via
//                                 callback success + session VALID, or
//                                 AUTHORIZED-but-diverged when session INVALID
//                                 without error code)
//
// Semantic preservation (AUTH_DECISION: NONE, OBSERVABILITY: ADDED):
//   - local runtime path untouched (no gate codes).
//   - G2 gate condition unchanged (preview + enabled check).
//   - secret timing-safe equality unchanged.
//   - allowlist membership unchanged (isAllowedE2EDriverEmail verbatim).
//   - credential shape split preserves `reject if either` (both branches
//     still reject; null credentials now map to g5 instead of TypeError,
//     still reject).
//   - API origin selection unchanged (`${API}/auth/login` verbatim).
//   - inner POST body exactly {email,password}, no extra keys/normalization.
//   - res.ok handling unchanged (still reject on !ok, now with g7).
//   - response parsing unchanged (still reject on invalid, now with g8).
//   - role/driverApproved checks unchanged (still reject, now with g9/g10).
//   - returned user/session shape unchanged.
// No reject<->authorize flip is introduced by this patch.
type DriverPreUpstreamRejectionCode =
  | 'authorize-rejected__driver-g2-enabled'
  | 'authorize-rejected__driver-g3-secret-mismatch'
  | 'authorize-rejected__driver-g4-allowlist-rejected'
  | 'authorize-rejected__driver-g5-credential-shape-rejected'
  | 'authorize-rejected__driver-g6-upstream-dispatch-failed'
  | 'authorize-rejected__driver-g7-upstream-non-ok'
  | 'authorize-rejected__driver-g8-upstream-response-invalid'
  | 'authorize-rejected__driver-g9-role-rejected'
  | 'authorize-rejected__driver-g10-approval-rejected';

class DiagnosticCredentialsSignin extends CredentialsSignin {
  constructor(code: DriverPreUpstreamRejectionCode) {
    super();
    this.code = code;
  }
}

function secretsMatch(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const receivedDigest = createHash('sha256').update(received).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

function isAllowedE2EDriverEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const allowed = new Set(
    (process.env.ROUND_DIRECT_E2E_DRIVER_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowed.has(value.trim().toLowerCase());
}

// Local pilot runtime 전용 Credentials 진입.
// launcher가 고정하는 marker + localhost API에서만 허용하며,
// API 실경로 + driver role + 승인 검사를 그대로 적용한다 (fail-closed).
function isLocalCredentialRuntime(): boolean {
  if (process.env.GREENHUB_LOCAL_RUNTIME !== 'true') return false;
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.VERCEL_ENV === 'production') return false;
  if (process.env.RAILWAY_ENVIRONMENT_NAME === 'production') return false;
  return true;
}

async function authorizeLocalDriver(credentials: Record<string, unknown>) {
  if (typeof credentials.email !== 'string' || typeof credentials.password !== 'string') {
    return null;
  }
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
    }),
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (data.user.role !== 'driver') return null;
  if (data.user.driverApproved !== true) return null;
  return {
    id: data.user.id,
    email: data.user.email,
    name: data.user.name,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    role: data.user.role,
  };
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
    Credentials({
      credentials: {
        email: { label: '이메일', type: 'email' },
        password: { label: '비밀번호', type: 'password' },
      },
      async authorize(credentials, request) {
        if (isLocalCredentialRuntime()) {
          return authorizeLocalDriver(credentials as Record<string, unknown>);
        }
        if (
          process.env.VERCEL_ENV !== 'preview' ||
          process.env.ROUND_DIRECT_E2E_ENABLED !== 'true'
        ) {
          throw new DiagnosticCredentialsSignin('authorize-rejected__driver-g2-enabled');
        }
        const expectedSecret = process.env.ROUND_DIRECT_E2E_SHARED_SECRET;
        const receivedSecret = request?.headers?.get('x-round-direct-e2e-secret') ?? null;
        if (!secretsMatch(receivedSecret, expectedSecret))
          throw new DiagnosticCredentialsSignin('authorize-rejected__driver-g3-secret-mismatch');
        // 38B gate split (preserves `reject if either`): shape first, then allowlist.
        // Previously g4 lumped both; now malformed/missing credential shape maps
        // to g5 (CREDENTIAL_SHAPE_REJECTED) and well-shaped but non-allowlisted
        // email maps to g4 (DRIVER_ALLOWLIST_REJECTED). Both still reject.
        const credShape = credentials as Record<string, unknown> | null | undefined;
        if (!credShape || typeof credShape !== 'object') {
          throw new DiagnosticCredentialsSignin(
            'authorize-rejected__driver-g5-credential-shape-rejected',
          );
        }
        if (typeof credShape.password !== 'string') {
          throw new DiagnosticCredentialsSignin(
            'authorize-rejected__driver-g5-credential-shape-rejected',
          );
        }
        if (typeof credShape.email !== 'string') {
          throw new DiagnosticCredentialsSignin(
            'authorize-rejected__driver-g5-credential-shape-rejected',
          );
        }
        if (!isAllowedE2EDriverEmail(credShape.email)) {
          throw new DiagnosticCredentialsSignin('authorize-rejected__driver-g4-allowlist-rejected');
        }

        let res: Response;
        try {
          res = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credShape.email,
              password: credShape.password,
            }),
          });
        } catch {
          // UPSTREAM_DISPATCH_FAILED: fetch threw, no response obtained.
          // Distinct from UPSTREAM_NON_OK (response received, res.ok == false).
          throw new DiagnosticCredentialsSignin(
            'authorize-rejected__driver-g6-upstream-dispatch-failed',
          );
        }
        if (!res.ok) {
          throw new DiagnosticCredentialsSignin('authorize-rejected__driver-g7-upstream-non-ok');
        }

        // biome-ignore lint/suspicious/noExplicitAny: upstream contract is any-shaped;
        // 38B adds no new validation beyond role/approval, preserves original any-shape.
        let data: any;
        try {
          data = await res.json();
        } catch {
          throw new DiagnosticCredentialsSignin(
            'authorize-rejected__driver-g8-upstream-response-invalid',
          );
        }
        const gatedUser = data?.user;
        if (!gatedUser || typeof gatedUser !== 'object') {
          throw new DiagnosticCredentialsSignin(
            'authorize-rejected__driver-g8-upstream-response-invalid',
          );
        }
        const gatedRecord = gatedUser as Record<string, unknown>;
        if (gatedRecord.role !== 'driver') {
          throw new DiagnosticCredentialsSignin('authorize-rejected__driver-g9-role-rejected');
        }
        if (gatedRecord.driverApproved !== true) {
          throw new DiagnosticCredentialsSignin(
            'authorize-rejected__driver-g10-approval-rejected',
          );
        }
        return {
          id: data.user?.id,
          email: data.user?.email,
          name: data.user?.name,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          role: gatedRecord.role,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'credentials') return true;
      if (account?.provider !== 'kakao') return false;
      if (!account.access_token) return false;

      const res = await fetch(`${API}/auth/kakao-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kakaoAccessToken: account.access_token,
          targetRole: 'driver',
        }),
      });
      if (!res.ok) return false;

      const data = await res.json();
      if (!['driver', 'admin'].includes(data.user.role)) return false;

      // admin은 승인 절차 없이 바로 통과
      if (data.user.role === 'driver' && !data.user.driverApproved) {
        return '/login?pending=true';
      }

      user.id = data.user.id;
      user.accessToken = data.accessToken;
      user.refreshToken = data.refreshToken;
      user.role = data.user.role;
      return true;
    },
    jwt({ token, user, account }) {
      if (user) {
        return {
          ...token,
          accessToken: user.accessToken,
          refreshToken: user.refreshToken,
          accessTokenExpires:
            Date.now() +
            (account?.provider === 'credentials' ? E2E_ACCESS_TOKEN_TTL : ACCESS_TOKEN_TTL),
          role: user.role,
          sub: user.id,
        };
      }
      if (Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }
      return refreshAccessToken(token);
    },
    session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.accessToken = token.accessToken as string;
      session.user.role = token.role as string;
      // name이 없거나 placeholder인 경우 email 앞부분 사용
      const rawName = token.name as string | undefined;
      session.user.name =
        rawName && rawName !== '???' ? rawName : (session.user.email?.split('@')[0] ?? '드라이버');
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
