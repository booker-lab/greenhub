'use client';

import { useSession } from 'next-auth/react';
import { useEffect } from 'react';
import { getPendingPhotoRunner, subscribePendingPhotoKick } from './pending-photo-client';

/**
 * 앱이 열려 있는 동안 사진 업로드 대기열을 돌린다(SessionProvider 안, providers.tsx).
 *
 * 깨우는 때: 로그인된 앱 열기·세션(토큰) 바뀜, 연결 복구('online'), 화면 복귀(visibilitychange visible),
 * 페이지 복원(pageshow), 새 항목·"지금 올리기" 직후. 화면이 보이는 동안은 다음 차례 시각에 다시 깨운다
 * (간격 30초·1분·2분·5분 상한 + 흔들림, pending-photo-policy). 화면이 숨으면 타이머를 걸지 않는다.
 * 세션이 없으면(만료 포함) 돌리지 않고 항목은 그 사용자에게 묶인 채 남는다.
 */
export function PendingPhotoUploader() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const accessToken = session?.user?.accessToken;
  const tokenError = session?.user?.tokenError === true;

  // accessToken이 바뀌면(세션 갱신) 다시 깨운다: 401로 멈춘 항목이 새 토큰으로 이어서 올라간다.
  useEffect(() => {
    if (status !== 'authenticated' || !userId || !accessToken || tokenError) return;
    const runner = getPendingPhotoRunner();
    if (!runner) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function kick() {
      if (stopped) return;
      void runner?.runAll().then(schedule, () => schedule(null));
    }
    function schedule(wakeAt: number | null) {
      clearTimeout(timer);
      timer = undefined;
      if (stopped || wakeAt === null || document.visibilityState === 'hidden') return;
      // 차례가 이미 지났는데 보내지 못했으면(다른 탭이 보내는 중 등) 잠깐 쉬었다 다시 본다.
      const delay = wakeAt - Date.now();
      timer = setTimeout(kick, delay <= 0 ? 5_000 : Math.max(1_000, delay));
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') kick();
      else schedule(null);
    };

    kick();
    window.addEventListener('online', kick);
    window.addEventListener('pageshow', kick);
    document.addEventListener('visibilitychange', handleVisibility);
    const unsubscribeKick = subscribePendingPhotoKick(kick);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', kick);
      window.removeEventListener('pageshow', kick);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribeKick();
    };
  }, [status, userId, accessToken, tokenError]);

  return null;
}
