'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

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

/** 하단 내비가 숨는 화면(BottomNav의 HIDDEN_PATHS와 같아야 한다). */
const BOTTOM_NAV_HIDDEN_PATHS = ['/checkout', '/order/success', '/products/'];
/** 하단 내비 높이(BottomNav와 같은 값). */
const BOTTOM_NAV_OFFSET = 'calc(64px + env(safe-area-inset-bottom))';
/** 상품 상세 하단 구매 바(ProductCTABar) 높이: 위아래 여백 12px씩 + 큰 버튼 50px. */
const PRODUCT_CTA_OFFSET = 'calc(74px + env(safe-area-inset-bottom))';

/**
 * 오프라인 띠를 화면 아래에서 띄울 거리. 상단 바(제목·뒤로가기)를 가리지 않게 아래쪽에 두되,
 * 하단에 고정된 바(하단 내비·상품 구매 바)와 겹치지 않게 그 바로 위에 둔다. 고정 바가 없는 화면은 0.
 */
export function offlineNoticeBottomOffset(pathname: string): string {
  if (!BOTTOM_NAV_HIDDEN_PATHS.some((path) => pathname.startsWith(path))) return BOTTOM_NAV_OFFSET;
  if (pathname.startsWith('/products/')) return PRODUCT_CTA_OFFSET;
  return '0px';
}

/** 띠가 보이는 동안 띠 높이를 알리는 문서 루트 CSS 변수. 담기 알림(QuickAddToast)이 이 값만큼 위로 올라간다. */
export const OFFLINE_NOTICE_HEIGHT_VAR = '--offline-notice-height';

/**
 * 띠가 보이는 동안 문서 루트에 둘 띠 높이 값. 연결돼 있거나 아직 높이를 재지 못했으면 null(변수를 지운다).
 * 소수점 높이는 올려서 띠 위 요소가 띠에 겹치지 않게 한다.
 */
export function offlineNoticeHeightValue(online: boolean, bandHeight: number): string | null {
  if (online || !Number.isFinite(bandHeight) || bandHeight <= 0) return null;
  return `${Math.ceil(bandHeight)}px`;
}

/**
 * 인터넷 연결이 끊기면 하단 고정 바 바로 위에 안내 띠를 보인다. 탭을 눌러도 반응이 없는 이유를 알려 준다.
 * 화면 위쪽에 두면 각 화면의 상단 바(제목·뒤로가기)를 가리므로 아래쪽에 둔다.
 */
export default function OfflineNotice() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const pathname = usePathname();
  const bandRef = useRef<HTMLDivElement>(null);
  const [bandHeight, setBandHeight] = useState(0);
  // 띠 높이를 잰다(글자 크기·홈 표시줄 여백에 따라 달라진다). 관찰을 시작하면 첫 크기를 한 번 알려 준다.
  useEffect(() => {
    const band = bandRef.current;
    if (online || !band) return;
    const observer = new ResizeObserver(() => setBandHeight(band.offsetHeight));
    observer.observe(band);
    return () => observer.disconnect();
  }, [online]);
  const heightValue = offlineNoticeHeightValue(online, bandHeight);
  // 띠가 보이는 동안만 문서 루트에 띠 높이를 알린다. 연결되면 지워 원래 위치로 돌아가게 한다.
  useEffect(() => {
    if (heightValue === null) return;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty(OFFLINE_NOTICE_HEIGHT_VAR, heightValue);
    return () => {
      rootStyle.removeProperty(OFFLINE_NOTICE_HEIGHT_VAR);
    };
  }, [heightValue]);
  if (online) return null;
  const bottom = offlineNoticeBottomOffset(pathname);
  return (
    <>
      {/* 띠가 본문 마지막 부분을 가리지 않게 문서 끝에 띠 높이만큼 빈 공간을 더한다. */}
      {heightValue !== null &&
        createPortal(<div aria-hidden style={{ height: heightValue }} />, document.body)}
      <div
        ref={bandRef}
        role="alert"
        style={{
          position: 'fixed',
          bottom,
          left: 0,
          right: 0,
          zIndex: 200,
          // 고정 바가 없는 화면은 띠가 맨 아래에 붙으므로 홈 표시줄 영역만큼 안쪽 여백을 둔다.
          paddingBottom: bottom === '0px' ? 'env(safe-area-inset-bottom)' : undefined,
          background: 'var(--color-status-warning-bg)',
          color: 'var(--color-status-warning-text)',
          // 아래에 붙은 띠라 하단 바와 같은 방향(위쪽)으로 그림자를 둔다.
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
    </>
  );
}
