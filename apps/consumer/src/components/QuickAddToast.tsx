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
        bottom: 'calc(64px + env(safe-area-inset-bottom) + 12px)',
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
          {/* 실패(다른 회차·예전 판매 상품과 섞임)도 장바구니에서 비워야 다음으로 갈 수 있다 */}
          <Link
            href="/cart"
            style={{
              color: toast.tone === 'success' ? 'var(--color-primary-light)' : 'var(--color-bg)',
              flexShrink: 0,
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
