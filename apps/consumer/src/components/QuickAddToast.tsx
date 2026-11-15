'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export interface QuickAddToastState {
  /** 같은 문구를 연달아 띄울 때도 다시 보이게 하는 값 */
  id: number;
  tone: 'success' | 'error';
  message: string;
}

const VISIBLE_MS = 3500;
/**
 * 알림을 화면 아래에서 띄울 거리: 하단 내비 높이 + 12px. 오프라인 띠(OfflineNotice)가 하단 내비 바로 위에
 * 떠 있으면 띠가 문서 루트에 알린 띠 높이(--offline-notice-height)만큼 더 올라가 띠에 가리지 않는다.
 */
export const QUICK_ADD_TOAST_BOTTOM =
  'calc(64px + env(safe-area-inset-bottom) + var(--offline-notice-height, 0px) + 12px)';

// 홈 "+ 바로 담기" 결과를 하단 탭 위에 잠깐 보여주고 장바구니로 가는 링크를 붙인다.
export default function QuickAddToast({
  toast,
  onClose,
}: {
  toast: QuickAddToastState | null;
  onClose: () => void;
}) {
  const toastId = toast?.id ?? null;
  useEffect(() => {
    if (toastId === null) return;
    const timer = setTimeout(onClose, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toastId, onClose]);

  return (
    <div
      aria-live="polite"
      style={{
        bottom: QUICK_ADD_TOAST_BOTTOM,
        left: 16,
        pointerEvents: 'none',
        position: 'fixed',
        right: 16,
        zIndex: 20,
      }}
    >
      {toast && (
        <div
          role={toast.tone === 'error' ? 'alert' : 'status'}
          style={{
            alignItems: 'center',
            background: toast.tone === 'error' ? 'var(--color-danger)' : 'var(--color-text)',
            borderRadius: 'var(--radius)',
            color: 'var(--color-bg)',
            display: 'flex',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            gap: 12,
            justifyContent: 'space-between',
            margin: '0 auto',
            maxWidth: 560,
            padding: '12px 16px',
            pointerEvents: 'auto',
          }}
        >
          <span>{toast.message}</span>
          {/* 실패(다른 회차·예전 판매 상품과 섞임)도 장바구니에서 비워야 다음으로 갈 수 있다.
              눌리는 줄 높이는 44px이고(design-standard §4), 늘어난 만큼 위아래 여백을 당겨 알림 높이는 그대로 둔다. */}
          <Link
            href="/cart"
            style={{
              alignItems: 'center',
              color: toast.tone === 'success' ? 'var(--color-primary-light)' : 'var(--color-bg)',
              display: 'inline-flex',
              flexShrink: 0,
              margin: '-11px 0',
              minHeight: 'var(--touch-target)',
              textDecoration: toast.tone === 'success' ? 'none' : 'underline',
            }}
          >
            장바구니 보기
          </Link>
        </div>
      )}
    </div>
  );
}
