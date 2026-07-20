import { createHash, timingSafeEqual } from 'node:crypto';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Kakao from 'next-auth/providers/kakao';

const API = process.env.NEXT_PUBLIC_API_URL!;
const ACCESS_TOKEN_TTL = 55 * 60 * 1000;
const E2E_ACCESS_TOKEN_TTL = 15 * 60 * 1000;

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
        if (
          process.env.VERCEL_ENV !== 'preview' ||
          process.env.ROUND_DIRECT_E2E_ENABLED !== 'true'
        ) {
          return null;
        }
        const expectedSecret = process.env.ROUND_DIRECT_E2E_SHARED_SECRET;
        const receivedSecret = request?.headers?.get('x-round-direct-e2e-secret') ?? null;
        if (!secretsMatch(receivedSecret, expectedSecret)) return null;
        if (
          !isAllowedE2EDriverEmail(credentials.email) ||
          typeof credentials.password !== 'string'
        ) {
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
