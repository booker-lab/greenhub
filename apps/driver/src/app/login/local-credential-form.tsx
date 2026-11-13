'use client';

import type { ReactNode } from 'react';
import type { LocalCredentialSignInResult } from './local-credential-sign-in';

/**
 * 로컬 파일럿 이메일 로그인 폼(local runtime 전용). 입력칸은 서버 화면(`page.tsx`)이 children으로 넘긴다.
 *
 * 서버 액션이 돌려준 주소로 전체 페이지 이동한다. 서버 액션 안의 redirect는 클라이언트 화면 이동이라
 * `SessionProvider`가 로그인 화면에서 읽은 비로그인 상태를 그대로 들고 가고, 작업 보드가
 * 인증 필요 화면으로 뜬다. 전체 이동이면 새 세션 쿠키로 처음부터 다시 읽는다.
 * 이동은 replace로 한다. 로그인 화면 기록이 남으면 돌아온 화면에서 뒤로가기가 /login으로 가고, 로그인한 기사라
 * proxy가 같은 화면으로 다시 보내 제자리를 맴돈다(실패 때 다시 여는 로그인 화면도 기록을 쌓지 않는다).
 */
export function LocalCredentialForm({
  signInAction,
  children,
}: {
  signInAction: (formData: FormData) => Promise<LocalCredentialSignInResult>;
  children: ReactNode;
}) {
  return (
    <form
      action={async (formData) => {
        const { redirectTo } = await signInAction(formData);
        window.location.replace(redirectTo);
      }}
    >
      {children}
    </form>
  );
}
