// 어드민 정산 화면 공용 유틸 (F-2/S5).
import type { AdminSettlement } from '@/hooks/useAdmin';

/**
 * 정산일시 표기 포매터 — 브라우저 시간대와 무관하게 항상 KST(Asia/Seoul)로 표시.
 * shared `toDateStrKST`는 YYYY-MM-DD만 지원하므로 시·분 표시는 timeZone 지정으로 해결.
 */
const SETTLED_AT_FORMAT_KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * 정산일시 표기 — settledAt 직렬화 형태가 호출 경로마다 다름(#CL-46).
 * API TimestampInterceptor는 ISO 문자열, Firestore raw 직렬화는 `{ _seconds }`.
 * 양쪽 모두 방어적으로 파싱하고, 불가하면 '-'.
 */
export function toDateStr(ts: unknown): string {
  let date: Date | null = null;
  if (typeof ts === 'string') {
    const d = new Date(ts);
    date = Number.isNaN(d.getTime()) ? null : d;
  } else if (ts && typeof ts === 'object' && '_seconds' in ts) {
    date = new Date((ts as { _seconds: number })._seconds * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return '-';
  return SETTLED_AT_FORMAT_KST.format(date);
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
