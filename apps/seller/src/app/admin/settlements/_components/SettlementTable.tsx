'use client';

import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
// 정산 라벨/색 SSOT = @greenhub/shared (F-1/S4).
import { STATUS_COLOR, STATUS_LABEL } from '@greenhub/shared';
import type { AdminSettlement } from '@/hooks/useAdmin';
import { HOLD_REASON_LABEL, orderLabel, storeLabel, toDateStr, toKRW } from '../_lib';

interface SettlementTableProps {
  settlements: AdminSettlement[];
  loading: boolean;
  processingId: string | null;
  onPay: (id: string) => void;
}

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·Paper(흰 면, shadow xs)·Group·Stack과 같은 값.
// 카드 목록·표는 Mantine hiddenFrom·visibleFrom sm(48em)과 같은 폭에서 바뀐다.
const TEXT = 'm-0 p-0 text-base';
const PAPER = 'block bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.1)]';
const GROUP = 'flex flex-row items-center';

// Mantine Badge light color → @greenhub/ui Badge 변형.
const LIGHT_BADGE: Record<string, 'warning' | 'light' | 'secondary' | 'destructive'> = {
  yellow: 'warning',
  brand: 'light',
  gray: 'secondary',
  red: 'destructive',
};

const thBase = {
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};
const tdBase = { padding: '12px 16px' };
const muted = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' };

/** 상태 배지 + 회수 필요·지급 보류 배지 — 테이블·카드 공용. */
function StatusBadges({ s }: { s: AdminSettlement }) {
  return (
    <div className={`${GROUP} flex-wrap justify-start gap-1`}>
      <Badge variant={LIGHT_BADGE[STATUS_COLOR[s.status] ?? 'gray']} className="rounded-[32px]">
        {STATUS_LABEL[s.status] ?? s.status}
      </Badge>
      {s.recoveryRequired && (
        <Badge variant="destructive-filled" className="rounded-[32px]">
          회수 필요 {toKRW(s.recoveryAmount ?? s.netAmount)}
        </Badge>
      )}
      {s.holdReason && (
        <Badge variant="light-orange" className="rounded-[32px]">
          {HOLD_REASON_LABEL[s.holdReason] ?? s.holdReason}
        </Badge>
      )}
    </div>
  );
}

/** 지급처리 버튼 — 확정(confirmed)만. 보류 사유가 있으면 서버가 거절하므로 누르지 못하게 둔다. */
function PayButton({
  s,
  processingId,
  onPay,
}: {
  s: AdminSettlement;
  processingId: string | null;
  onPay: (id: string) => void;
}) {
  if (s.status !== 'confirmed') return null;
  return (
    <Button
      onClick={() => onPay(s.id)}
      disabled={processingId === s.id || Boolean(s.holdReason)}
      size="xs"
      variant="outline"
      className="rounded-[8px]"
    >
      {processingId === s.id ? '처리중…' : '지급처리'}
    </Button>
  );
}

export function SettlementTable({
  settlements,
  loading,
  processingId,
  onPay,
}: SettlementTableProps) {
  if (loading && settlements.length === 0) {
    return (
      <p className={`${TEXT} py-20 text-center`} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </p>
    );
  }

  if (settlements.length === 0) {
    return (
      <div
        className={`${PAPER} rounded-[16px]`}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <p className={`${TEXT} py-16 text-center`} style={{ color: 'var(--color-text-disabled)' }}>
          정산 내역이 없습니다.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* 모바일(<sm): 카드 리스트 — 마지막 컬럼(상태·지급처리) 잘림 방지 */}
      <div className="flex flex-col gap-3 min-[48em]:hidden">
        {settlements.map((s) => (
          <div
            key={s.id}
            className={`${PAPER} rounded-[8px] px-4 py-3`}
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div className="mb-2.5 flex flex-row flex-nowrap items-start justify-between gap-4">
              <div>
                <p className={TEXT} style={{ fontWeight: 500 }}>
                  {storeLabel(s)}
                </p>
                <p
                  className={`${TEXT} font-mono`}
                  style={{ ...muted, color: 'var(--color-text-disabled)' }}
                >
                  {orderLabel(s)}
                </p>
              </div>
              <StatusBadges s={s} />
            </div>
            <p className={`${TEXT} mb-1`} style={muted}>
              {toDateStr(s.settledAt)}
            </p>
            <div className={`${GROUP} flex-wrap justify-between gap-2.5`}>
              <p className={TEXT} style={muted}>
                거래 {toKRW(s.totalAmount)}
              </p>
              <p className={TEXT} style={muted}>
                수수료 {toKRW(s.platformFee)}
              </p>
            </div>
            <div className={`${GROUP} mt-2.5 flex-wrap justify-between gap-4`}>
              <p className={TEXT} style={{ fontWeight: 500, color: 'var(--color-primary-dark)' }}>
                지급액 {toKRW(s.netAmount)}
              </p>
              <PayButton s={s} processingId={processingId} onPay={onPay} />
            </div>
          </div>
        ))}
      </div>

      {/* 데스크톱(≥sm): 테이블 */}
      <div
        className={`${PAPER} rounded-[16px] max-[47.99375em]:hidden`}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <table
          style={{ width: '100%', fontSize: 'var(--font-size-sm)', borderCollapse: 'collapse' }}
        >
          <thead
            style={{
              backgroundColor: 'var(--color-surface-muted)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <tr>
              <th style={{ ...thBase, textAlign: 'left' }}>가게</th>
              <th style={{ ...thBase, textAlign: 'left' }}>주문번호</th>
              {/* N10: 정산일시 컬럼(셀러 화면과 동형) */}
              <th style={{ ...thBase, textAlign: 'left' }}>정산일시</th>
              <th style={{ ...thBase, textAlign: 'right' }}>거래금액</th>
              <th style={{ ...thBase, textAlign: 'right' }}>수수료</th>
              <th style={{ ...thBase, textAlign: 'right' }}>지급액</th>
              <th style={{ ...thBase, textAlign: 'left' }}>상태</th>
              <th style={tdBase} />
            </tr>
          </thead>
          <tbody>
            {settlements.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={tdBase}>{storeLabel(s)}</td>
                <td style={{ ...tdBase, color: 'var(--color-text-secondary)' }}>
                  <p className={`${TEXT} font-mono`} style={{ fontSize: 'var(--font-size-sm)' }}>
                    {orderLabel(s)}
                  </p>
                </td>
                <td style={{ ...tdBase, color: 'var(--color-text-secondary)' }}>
                  {toDateStr(s.settledAt)}
                </td>
                <td style={{ ...tdBase, textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                  {toKRW(s.totalAmount)}
                </td>
                <td style={{ ...tdBase, textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                  {toKRW(s.platformFee)}
                </td>
                <td
                  style={{
                    ...tdBase,
                    textAlign: 'right',
                    fontWeight: 500,
                    color: 'var(--color-primary-dark)',
                  }}
                >
                  {toKRW(s.netAmount)}
                </td>
                <td style={tdBase}>
                  <StatusBadges s={s} />
                </td>
                <td style={{ ...tdBase, textAlign: 'right' }}>
                  <PayButton s={s} processingId={processingId} onPay={onPay} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
