'use client';

import { theme } from '@greenhub/ui';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { usePathname } from 'next/navigation';
import { SessionProvider, signOut, useSession } from 'next-auth/react';
import { createContext, useContext, useEffect } from 'react';
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
    <FirebaseReadyContext.Provider value={firebaseReady}>{children}</FirebaseReadyContext.Provider>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const isFixturePath = usePathname().startsWith('/e2e/');
  const content = isFixturePath ? (
    children
  ) : (
    <SessionProvider>
      <TokenErrorGuard>{children}</TokenErrorGuard>
    </SessionProvider>
  );

  return (
    <MantineProvider theme={theme}>
      <ModalsProvider>
        <Notifications position="top-right" autoClose={4000} />
        {content}
      </ModalsProvider>
    </MantineProvider>
  );
}
