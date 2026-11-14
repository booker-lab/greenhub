'use client';

import { ChevronDown } from 'lucide-react';
import { Fragment } from 'react';
import RoundCountdownPill from '@/components/RoundCountdownPill';
import type { PublicSaleRound } from '@/hooks/useSaleRounds';
import { isFeatureOn } from '@/lib/features';
import { homeRoundHeroState } from '@/lib/home-round-hero';
import {
  formatOrderCloseStatus,
  formatOrderOpenLabel,
  formatRoundDeliveryPromise,
  isRoundOrderClosed,
} from '@/lib/round-schedule-label';

const TITLE_ID = 'home-round-hero-title';
const LINE = 'm-0 p-0 text-sm';
const SECONDARY = { color: 'var(--color-text-secondary)' } as const;
const STRONG = { color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' } as const;

interface Props {
  round: PublicSaleRound | null;
  /** 주문이 끝난 회차 다음에 열리는 회차 안내 한 줄(없으면 null). */
  nextRoundNotice: string | null;
}

// 홈 제목 구역(design-direction.md §4.2 2·3번, design-standard.md §5): 배송일 52px → 도착 회차 줄 22px와
// 노란 마감 알약 → 배송 지역·주문 마감·배송 약속 줄 → 한 줄 단계 표시(누르면 날짜).
// 회차가 없거나 도착일을 읽지 못하면 제목·알약·단계 표시 없이 안내 줄만 남긴다(상태는 lib/home-round-hero).
export default function HomeRoundHero({ round, nextRoundNotice }: Props) {
  const now = Date.now();
  const hero = homeRoundHeroState(round, now);
  const titled = hero.kind !== 'none';

  return (
    <section aria-labelledby={titled ? TITLE_ID : undefined}>
      {titled && (
        <div className="mb-2 flex flex-row flex-wrap items-end justify-start gap-x-2.5 gap-y-1.5">
          <h2
            id={TITLE_ID}
            className="m-0 min-w-0"
            style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-extrabold)' }}
          >
            {/* 날짜 줄은 제목 폭에 넣지 않는다(w-0, 글자는 그대로 보인다). 넣으면 알약이 도착 회차 줄
                오른쪽에 붙지 못하고 다음 줄로 밀린다. 52px은 이 화면에서 여기 한 번만 쓴다. */}
            <span
              className="block w-0 whitespace-nowrap"
              style={{ fontSize: 52, letterSpacing: '-0.02em', lineHeight: 1.1 }}
            >
              {hero.deliveryDate}
            </span>{' '}
            <span
              className="mt-0.5 block whitespace-nowrap"
              style={{ fontSize: 22, letterSpacing: '-0.01em', lineHeight: 1.4 }}
            >
              문 앞 도착 회차
            </span>
          </h2>
          {hero.kind !== 'closed' && hero.countdown && (
            <RoundCountdownPill target={hero.countdown} />
          )}
        </div>
      )}

      <div className="flex flex-col items-stretch justify-start gap-0.5">
        <p className={LINE} style={SECONDARY}>
          경기도 이천시 직접 배송
        </p>
        {round?.status === 'SCHEDULED' && (
          <p className={LINE} style={STRONG}>
            {formatOrderOpenLabel(round.schedule.orderOpenAt)}
          </p>
        )}
        <p className={LINE} style={SECONDARY}>
          {/* 주문 마감 시각이 지났으면 "~까지" 대신 "주문 마감됨 · 시각"으로 쓴다. */}
          {round
            ? formatOrderCloseStatus(
                round.schedule.orderCloseAt,
                isRoundOrderClosed(round, now),
              )
            : '주문 마감 일정 준비 중'}
        </p>
        {nextRoundNotice && (
          <p className={LINE} style={STRONG}>
            {nextRoundNotice}
          </p>
        )}
        <p className={LINE} style={SECONDARY}>
          {/* 회차 도착 시각에서 만든다(값을 읽지 못하면 고정 문구). */}
          {formatRoundDeliveryPromise(round?.schedule.deliveryEndAt)}
        </p>
        {isFeatureOn('demand-signals') && round?.demand && round.demand.buyerCount > 0 && (
          <p className={LINE} style={STRONG}>
            이번 회차 {round.demand.buyerCount}곳에서 주문했어요
          </p>
        )}
      </div>

      {titled && (
        <details className="group">
          {/* 지금 단계만 초록(--color-primary-dark)이고 나머지는 보조 글자색이다. */}
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span
              className="flex min-h-11 flex-row items-center justify-start gap-1.5 text-sm"
              style={SECONDARY}
            >
              {hero.steps.map((step, index) => (
                <Fragment key={step.key}>
                  {index > 0 && <span>—</span>}
                  <span
                    aria-current={step.current ? 'step' : undefined}
                    style={
                      step.current
                        ? { color: 'var(--color-primary-dark)', fontWeight: 'var(--fw-bold)' }
                        : undefined
                    }
                  >
                    {step.label}
                  </span>
                </Fragment>
              ))}
              <span className="sr-only"> 날짜 보기</span>
              <ChevronDown
                size={18}
                aria-hidden
                className="shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
              />
            </span>
          </summary>
          <dl
            className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pb-1 text-sm"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {hero.steps.map((step) => (
              <Fragment key={step.key}>
                <dt
                  style={
                    step.current
                      ? { color: 'var(--color-primary-dark)', fontWeight: 'var(--fw-bold)' }
                      : SECONDARY
                  }
                >
                  {step.label}
                </dt>
                <dd className="m-0" style={{ color: 'var(--color-text)' }}>
                  {step.time}
                </dd>
              </Fragment>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}
