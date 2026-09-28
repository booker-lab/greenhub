import type { Settlement, SettlementStatus } from './_constants';
import { STATUS_LABEL } from './_constants';

export function toKRW(n: number) {
  return `₩${n.toLocaleString('ko-KR')}`;
}

// 브라우저 시간대와 무관하게 항상 KST(Asia/Seoul)로 표시한다.
const SETTLED_AT_FORMAT_KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 정산일시 표기 — settledAt 직렬화 형태가 호출 경로마다 다름(#CL-46 후속).
 * API는 TimestampInterceptor로 ISO 문자열을 보내지만, Firestore Timestamp 직렬화 객체
 * (`{ _seconds }`)가 올 수도 있어 양쪽 모두 방어적으로 파싱한다. 파싱 불가면 '-'.
 */
function parseSettledAt(value: unknown): Date | null {
  let date: Date | null = null;
  if (typeof value === 'string') {
    date = new Date(value);
  } else if (typeof value === 'number') {
    date = new Date(value * 1000);
  } else if (value && typeof value === 'object' && '_seconds' in value) {
    date = new Date((value as { _seconds: number })._seconds * 1000);
  }
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function toDateStr(value: unknown): string {
  const date = parseSettledAt(value);
  return date ? SETTLED_AT_FORMAT_KST.format(date) : '-';
}

/**
 * CSV용 정산일시 — KST 오프셋을 붙인 ISO 8601(`2026-09-28T00:00:00+09:00`).
 * UTC(`Z`) 문자열은 KST 자정 전후 정산이 전날 날짜로 읽히므로 쓰지 않는다. 파싱 불가면 빈 문자열.
 */
export function toKSTISO(value: unknown): string {
  const date = parseSettledAt(value);
  if (!date) return '';
  return `${new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;
}

export function downloadCSV(items: Settlement[], from: string, to: string) {
  const header = '주문ID,정산일시,총금액,플랫폼수수료,정산액,상태';
  const rows = items.map((s: Settlement) =>
    [
      s.orderId,
      toKSTISO(s.settledAt),
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
