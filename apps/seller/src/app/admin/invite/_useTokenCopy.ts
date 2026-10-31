'use client';

import { notify } from '@/components/AppToaster';
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from './_clipboard';
import { buildInviteLink } from './_lib';

const COPIED_FEEDBACK_MS = 2000;

/**
 * 초대 링크 복사 상태 — 발급 직후 초대와 발급 내역 행별 복사가 공유한다.
 * 복사 값은 토큰이 아니라 지금 판매자 앱 주소 기준의 초대 링크(/invite/[token])다.
 * - 성공: `copiedToken`에 해당 토큰을 2초간 기록(버튼 라벨 '복사됨!' 토큰별 식별).
 * - 실패: 빨간 알림 + `manualLink`에 링크를 기록해 직접 선택·복사 창을 연다.
 */
export function useTokenCopy() {
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async (token: string) => {
    const link = buildInviteLink(token, window.location.origin);
    const result = await copyText(link);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (result === 'failed') {
      setCopiedToken(null);
      notify({
        color: 'red',
        title: '초대 링크를 복사하지 못했습니다',
        message:
          '브라우저가 클립보드 접근을 막았습니다. 열린 창에서 초대 링크를 직접 선택해 복사해 주세요.',
      });
      setManualLink(link);
      return;
    }
    setCopiedToken(token);
    timerRef.current = setTimeout(() => setCopiedToken(null), COPIED_FEEDBACK_MS);
  }, []);

  const closeManual = useCallback(() => setManualLink(null), []);

  return { copiedToken, manualLink, copy, closeManual };
}
