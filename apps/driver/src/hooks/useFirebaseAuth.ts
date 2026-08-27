'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  signInWithCustomToken,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { firebaseAuth } from '@/lib/firebase';
import { getApiBaseUrl } from '@/lib/api-base-url';

export function useFirebaseAuth() {
  const { data: session, status } = useSession();
  const [firebaseReady, setFirebaseReady] = useState(false);

  // Firebase Auth 완료 대기 (Firestore race condition 방지)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      setFirebaseReady(!!user);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && session?.user.accessToken) {
      fetch(`${getApiBaseUrl()}/auth/firebase-token`, {
        headers: { Authorization: `Bearer ${session.user.accessToken}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`firebase-token fetch failed: ${res.status}`);
          return res.text();
        })
        .then((token: string) => signInWithCustomToken(firebaseAuth, token))
        .catch((err) => {
          console.error('[useFirebaseAuth]', err);
        });
    }

    if (status === 'unauthenticated') {
      firebaseSignOut(firebaseAuth).catch(() => {});
    }
  }, [status, session?.user.accessToken]);

  return { firebaseReady };
}
