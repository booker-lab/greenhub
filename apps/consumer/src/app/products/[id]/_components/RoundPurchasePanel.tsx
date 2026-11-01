import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import { formatOrderCloseLabel, formatRoundTime } from '@/lib/round-schedule-label';

interface RoundPurchasePanelProps {
  round: SaleRound;
  item: SaleRoundItem;
  state: 'current' | 'closed' | 'sold_out';
  isPurchasable: boolean;
}

// 상품 상세 사진 바로 아래의 회차 요약(디자인 기준 §5): 상태 태그 → 상품명·회차 가격 → 배송 흐름.
// 상품명은 회차에 올린 시점의 이름(productNameSnapshot)을 쓴다. 필수 고지는 아래 RoundPurchaseNotices.
export default function RoundPurchasePanel({
  round,
  item,
  state,
  isPurchasable,
}: RoundPurchasePanelProps) {
  const closed = state === 'closed';
  const soldOut = state === 'sold_out';
  const roundStateLabel = closed ? '판매 마감' : '판매 예정';
  const statusLabel = isPurchasable ? '구매 가능' : soldOut ? '품절' : roundStateLabel;
  const notOpenYet = !closed && round.status === 'SCHEDULED';
  const statusTone = isPurchasable
    ? { background: 'var(--color-primary-surface)', color: 'var(--color-primary-dark)' }
    : closed || soldOut
      ? { background: 'var(--color-surface-muted)', color: 'var(--color-text-secondary)' }
      : { background: 'var(--color-deadline-surface)', color: 'var(--color-deadline-text)' };

  const steps = [
    notOpenYet
      ? { label: '주문 시작', value: formatRoundTime(round.schedule.orderOpenAt) ?? '일정 확인 중' }
      : null,
    { label: '주문 마감', value: formatOrderCloseLabel(round.schedule.orderCloseAt) },
    { label: '새벽 경매', value: formatRoundTime(round.schedule.auctionAt) ?? '일정 확인 중' },
    {
      label: '문 앞 도착',
      value: `${formatRoundTime(round.schedule.deliveryEndAt) ?? '화요일 오전 9시'}까지`,
    },
  ].filter((step): step is { label: string; value: string } => step !== null);

  return (
    // ① 외형 유지(UI 교체 P5): Mantine Box(px md·pt lg·pb xs)·Group·Stack·Text(16/1.55, sm 15/1.45)·
    // Title order 1(줄 높이 1.3) 계산값.
    <section
      className="px-4 pt-5 pb-2.5"
      aria-labelledby="round-purchase-title"
      data-round-state={state}
      data-round-purchasable={isPurchasable}
    >
      <div className="flex flex-row flex-nowrap items-center justify-start gap-2">
        <span
          style={{
            ...statusTone,
            borderRadius: 'var(--radius-tag)',
            flexShrink: 0,
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--fw-bold)',
            padding: '2px 8px',
          }}
        >
          {statusLabel}
        </span>
        <p
          id="round-purchase-title"
          className="m-0 truncate p-0 leading-[1.55] font-normal"
          style={{
            color: 'var(--color-primary-dark)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          {closed ? '마감된 회차' : notOpenYet ? '판매 예정 회차' : '이번 주 판매 회차'} ·{' '}
          {round.name}
        </p>
      </div>

      <h1
        className="m-0 mt-2.5"
        style={{
          color: 'var(--color-text)',
          fontSize: 22,
          fontWeight: 'var(--fw-extrabold)',
          letterSpacing: '-0.01em',
          lineHeight: 1.3,
        }}
      >
        {item.productNameSnapshot}
      </h1>
      <div className="mt-1.5 flex flex-row flex-wrap items-baseline justify-start gap-2">
        <p className="m-0 p-0 text-sm font-normal" style={{ color: 'var(--color-text-secondary)' }}>
          회차 가격
        </p>
        <p
          className="m-0 p-0 leading-[1.55] font-normal"
          style={{
            color: closed ? 'var(--color-text-secondary)' : 'var(--color-text)',
            fontSize: 24,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 'var(--fw-extrabold)',
          }}
        >
          {item.roundPrice.toLocaleString('ko-KR')}원
        </p>
      </div>
      <p className="m-0 p-0 text-sm font-normal" style={{ color: 'var(--color-text-secondary)' }}>
        이 회차 주문에 적용되는 결제 기준 가격입니다.
      </p>

      <ol
        className="mt-4 flex flex-col items-stretch justify-start gap-2.5 p-4"
        aria-label="주문부터 배송까지"
        style={{
          background: closed ? 'var(--color-surface-muted)' : 'var(--color-primary-surface)',
          borderRadius: 'var(--radius)',
          listStyle: 'none',
          marginBottom: 0,
        }}
      >
        {steps.map((step) => (
          <li
            key={step.label}
            className="flex flex-row flex-nowrap items-start justify-between gap-3"
          >
            <div className="flex flex-row flex-nowrap items-center justify-start gap-2">
              <span
                aria-hidden
                style={{
                  background: closed ? 'var(--color-text-disabled)' : 'var(--color-primary)',
                  borderRadius: 'var(--radius-full)',
                  display: 'inline-block',
                  flexShrink: 0,
                  height: 8,
                  width: 8,
                }}
              />
              <p
                className="m-0 p-0 text-sm"
                style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}
              >
                {step.label}
              </p>
            </div>
            <p
              className="m-0 p-0 text-right text-sm font-normal"
              style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}
            >
              {step.value}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 회차 상품의 필수 고지(배송 지역·기상 연기·청약철회). 상품 설명 아래, 구매 버튼 위에 둔다. */
export function RoundPurchaseNotices() {
  return (
    // ① 외형 유지(UI 교체 P5): Mantine Box(px md·pb xs·mt md·p md)·Stack(gap 4)·Text sm(15/1.45) 계산값.
    <section aria-label="회차 배송·청약철회 안내" className="px-4 pb-2.5">
      <div className="flex flex-col items-stretch justify-start gap-1">
        <p
          className="m-0 p-0 text-sm"
          style={{ fontWeight: 'var(--fw-extrabold)', color: 'var(--color-text)' }}
        >
          경기 이천 직접배송
        </p>
        <p className="m-0 p-0 text-sm font-normal" style={{ color: 'var(--color-text-secondary)' }}>
          경기도 이천시 직접배송만 제공하며, 화요일 오전 9시까지 문 앞 배송합니다.
        </p>
      </div>

      <div
        className="mt-4 p-4"
        style={{ background: 'var(--color-deadline-surface)', borderRadius: 'var(--radius)' }}
      >
        <p
          className="m-0 mb-1 p-0 text-sm"
          style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-deadline-text)' }}
        >
          기상 상황에 따른 배송 연기
        </p>
        <p
          className="m-0 p-0 text-sm font-normal"
          style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}
        >
          안전한 배송이 어려운 기상 상황에는 배송이 연기될 수 있습니다. 판매자 책임으로 재배송비
          없이 새 배송 일정을 안내합니다.
        </p>
      </div>

      <div className="mt-4">
        <p className="m-0 mb-1 p-0 text-sm" style={{ fontWeight: 'var(--fw-bold)' }}>
          청약철회 제한 안내
        </p>
        <p
          className="m-0 p-0 text-sm font-normal"
          style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}
        >
          주문 마감 후 경매 매입·배송 준비가 시작되었거나 생화의 상품 가치가 현저히 감소한 경우
          청약철회가 제한될 수 있습니다. 표시·광고 또는 계약 내용과 다르게 이행된 경우는 제외됩니다.
        </p>
      </div>
    </section>
  );
}
