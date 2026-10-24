'use client';

import { useEffect, useRef } from 'react';
import { SessionProvider, useSession, signOut } from 'next-auth/react';
import { MantineProvider } from '@mantine/core';
import { theme } from '@greenhub/ui';
import { watchApiAuthorityRejections } from '@greenhub/shared';
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
          void updateRef.current({});
        },
      }),
    [],
  );
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme}>
      <SessionProvider>
        <SessionAuthorityRecheck />
        <TokenErrorGuard>{children}</TokenErrorGuard>
      </SessionProvider>
    </MantineProvider>
  );
}
