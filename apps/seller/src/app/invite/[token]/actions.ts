'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import {
  isInviteTokenFormat,
  SELLER_INVITE_COOKIE,
  SELLER_INVITE_COOKIE_MAX_AGE_SECONDS,
  signInErrorPath,
} from '@/lib/seller-invite';

/**
 * 초대 링크의 "카카오로 가입하기". 토큰을 짧은 수명의 httpOnly 쿠키에 담고 카카오 로그인을 시작한다.
 * 카카오에서 돌아오면 auth.ts signIn 콜백이 쿠키를 읽어 kakao-login 요청에 싣고 지운다.
 * 토큰 판정(존재·만료·취소·사용·받는 사람)은 API가 하고, 여기서는 형식만 다시 거른다.
 */
export async function startInviteSignup(token: string): Promise<void> {
  if (!isInviteTokenFormat(token)) redirect(signInErrorPath('InviteInvalid'));

  const cookieStore = await cookies();
  cookieStore.set(SELLER_INVITE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    // 카카오에서 돌아오는 최상위 이동(GET)에는 실리고, 다른 사이트의 하위 요청에는 실리지 않는다.
    sameSite: 'lax',
    path: '/',
    maxAge: SELLER_INVITE_COOKIE_MAX_AGE_SECONDS,
  });

  // 새 판매자는 가게 정보가 없어 로그인 뒤 사업자 정보 입력(/onboarding)부터 한다.
  await signIn('kakao', { redirectTo: '/onboarding' });
}
