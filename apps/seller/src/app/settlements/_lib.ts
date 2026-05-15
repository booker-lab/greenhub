import type { Settlement, SettlementStatus } from './_constants';
import { STATUS_LABEL } from './_constants';

export function toKRW(n: number) {
  return `₩${n.toLocaleString('ko-KR')}`;
}

export function toDateStr(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function downloadCSV(items: Settlement[], from: string, to: string) {
  const header = '주문ID,정산일시,총금액,플랫폼수수료,정산액,상태';
  const rows = items.map((s: Settlement) =>
    [
      s.orderId,
      new Date(s.settledAt._seconds * 1000).toISOString(),
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
