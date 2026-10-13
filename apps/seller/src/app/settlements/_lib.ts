import type {
  Settlement,
  SettlementListQuery,
  SettlementListResponse,
  SettlementPage,
  SettlementStatus,
} from './_constants';
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

/** CSV 칸: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고, 수식으로 해석될 첫 글자는 막는다. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text) && typeof value === 'string') text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildSettlementCsv(items: Settlement[]): string {
  const header = ['주문ID', '정산일시', '총금액', '플랫폼수수료', '정산액', '상태', '주문번호'];
  const rows = items.map((s: Settlement) =>
    [
      s.orderId,
      toKSTISO(s.settledAt),
      s.totalAmount,
      s.platformFee,
      s.netAmount,
      STATUS_LABEL[s.status as SettlementStatus],
      s.orderNumber ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

export function downloadCSV(items: Settlement[], from: string, to: string) {
  const csv = buildSettlementCsv(items);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `settlements_${from || 'all'}_${to || 'all'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 정산 목록 요청 경로. limit은 보내지 않고 서버 기본값을 쓴다.
 * 이전 API는 모르는 쿼리를 400으로 거절하므로 cursor도 서버가 nextCursor를 준 뒤에만 붙인다.
 */
export function settlementListPath(
  storeId: string,
  query: SettlementListQuery,
  cursor?: string | null,
): string {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.status) params.set('status', query.status);
  if (cursor) params.set('cursor', cursor);
  return `/stores/${encodeURIComponent(storeId)}/settlements?${params.toString()}`;
}

/** 응답을 한 페이지로 읽는다. hasMore·nextCursor가 없는 이전 API 응답은 마지막 페이지로 본다. */
export function readSettlementPage(
  data: SettlementListResponse | null | undefined,
): SettlementPage {
  const list = data?.settlements;
  const cursor = data?.nextCursor;
  const nextCursor =
    data?.hasMore === true && typeof cursor === 'string' && cursor !== '' ? cursor : null;
  return {
    settlements: Array.isArray(list) ? list : [],
    hasMore: nextCursor !== null,
    nextCursor,
  };
}

/** 더 보기로 받은 페이지를 뒤에 붙인다. 이미 있는 정산 id는 다시 넣지 않는다. */
export function appendSettlementPage(current: Settlement[], next: Settlement[]): Settlement[] {
  const seen = new Set(current.map((s) => s.id));
  return [...current, ...next.filter((s) => !seen.has(s.id))];
}
