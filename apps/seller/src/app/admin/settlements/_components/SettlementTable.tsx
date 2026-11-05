'use client';

import { StatusDot } from '@greenhub/ui/components/status-dot';
import { useState } from 'react';
import type { AdminPayoutAccount, AdminSettlement } from '@/hooks/useAdmin';
import {
  ADMIN_NUM,
  ADMIN_SUB,
  ADMIN_TD,
  ADMIN_TEXT_ACTION,
  ADMIN_TH,
} from '../../_components/adminList';
import { copyText } from '../../invite/_clipboard';
import {
  ADMIN_SETTLEMENT_STATUS_LABEL,
  canPay,
  groupSettlementsByStore,
  HOLD_REASON_LABEL,
  maskAccountNumber,
  orderLabel,
  type SettlementStoreGroup,
  settlementStatusTone,
  toDateOnly,
  toWon,
} from '../_lib';

interface SettlementTableProps {
  settlements: AdminSettlement[];
  loading: boolean;
  processingId: string | null;
  onPay: (id: string) => void;
}

// ② 방향(design-direction.md §5 어드민 "정산", §8 D7, 2026-11-01 "적용 때 정한 것"):
// 지급은 가게별로 묶어 보여 준다(운영자는 가게마다 한 번 이체한다). 묶음 줄에 가게 · 정산 계좌(은행 · 가린 번호 · 예금주 · 복사) ·
// 지급 대기 건수 · 그 거래액 · 수수료 · 지급액(지급 대기 행만, 이체할 돈)을 쓰고, 그 아래 정산 행을 둔다. 지급 완료 기록은 지금처럼 정산 1건 단위다(요청 불변).
// 계좌가 없는 가게는 빨간 "계좌 미등록 · 지급 불가"와 표시만 하는 "계좌 등록 요청"을 둔다(요청 API 없음).
// 태블릿·휴대폰은 거래액·수수료 열 대신 계산식("594,000 − 59,400 (10%)")을 보조 줄로 쓴다.
// 폭 기준 클래스는 Tailwind가 소스 글자로 찾으므로 조합하지 않고 그대로 쓴다.

function feeRateLabel(rows: readonly AdminSettlement[]): string | null {
  const rates = new Set(
    rows.map((row) => row.platformFeeRate).filter((r) => typeof r === 'number'),
  );
  if (rates.size !== 1) return null;
  const [rate] = [...rates] as number[];
  return `${Math.round(rate * 1000) / 10}%`;
}

function formula(total: number, fee: number, rate: string | null): string {
  return `${total.toLocaleString('ko-KR')} − ${fee.toLocaleString('ko-KR')}${rate ? ` (${rate})` : ''}`;
}

function PayoutAccount({ account }: { account: AdminPayoutAccount | null }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  if (!account) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-3">
        <StatusDot tone="problem" size={13}>
          계좌 미등록 · 지급 불가
        </StatusDot>
        <span className="text-[13px] whitespace-nowrap text-[var(--color-text-secondary)]">
          계좌 등록 요청 필요
        </span>
      </span>
    );
  }
  const copy = async () => {
    const result = await copyText(account.accountNumber);
    setCopied(result === 'failed' ? 'failed' : 'done');
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-[13px] leading-[18px] text-[var(--color-text-secondary)]">
      <span className="whitespace-nowrap">{account.bankName}</span>
      <span className="whitespace-nowrap tabular-nums">
        {maskAccountNumber(account.accountNumber)}
      </span>
      <span className="whitespace-nowrap">예금주 {account.accountHolder}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`${account.bankName} 계좌번호 전체 복사`}
        className="inline-flex min-h-8 cursor-pointer items-center border-0 bg-transparent px-1 text-[13px] font-bold text-foreground underline underline-offset-4"
      >
        {copied === 'done' ? '복사됨' : copied === 'failed' ? '복사 실패' : '복사'}
      </button>
    </span>
  );
}

function RowStatus({ s, size = 15 }: { s: AdminSettlement; size?: 13 | 15 }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <StatusDot tone={settlementStatusTone(s.status)} size={size}>
        {ADMIN_SETTLEMENT_STATUS_LABEL[s.status] ?? s.status}
      </StatusDot>
      {s.recoveryRequired && (
        <StatusDot tone="problem" size={size}>
          회수 필요 {toWon(s.recoveryAmount ?? s.netAmount)}
        </StatusDot>
      )}
      {s.holdReason && (
        <StatusDot size={size}>{HOLD_REASON_LABEL[s.holdReason] ?? s.holdReason}</StatusDot>
      )}
    </span>
  );
}

/** 지급 완료 기록 — 지급 대기(confirmed)이고 보류·계좌 없음이 아닐 때만 글자 버튼. 기록은 돈을 보내지 않는다. */
function PayAction({
  s,
  processingId,
  onPay,
}: {
  s: AdminSettlement;
  processingId: string | null;
  onPay: (id: string) => void;
}) {
  if (!canPay(s)) return null;
  if (processingId === s.id) {
    return (
      <span className="text-[13px] whitespace-nowrap text-[var(--color-text-secondary)]">
        처리 중…
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onPay(s.id)}
      disabled={processingId !== null}
      aria-label={`주문 ${orderLabel(s)} 지급 완료 기록`}
      className={ADMIN_TEXT_ACTION}
    >
      지급 완료 기록…
    </button>
  );
}

/** 묶음 줄의 건수 — 이체할 지급 대기 건수와 불러온 전체 건수. */
function groupCountLabel(group: SettlementStoreGroup): string {
  return group.payableCount > 0
    ? `지급 대기 ${group.payableCount}건 · 전체 ${group.rows.length}건`
    : `지급 대기 없음 · 전체 ${group.rows.length}건`;
}

function payableRows(group: SettlementStoreGroup) {
  return group.rows.filter((row) => row.status === 'confirmed');
}

function EmptyValue() {
  return <span className="font-normal text-[var(--color-text-secondary)]">–</span>;
}

function GroupRow({ group }: { group: SettlementStoreGroup }) {
  const rate = feeRateLabel(payableRows(group));
  const has = group.payableCount > 0;
  return (
    <tr>
      <td className={`${ADMIN_TD} pt-5 [word-break:keep-all]`} colSpan={2}>
        <p className="m-0 font-bold">
          {group.storeName}
          <span className="ml-2 text-[13px] font-normal text-[var(--color-text-secondary)]">
            {groupCountLabel(group)}
          </span>
        </p>
        <PayoutAccount account={group.payoutAccount} />
        {has && (
          <p className={`${ADMIN_SUB} tabular-nums min-[1101px]:hidden`}>
            {formula(group.totalAmount, group.platformFee, rate)}
          </p>
        )}
      </td>
      <td className={`${ADMIN_TD} pt-5 ${ADMIN_NUM} max-[1100px]:hidden`}>
        {has ? toWon(group.totalAmount) : <EmptyValue />}
      </td>
      <td className={`${ADMIN_TD} pt-5 ${ADMIN_NUM} max-[1100px]:hidden`}>
        {has ? toWon(group.platformFee) : <EmptyValue />}
        {has && rate && (
          <span className="block text-[13px] text-[var(--color-text-secondary)]">{rate}</span>
        )}
      </td>
      <td className={`${ADMIN_TD} pt-5 ${ADMIN_NUM} font-bold`}>
        {has ? toWon(group.netAmount) : <EmptyValue />}
      </td>
      <td className={`${ADMIN_TD} pt-5`} />
    </tr>
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
      <p className="m-0 py-20 text-center text-[15px] text-[var(--color-text-secondary)]">
        불러오는 중...
      </p>
    );
  }

  if (settlements.length === 0) {
    return (
      <p className="m-0 rounded-[8px] border border-rule py-16 text-center text-[15px] text-[var(--color-text-secondary)]">
        정산 내역이 없습니다.
      </p>
    );
  }

  const groups = groupSettlementsByStore(settlements);

  return (
    <>
      {/* 휴대폰(640px 이하): 가게 묶음 머리 + 정산 행(1줄 주문번호·지급액, 2줄 정산일·상태, 3줄 계산식과 동작). */}
      <div className="min-[641px]:hidden">
        {groups.map((group) => {
          const rate = feeRateLabel(payableRows(group));
          const has = group.payableCount > 0;
          return (
            <section key={group.storeId} aria-label={group.storeName} className="mb-4">
              <div className="border-b border-rule pb-2 [word-break:keep-all]">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="m-0 min-w-0 text-[15px] font-bold">{group.storeName}</p>
                  <p className={`m-0 text-[15px] font-bold ${ADMIN_NUM}`}>
                    {has ? toWon(group.netAmount) : <EmptyValue />}
                  </p>
                </div>
                <p className={ADMIN_SUB}>{groupCountLabel(group)}</p>
                <PayoutAccount account={group.payoutAccount} />
                {has && (
                  <p className={`${ADMIN_SUB} tabular-nums`}>
                    {formula(group.totalAmount, group.platformFee, rate)}
                  </p>
                )}
              </div>
              {group.rows.map((s) => (
                <div key={s.id} className="border-b border-rule py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="m-0 text-[15px] whitespace-nowrap tabular-nums">
                      {orderLabel(s)}
                    </p>
                    <p className={`m-0 text-[15px] font-bold ${ADMIN_NUM}`}>{toWon(s.netAmount)}</p>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`${ADMIN_SUB} whitespace-nowrap tabular-nums`}>
                      {toDateOnly(s.settledAt) ?? '–'}
                    </p>
                    <RowStatus s={s} size={13} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`${ADMIN_SUB} tabular-nums`}>
                      {formula(s.totalAmount, s.platformFee, null)}
                    </p>
                    <PayAction s={s} processingId={processingId} onPay={onPay} />
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>

      {/* 태블릿·데스크톱(641px 이상): 가게 묶음 줄 + 정산 행 표. 1100px 이하는 거래액·수수료 열을 계산식 보조 줄로 바꾼다. */}
      <table className="w-full border-collapse max-[640px]:hidden">
        <thead>
          <tr>
            <th className={ADMIN_TH}>가게 · 주문번호</th>
            <th className={ADMIN_TH}>상태 · 정산일</th>
            <th className={`${ADMIN_TH} text-right max-[1100px]:hidden`}>거래액</th>
            <th className={`${ADMIN_TH} text-right max-[1100px]:hidden`}>수수료</th>
            <th className={`${ADMIN_TH} text-right`}>지급액</th>
            <th className={`${ADMIN_TH} w-[140px]`}>
              <span className="sr-only">처리</span>
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.storeId}>
            <GroupRow group={group} />
            {group.rows.map((s) => (
              <tr key={s.id}>
                <td className={`${ADMIN_TD} pl-6`}>
                  <span className="whitespace-nowrap tabular-nums">{orderLabel(s)}</span>
                  <p className={`${ADMIN_SUB} tabular-nums min-[1101px]:hidden`}>
                    {formula(s.totalAmount, s.platformFee, null)}
                  </p>
                </td>
                <td className={ADMIN_TD}>
                  <RowStatus s={s} />
                  <p className={`${ADMIN_SUB} whitespace-nowrap tabular-nums`}>
                    {toDateOnly(s.settledAt) ?? '–'}
                  </p>
                </td>
                <td className={`${ADMIN_TD} ${ADMIN_NUM} max-[1100px]:hidden`}>
                  {toWon(s.totalAmount)}
                </td>
                <td className={`${ADMIN_TD} ${ADMIN_NUM} max-[1100px]:hidden`}>
                  {toWon(s.platformFee)}
                </td>
                <td className={`${ADMIN_TD} ${ADMIN_NUM}`}>{toWon(s.netAmount)}</td>
                <td className={`${ADMIN_TD} py-1 text-right align-middle`}>
                  <PayAction s={s} processingId={processingId} onPay={onPay} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </>
  );
}
