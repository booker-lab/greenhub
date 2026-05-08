'use client';

import { createContext, useContext, useEffect } from 'react';
import { SessionProvider, useSession, signOut } from 'next-auth/react';
import { MantineProvider } from '@mantine/core';
import { theme } from '@greenhub/ui';
import { useFirebaseAuth } from '@/hooks/useFirebaseAuth';

const FirebaseReadyContext = createContext(false);
export function useFirebaseReady() {
  return useContext(FirebaseReadyContext);
}

function TokenErrorGuard({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const { firebaseReady } = useFirebaseAuth();
  useEffect(() => {
    if (session?.user?.tokenError) {
      signOut({ callbackUrl: '/login' });
    }
  }, [session?.user?.tokenError]);
  return (
    <FirebaseReadyContext.Provider value={firebaseReady}>
      {children}
    </FirebaseReadyContext.Provider>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme}>
      <SessionProvider>
        <TokenErrorGuard>{children}</TokenErrorGuard>
      </SessionProvider>
    </MantineProvider>
  );
}
