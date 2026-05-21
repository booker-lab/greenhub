'use client';

import {
  signOut as firebaseSignOut,
  onAuthStateChanged,
  signInWithCustomToken,
} from 'firebase/auth';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { getFirebaseAuth } from '@/lib/firebase';

// biome-ignore lint/style/noNonNullAssertion: NEXT_PUBLIC_API_URL은 Next 빌드 시점에 인라인 보장
const API = process.env.NEXT_PUBLIC_API_URL!;

/**
 * NextAuth 세션과 Firebase Auth를 동기화.
 * 로그인 시 백엔드에서 Custom Token을 받아 Firebase에 sign-in,
 * 로그아웃 시 Firebase도 sign-out.
 * seller 앱 루트 레이아웃에서 한 번만 마운트.
 */
export function useFirebaseAuth() {
  const { data: session, status } = useSession();
  const [firebaseReady, setFirebaseReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      setFirebaseReady(!!user);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && session?.user.accessToken) {
      fetch(`${API}/auth/firebase-token`, {
        headers: { Authorization: `Bearer ${session.user.accessToken}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`firebase-token fetch failed: ${res.status}`);
          return res.text();
        })
        .then((token: string) => signInWithCustomToken(getFirebaseAuth(), token))
        .catch((err) => {
          console.error('[useFirebaseAuth]', err);
        });
    }

    if (status === 'unauthenticated') {
      firebaseSignOut(getFirebaseAuth()).catch(() => {});
    }
  }, [status, session?.user.accessToken]);

  return { firebaseReady };
}
