'use client';

import { useEffect, useState } from 'react';
import { isFeatureOn } from '@/lib/features';
import { type CountdownTarget, formatCountdown } from '@/lib/round-countdown';
import { formatRoundTime } from '@/lib/round-schedule-label';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// 홈 배송일 제목 옆 노란 마감 알약(design-direction.md §4.2 3번). 첫 화면에서 색을 칠한 면은 이것 하나다.
// 서버 렌더와 첫 화면이 어긋나지 않게 시간은 마운트 뒤에만 센다.
export default function RoundCountdownPill({ target }: { target: CountdownTarget }) {
  const targetAt = target.at;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
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

  const remaining = now === null ? 0 : Date.parse(targetAt) - now;
  // 하루 넘게 남으면 초 단위로 세지 않고 날짜·시각으로 보여준다(기능 토글 countdown-date).
  const longWait = isFeatureOn('countdown-date') && now !== null && remaining > DAY_MS;

  return (
    <p
      className="m-0 whitespace-nowrap"
      style={{
        background: 'var(--color-deadline)',
        borderRadius: 'var(--radius-full)',
        color: 'var(--color-deadline-on)',
        fontSize: 'var(--font-size-sm)',
        // 숫자가 바뀌어도 알약 폭이 흔들리지 않게 자리를 맞춘다(design-standard.md §3).
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 'var(--fw-extrabold)',
        lineHeight: 1.45,
        padding: '4px 12px',
      }}
    >
      {longWait ? target.label.replace(/까지$/, '') : target.label}{' '}
      {/* 마운트 전에는 같은 자리만 잡아 두어 알약 폭이 한 번 더 바뀌지 않게 한다. */}
      <span aria-hidden={now === null} style={now === null ? { visibility: 'hidden' } : undefined}>
        {longWait
          ? (formatRoundTime(targetAt) ?? formatCountdown(remaining))
          : formatCountdown(remaining)}
      </span>
    </p>
  );
}
