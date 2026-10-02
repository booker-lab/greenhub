// 셀러 앱(어드민 포함) 화면 확인용 고정 데이터.
// 2026-09-28 프론트 PR #314~#320 육안 확인에 쓴 데이터를 옮겼다. 화면을 추가할 때 경로를 여기에 더한다.
const STORE_ID = 'store-visual-0001';

// 겸직(어드민 + 셀러) 계정 — 셀러 화면과 /admin 화면을 한 로그인으로 모두 볼 수 있다.
export const user = {
  id: 'admin-visual-0001',
  email: 'visual-admin@local.test',
  name: '검증 관리자',
  role: 'admin',
  storeId: STORE_ID,
};

// ── 셀러 주문 ──
function sellerOrder(id, orderNumber, extra) {
  return {
    id,
    orderNumber,
    schemaVersion: 1,
    storeId: STORE_ID,
    userId: 'consumer-0001',
    productId: 'product-0001',
    productName: '장미 꽃다발',
    quantity: 1,
    saleType: 'normal',
    status: 'ACCEPTED',
    deliveryMethod: 'direct',
    deliveryFee: 3000,
    deliveryAddress: {
      address: '서울시 강남구 테헤란로 1',
      addressDetail: '101호',
      zipCode: '06000',
    },
    isMetropolitan: true,
    hubId: null,
    pickupCode: null,
    totalAmount: 33000,
    requestedDeliveryDate: '2026-09-29',
    preparedAt: null,
    cancelReason: null,
    groupBuyConsent: null,
    createdAt: '2026-09-28T01:00:00.000Z',
    updatedAt: '2026-09-28T01:00:00.000Z',
    ...extra,
  };
}
const SELLER_ORDERS = [
  sellerOrder('order-with-contact', '20260928-000101', {
    buyerName: '김그린',
    deliveryPhone: '010-1234-5678',
  }),
  sellerOrder('order-no-contact', '20260928-000102', { buyerName: null, deliveryPhone: null }),
];

// ── 셀러 정산 ──
const SELLER_SETTLEMENTS = [
  {
    id: 'settle-0001',
    orderId: 'order-settle-0001-abcdef',
    totalAmount: 33000,
    platformFee: 3300,
    netAmount: 29700,
    status: 'paid',
    settledAt: '2026-09-27T15:00:00.000Z',
  },
];

// ── 어드민 주문: 회차(R-)·일반(L-) 주문을 상태별로 한 건씩 ──
function adminOrder(num, status, round) {
  return {
    id: `admin-order-${num}`,
    orderNumber: num,
    storeId: STORE_ID,
    userId: 'consumer-0001',
    status,
    totalAmount: 30000,
    deliveryMethod: 'direct',
    createdAt: '2026-09-28T01:00:00.000Z',
    ...(round ? { schemaVersion: 2, roundId: 'round-0001' } : { schemaVersion: 1, roundId: null }),
  };
}
const ADMIN_ORDERS = [
  adminOrder('R-PENDING', 'PENDING', true),
  adminOrder('R-HELD', 'DELIVERY_HELD', true),
  adminOrder('R-ACCEPTED', 'ACCEPTED', true),
  adminOrder('R-DELIVERING', 'DELIVERING', true),
  adminOrder('R-CANCELLED', 'CANCELLED', true),
  adminOrder('L-RECRUITING', 'RECRUITING', false),
  adminOrder('L-ACCEPTED', 'ACCEPTED', false),
  adminOrder('L-CONFIRMED', 'CONFIRMED', false),
  adminOrder('L-PREPARING', 'PREPARING', false),
  adminOrder('L-DELIVERING', 'DELIVERING', false),
  adminOrder('L-DELIVERED', 'DELIVERED', false),
  adminOrder('L-CANCELLED', 'CANCELLED', false),
];

const ADMIN_SETTLEMENTS = [
  {
    id: 'admin-settle-0001',
    storeId: STORE_ID,
    orderId: 'order-settle-0001-abcdef',
    totalAmount: 33000,
    platformFee: 3300,
    netAmount: 29700,
    status: 'confirmed',
    settledAt: '2026-09-27T15:00:00.000Z',
    confirmedAt: '2026-09-27T15:00:00.000Z',
    paidAt: null,
  },
];

const ADMIN_USERS = [
  {
    id: 'consumer-with-info-0001',
    email: 'green.kim@example.test',
    name: '김그린',
    phone: '010-1234-5678',
    suspended: false,
    createdAt: '2026-09-27T15:00:00.000Z',
  },
  { id: 'consumer-empty-0002', email: 'no.info@example.test', name: '정보없음', suspended: false },
];

const ADMIN_INVITES = [
  {
    token: 'VALID001',
    createdBy: user.id,
    usedAt: null,
    usedBy: null,
    expiresAt: '2026-12-31T00:00:00.000Z',
    createdAt: '2026-09-28T00:00:00.000Z',
  },
  {
    token: 'USED0002',
    createdBy: user.id,
    usedAt: '2026-09-20T00:00:00.000Z',
    usedBy: 'seller-0002',
    expiresAt: '2026-12-31T00:00:00.000Z',
    createdAt: '2026-09-19T00:00:00.000Z',
  },
  {
    token: 'EXPIRED3',
    createdBy: user.id,
    usedAt: null,
    usedBy: null,
    expiresAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2025-12-25T00:00:00.000Z',
  },
];

// ── 회차: 예정·진행·마감·임시저장 한 건씩. 일정은 파일럿 첫 회차(목 10:00 오픈 → 일 24:00 마감) 형태 ──
function saleRound(id, name, status, schedule, counters = {}) {
  return {
    id,
    storeId: STORE_ID,
    name,
    status,
    closeReason: status === 'CLOSED' ? 'SCHEDULE_ENDED' : null,
    cancellation: null,
    schedule: { ...schedule, timezone: 'Asia/Seoul' },
    deliveryRegion: {
      id: 'icheon',
      label: '이천시',
      province: '경기도',
      city: '이천시',
      enabled: true,
    },
    limits: { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
      ...counters,
    },
    carrotLandingUrl: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: '2026-09-28T15:00:00.000Z',
    updatedAt: '2026-09-28T15:00:00.000Z',
  };
}
const SALE_ROUNDS = [
  saleRound('round-scheduled', '11월 3일 배송 회차', 'SCHEDULED', {
    orderOpenAt: '2026-10-29T01:00:00.000Z',
    orderCloseAt: '2026-11-01T15:00:00.000Z',
    auctionAt: '2026-11-01T22:00:00.000Z',
    deliveryStartAt: '2026-11-02T15:00:00.000Z',
    deliveryEndAt: '2026-11-03T00:00:00.000Z',
  }),
  saleRound(
    'round-open',
    '10월 6일 배송 회차',
    'OPEN',
    {
      orderOpenAt: '2026-10-01T01:00:00.000Z',
      orderCloseAt: '2026-10-04T15:00:00.000Z',
      auctionAt: '2026-10-04T22:00:00.000Z',
      deliveryStartAt: '2026-10-05T15:00:00.000Z',
      deliveryEndAt: '2026-10-06T00:00:00.000Z',
    },
    {
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: 2,
      orderedDeliveryAddresses: 6,
      orderedItemQuantity: 11,
      heldOrderCount: 1,
    },
  ),
  saleRound(
    'round-closed',
    '9월 29일 배송 회차',
    'CLOSED',
    {
      orderOpenAt: '2026-09-24T01:00:00.000Z',
      orderCloseAt: '2026-09-27T15:00:00.000Z',
      auctionAt: '2026-09-27T22:00:00.000Z',
      deliveryStartAt: '2026-09-28T15:00:00.000Z',
      deliveryEndAt: '2026-09-29T00:00:00.000Z',
    },
    { orderedDeliveryAddresses: 15, orderedItemQuantity: 27 },
  ),
  saleRound('round-draft', '11월 10일 배송 회차(작성 중)', 'DRAFT', {
    orderOpenAt: '2026-11-05T01:00:00.000Z',
    orderCloseAt: '2026-11-08T15:00:00.000Z',
    auctionAt: '2026-11-08T22:00:00.000Z',
    deliveryStartAt: '2026-11-09T15:00:00.000Z',
    deliveryEndAt: '2026-11-10T00:00:00.000Z',
  }),
];
function roundItems(round) {
  return [
    ['빅립', 30000, 10, 4],
    ['만천홍', 25000, 10, 5],
    ['v3', 45000, 10, 2],
  ].map(([name, price, limit, ordered], i) => ({
    id: `${round.id}-item-${i + 1}`,
    roundId: round.id,
    storeId: STORE_ID,
    productId: `product-${i + 1}`,
    productNameSnapshot: `동양란 ${name}`,
    productImageUrlSnapshot: null,
    roundPrice: price,
    saleLimitQuantity: limit,
    reservedQuantity: 0,
    orderedQuantity: round.status === 'OPEN' ? ordered : 0,
    displayOrder: i,
    status: 'ACTIVE',
    createdAt: round.createdAt,
    updatedAt: round.updatedAt,
  }));
}

// ── 어드민 기사·배너 ──
const ADMIN_DRIVERS = [
  {
    id: 'driver-approved-0001',
    name: '박배송',
    email: 'driver.park@example.test',
    driverApproved: true,
    suspended: false,
    createdAt: '2026-09-20T01:00:00.000Z',
  },
  {
    id: 'driver-pending-0002',
    name: '이대기',
    email: null,
    driverApproved: false,
    suspended: false,
    createdAt: '2026-09-27T01:00:00.000Z',
  },
  {
    id: 'driver-suspended-0003',
    name: '최정지',
    email: 'driver.choi@example.test',
    driverApproved: true,
    suspended: true,
    createdAt: '2026-09-10T01:00:00.000Z',
  },
];
const ADMIN_STORES = [
  {
    id: STORE_ID,
    name: '디어 오키드',
    ownerId: user.id,
    status: 'active',
    commissionRate: 0.1,
    createdAt: '2026-08-01T01:00:00.000Z',
  },
  {
    id: 'store-pending-0002',
    name: '새싹 농원',
    ownerId: 'seller-0002',
    status: 'invited',
    createdAt: '2026-09-25T01:00:00.000Z',
  },
  {
    id: 'store-archived-0003',
    name: '정리된 가게',
    ownerId: 'seller-0003',
    status: 'archived',
    createdAt: '2026-07-01T01:00:00.000Z',
  },
];
const ADMIN_BANNER = {
  tagText: '이번 주 회차',
  headline: '경매에서 막 나온 동양란',
  subText: '목요일 10시 주문 시작 · 화요일 아침 배송',
  cta1: { label: '회차 보기', href: '/' },
  isActive: true,
};

const byStatus = (items, url) => {
  const st = url.searchParams.get('status');
  return items.filter((x) => !st || x.status === st);
};

/** [메서드, 경로 정규식, 처리 함수] — 첫 일치가 응답한다. 처리 함수는 { status?, body, delay? }를 돌려준다. */
export const routes = [
  ['GET', /^\/stores\/[^/]+\/orders$/, () => ({ body: SELLER_ORDERS })],
  [
    'GET',
    /^\/stores\/[^/]+\/orders\/([^/]+)$/,
    ({ params: [id] }) => {
      const o = SELLER_ORDERS.find((x) => x.id === id);
      return o ? { body: o } : { status: 404, body: { message: '주문 없음' } };
    },
  ],
  ['GET', /^\/stores\/[^/]+\/operation-issues$/, () => ({ body: { items: [] } })],
  [
    'GET',
    /^\/stores\/[^/]+\/settlements\/summary$/,
    ({ url }) => ({
      body: {
        date: url.searchParams.get('date') ?? '2026-09-28',
        count: 1,
        totalAmount: 33000,
        totalPlatformFee: 3300,
        totalNetAmount: 29700,
        byStatus: { pending: 0, confirmed: 0, paid: 1, cancelled: 0 },
      },
    }),
  ],
  [
    'GET',
    /^\/stores\/[^/]+\/settlements$/,
    ({ url }) => ({ body: { settlements: byStatus(SELLER_SETTLEMENTS, url) } }),
  ],
  ['GET', /^\/admin\/orders$/, ({ url }) => ({ body: { orders: byStatus(ADMIN_ORDERS, url) } })],
  ['GET', /^\/admin\/settlements$/, () => ({ body: { settlements: ADMIN_SETTLEMENTS } })],
  // 새로고침 시 '불러오는 중...'을 볼 수 있게 약간 늦춘다.
  ['GET', /^\/admin\/users$/, () => ({ body: { users: ADMIN_USERS }, delay: 700 })],
  ['GET', /^\/admin\/invite$/, () => ({ body: ADMIN_INVITES })],
  ['GET', /^\/admin\/stores$/, () => ({ body: { stores: ADMIN_STORES } })],
  ['GET', /^\/stores\/[^/]+\/sale-rounds$/, () => ({ body: { items: SALE_ROUNDS } })],
  [
    'GET',
    /^\/stores\/[^/]+\/sale-rounds\/([^/]+)$/,
    ({ params: [id] }) => {
      const round = SALE_ROUNDS.find((r) => r.id === id);
      return round
        ? { body: { ...round, items: roundItems(round) } }
        : { status: 404, body: { message: '회차 없음' } };
    },
  ],
  ['GET', /^\/admin\/drivers$/, () => ({ body: { drivers: ADMIN_DRIVERS } })],
  ['GET', /^\/admin\/banner$/, () => ({ body: ADMIN_BANNER })],
];

/**
 * 자동 캡처 대상 화면. id는 파일 이름, group은 보고서 묶음이다.
 * auth: false면 로그인 없이 연다. 회차·상품 같은 fixture가 없는 화면은 빈 상태나 오류로 찍히고,
 * 캡처 기록(missing)에 빠진 API 경로가 남는다.
 */
export const screens = [
  { id: 'login', group: '판매자', title: '로그인', path: '/login', auth: false },
  { id: 'orders', group: '판매자', title: '주문 목록', path: '/orders' },
  {
    id: 'order-contact',
    group: '판매자',
    title: '주문 상세 · 손님 정보 있음',
    path: '/orders/order-with-contact',
  },
  {
    id: 'order-no-contact',
    group: '판매자',
    title: '주문 상세 · 손님 정보 없음',
    path: '/orders/order-no-contact',
  },
  { id: 'prep', group: '판매자', title: '준비', path: '/prep' },
  { id: 'sale-rounds', group: '판매자', title: '회차 목록', path: '/sale-rounds' },
  {
    id: 'sale-round-open',
    group: '판매자',
    title: '회차 상세 · 진행 중',
    path: '/sale-rounds/round-open',
  },
  {
    id: 'sale-round-scheduled',
    group: '판매자',
    title: '회차 상세 · 예정',
    path: '/sale-rounds/round-scheduled',
  },
  { id: 'sale-round-new', group: '판매자', title: '새 회차', path: '/sale-rounds/new' },
  { id: 'products', group: '판매자', title: '상품 목록', path: '/products' },
  { id: 'settlements', group: '판매자', title: '정산', path: '/settlements' },
  { id: 'settings', group: '판매자', title: '설정', path: '/settings' },
  { id: 'admin-orders', group: '어드민', title: '주문', path: '/admin/orders' },
  { id: 'admin-settlements', group: '어드민', title: '정산', path: '/admin/settlements' },
  { id: 'admin-users', group: '어드민', title: '소비자', path: '/admin/users' },
  { id: 'admin-invite', group: '어드민', title: '초대', path: '/admin/invite' },
  { id: 'admin-stores', group: '어드민', title: '판매자', path: '/admin/stores' },
  { id: 'admin-drivers', group: '어드민', title: '기사', path: '/admin/drivers' },
  { id: 'admin-banner', group: '어드민', title: '배너', path: '/admin/banner' },
];
