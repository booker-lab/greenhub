'use client';

import type { SaleRoundSchedule, SaleRoundStatus } from '@greenhub/shared';
import { useEffect, useState } from 'react';
import { isFeatureOn } from '@/lib/features';
import { countdownTarget, formatCountdown } from '@/lib/round-countdown';
import { formatRoundTime } from '@/lib/round-schedule-label';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

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
    const targetMs = Date.parse(targetAt);
    // 하루 넘게 남아 날짜·시각만 보이는 동안은 표시가 바뀌지 않으므로 매초 다시 그리지 않는다.
    const showsDate = isFeatureOn('countdown-date') && formatRoundTime(targetAt) !== null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const remaining = targetMs - current;
      // 0이 되면(또는 시각을 못 읽으면) 표시가 00:00:00으로 고정되므로 멈춘다.
      if (!(remaining > 0)) return;
      // 날짜 표시 중이면 남은 시간이 하루가 되는 시점까지 기다린다(잠자기·시계 변경 대비 최대 1시간).
      const delay =
        showsDate && remaining > DAY_MS ? Math.min(remaining - DAY_MS + 1, HOUR_MS) : 1000;
      timer = setTimeout(tick, delay);
    };
    tick();
    return () => clearTimeout(timer);
  }, [targetAt]);

  if (!target) return null;
  const remaining = now === null ? 0 : Date.parse(target.at) - now;
  // 하루 넘게 남으면 초 단위로 세지 않고 날짜·시각으로 보여준다(기능 토글 countdown-date).
  const longWait = isFeatureOn('countdown-date') && now !== null && remaining > DAY_MS;

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
      <span>{longWait ? target.label.replace(/까지$/, '') : target.label}</span>
      <span aria-hidden={now === null}>
        {now === null
          ? ''
          : longWait
            ? (formatRoundTime(target.at) ?? formatCountdown(remaining))
            : formatCountdown(remaining)}
      </span>
    </div>
  );
}
