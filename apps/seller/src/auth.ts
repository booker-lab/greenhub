import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Kakao from 'next-auth/providers/kakao';

// biome-ignore lint/style/noNonNullAssertion: NEXT_PUBLIC_API_URL은 Next 빌드 시점에 인라인 보장
const API = process.env.NEXT_PUBLIC_API_URL!;
const ACCESS_TOKEN_TTL = 55 * 60 * 1000;

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
      // biome-ignore lint/style/noNonNullAssertion: KAKAO_CLIENT_ID는 서버 env로 배포 시점 보장
      clientId: process.env.KAKAO_CLIENT_ID!,
      // biome-ignore lint/style/noNonNullAssertion: KAKAO_CLIENT_SECRET는 서버 env로 배포 시점 보장
      clientSecret: process.env.KAKAO_CLIENT_SECRET!,
    }),
    // E2E 헤더 게이팅 — 일치하는 x-e2e-test-token 없으면 즉시 거부.
    // SECRET 미설정 시 모든 credentials 요청 차단(안전 기본값).
    Credentials({
      credentials: {
        email: { label: '이메일', type: 'email' },
        password: { label: '비밀번호', type: 'password' },
      },
      async authorize(credentials, request) {
        const expected = process.env.E2E_TEST_SECRET;
        if (!expected) return null;
        const got = request?.headers?.get('x-e2e-test-token');
        if (got !== expected) return null;
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
        if (!['seller', 'admin'].includes(data.user.role)) return null;
        return {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          storeId: data.user.storeId ?? null,
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
          targetRole: 'seller',
        }),
      });
      if (!res.ok) return false;

      const data = await res.json();
      if (!['seller', 'admin'].includes(data.user.role)) return false;

      user.id = data.user.id;
      user.accessToken = data.accessToken;
      user.refreshToken = data.refreshToken;
      user.role = data.user.role;
      user.storeId = data.user.storeId ?? null;
      return true;
    },
    jwt({ token, user, trigger, session }) {
      if (user) {
        return {
          ...token,
          accessToken: user.accessToken,
          refreshToken: user.refreshToken,
          accessTokenExpires: Date.now() + ACCESS_TOKEN_TTL,
          role: user.role,
          storeId: user.storeId,
        };
      }
      if (trigger === 'update' && session?.storeId) {
        token.storeId = session.storeId;
      }
      if (Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }
      return refreshAccessToken(token);
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
