'use client';

import { theme } from '@greenhub/ui';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { getSession, SessionProvider, signOut, useSession } from 'next-auth/react';
import { createContext, useContext, useEffect, useRef } from 'react';
import { useFirebaseAuth } from '@/hooks/useFirebaseAuth';
import { startSessionKeepAlive } from '@/lib/session-keepalive';

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

// 주문·준비 화면을 켜 둔 동안 2분마다 세션을 다시 확인해 jwt callback이 API 토큰을 만료 전에
// 갱신하게 한다. SessionProvider의 refetchInterval은 확인이 한 번만 실패해도(약한 전파) 세션을
// 비로그인으로 바꾸므로 쓰지 않는다. 실패는 무시하고, 새 토큰을 받았을 때만 update()로 바꾼다.
function SessionKeepAlive() {
  const { data: session, status, update } = useSession();
  const accessTokenRef = useRef(session?.user?.accessToken);
  accessTokenRef.current = session?.user?.accessToken;
  const updateRef = useRef(update);
  updateRef.current = update;

  useEffect(() => {
    if (status !== 'authenticated') return;
    return startSessionKeepAlive({
      probeAccessToken: async () => (await getSession({ broadcast: false }))?.user?.accessToken,
      currentAccessToken: () => accessTokenRef.current,
      syncSession: () => {
        void updateRef.current();
      },
    });
  }, [status]);

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme}>
      <Notifications position="top-right" autoClose={4000} />
      <SessionProvider>
        <SessionKeepAlive />
        <TokenErrorGuard>{children}</TokenErrorGuard>
      </SessionProvider>
    </MantineProvider>
  );
}
