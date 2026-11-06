import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import { formatOrderCloseLabel, formatRoundDay, formatRoundTime } from '@/lib/round-schedule-label';

interface RoundPurchasePanelProps {
  round: SaleRound;
  item: SaleRoundItem;
  state: 'current' | 'closed' | 'sold_out';
  isPurchasable: boolean;
}

// 상품 상세 사진 바로 아래의 회차 요약(디자인 기준 §5): 상품명 → 언제·어디서 한 줄 → 회차 가격 → 배송 흐름.
// 상품명은 회차에 올린 시점의 이름(productNameSnapshot)을 쓴다. 필수 고지는 아래 RoundPurchaseNotices.
export default function RoundPurchasePanel({
  round,
  item,
  state,
  isPurchasable,
}: RoundPurchasePanelProps) {
  const closed = state === 'closed';
  const soldOut = state === 'sold_out';
  const notOpenYet = !closed && round.status === 'SCHEDULED';
  // 구매할 수 없을 때만 이유를 18px 줄 앞에 붙인다(제목 위 상태 태그·회차 이름 라벨은 두지 않는다, 방향 §4.3).
  const statusLabel = isPurchasable
    ? null
    : soldOut
      ? '품절'
      : closed
        ? '판매 마감'
        : notOpenYet
          ? '판매 예정 회차'
          : '구매 불가';
  const deliveryDay = formatRoundDay(round.schedule.deliveryEndAt);

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
    // ② 상세 첫 화면(design-direction.md §4.3): 상품 이름 30px → 18px 한 줄(언제·어디서) → 가격 → 배송 흐름.
    <section
      className="px-4 pt-5 pb-2.5"
      aria-labelledby="round-purchase-title"
      data-round-state={state}
      data-round-purchasable={isPurchasable}
    >
      <h1
        id="round-purchase-title"
        className="m-0"
        style={{
          color: 'var(--color-text)',
          fontSize: 30,
          fontWeight: 'var(--fw-extrabold)',
          letterSpacing: '-0.01em',
          lineHeight: 1.25,
          textWrap: 'balance',
        }}
      >
        {item.productNameSnapshot}
      </h1>
      <p
        className="m-0 mt-2 p-0"
        style={{
          color: 'var(--color-text-secondary)',
          fontSize: 'var(--font-size-lg)',
          lineHeight: 1.45,
        }}
      >
        {statusLabel && (
          <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}>
            {statusLabel} ·{' '}
          </span>
        )}
        {deliveryDay ? `${deliveryDay} 문 앞 도착` : '화요일 오전 9시까지 문 앞 도착'} · 경기도
        이천시 직접 배송
      </p>
      <div className="mt-3 flex flex-row flex-wrap items-baseline justify-start gap-2">
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
