import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      accessToken: string;
      role: string;
      tokenError?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    accessToken: string;
    refreshToken: string;
    role: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken: string;
    refreshToken: string;
    accessTokenExpires: number;
    role: string;
    error?: string;
  }
}
