import type { FeatureKey, SalesMode } from '@greenhub/shared';

export const SELLER_OPERATION_SETTINGS = [
  {
    label: '정산',
    links: [
      { href: '/settlements', label: '정산 관리' },
      { href: '/settings/payout-account', label: '정산 계좌' },
    ],
  },
  {
    label: '배송',
    links: [
      { href: '/settings/delivery', label: '배송비 설정 / 기상 제한' },
      { href: '/settings/daily-caps', label: '배송 슬롯 (Daily Cap)' },
    ],
  },
  {
    label: '거점',
    links: [{ href: '/hubs', label: '거점 관리' }],
  },
] as const;

/** 예전 판매 방식(legacy) 주문에만 쓰이는 메뉴 — 회차 주문은 배송비 0원이고 배송 슬롯·거점을 보지 않는다. */
const LEGACY_ONLY_SECTIONS = new Set(['배송', '거점']);

/**
 * 가게 판매 방식에 맞는 운영 메뉴. 회차 판매(round_direct) 가게에는 적용되지 않는 메뉴를 숨긴다.
 * 판매 방식을 아직 모르면(조회 중) 운영 메뉴 중 공통인 것만 보여 깜빡임 없이 숨긴 상태로 시작하고,
 * 조회에 실패하면(null 대신 'legacy'로 넘겨) 접근을 막지 않도록 전부 보여 준다.
 */
export function operationSettingsFor(salesMode: SalesMode | undefined) {
  if (salesMode === 'legacy') return SELLER_OPERATION_SETTINGS;
  return SELLER_OPERATION_SETTINGS.filter((section) => !LEGACY_ONLY_SECTIONS.has(section.label));
}

/** 팔도감 벤치마킹 비교 기능 메뉴. 켜진 기능의 메뉴만 보여 준다(운영 기본값은 모두 꺼짐). */
const BENCHMARK_LINKS: ReadonlyArray<{ href: string; label: string; features: FeatureKey[] }> = [
  {
    href: '/settings/store-profile',
    label: '가게 소개·품질 보장',
    features: ['seller-store', 'quality-guarantee', 'demand-signals'],
  },
  {
    href: '/reactions',
    label: '고객 반응 (후기·알림 신청·찾는 상품)',
    features: ['reviews', 'restock-alert', 'product-request'],
  },
];

export function benchmarkSettingsLinks(isOn: (key: FeatureKey) => boolean) {
  return BENCHMARK_LINKS.filter((link) => link.features.some(isOn)).map(({ href, label }) => ({
    href,
    label,
  }));
}
