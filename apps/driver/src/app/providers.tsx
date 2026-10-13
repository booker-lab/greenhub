'use client';

import { useEffect, useRef } from 'react';
import { getSession, SessionProvider, useSession, signOut } from 'next-auth/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { theme } from '@greenhub/ui';
import { useFirebaseAuth } from '@/hooks/useFirebaseAuth';
import { startSessionKeepAlive } from '@/lib/session-refresh';

function TokenErrorGuard({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  useFirebaseAuth();
  useEffect(() => {
    if (session?.user?.tokenError) {
      signOut({ callbackUrl: '/login' });
    }
  }, [session?.user?.tokenError]);
  return <>{children}</>;
}

// 앱을 켜 둔 동안 2분마다 세션을 다시 확인해 jwt callback이 API 토큰을 만료 전에 갱신하게 한다.
// SessionProvider의 refetchInterval은 확인이 한 번만 실패해도(약한 전파) 세션을 비로그인으로 바꾸고
// 그 뒤 다시 확인하지 않아 쓰지 않는다. 실패는 무시하고, 새 토큰을 받았을 때만 화면 세션을
// update()로 바꾼다(update는 실패하면 기존 세션을 그대로 둔다).
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
      <Notifications />
      <SessionProvider>
        <SessionKeepAlive />
        <TokenErrorGuard>{children}</TokenErrorGuard>
      </SessionProvider>
    </MantineProvider>
  );
}
