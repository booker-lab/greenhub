import { signOut as firebaseSignOut } from 'firebase/auth';
import { signOut } from 'next-auth/react';
import { getFirebaseAuth } from '@/lib/firebase';

/**
 * 로그아웃: 이 탭의 Firebase 로그인 상태를 먼저 지운 뒤 NextAuth 세션을 끝낸다.
 * API refresh token 폐기는 NextAuth signOut 이벤트(auth.ts)가 맡는다.
 * 판매자 설정 화면과 관리자 콘솔 헤더가 같이 쓴다.
 */
export async function logout() {
  try {
    await firebaseSignOut(getFirebaseAuth());
  } catch {
    // Firebase 정리에 실패해도 로그아웃은 계속한다. 다음 화면의 useFirebaseAuth가 다시 정리한다.
  }
  await signOut({ callbackUrl: '/login' });
}
