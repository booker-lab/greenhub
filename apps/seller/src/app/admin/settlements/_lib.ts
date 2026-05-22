// 어드민 정산 화면 공용 유틸 (F-2/S5).
import type { AdminSettlement } from '@/hooks/useAdmin';

/** Firestore Timestamp 직렬화 형태(`{ _seconds }`) → 'M월 D일 HH:mm' KST 표기. */
export function toDateStr(ts: unknown): string {
  const seconds =
    ts && typeof ts === 'object' && '_seconds' in ts
      ? (ts as { _seconds: number })._seconds
      : null;
  if (seconds === null) return '-';
  return new Date(seconds * 1000).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toKRW(n: number): string {
  return `₩${n.toLocaleString('ko-KR')}`;
}

/**
 * N11(F-2): 지급 합계는 confirmed + paid 정산만 합산.
 * pending(미확정)·cancelled(취소)는 실제 지급 대상이 아니므로 제외 — 과대 표시 방지.
 */
export function sumPayable(settlements: AdminSettlement[]) {
  return settlements
    .filter((s) => s.status === 'confirmed' || s.status === 'paid')
    .reduce(
      (acc, s) => {
        acc.totalFee += s.platformFee;
        acc.totalNet += s.netAmount;
        return acc;
      },
      { totalFee: 0, totalNet: 0 },
    );
}
