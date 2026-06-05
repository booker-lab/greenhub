import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      accessToken: string;
      role: string;
      storeId: string | null;
      hubId: string | null;
      hubIds: string[];
      tokenError?: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    accessToken: string;
    refreshToken: string;
    role: string;
    storeId: string | null;
    hubId: string | null;
    hubIds: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken: string;
    refreshToken: string;
    accessTokenExpires: number;
    role: string;
    storeId: string | null;
    hubId: string | null;
    hubIds: string[];
    error?: string;
  }
}
