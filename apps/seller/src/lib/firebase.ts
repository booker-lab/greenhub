import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache, getFirestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// 오프라인 IndexedDB 캐시 비활성화: 빈 캐시가 exists:false를 즉시 반환하고
// 이후 서버 연결이 조용히 실패하는 문제를 방지. 모든 읽기를 서버로 직접 전달.
export const db =
  getApps().length === 1
    ? initializeFirestore(app, { localCache: memoryLocalCache() })
    : getFirestore(app);

// getAuth()는 apiKey 부재 시 auth/invalid-api-key를 동기적으로 throw한다.
// 모듈 로드(= 빌드 prerender) 시점에 평가하면 env 미주입 빌드가 깨지므로
// (`/admin/banner` prerender 실패), 첫 사용(클라이언트 런타임) 시점에 지연
// 초기화한다. getAuth/getStorage는 내부적으로 멱등하므로 반복 호출은 무해하다.
let authInstance: Auth | undefined;
export function getFirebaseAuth(): Auth {
  authInstance ??= getAuth(app);
  return authInstance;
}

let storageInstance: FirebaseStorage | undefined;
export function getFirebaseStorage(): FirebaseStorage {
  storageInstance ??= getStorage(app);
  return storageInstance;
}
