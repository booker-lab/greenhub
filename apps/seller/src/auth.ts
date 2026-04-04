import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
// 카카오 OAuth — KAKAO_CLIENT_ID 발급 후 주석 해제
// import Kakao from "next-auth/providers/kakao";

const API = process.env.NEXT_PUBLIC_API_URL!;
const ACCESS_TOKEN_TTL = 55 * 60 * 1000;

async function refreshAccessToken(token: Record<string, unknown>) {
  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: token.refreshToken }),
    });
    if (!res.ok) throw new Error("refresh failed");
    const data = await res.json();
    return {
      ...token,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessTokenExpires: Date.now() + ACCESS_TOKEN_TTL,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshTokenError" };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "이메일", type: "email" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials) {
        const res = await fetch(`${API}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!["seller", "admin"].includes(data.user.role)) return null;
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
      if (trigger === "update" && session?.storeId) {
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
      session.user.name = rawName && rawName !== '???' ? rawName : (session.user.email?.split('@')[0] ?? '사용자');
      if (token.error) session.user.accessToken = "";
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
