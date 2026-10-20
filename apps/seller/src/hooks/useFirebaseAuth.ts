'use client';

import {
  signOut as firebaseSignOut,
  onAuthStateChanged,
  signInWithCustomToken,
} from 'firebase/auth';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { getFirebaseAuth } from '@/lib/firebase';
import { getApiBaseUrl } from '@/lib/api-base-url';

/**
 * 백엔드 Custom Token으로 Firebase에 로그인한다. 도중에 취소되면(로그아웃·토큰 교체로 effect 정리)
 * 결과를 반영하지 않는다. 로그인 요청이 이미 나간 뒤 취소됐다면 끝난 뒤 onLateSignIn으로 되돌릴
 * 기회를 준다.
 */
export async function syncFirebaseSignIn(deps: {
  fetchCustomToken: () => Promise<string>;
  signIn: (customToken: string) => Promise<unknown>;
  isCancelled: () => boolean;
  onLateSignIn?: () => Promise<unknown> | undefined;
}): Promise<'signed-in' | 'cancelled'> {
  const customToken = await deps.fetchCustomToken();
  if (deps.isCancelled()) return 'cancelled';
  await deps.signIn(customToken);
  if (deps.isCancelled()) {
    await deps.onLateSignIn?.();
    return 'cancelled';
  }
  return 'signed-in';
}

/**
 * NextAuth 세션과 Firebase Auth를 동기화.
 * 로그인 시 백엔드에서 Custom Token을 받아 Firebase에 sign-in,
 * 로그아웃 시 Firebase도 sign-out.
 * seller 앱 루트 레이아웃에서 한 번만 마운트.
 */
export function useFirebaseAuth() {
  const { data: session, status } = useSession();
  const [firebaseReady, setFirebaseReady] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      setFirebaseReady(!!user);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && session?.user.accessToken) {
      const accessToken = session.user.accessToken;
      const controller = new AbortController();
      let cancelled = false;
      syncFirebaseSignIn({
        fetchCustomToken: async () => {
          const res = await fetch(`${getApiBaseUrl()}/auth/firebase-token`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`firebase-token fetch failed: ${res.status}`);
          return res.text();
        },
        signIn: (token) => signInWithCustomToken(getFirebaseAuth(), token),
        isCancelled: () => cancelled,
        // 로그인 도중 로그아웃됐으면 늦게 끝난 로그인을 되돌린다. 토큰 교체는 새 effect가 다시
        // 로그인하므로 그대로 둔다.
        onLateSignIn: () =>
          statusRef.current === 'unauthenticated' ? firebaseSignOut(getFirebaseAuth()) : undefined,
      }).catch((err) => {
        if (!cancelled) console.error('[useFirebaseAuth]', err);
      });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    if (status === 'unauthenticated') {
      firebaseSignOut(getFirebaseAuth()).catch(() => {});
    }
  }, [status, session?.user.accessToken]);

  return { firebaseReady };
}
