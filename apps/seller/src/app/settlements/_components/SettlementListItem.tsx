'use client';

import { StatusDot } from '@greenhub/ui/components/status-dot';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { Settlement } from '../_constants';
import { STATUS_LABEL } from '../_constants';
import { toDateStr, toKRW } from '../_lib';
import { settlementStatusTone } from './status-badge';

interface SettlementListItemProps {
  settlement: Settlement;
  showFee?: boolean;
}

// ① 외형 유지(UI 교체 P4): Mantine Paper(radius md 8px·px md·py sm; 그림자는 ② D2로 걷음)·Group·Stack·Text와 같은 값.
// 상태는 ② 점 + 글자(13px).
const TEXT = 'm-0 p-0 text-base';
const GROUP = 'flex flex-row flex-wrap items-center';
const muted = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' };

export function SettlementListItem({ settlement: s, showFee }: SettlementListItemProps) {
  return (
    // 정산에는 사람이 읽을 주문번호가 없어(orderId만 있음) 잘린 ID 대신 그 주문 상세로 가는 카드로 둔다.
    <Link
      href={`/orders/${encodeURIComponent(s.orderId)}`}
      className="block rounded-[8px] bg-white px-4 py-3 no-underline outline-0 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
      style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
    >
      <div className={`${GROUP} mb-1 justify-between gap-4`}>
        <div
          className={`${GROUP} justify-start gap-0.5`}
          style={{ color: 'var(--color-primary-dark)' }}
        >
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}
          >
            주문 보기
          </p>
          <ChevronRight size={16} aria-hidden />
        </div>
        <StatusDot tone={settlementStatusTone(s.status)} size={13}>
          {STATUS_LABEL[s.status]}
        </StatusDot>
      </div>
      <div className={`${GROUP} justify-between gap-4`}>
        {showFee ? (
          <div className="flex flex-col items-stretch justify-start gap-0">
            <p className={TEXT} style={muted}>
              {toDateStr(s.settledAt)}
            </p>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              수수료 {toKRW(s.platformFee)}
            </p>
          </div>
        ) : (
          <p className={TEXT} style={muted}>
            {toDateStr(s.settledAt)}
          </p>
        )}
        <p
          className={TEXT}
          style={{ fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}
        >
          {toKRW(s.netAmount)}
        </p>
      </div>
    </Link>
  );
}
