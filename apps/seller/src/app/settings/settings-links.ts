export const SELLER_OPERATION_SETTINGS = [
  {
    label: '정산',
    links: [{ href: '/settlements', label: '정산 관리' }],
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
