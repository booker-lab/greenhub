'use client';

import { useEffect, useRef } from 'react';

/**
 * 화면 세션의 access token을 조회 effect의 의존성에서 떼어 낸다.
 *
 * keepalive(55분 갱신)나 API 거절 뒤 재검증으로 토큰 문자열만 바뀌어도 조회 effect가 다시 돌면,
 * 응답으로 폼을 채우는 화면은 판매자가 입력 중인 값을 서버 값으로 덮는다. 조회 effect는 `hasToken`에
 * 묶고, 요청할 때 `tokenRef.current`를 읽는다. 이 hook은 조회 effect보다 먼저 호출해야 같은 commit에서
 * 최신 토큰을 읽는다(effect는 선언 순서대로 실행된다).
 */
export function useTokenRef(token: string | null | undefined) {
  const tokenRef = useRef(token ?? '');
  useEffect(() => {
    tokenRef.current = token ?? '';
  }, [token]);
  return { tokenRef, hasToken: Boolean(token) };
}
