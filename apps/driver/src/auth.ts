import NextAuth from "next-auth";
import Kakao from "next-auth/providers/kakao";

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
    Kakao({
      clientId: process.env.KAKAO_CLIENT_ID!,
      clientSecret: process.env.KAKAO_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "kakao") return false;

      const res = await fetch(`${API}/auth/kakao-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kakaoId: profile?.sub ?? account.providerAccountId,
          name: profile?.name ?? user.name,
          email: profile?.email ?? user.email,
        }),
      });
      if (!res.ok) return false;

      const data = await res.json();
      if (!["seller", "driver"].includes(data.user.role)) return false;

      if (data.user.role === "driver" && !data.user.driverApproved) {
        return "/login?pending=true";
      }

      user.id = data.user.id;
      user.accessToken = data.accessToken;
      user.refreshToken = data.refreshToken;
      user.role = data.user.role;
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        return {
          ...token,
          accessToken: user.accessToken,
          refreshToken: user.refreshToken,
          accessTokenExpires: Date.now() + ACCESS_TOKEN_TTL,
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
      if (token.error) session.user.accessToken = "";
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
