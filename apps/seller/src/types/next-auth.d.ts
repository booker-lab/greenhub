import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      accessToken: string;
      role: string;
      storeId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    accessToken: string;
    role: string;
    storeId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken: string;
    role: string;
    storeId: string | null;
  }
}
