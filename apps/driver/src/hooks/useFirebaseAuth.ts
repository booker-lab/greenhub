'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { signInWithCustomToken, signOut as firebaseSignOut } from 'firebase/auth';
import { firebaseAuth } from '@/lib/firebase';
import { getApiBaseUrl } from '@/lib/api-base-url';

// 앱 세션에 맞춰 Firebase Auth에 로그인·로그아웃한다.
// 로그인 완료 여부를 화면에 돌려주지 않는다(쓰는 곳이 없어 onAuthStateChanged 구독은 재렌더만 만들었다).
export function useFirebaseAuth(): void {
  const { data: session, status } = useSession();

  useEffect(() => {
    // 토큰이 바뀌거나 화면을 떠난 뒤 도착한 이전 응답으로는 로그인하지 않는다.
    let cancelled = false;

    if (status === 'authenticated' && session?.user.accessToken) {
      fetch(`${getApiBaseUrl()}/auth/firebase-token`, {
        headers: { Authorization: `Bearer ${session.user.accessToken}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`firebase-token fetch failed: ${res.status}`);
          return res.text();
        })
        .then((token: string) => {
          if (cancelled) return;
          return signInWithCustomToken(firebaseAuth, token);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error('[useFirebaseAuth]', err);
        });
    }

    if (status === 'unauthenticated') {
      firebaseSignOut(firebaseAuth).catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [status, session?.user.accessToken]);
}
