import { initializeApp, getApps, getApp } from 'firebase/app'
import { initializeFirestore, memoryLocalCache, getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()

// 오프라인 IndexedDB 캐시 비활성화: 빈 캐시가 exists:false를 즉시 반환하고
// 이후 서버 연결이 조용히 실패하는 문제를 방지. 모든 읽기를 서버로 직접 전달.
export const db = getApps().length === 1
  ? initializeFirestore(app, { localCache: memoryLocalCache() })
  : getFirestore(app)

export const firebaseAuth = getAuth(app)
export const storage = getStorage(app)
