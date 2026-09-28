'use client';

import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from './_clipboard';

const COPIED_FEEDBACK_MS = 2000;

/**
 * 초대 토큰 복사 상태 — 발급 직후 토큰과 발급 내역 행별 복사가 공유한다.
 * - 성공: `copiedToken`에 해당 토큰을 2초간 기록(버튼 라벨 '복사됨!' 토큰별 식별).
 * - 실패: 빨간 알림 + `manualToken`에 토큰을 기록해 직접 선택·복사 창을 연다.
 */
export function useTokenCopy() {
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async (token: string) => {
    const result = await copyText(token);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (result === 'failed') {
      setCopiedToken(null);
      notifications.show({
        color: 'red',
        title: '토큰을 복사하지 못했습니다',
        message:
          '브라우저가 클립보드 접근을 막았습니다. 열린 창에서 토큰을 직접 선택해 복사해 주세요.',
      });
      setManualToken(token);
      return;
    }
    setCopiedToken(token);
    timerRef.current = setTimeout(() => setCopiedToken(null), COPIED_FEEDBACK_MS);
  }, []);

  const closeManual = useCallback(() => setManualToken(null), []);

  return { copiedToken, manualToken, copy, closeManual };
}
