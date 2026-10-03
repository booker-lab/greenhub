'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { type DeadlineRound, deadlineTarget, formatCountdown } from '@/lib/round-deadline';

interface Props {
  round: DeadlineRound | null;
  /** 회차 이름을 문구 앞에 붙인다(주문 화면처럼 어느 회차인지 알 수 없는 곳). */
  showName?: boolean;
  /** 지정하면 띠 전체가 그 주소로 가는 링크가 된다. */
  href?: string;
  /** 본문 여백 안에 둘 때는 둥근 상자로, 머리줄 바로 아래 전체 폭에 둘 때는 띠로 그린다. */
  rounded?: boolean;
}

// 디자인 기준 §5: 판매자 화면도 회차가 진행 중이면 노란 마감 띠를 보인다.
// 서버 렌더와 첫 화면이 어긋나지 않게 남은 시간은 마운트 뒤에만 센다.
export function RoundDeadlineStrip({ round, showName = false, href, rounded = false }: Props) {
  const target = round ? deadlineTarget(round) : null;
  const targetAt = target?.at ?? null;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!targetAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [targetAt]);

  if (!round || !target) return null;

  const content = (
    <>
      <span
        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {showName ? `${round.name} ${target.label}` : target.label}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <span aria-hidden={now === null}>
          {now === null ? '' : formatCountdown(Date.parse(target.at) - now)}
        </span>
        {href && <ChevronRight size={18} strokeWidth={2.4} aria-hidden />}
      </span>
    </>
  );

  const style = {
    alignItems: 'center',
    background: 'var(--color-deadline)',
    borderRadius: rounded ? 'var(--radius)' : 0,
    color: 'var(--color-deadline-text)',
    display: 'flex',
    fontSize: 'var(--font-size-sm)',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 'var(--fw-extrabold)',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 'var(--touch-target)',
    padding: '0 16px',
    textDecoration: 'none',
  } as const;

  return href ? (
    <Link href={href} style={style} data-testid="round-deadline-strip">
      {content}
    </Link>
  ) : (
    <div style={style} data-testid="round-deadline-strip">
      {content}
    </div>
  );
}
