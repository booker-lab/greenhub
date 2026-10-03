import { Bell, ShoppingBag } from 'lucide-react';
import Link from 'next/link';

// 홈 맨 위 초록 머리띠(docs/specs/frontend/design-standard.md §5). 다른 화면에는 쓰지 않는다.
const iconLinkStyle = {
  alignItems: 'center',
  color: 'var(--color-bg)',
  display: 'inline-flex',
  height: 'var(--touch-target)',
  justifyContent: 'center',
  width: 'var(--touch-target)',
} as const;

export default function HomeHeader() {
  return (
    <header
      style={{
        alignItems: 'center',
        background: 'var(--color-primary)',
        color: 'var(--color-bg)',
        display: 'flex',
        justifyContent: 'space-between',
        padding: '8px 8px 8px 16px',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-brand)',
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: '-0.01em',
          lineHeight: 1.2,
          margin: 0,
        }}
      >
        Green Love
      </h1>
      <nav aria-label="바로가기" style={{ display: 'flex' }}>
        <Link href="/mypage/notifications" aria-label="알림" style={iconLinkStyle}>
          <Bell size={22} strokeWidth={2} aria-hidden />
        </Link>
        <Link href="/cart" aria-label="장바구니" style={iconLinkStyle}>
          <ShoppingBag size={22} strokeWidth={2} aria-hidden />
        </Link>
      </nav>
    </header>
  );
}
