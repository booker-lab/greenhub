'use client';

import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import { buildRoundPurchaseList } from '@/lib/round-purchase-list';

// ② 디자인 방향(D2): 그림자 없이 흰 면만 남긴다. 목록 행 사이 선은 유지한다.
const TEXT = 'm-0 p-0 text-base font-normal';

// 회차 구매 목록(경매에서 살 상품별 수량). 수량은 서버 회차 상품 집계를 그대로 쓴다.
export function RoundPurchaseListCard({
  round,
  title = '구매 목록',
}: {
  round: Pick<SaleRound, 'name' | 'counters'> & { items: SaleRoundItem[] };
  title?: string;
}) {
  const list = buildRoundPurchaseList(round);

  return (
    <div className="block rounded-[16px] bg-white p-4">
      <p className={TEXT} style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-bold)' }}>
        {title}
      </p>
      <p
        className={TEXT}
        style={{
          marginTop: 2,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
        }}
      >
        결제가 끝난 주문 기준이에요. 취소·환불되면 바로 빠져요.
      </p>
      <div className="mt-3">
        {list.lines.map((line, index) => (
          <div
            key={line.roundItemId}
            className="flex flex-row flex-nowrap items-center justify-between gap-4 py-2.5"
            style={index > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}
          >
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text)',
                fontWeight: 'var(--fw-medium)',
                minWidth: 0,
              }}
            >
              {line.productName}
            </p>
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {line.orderedQuantity.toLocaleString()}개
            </p>
          </div>
        ))}
      </div>
      <div
        className="flex flex-row flex-wrap items-center justify-end gap-4 pt-2.5"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <p
          className={TEXT}
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          배송지 {list.orderedDeliveryAddresses.toLocaleString()}곳 · 총{' '}
          {list.orderedTotal.toLocaleString()}개
        </p>
      </div>
      {list.pendingTotal > 0 && (
        <p
          className={TEXT}
          style={{
            marginTop: 6,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}
        >
          지금 결제 중인 {list.pendingTotal.toLocaleString()}개는 결제가 끝나면 더해져요.
        </p>
      )}
    </div>
  );
}
