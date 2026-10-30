'use client';

import type { Session } from 'next-auth';
import { useEffect, useRef } from 'react';
import { SessionProvider, useSession, signOut } from 'next-auth/react';
import { MantineProvider } from '@mantine/core';
import { theme } from '@greenhub/ui';
import { recheckSessionAfterRejection, watchApiAuthorityRejections } from '@greenhub/shared';
import { getApiBaseUrl } from '@/lib/api-base-url';

function TokenErrorGuard({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  useEffect(() => {
    if (session?.user?.tokenError) {
      signOut({ callbackUrl: '/login' });
    }
  }, [session?.user?.tokenError]);
  return <>{children}</>;
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

// session은 루트 layout이 넘긴 proxy 확인 세션이다. 있으면 첫 화면에서 /api/auth/session을 다시
// 조회하지 않는다. 없으면(undefined) 예전처럼 SessionProvider가 직접 조회한다.
export default function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session;
}) {
  return (
    <MantineProvider theme={theme}>
      <SessionProvider session={session}>
        <SessionAuthorityRecheck />
        <TokenErrorGuard>{children}</TokenErrorGuard>
      </SessionProvider>
    </MantineProvider>
  );
}
