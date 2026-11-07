'use client';

import { ChevronLeft, Home, ShoppingCart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/hooks/useCart';
import { readBackNavigationContext, resolveBackAction } from '@/lib/nav-back';

// ① 외형 유지(UI 교체 P5): Mantine Box(component=header·div)는 스타일이 없는 요소라 같은 요소로 바꿨다.
export default function ProductTopBar() {
  const router = useRouter();
  const { itemCount } = useCart();
  // 공유 링크를 새 탭으로 열었거나 다른 사이트에서 막 들어왔으면 돌아갈 가게 화면이 없으니 홈으로 보낸다.
  const goBack = () => {
    if (resolveBackAction(readBackNavigationContext(window)) === 'home') router.push('/');
    else router.back();
  };

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        // ② 홈 흰 머리띠와 같게 아래 1px 선을 두지 않는다(design-direction.md §3.1). 아이콘은 검정.
        backgroundColor: 'var(--color-bg)',
        height: 'calc(52px + env(safe-area-inset-top))',
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          maxWidth: 430,
          margin: '0 auto',
          height: 52,
          paddingLeft: 4,
          paddingRight: 8,
        }}
      >
        {/* 뒤로가기 */}
        <button
          type="button"
          onClick={goBack}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            minWidth: 'var(--touch-target)',
            minHeight: 'var(--touch-target)',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            color: 'var(--color-text)',
            padding: '0 8px',
          }}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
          <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-medium)' }}>
            뒤로
          </span>
        </button>

        {/* 로고 */}
        <span
          style={{
            fontFamily: 'var(--font-brand)',
            fontSize: 'var(--font-size-lg)',
            fontWeight: 800,
            letterSpacing: '-0.01em',
            color: 'var(--color-primary-dark)',
          }}
        >
          Green Love
        </span>

        {/* 홈 + 장바구니 */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => router.push('/')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              minWidth: 'var(--touch-target)',
              minHeight: 'var(--touch-target)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text)',
            }}
            aria-label="홈으로"
          >
            <Home size={22} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            onClick={() => router.push('/cart')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              minWidth: 'var(--touch-target)',
              minHeight: 'var(--touch-target)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              color: 'var(--color-text)',
            }}
            aria-label="장바구니"
          >
            <ShoppingCart size={22} strokeWidth={1.8} />
            {itemCount > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 4,
                  background: 'var(--color-primary-dark)',
                  color: 'var(--color-bg)',
                  fontSize: 10,
                  fontWeight: 'var(--fw-bold)',
                  minWidth: 16,
                  height: 16,
                  borderRadius: 'var(--radius-full)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}
              >
                {itemCount > 99 ? '99+' : itemCount}
              </div>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
