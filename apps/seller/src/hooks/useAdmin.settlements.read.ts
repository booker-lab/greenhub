/**
 * 관리자 정산 목록·합계 응답 읽기 — 순수 함수(vitest에서 `@/` alias 없이 검증).
 * 목록은 "더 보기"로 이어 받고(hasMore·nextCursor), 합계는 같은 조건 전체를 서버가 계산한다.
 */
import type { AdminSettlement, AdminSettlementsSummary } from './useAdmin.types';

/** 한 번에 받는 정산 건수(서버 기본값과 같다). */
export const ADMIN_SETTLEMENT_PAGE_SIZE = 100;

export interface AdminSettlementPage {
  settlements: AdminSettlement[];
  hasMore: boolean;
  nextCursor: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** 페이지 응답. hasMore·nextCursor가 없는 옛 응답은 이번 응답이 전부인 것으로 본다. */
export function readAdminSettlementPage(body: unknown): AdminSettlementPage {
  const data = record(body);
  const settlements = Array.isArray(data.settlements) ? (data.settlements as AdminSettlement[]) : [];
  const nextCursor = typeof data.nextCursor === 'string' ? data.nextCursor : null;
  return { settlements, hasMore: data.hasMore === true && nextCursor !== null, nextCursor };
}

export function readAdminSettlementsSummary(body: unknown): AdminSettlementsSummary {
  const data = record(body);
  const payable = record(data.payable);
  const paid = record(data.paid);
  const recovery = record(data.recovery);
  return {
    count: num(data.count),
    payable: { count: num(payable.count), netAmount: num(payable.netAmount) },
    paid: { count: num(paid.count), netAmount: num(paid.netAmount) },
    platformFee: num(data.platformFee),
    recovery: { count: num(recovery.count), amount: num(recovery.amount) },
    truncated: data.truncated === true,
  };
}

/** 더 불러온 행을 붙인다. 지급 처리 등으로 첫 페이지가 바뀌어 같은 정산이 겹치면 한 번만 둔다. */
export function appendSettlements(
  current: AdminSettlement[],
  more: AdminSettlement[],
): AdminSettlement[] {
  const seen = new Set(current.map((s) => s.id));
  return [...current, ...more.filter((s) => !seen.has(s.id))];
}
