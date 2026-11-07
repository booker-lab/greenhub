'use client';

import { useSyncExternalStore } from 'react';

type OnlineStatusTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** 연결 상태(online/offline 이벤트)가 바뀔 때마다 onChange를 부른다. 돌려준 함수로 구독을 끝낸다. */
export function subscribeOnlineStatus(target: OnlineStatusTarget, onChange: () => void) {
  target.addEventListener('online', onChange);
  target.addEventListener('offline', onChange);
  return () => {
    target.removeEventListener('online', onChange);
    target.removeEventListener('offline', onChange);
  };
}

function subscribe(onChange: () => void) {
  return subscribeOnlineStatus(window, onChange);
}

function getSnapshot() {
  return navigator.onLine;
}

// 서버에서 만든 첫 화면은 연결된 것으로 본다(띠 없이 그린 뒤 브라우저에서 실제 상태로 바꾼다).
function getServerSnapshot() {
  return true;
}

/** 인터넷 연결이 끊기면 화면 위에 안내 띠를 보인다. 탭을 눌러도 반응이 없는 이유를 알려 준다. */
export default function OfflineNotice() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (online) return null;
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        paddingTop: 'env(safe-area-inset-top)',
        background: 'var(--color-status-warning-bg)',
        color: 'var(--color-status-warning-text)',
        boxShadow: 'var(--bar-shadow)',
      }}
    >
      <p
        className="px-4 py-2.5 text-center"
        style={{
          maxWidth: 430,
          margin: '0 auto',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-bold)',
        }}
      >
        인터넷 연결을 확인해 주세요.
      </p>
    </div>
  );
}
