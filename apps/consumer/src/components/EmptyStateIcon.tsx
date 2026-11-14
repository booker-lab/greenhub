import type { LucideIcon } from 'lucide-react';

/**
 * 빈 상태 머리 그림: 연회색 원 + 선 아이콘(`app/not-found.tsx`와 같은 모양).
 * 뜻은 바로 아래 문장이 전하므로 보조 기술에는 숨긴다.
 */
export default function EmptyStateIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div
      aria-hidden
      style={{
        alignItems: 'center',
        background: 'var(--color-surface-muted)',
        borderRadius: 'var(--radius-full)',
        color: 'var(--color-text-secondary)',
        display: 'flex',
        height: 72,
        justifyContent: 'center',
        width: 72,
      }}
    >
      <Icon size={32} strokeWidth={1.8} />
    </div>
  );
}
