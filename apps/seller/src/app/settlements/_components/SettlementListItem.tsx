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
    // 행 전체가 그 주문 상세로 가는 링크다. 첫 줄은 주문번호(2026-10 이후 정산)이고, 번호가 없는 옛 정산은 "주문 보기"다.
    // 초록은 화면의 주요 버튼에만 쓰므로 행마다 반복되는 이 줄은 검정 굵은 글자다(design-direction §3).
    <Link
      href={`/orders/${encodeURIComponent(s.orderId)}`}
      className="block rounded-[8px] bg-card px-4 py-3 no-underline outline-0 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
      style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
    >
      {/* 좁은 화면에서 주문번호와 상태가 한 줄에 안 들어가면 번호를 끊지 않고 상태를 아랫줄 오른쪽으로 내린다. */}
      <div className="mb-1 flex flex-row flex-wrap items-center justify-between gap-x-4">
        <div className="flex max-w-full min-w-0 flex-row flex-nowrap items-center justify-start gap-0.5">
          <p
            className={`${TEXT} min-w-0 [overflow-wrap:anywhere]`}
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {s.orderNumber ? `주문 ${s.orderNumber}` : '주문 보기'}
          </p>
          <ChevronRight
            size={16}
            aria-hidden
            className="shrink-0"
            style={{ color: 'var(--color-text-secondary)' }}
          />
        </div>
        <StatusDot tone={settlementStatusTone(s.status)} size={13} className="ml-auto shrink-0">
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
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
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
