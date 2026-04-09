'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { signInWithCustomToken, signOut as firebaseSignOut } from 'firebase/auth'
import { firebaseAuth } from '@/lib/firebase'

const API = process.env.NEXT_PUBLIC_API_URL!

export function useFirebaseAuth() {
  const { data: session, status } = useSession()

  useEffect(() => {
    if (status === 'authenticated' && session?.user.accessToken) {
      fetch(`${API}/auth/firebase-token`, {
        headers: { Authorization: `Bearer ${session.user.accessToken}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`firebase-token fetch failed: ${res.status}`)
          return res.text()
        })
        .then((token: string) => signInWithCustomToken(firebaseAuth, token))
        .catch((err) => { console.error('[useFirebaseAuth]', err) })
    }

    if (status === 'unauthenticated') {
      firebaseSignOut(firebaseAuth).catch(() => {})
    }
  }, [status, session?.user.accessToken])
}
