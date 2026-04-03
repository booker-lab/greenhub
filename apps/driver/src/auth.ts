import NextAuth from "next-auth";
import Kakao from "next-auth/providers/kakao";

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

      // 카카오 ID로 API에서 사용자 조회 or 자동 등록
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/kakao-login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kakaoId: profile?.sub ?? account.providerAccountId,
            name: profile?.name ?? user.name,
            email: profile?.email ?? user.email,
          }),
        }
      );
      if (!res.ok) return false;

      const data = await res.json();

      // seller 또는 driver role만 허용
      if (!["seller", "driver"].includes(data.user.role)) return false;

      // 드라이버 사전 승인 체크 — 미승인이면 대기 안내 페이지로
      if (data.user.role === "driver" && !data.user.driverApproved) {
        return "/login?pending=true";
      }

      user.id = data.user.id;
      user.accessToken = data.accessToken;
      user.role = data.user.role;
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.accessToken = user.accessToken;
        token.role = user.role;
        token.sub = user.id;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.accessToken = token.accessToken as string;
      session.user.role = token.role as string;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
