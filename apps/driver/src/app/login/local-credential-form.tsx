'use client';

import type { ReactNode } from 'react';
import type { LocalCredentialSignInResult } from './local-credential-sign-in';

/**
 * 로컬 파일럿 이메일 로그인 폼(local runtime 전용). 입력칸은 서버 화면(`page.tsx`)이 children으로 넘긴다.
 *
 * 서버 액션이 돌려준 주소로 전체 페이지 이동한다. 서버 액션 안의 redirect는 클라이언트 화면 이동이라
 * `SessionProvider`가 로그인 화면에서 읽은 비로그인 상태를 그대로 들고 가고, 작업 보드가
 * 인증 필요 화면으로 뜬다. 전체 이동이면 새 세션 쿠키로 처음부터 다시 읽는다.
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
        window.location.assign(redirectTo);
      }}
    >
      {children}
    </form>
  );
}
