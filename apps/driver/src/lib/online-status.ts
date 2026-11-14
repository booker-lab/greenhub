import { useSyncExternalStore } from 'react';

/**
 * 기기 연결 상태(navigator.onLine)를 화면에서 쓰는 작은 연결부.
 *
 * 로그인 검사 화면(/board·/map·/profile)은 서비스워커가 NetworkOnly로 두어(next.config.ts) 신호가 없을 때
 * 화면을 옮기면 서버 응답을 받지 못해 앱 밖 오류 화면으로 나간다. 그러면 앱이 닫혀 사진 업로드 대기열도
 * 멈춘다(S-01). 그래서 신호가 없다고 확실히 알 때(onLine === false)만 화면 이동을 막고 앱 안에 머문다.
 * onLine이 참이어도 실제로는 신호가 약할 수 있으므로, 참일 때는 예전처럼 이동한다.
 */

/** 하단 탭을 신호 없이 눌렀을 때의 안내(S-01). */
export const OFFLINE_NAVIGATION_MESSAGE = '신호가 잡히면 이동할 수 있어요.';

/** navigator가 없거나(서버) onLine을 모르면 연결된 것으로 본다(이동을 막지 않는다). */
export function readOnlineStatus(nav: { onLine?: unknown } | undefined | null): boolean {
  return nav?.onLine !== false;
}

type OnlineEventTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/** 'online'·'offline' 이벤트를 듣는다. 돌려준 함수로 듣기를 그만둔다. */
export function subscribeOnlineStatus(
  target: OnlineEventTarget | undefined | null,
  callback: () => void,
): () => void {
  if (!target) return () => {};
  target.addEventListener('online', callback);
  target.addEventListener('offline', callback);
  return () => {
    target.removeEventListener('online', callback);
    target.removeEventListener('offline', callback);
  };
}

function subscribeWindow(callback: () => void): () => void {
  return subscribeOnlineStatus(typeof window === 'undefined' ? null : window, callback);
}

function readNavigator(): boolean {
  return readOnlineStatus(typeof navigator === 'undefined' ? null : navigator);
}

/** 지금 연결 상태. 서버 렌더와 첫 hydration은 연결된 것으로 그리고, 'online'·'offline' 때 다시 그린다. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeWindow, readNavigator, () => true);
}
