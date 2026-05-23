import { type OrderStatus, todayKST, toDateStrKST } from '@greenhub/shared';

export function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && 'toDate' in v) return (v as { toDate(): Date }).toDate();
  return new Date(v as string);
}

export function formatDeadlineCountdown(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return '마감됨';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `마감까지 ${days}일`;
  return `마감까지 ${hours}시간`;
}

export function makePreparedAtOptions(): { label: string; iso: string }[] {
  const today = todayKST();
  const tomorrow = toDateStrKST(new Date(Date.now() + 86400000));
  return [
    { label: '오늘 오후 2시', iso: `${today}T05:00:00.000Z` },
    { label: '오늘 오후 4시', iso: `${today}T07:00:00.000Z` },
    { label: '내일 오전 9시', iso: `${tomorrow}T00:00:00.000Z` },
  ];
}

export const READONLY_STATUSES: OrderStatus[] = [
  'DELIVERING',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'REVIEWED',
  'CANCELLED',
];

export const CANCELLABLE_STATUSES: OrderStatus[] = ['ACCEPTED', 'CONFIRMED', 'PREPARING'];
