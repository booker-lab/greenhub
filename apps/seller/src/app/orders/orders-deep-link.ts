import type { OrderGroup } from './_constants';

// 주문 목록 주소 파라미터 — 홈 "오늘 할 일"·회차 상세 "이 회차 주문"이 같은 규칙으로 링크를 만든다.
//   tab=<상태 탭>   held=1(처리 필요 탭에서 배송 보류만)   round=<회차 id>(그 회차 주문만)

const ORDER_GROUPS: ReadonlySet<string> = new Set<OrderGroup>([
  'ACTION_REQUIRED',
  'WAITING',
  'IN_DELIVERY',
  'DONE',
  'CANCELLED',
]);

const MAX_ROUND_ID_LENGTH = 128;

export interface OrdersDeepLink {
  tab: OrderGroup | null;
  /** 처리 필요 탭에서 배송 보류만 본다. */
  heldOnly: boolean;
  /** 이 회차 주문만 본다. */
  roundId: string | null;
}

export function readOrdersDeepLink(search: string): OrdersDeepLink {
  const params = new URLSearchParams(search);
  const rawTab = params.get('tab');
  const tab = rawTab && ORDER_GROUPS.has(rawTab) ? (rawTab as OrderGroup) : null;
  const rawRoundId = params.get('round')?.trim() ?? '';
  return {
    tab,
    heldOnly: tab === 'ACTION_REQUIRED' && params.get('held') === '1',
    roundId: rawRoundId && rawRoundId.length <= MAX_ROUND_ID_LENGTH ? rawRoundId : null,
  };
}

export function buildOrdersHref(link: {
  tab: OrderGroup;
  heldOnly?: boolean;
  roundId?: string | null;
}): string {
  const params = new URLSearchParams({ tab: link.tab });
  if (link.heldOnly && link.tab === 'ACTION_REQUIRED') params.set('held', '1');
  if (link.roundId) params.set('round', link.roundId);
  return `/orders?${params.toString()}`;
}
