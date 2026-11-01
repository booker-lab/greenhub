'use client';

import { recheckSessionAfterRejection, watchApiAuthorityRejections } from '@greenhub/shared';
import { getSession, SessionProvider, signOut, useSession } from 'next-auth/react';
import { createContext, useContext, useEffect, useRef } from 'react';
import { AppToaster } from '@/components/AppToaster';
import { useFirebaseAuth } from '@/hooks/useFirebaseAuth';
import { getApiBaseUrl } from '@/lib/api-base-url';
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
// 숨은 탭에서는 주기 확인을 건너뛰고, 다시 보이게 되면 즉시 1회 확인한다.
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
      isHidden: () => document.visibilityState === 'hidden',
      subscribeVisibilityChange: (onChange) => {
        document.addEventListener('visibilitychange', onChange);
        return () => document.removeEventListener('visibilitychange', onChange);
      },
    });
  }, [status]);

  return null;
}

// 화면의 API 요청이 거절(401/403)되면 세션을 update({})(POST, jwt 콜백 trigger 'update')로 다시 받아
// 60초 검증 재사용 없이 바로 API로 검증한다. 폐기된 세션이면 jwt 콜백이 null을 돌려 세션 쿠키가 지워진다.
// 인자 없는 update()는 GET이라 재사용 구간에 걸리므로 빈 객체를 넘긴다(jwt 콜백은 그 값을 토큰에 넣지 않는다).
// update()는 null이면 화면 세션을 바꾸지 않으므로, 세션 조회로 정말 끝났는지 확인해 로그아웃시킨다.
function SessionAuthorityRecheck() {
  const { update } = useSession();
  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(
    () =>
      watchApiAuthorityRejections({
        target: window,
        apiOrigin: new URL(getApiBaseUrl()).origin,
        onRejected: () => {
          void recheckSessionAfterRejection({
            update: () => updateRef.current({}),
            fetchImpl: (input, init) => window.fetch(input, init),
            signOut: () => signOut({ callbackUrl: '/login' }),
          });
        },
      }),
    [],
  );
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AppToaster>
      <SessionProvider>
        <SessionKeepAlive />
        <SessionAuthorityRecheck />
        <TokenErrorGuard>{children}</TokenErrorGuard>
      </SessionProvider>
    </AppToaster>
  );
}
