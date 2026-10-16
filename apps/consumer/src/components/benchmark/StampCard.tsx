'use client';

import { useStamps } from '@/hooks/useBenchmark';
import { couponLabel } from './CouponStrip';

// 구매 스탬프(purchase-stamps). 로그인한 손님에게만 보인다. 배송 완료 주문 수로 칸을 채운다.
export default function StampCard({ storeId }: { storeId: string | null }) {
  const { stamps, claim, signedIn } = useStamps(storeId, true);
  if (!signedIn || !stamps) return null;
  const max = stamps.stages[stamps.stages.length - 1]?.at ?? 7;
  const next = stamps.stages.find((stage) => stamps.count < stage.at);
  const ready = stamps.stages.filter((stage) => stamps.count >= stage.at && !stage.claimedCouponId);

  return (
    <section
      aria-labelledby="stamp-title"
      style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)', padding: 16 }}
    >
      <h2 id="stamp-title" style={{ fontSize: 'var(--font-size-md)', fontWeight: 800, margin: 0 }}>
        구매 스탬프 {Math.min(stamps.count, max)}/{max}
      </h2>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '4px 0 12px' }}>
        {next
          ? `${next.at - stamps.count}번 더 받으면 ${couponLabel(next.reward)} 쿠폰을 드려요.`
          : '스탬프를 모두 모았어요. 고맙습니다.'}
      </p>
      <ol aria-label="스탬프 칸" style={{ display: 'flex', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
        {Array.from({ length: max }, (_, i) => {
          const filled = i < stamps.count;
          const isStage = stamps.stages.some((stage) => stage.at === i + 1);
          return (
            <li
              key={i}
              aria-label={`${i + 1}번째 ${filled ? '받음' : '아직'}`}
              style={{
                alignItems: 'center',
                aspectRatio: '1/1',
                background: filled ? 'var(--color-primary)' : 'var(--color-bg)',
                border: isStage ? '2px solid var(--color-primary-dark)' : 'var(--border)',
                borderRadius: 'var(--radius-full)',
                color: filled ? 'var(--color-bg)' : 'var(--color-text-disabled)',
                display: 'flex',
                flex: 1,
                fontSize: 'var(--font-size-xs)',
                fontWeight: 800,
                justifyContent: 'center',
              }}
            >
              {i + 1}
            </li>
          );
        })}
      </ol>
      {ready.map((stage) => (
        <button
          key={stage.at}
          type="button"
          onClick={() => void claim(stage.at)}
          style={{
            background: 'var(--color-primary)',
            border: 0,
            borderRadius: 'var(--radius-full)',
            color: 'var(--color-bg)',
            cursor: 'pointer',
            fontSize: 'var(--font-size-md)',
            fontWeight: 800,
            marginTop: 12,
            minHeight: 'var(--touch-target)',
            width: '100%',
          }}
        >
          {stage.at}회 쿠폰 받기 · {couponLabel(stage.reward)}
        </button>
      ))}
    </section>
  );
}
