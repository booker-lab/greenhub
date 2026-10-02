'use client';

import type { SaleRoundSchedule, SaleRoundStatus } from '@greenhub/shared';
import { useEffect, useState } from 'react';
import { countdownTarget, formatCountdown } from '@/lib/round-countdown';

interface Props {
  status: SaleRoundStatus;
  schedule: Pick<SaleRoundSchedule, 'orderOpenAt' | 'orderCloseAt'>;
}

// 홈 머리띠 아래 노란 마감 띠. 서버 렌더와 첫 화면이 어긋나지 않게 시간은 마운트 뒤에만 센다.
export default function RoundCountdownStrip({ status, schedule }: Props) {
  const target = countdownTarget(status, schedule);
  const targetAt = target?.at ?? null;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!targetAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [targetAt]);

  if (!target) return null;

  return (
    <div
      style={{
        alignItems: 'center',
        background: 'var(--color-deadline)',
        color: 'var(--color-deadline-text)',
        display: 'flex',
        fontSize: 'var(--font-size-sm)',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 'var(--fw-extrabold)',
        justifyContent: 'space-between',
        minHeight: 'var(--touch-target)',
        padding: '0 16px',
      }}
    >
      <span>{target.label}</span>
      <span aria-hidden={now === null}>
        {now === null ? '' : formatCountdown(Date.parse(target.at) - now)}
      </span>
    </div>
  );
}
