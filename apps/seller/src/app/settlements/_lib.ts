import type { Settlement, SettlementStatus } from './_constants';
import { STATUS_LABEL } from './_constants';

export function toKRW(n: number) {
  return `₩${n.toLocaleString('ko-KR')}`;
}

/**
 * 정산일시 표기 — settledAt 직렬화 형태가 호출 경로마다 다름(#CL-46 후속).
 * API는 TimestampInterceptor로 ISO 문자열을 보내지만, Firestore Timestamp 직렬화 객체
 * (`{ _seconds }`)가 올 수도 있어 양쪽 모두 방어적으로 파싱한다. 파싱 불가면 '-'.
 */
export function toDateStr(value: unknown): string {
  let date: Date | null = null;
  if (typeof value === 'string') {
    const d = new Date(value);
    date = Number.isNaN(d.getTime()) ? null : d;
  } else if (typeof value === 'number') {
    date = new Date(value * 1000);
  } else if (value && typeof value === 'object' && '_seconds' in value) {
    date = new Date((value as { _seconds: number })._seconds * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** settledAt(ISO 문자열 | { _seconds } | number) → ISO 문자열. 파싱 불가면 빈 문자열. */
function toISO(value: unknown): string {
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  if (value && typeof value === 'object' && '_seconds' in value) {
    return new Date((value as { _seconds: number })._seconds * 1000).toISOString();
  }
  return '';
}

export function downloadCSV(items: Settlement[], from: string, to: string) {
  const header = '주문ID,정산일시,총금액,플랫폼수수료,정산액,상태';
  const rows = items.map((s: Settlement) =>
    [
      s.orderId,
      toISO(s.settledAt),
      s.totalAmount,
      s.platformFee,
      s.netAmount,
      STATUS_LABEL[s.status as SettlementStatus],
    ].join(','),
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `settlements_${from || 'all'}_${to || 'all'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
