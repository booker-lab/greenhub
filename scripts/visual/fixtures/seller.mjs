// 셀러 앱(어드민 포함) 화면 확인용 고정 데이터.
// 2026-09-28 프론트 PR #314~#320 육안 확인에 쓴 데이터를 옮겼다. 화면을 추가할 때 경로를 여기에 더한다.
import { hoursFromNow } from '../clock.mjs';

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
// 상세 주소로만 여는 주문(목록·회차 건수에는 넣지 않는다). 배송 보류 모달처럼 특정 상태가 필요한 화면용.
const DETAIL_ONLY_ORDERS = [
  roundOrder('order-round-preparing', '20261001-000009', 'PREPARING', [['빅립', 43000, 1]]),
];
const SELLER_ORDERS = [
  sellerOrder('order-with-contact', '20260928-000101', {
    buyerName: '김그린',
    deliveryPhone: '010-1234-5678',
  }),
  sellerOrder('order-no-contact', '20260928-000102', { buyerName: null, deliveryPhone: null }),
  // 판매 중 회차(round-open) 주문: 여러 상품 주문·상태별 한 건씩(회차 상세 "이 회차 주문"·상품별 수량 확인용).
  roundOrder('order-round-multi', '20261001-000001', 'ACCEPTED', [
    ['빅립', 30000, 1],
    ['만천홍', 25000, 2],
  ]),
  roundOrder('order-round-single', '20261001-000002', 'ACCEPTED', [['v3', 45000, 1]]),
  // 비교 기능(옵션·축하 토퍼·포장 라벨·선물)이 담긴 회차 주문 — 포장할 때 옵션·라벨 문구와 선물 카드를 봐야 한다.
  roundOrder('order-round-gift', '20261002-000007', 'ACCEPTED', [['빅립', 43000, 1]], {
    orderItems: [
      {
        roundItemId: 'round-open-item-1',
        productId: 'product-1',
        productName: '동양란 빅립',
        productImageUrl: null,
        unitPrice: 43000,
        quantity: 1,
        subtotalAmount: 43000,
        selectedOptions: [
          { groupId: 'g1', groupName: '화분', choiceId: 'c2', choiceLabel: '백자 도자기 화분', priceDelta: 8000 },
          { groupId: 'g2', groupName: '축하 토퍼', choiceId: 'c5', choiceLabel: '祝 生辰', priceDelta: 5000 },
        ],
      },
    ],
    totalAmount: 43000,
    gift: {
      recipientName: '박엄마',
      recipientPhone: '010-2345-6789',
      senderName: '김그린',
      cardMessage: '늘 고마워요. 건강하세요!',
    },
    packageLabel: '김그린',
  }),
  roundOrder('order-round-preparing', '20261001-000003', 'PREPARING', [['빅립', 30000, 2]]),
  roundOrder('order-round-held', '20261001-000004', 'DELIVERY_HELD', [['만천홍', 25000, 1]]),
  roundOrder('order-round-pending', '20261001-000005', 'PENDING', [
    ['빅립', 30000, 1],
    ['만천홍', 25000, 1],
  ]),
];

function roundOrder(id, orderNumber, status, items, extra = {}) {
  const orderItems = items.map(([name, unitPrice, quantity]) => {
    const index = ['빅립', '만천홍', 'v3'].indexOf(name) + 1;
    return {
      roundItemId: `round-open-item-${index}`,
      productId: `product-${index}`,
      productName: `동양란 ${name}`,
      productImageUrl: null,
      unitPrice,
      quantity,
      subtotalAmount: unitPrice * quantity,
    };
  });
  return sellerOrder(id, orderNumber, {
    schemaVersion: 2,
    roundId: 'round-open',
    status,
    buyerName: '이천손님',
    deliveryPhone: '010-2345-6789',
    productId: orderItems[0].productId,
    productName: orderItems[0].productName,
    quantity: orderItems.reduce((sum, item) => sum + item.quantity, 0),
    orderItems,
    deliveryFee: 0,
    totalAmount: orderItems.reduce((sum, item) => sum + item.subtotalAmount, 0),
    deliveryAddress: {
      address: '경기도 이천시 중리천로 1',
      addressDetail: '2층',
      zipCode: '17379',
    },
    isMetropolitan: false,
    requestedDeliveryDate: '2026-10-06',
    createdAt: '2026-10-01T02:00:00.000Z',
    updatedAt: '2026-10-01T02:00:00.000Z',
    ...extra,
  });
}

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
  adminOrder('R-DELIVERED', 'DELIVERED', true),
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
  // 취소된 초대(취소됨 배지)와 받는 사람을 지정한 초대(UI 교체 P2b).
  {
    token: 'REVOKED4',
    createdBy: user.id,
    usedAt: null,
    usedBy: null,
    revokedAt: '2026-09-15T00:00:00.000Z',
    revokedBy: user.id,
    recipientEmail: 'new.seller@example.test',
    expiresAt: '2026-12-31T00:00:00.000Z',
    createdAt: '2026-09-14T00:00:00.000Z',
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
  // 다가오는 회차는 고정 시각(clock.mjs) 기준 상대값이다. 날짜가 지나도 "예정" 화면이 그대로 찍힌다.
  saleRound('round-scheduled', '11월 3일 배송 회차', 'SCHEDULED', {
    orderOpenAt: hoursFromNow(-14),
    orderCloseAt: hoursFromNow(72),
    auctionAt: hoursFromNow(79),
    deliveryStartAt: hoursFromNow(96),
    deliveryEndAt: hoursFromNow(105),
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
    orderOpenAt: hoursFromNow(154),
    orderCloseAt: hoursFromNow(240),
    auctionAt: hoursFromNow(247),
    deliveryStartAt: hoursFromNow(264),
    deliveryEndAt: hoursFromNow(273),
  }),
];
// 상품별 수량은 회차 counters 합계와 맞춘다(판매 중 11개·결제 중 2개, 마감 27개).
const ROUND_ITEM_QUANTITIES = {
  OPEN: { ordered: [4, 5, 2], reserved: [1, 1, 0] },
  CLOSED: { ordered: [10, 10, 7], reserved: [0, 0, 0] },
};
function roundItems(round) {
  const quantities = ROUND_ITEM_QUANTITIES[round.status] ?? {
    ordered: [0, 0, 0],
    reserved: [0, 0, 0],
  };
  return [
    ['빅립', 30000, 10],
    ['만천홍', 25000, 10],
    ['v3', 45000, 10],
  ].map(([name, price, limit], i) => ({
    id: `${round.id}-item-${i + 1}`,
    roundId: round.id,
    storeId: STORE_ID,
    productId: `product-${i + 1}`,
    productNameSnapshot: `동양란 ${name}`,
    productImageUrlSnapshot: null,
    roundPrice: price,
    saleLimitQuantity: limit,
    reservedQuantity: quantities.reserved[i],
    orderedQuantity: quantities.ordered[i],
    displayOrder: i,
    status: 'ACTIVE',
    createdAt: round.createdAt,
    updatedAt: round.updatedAt,
  }));
}

// ── 운영 확인 기록(가게 전체 목록·주문 상세) ──
function operationIssue(id, type, severity, status, orderId, updatedAt) {
  return {
    id,
    storeId: STORE_ID,
    orderId,
    paymentId: orderId,
    type,
    severity,
    status,
    createdAt: updatedAt,
    updatedAt,
    resolvedAt: status === 'OPEN' ? null : updatedAt,
    latestSnapshot: { orderStatus: 'CANCELLED', paymentStatus: 'UNKNOWN' },
    actions: [],
  };
}
const OPERATION_ISSUES = [
  operationIssue(
    'issue-visual-0001',
    'FINALIZATION_REFUND_FAILED',
    'critical',
    'OPEN',
    'order-with-contact',
    '2026-10-06T01:10:00.000Z',
  ),
  operationIssue(
    'issue-visual-0002',
    'CUSTOMER_NOTICE_FAILED',
    'warning',
    'OPEN',
    'order-no-contact',
    '2026-10-06T02:30:00.000Z',
  ),
  operationIssue(
    'issue-visual-0003',
    'AUTO_REFUND_FAILED',
    'warning',
    'RESOLVED',
    'order-with-contact',
    '2026-10-05T09:00:00.000Z',
  ),
];

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
// ── Firestore 에뮬레이터 시드 ──
// 셀러 상품·준비 화면은 브라우저가 Firestore products를 직접 구독한다. start.mjs가 이 값을 에뮬레이터에 넣는다.
// 저장소 firestore.rules가 그대로 적용되므로 읽기 조건(users 문서 role·storeId, stores.ownerId, 토큰 클레임)을 함께 맞춘다.
// 상품 id는 회차 항목(roundItems)의 product-1~3과 같다.
function storeProduct(name, price, extra = {}) {
  return {
    storeId: STORE_ID,
    name,
    images: [],
    price,
    category: 'orchid',
    saleType: 'normal',
    deliverySize: 'medium',
    isActive: true,
    createdAt: '2026-09-01T01:00:00.000Z',
    updatedAt: '2026-09-28T01:00:00.000Z',
    selection: {
      colors: ['핑크'],
      stemType: '외대',
      fragrance: 'light',
      bloomCondition: 'half',
      bundleUnit: '1분',
      careLevel: 'easy',
    },
    ...extra,
  };
}

export const firestoreSeed = {
  users: {
    [user.id]: {
      role: user.role,
      storeId: STORE_ID,
      suspended: false,
      name: user.name,
      email: user.email,
    },
  },
  stores: {
    [STORE_ID]: { ownerId: user.id, name: '디어 오키드' },
  },
  products: {
    // 셀러 주문 fixture(sellerOrder)가 쓰는 예전 일반 판매 상품 — 준비 물량 화면이 상품 이름을 찾는다.
    'product-0001': storeProduct('장미 꽃다발', 30000, {
      category: 'cut_flower',
      createdAt: '2026-08-10T01:00:00.000Z',
    }),
    'product-1': storeProduct('동양란 빅립', 30000, {
      createdAt: '2026-09-03T01:00:00.000Z',
      // 비교 기능 상품 추가 정보(소비자 fixture와 같은 값)
      size: { heightCm: 55, widthCm: 40, potDiameterCm: 15, bloomCount: 12 },
      light: 'medium',
      placements: ['living', 'office'],
      careGuide: {
        watering: '겉흙이 마르면 2주에 한 번, 화분 밑으로 물이 흐를 만큼 줘요.',
        light: '직사광선을 피한 밝은 창가가 좋아요.',
        temperature: '15~25도. 겨울 창가 찬바람을 피해 주세요.',
        repotting: '꽃이 진 뒤 2년에 한 번 바크로 갈아 주세요.',
      },
      options: [
        {
          id: 'g1',
          name: '화분',
          choices: [
            { id: 'c1', label: '기본 플라스틱 화분', priceDelta: 0 },
            { id: 'c2', label: '백자 도자기 화분', priceDelta: 8000 },
          ],
        },
        {
          id: 'g2',
          name: '축하 토퍼',
          choices: [
            { id: 'c3', label: '토퍼 없음', priceDelta: 0 },
            { id: 'c4', label: '祝 開業', priceDelta: 5000 },
            { id: 'c5', label: '祝 生辰', priceDelta: 5000 },
          ],
        },
      ],
      guaranteed: true,
      aliases: ['빅립 동양란', 'Big lip'],
    }),
    'product-2': storeProduct('동양란 만천홍', 25000, {
      createdAt: '2026-09-02T01:00:00.000Z',
    }),
    'product-3': storeProduct('동양란 v3', 45000, {
      createdAt: '2026-09-01T01:00:00.000Z',
    }),
    'product-4': storeProduct('오렌지 글로우', 38000, {
      isActive: false,
      createdAt: '2026-08-20T01:00:00.000Z',
    }),
  },
};

/** Auth 에뮬레이터 커스텀 토큰 클레임 — firestore.rules의 currentRole·currentSellerFor가 읽는다. */
export const firebaseClaims = { role: user.role, storeId: STORE_ID };

// ── 상품 등록·수정 화면 ──
// 수정 화면은 API /stores/:storeId/products/:id/owner로 상품을 읽고, 등록 화면은 /varieties로 품종을 고른다.
const VARIETIES = [
  ['variety-biglip', '빅립', 'cymbidium', ['핑크', '레드']],
  ['variety-mancheonhong', '만천홍', 'cymbidium', ['레드']],
  ['variety-orange-glow', '오렌지 글로우', 'cymbidium', ['오렌지', '옐로우']],
].map(([id, name, subCategory, typicalColors]) => ({
  id,
  name,
  category: 'orchid',
  subCategory,
  flowerSize: 'medium',
  plantSize: 'medium',
  availableStemTypes: ['외대'],
  hasFragrance: true,
  fragranceLevel: 'light',
  bloomDuration: '60~90일',
  careLevel: 'easy',
  typicalColors,
  notes: '',
  createdAt: '2026-08-01T01:00:00.000Z',
}));

// 감사 기록(/admin/audit) — 종류 이름은 화면의 ACTION_LABEL과 맞춘다.
const ADMIN_AUDIT_LOGS = [
  {
    id: 'audit-1',
    action: 'admin.driver.approved',
    actorId: 'admin-visual-0001',
    targetType: 'driver',
    targetId: 'driver-visual-0002',
    before: { status: 'pending' },
    after: { status: 'approved' },
    reason: null,
    createdAt: '2026-10-05T01:20:00.000Z',
  },
  {
    id: 'audit-2',
    action: 'admin.order.force_refunded',
    actorId: 'admin-visual-0001',
    targetType: 'order',
    targetId: 'order-round-multi',
    before: { status: 'PAID' },
    after: { status: 'REFUNDED' },
    reason: '꽃 상태 불량으로 손님 요청',
    createdAt: '2026-10-04T08:05:00.000Z',
  },
  {
    id: 'audit-3',
    action: 'store.payout_account.updated',
    actorId: 'admin-visual-0001',
    targetType: 'store',
    targetId: STORE_ID,
    before: null,
    after: { bankName: '농협은행', accountNumberLast4: '7788' },
    reason: null,
    createdAt: '2026-10-02T03:00:00.000Z',
  },
];
// 옵션 재고(/settings/option-stocks) — 직접 출력한 화분 등.
const OPTION_STOCKS = [
  {
    id: 'stock-1',
    storeId: STORE_ID,
    name: '3D 출력 화분 · 흰색 중형',
    stockQuantity: 20,
    reservedQuantity: 2,
    orderedQuantity: 7,
    remainingQuantity: 11,
  },
  {
    id: 'stock-2',
    storeId: STORE_ID,
    name: '3D 출력 화분 · 연두 소형',
    stockQuantity: 10,
    reservedQuantity: 0,
    orderedQuantity: 10,
    remainingQuantity: 0,
  },
];
const HUB_ARRIVED_ORDERS = [
  {
    id: 'order-hub-1',
    status: 'HUB_ARRIVED',
    totalAmount: 38000,
    createdAt: '2026-10-05T02:10:00.000Z',
    items: [
      { name: '호접란 2대', quantity: 1 },
      { name: '스투키', quantity: 1 },
    ],
    customerName: '김*연',
    pickupCode: '4821',
  },
];
const DELIVERY_CONFIG = {
  directFee: 3000,
  hubFee: 1000,
  parcelFee: 4000,
  freeThresholdDirect: 50000,
  freeThresholdHub: 30000,
  freeThresholdParcel: 50000,
  weatherRestrictionActive: false,
};
function adminSettlementsSummary() {
  const sum = (list, key) => list.reduce((total, s) => total + (s[key] ?? 0), 0);
  const payable = ADMIN_SETTLEMENTS.filter((s) => s.status === 'confirmed');
  const paid = ADMIN_SETTLEMENTS.filter((s) => s.status === 'paid');
  const recovery = ADMIN_SETTLEMENTS.filter((s) => (s.recoveryAmount ?? 0) > 0);
  return {
    count: ADMIN_SETTLEMENTS.length,
    payable: { count: payable.length, netAmount: sum(payable, 'netAmount') },
    paid: { count: paid.length, netAmount: sum(paid, 'netAmount') },
    platformFee: sum(ADMIN_SETTLEMENTS, 'platformFee'),
    recovery: { count: recovery.length, amount: sum(recovery, 'recoveryAmount') },
    truncated: false,
  };
}
const HUBS = [
  {
    id: 'hub-0001',
    name: '이천 부발 픽업점',
    address: '경기도 이천시 부발읍 경충대로 2091',
    addressDetail: '1층 꽃집',
    operatingHours: '평일 10:00~19:00',
    isActive: true,
  },
  {
    id: 'hub-0002',
    name: '증포동 거점',
    address: '경기도 이천시 증포동 403',
    addressDetail: null,
    operatingHours: null,
    isActive: false,
  },
];

// ── 팔도감 벤치마킹 비교 기능(고객 반응·입점 문의) ──
const STORE_REVIEWS = [
  ['review-1', 'product-1', 5, '꽃대가 사진보다 튼실하게 왔어요. 화요일 아침에 정확히 문 앞에 있었습니다.', '이*연', '2026-09-30T02:00:00.000Z'],
  ['review-2', 'product-1', 5, '도자기 화분으로 골랐는데 선물하기 좋네요.', '정*호', '2026-09-23T05:00:00.000Z'],
  ['review-3', 'product-2', 4, '반쯤 핀 상태로 와서 일주일 뒤에 활짝 폈어요.', '최*은', '2026-09-16T08:00:00.000Z'],
].map(([id, productId, rating, text, authorName, createdAt]) => ({ id, productId, rating, text, authorName, createdAt }));
const benchmarkRoutes = [
  ['GET', /^\/stores\/[^/]+\/reviews$/, () => ({ body: STORE_REVIEWS })],
  [
    'GET',
    /^\/stores\/[^/]+\/restock-subscriptions\/summary$/,
    () => ({
      body: [
        { productId: 'product-2', productName: '동양란 만천홍', count: 7 },
        { productId: 'product-4', productName: '오렌지 글로우', count: 3 },
      ],
    }),
  ],
  [
    'GET',
    /^\/stores\/[^/]+\/product-requests$/,
    () => ({
      body: [
        { id: 'request-1', text: '흰 호접란 큰 화분', createdAt: '2026-10-02T03:00:00.000Z' },
        { id: 'request-2', text: '수국', createdAt: '2026-10-01T09:00:00.000Z' },
        { id: 'request-3', text: '개업 축하용 금전수', createdAt: '2026-09-29T01:00:00.000Z' },
      ],
    }),
  ],
  [
    'GET',
    /^\/admin\/partner-inquiries$/,
    () => ({
      body: [
        {
          id: 'inquiry-1',
          farmName: '여주 햇살농원',
          region: '경기 여주',
          contact: '010-9876-5432',
          message: '호접란 2,000분 규모로 재배합니다. 주 1회 납품 가능합니다.',
          createdAt: '2026-10-02T05:00:00.000Z',
        },
        // UI 교체 P2b: 연락 전·이메일 연락처 카드(배지·링크 모양).
        {
          id: 'inquiry-2',
          farmName: '제주 동백정원',
          region: '제주 서귀포',
          contact: 'camellia@example.test',
          message: '동백 분재를 소량 납품하고 싶습니다.\n사진은 메일로 보내 드릴게요.',
          contactedAt: null,
          createdAt: '2026-10-01T02:00:00.000Z',
        },
      ],
    }),
  ],
  // 숨긴 후기(/admin/reviews, 기능 플래그 reviews). 사진은 외부 주소라 넣지 않는다.
  [
    'GET',
    /^\/admin\/reviews\/hidden$/,
    () => ({
      body: {
        reviews: [
          {
            id: 'hidden-review-1',
            productId: 'product-1',
            storeId: 'store-visual-0001',
            storeName: '디어 오키드',
            productName: '호접란 화이트',
            rating: 1,
            text: '연락처 010-0000-0000으로 전화 주세요. 꽃이 금방 시들었어요.',
            authorName: '김*린',
            createdAt: '2026-10-03T01:00:00.000Z',
            hidden: true,
            hiddenReasonCode: 'privacy',
            hiddenNote: '전화번호가 적혀 있음',
            hiddenAt: '2026-10-03T05:00:00.000Z',
            hiddenByRole: 'seller',
          },
          {
            id: 'hidden-review-2',
            productId: 'product-2',
            storeId: 'store-visual-0001',
            storeName: '디어 오키드',
            productName: null,
            rating: 2,
            text: '광고 문구',
            authorName: '이*수',
            createdAt: '2026-10-02T01:00:00.000Z',
            hidden: true,
            hiddenAt: '2026-10-02T03:00:00.000Z',
            hiddenByRole: 'admin',
          },
        ],
        hasMore: true,
        limit: 100,
      },
    }),
  ],
];

export const routes = [
  ...benchmarkRoutes,
  ['GET', /^\/stores\/[^/]+\/orders$/, () => ({ body: SELLER_ORDERS })],
  // 홈의 끝난 주문 건수(완료·취소 탭). 주문 상세 경로보다 먼저 둔다(summary를 주문 id로 읽지 않게).
  [
    'GET',
    /^\/stores\/[^/]+\/orders\/summary$/,
    () => ({ body: { archivedStatusCounts: { DELIVERED: 12, PICKED_UP: 1, REVIEWED: 3, CANCELLED: 2 } } }),
  ],
  [
    'GET',
    /^\/stores\/[^/]+\/orders\/([^/]+)$/,
    ({ params: [id] }) => {
      const o = [...SELLER_ORDERS, ...DETAIL_ONLY_ORDERS].find((x) => x.id === id);
      return o ? { body: o } : { status: 404, body: { message: '주문 없음' } };
    },
  ],
  ['GET', /^\/stores\/[^/]+\/operation-issues$/, () => ({ body: { items: OPERATION_ISSUES } })],
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
  // 합계 카드는 같은 목록에서 계산한다(서버 계산과 같은 모양).
  ['GET', /^\/admin\/settlements\/summary$/, () => ({ body: adminSettlementsSummary() })],
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
  ['GET', /^\/stores\/[^/]+\/delivery-config$/, () => ({ body: DELIVERY_CONFIG })],
  // 설정 · 배송비 화면은 판매자 전용 조회 경로를 쓴다.
  ['GET', /^\/stores\/[^/]+\/delivery-config\/owner$/, () => ({ body: DELIVERY_CONFIG })],
  // 이번 달 몇몇 날짜에 한도를 넣는다(보는 달이 바뀌어도 같은 날짜 모양이 보이게 from의 연·월을 따른다).
  [
    'GET',
    /^\/stores\/[^/]+\/daily-caps$/,
    ({ url }) => {
      const month = (url.searchParams.get('from') ?? '2026-10-01').slice(0, 7);
      return {
        body: {
          caps: [
            { date: `${month}-10`, totalCap: 20, usedSlots: 12 },
            { date: `${month}-11`, totalCap: 20, usedSlots: 20 },
            { date: `${month}-17`, totalCap: 15, usedSlots: 3 },
          ],
        },
      };
    },
  ],
  ['GET', /^\/stores\/[^/]+\/hubs$/, () => ({ body: { hubs: HUBS } })],
  [
    'GET',
    /^\/stores\/[^/]+\/hubs\/([^/]+)$/,
    ({ params: [id] }) => {
      const hub = HUBS.find((h) => h.id === id);
      return hub ? { body: hub } : { status: 404, body: { message: '거점 없음' } };
    },
  ],
  [
    'GET',
    /^\/stores\/[^/]+\/hubs\/([^/]+)\/orders$/,
    () => ({ body: { orders: HUB_ARRIVED_ORDERS } }),
  ],
  ['GET', /^\/admin\/audit-logs$/, () => ({ body: ADMIN_AUDIT_LOGS })],
  ['GET', /^\/stores\/[^/]+\/option-stocks$/, () => ({ body: { stocks: OPTION_STOCKS } })],
  [
    'GET',
    /^\/stores\/[^/]+\/payout-account$/,
    () => ({
      body: {
        account: {
          bankName: '농협은행',
          accountHolder: '검증 판매자',
          accountNumberMasked: '351-****-****-7788',
          accountNumberLast4: '7788',
        },
      },
    }),
  ],
  [
    'GET',
    /^\/stores\/([^/]+)$/,
    ({ params: [id] }) => ({
      body: {
        id,
        name: '그린러브 검증 가게',
        ceoName: '김농부',
        phone: '010-4452-2104',
        address: '경기도 이천시 부발읍 경충대로 2091',
        businessNumber: '123-45-67890',
        logoUrl: '',
      },
    }),
  ],
  // 파일럿 가게와 같은 회차 판매 가게 — 설정에서 예전 방식 메뉴(배송비·배송 슬롯·거점)가 숨는다.
  [
    'GET',
    /^\/stores\/([^/]+)\/public-profile$/,
    ({ params: [id] }) => ({
      body: {
        id,
        name: '그린러브 검증 가게',
        logoUrl: null,
        salesMode: 'round_direct',
        // 비교 기능: 가게 소개·품질 보장·남은 수량 공개
        intro: '매주 경매에서 직접 골라 보내는 이천 꽃집',
        story: '매주 경매에서 상태 좋은 동양란만 골라 들여옵니다.',
        region: '경기 이천',
        sinceYear: 1996,
        guarantee: {
          enabled: true,
          title: '꽃 상태 보장',
          terms: [
            '받은 날 사진과 함께 알려 주시면 가장 빨리 다시 보내 드려요.',
            '꽃이 시들었거나 화분이 깨졌다면 다음 회차에 다시 보내 드리거나 환불해 드려요.',
          ],
        },
        showDemandSignals: true,
      },
    }),
  ],
  [
    'GET',
    /^\/stores\/[^/]+\/products\/([^/]+)\/owner$/,
    ({ params: [id] }) => {
      const product = firestoreSeed.products[id];
      return product
        ? { body: { id, ...product } }
        : { status: 404, body: { message: '상품 없음' } };
    },
  ],
  [
    'GET',
    /^\/varieties$/,
    ({ url }) => ({
      body: VARIETIES.filter(
        (v) => !url.searchParams.get('category') || v.category === url.searchParams.get('category'),
      ),
    }),
  ],
];

/**
 * 자동 캡처 대상 화면. id는 파일 이름, group은 보고서 묶음이다.
 * auth: false면 로그인 없이 연다. 회차·상품 같은 fixture가 없는 화면은 빈 상태나 오류로 찍히고,
 * 캡처 기록(missing)에 빠진 API 경로가 남는다.
 * firestore: true는 브라우저가 Firestore `products`를 직접 구독하는 화면(useStoreProducts)이다. 에뮬레이터가
 * 없으면(운영 빌드 --prod) 데이터 없이 "연결 중"·로딩으로 찍히므로 shots.mjs가 정상 판정에서 뺀다.
 */
export const screens = [
  { id: 'login', group: '판매자', title: '로그인', path: '/login', auth: false },
  { id: 'home', group: '판매자', title: '홈', path: '/', firestore: true },
  { id: 'onboarding', group: '판매자', title: '사업자 프로필 수정', path: '/onboarding' },
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
  {
    id: 'order-round',
    group: '판매자',
    title: '회차 주문 상세(여러 상품)',
    path: '/orders/order-round-multi',
  },
  { id: 'prep', group: '판매자', title: '준비', path: '/prep', firestore: true },
  { id: 'operations', group: '판매자', title: '운영 확인', path: '/operations' },
  { id: 'sale-rounds', group: '판매자', title: '회차 목록', path: '/sale-rounds' },
  {
    id: 'sale-round-open',
    group: '판매자',
    title: '회차 상세 · 진행 중',
    path: '/sale-rounds/round-open',
    firestore: true,
  },
  {
    id: 'sale-round-scheduled',
    group: '판매자',
    title: '회차 상세 · 예정',
    path: '/sale-rounds/round-scheduled',
    firestore: true,
  },
  {
    id: 'sale-round-new',
    group: '판매자',
    title: '새 회차',
    path: '/sale-rounds/new',
    firestore: true,
  },
  { id: 'products', group: '판매자', title: '상품 목록', path: '/products', firestore: true },
  { id: 'product-new', group: '판매자', title: '상품 등록', path: '/products/new' },
  { id: 'product-edit', group: '판매자', title: '상품 수정', path: '/products/product-1/edit' },
  // 상품 폼 2~5단계는 주소로 열 수 없어 수정 화면에서 "다음"을 n-1번 누른다.
  ...[2, 3, 4, 5].map((step) => ({
    id: `product-edit-step${step}`,
    group: '판매자',
    title: `상품 수정 · ${step}단계`,
    path: '/products/product-1/edit',
    steps: Array.from({ length: step - 1 }, () => ({ click: '다음' })),
  })),
  {
    // 예전 방식(legacy) 가게에서만 공동구매 선택이 보인다(#696). 공동구매를 골라 설정 칸까지 연다.
    id: 'product-edit-step5-group',
    group: '판매자',
    title: '상품 수정 · 5단계 · 공동구매(예전 방식 가게)',
    path: '/products/product-1/edit',
    scenario: 'legacy-store',
    steps: [...Array.from({ length: 4 }, () => ({ click: '다음' })), { click: '공동구매' }],
  },
  { id: 'settlements', group: '판매자', title: '정산', path: '/settlements' },
  {
    id: 'settlements-period',
    group: '판매자',
    title: '정산 · 기간별 조회',
    path: '/settlements',
    click: '기간별 조회',
  },
  {
    id: 'settlements-orders',
    group: '판매자',
    title: '정산 · 주문별 상세',
    path: '/settlements',
    click: '주문별 상세',
  },
  { id: 'settings', group: '판매자', title: '설정', path: '/settings' },
  {
    id: 'settings-delivery',
    group: '판매자',
    title: '설정 · 배송비',
    path: '/settings/delivery',
  },
  {
    id: 'settings-daily-caps',
    group: '판매자',
    title: '설정 · 배송 한도',
    path: '/settings/daily-caps',
  },
  { id: 'hubs', group: '판매자', title: '거점', path: '/hubs' },
  { id: 'admin-orders', group: '어드민', title: '주문', path: '/admin/orders' },
  { id: 'admin-settlements', group: '어드민', title: '정산', path: '/admin/settlements' },
  { id: 'admin-users', group: '어드민', title: '소비자', path: '/admin/users' },
  { id: 'admin-invite', group: '어드민', title: '초대', path: '/admin/invite' },
  { id: 'admin-stores', group: '어드민', title: '판매자', path: '/admin/stores' },
  { id: 'admin-drivers', group: '어드민', title: '기사', path: '/admin/drivers' },
  { id: 'admin-banner', group: '어드민', title: '배너', path: '/admin/banner' },
  // 2026-10-30 UI 교체 P0.5: 촬영 목록에 없던 화면을 채운다(ui-stack-migration-plan.md P0.5-1).
  // /admin은 /admin/stores로 넘어가는 주소라, 기능 플래그가 꺼진 후기·입점 문의·고객 반응·가게 소개는
  // 지금 404라 넣지 않는다(기능을 켠 모양은 benchmarkScreens).
  { id: 'admin-audit', group: '어드민', title: '감사 기록', path: '/admin/audit' },
  { id: 'hub-detail', group: '판매자', title: '거점 상세', path: '/hubs/hub-0001' },
  { id: 'hub-edit', group: '판매자', title: '거점 수정', path: '/hubs/hub-0001/edit' },
  { id: 'hub-pickup', group: '판매자', title: '거점 픽업', path: '/hubs/hub-0001/pickup' },
  { id: 'hub-new', group: '판매자', title: '거점 추가', path: '/hubs/new' },
  {
    id: 'settings-option-stocks',
    group: '판매자',
    title: '설정 · 옵션 재고',
    path: '/settings/option-stocks',
  },
  {
    id: 'settings-payout-account',
    group: '판매자',
    title: '설정 · 정산 계좌',
    path: '/settings/payout-account',
  },
  {
    id: 'invite-token',
    group: '판매자',
    title: '초대 수락',
    path: '/invite/visualInviteToken0001',
    auth: false,
  },
  {
    id: 'invite-token-invalid',
    group: '판매자',
    title: '초대 수락 · 잘못된 링크',
    path: '/invite/visual-invalid-token',
    auth: false,
  },
  { id: 'login-error', group: '판매자', title: '로그인 오류', path: '/login/error', auth: false },
  // 모달이 열린 상태 — 같이 쓰는 기간의 CSS 우선순위 회귀는 열린 상태에서 드러난다(P2a 판정 범위).
  {
    id: 'modal-order-hold',
    group: '판매자 · 모달',
    title: '주문 상세 · 배송 보류',
    path: '/orders/order-round-preparing',
    steps: [{ click: '배송 보류' }],
    viewport: true,
  },
  {
    id: 'modal-order-cancel',
    group: '판매자 · 모달',
    title: '주문 상세 · 강제 취소',
    path: '/orders/order-with-contact',
    steps: [{ click: '강제 취소' }],
    viewport: true,
  },
  // 어드민 기사 승인·정지 확인창(ConfirmModal, 정지는 사유 입력칸 포함). 기본 탭은 승인 대기다.
  {
    id: 'modal-driver-approve',
    group: '어드민 · 모달',
    title: '기사 · 승인 확인',
    path: '/admin/drivers',
    steps: [{ click: '승인' }],
    viewport: true,
  },
  {
    id: 'modal-driver-suspend',
    group: '어드민 · 모달',
    title: '기사 · 정지 확인(사유)',
    path: '/admin/drivers',
    steps: [{ click: '정지' }],
    viewport: true,
  },
  // 어드민 초대(UI 교체 P2b). 표와 카드가 같은 버튼을 함께 그려 보이는 것만 누른다.
  // 헤드리스 브라우저는 클립보드 쓰기 권한이 없어 링크 복사가 실패하고 직접 복사 창이 열린다.
  {
    id: 'modal-invite-revoke',
    group: '어드민 · 모달',
    title: '초대 · 취소 확인',
    path: '/admin/invite',
    steps: [{ clickSelector: 'button:has-text("취소"):visible' }],
    viewport: true,
  },
  {
    id: 'modal-invite-manual-copy',
    group: '어드민 · 모달',
    title: '초대 · 링크 직접 복사',
    path: '/admin/invite',
    steps: [{ clickSelector: 'button:has-text("링크 복사"):visible' }],
    viewport: true,
  },
  // 어드민 주문 환불 확인창. 강제환불은 사유 입력칸, 배송 후 환불은 메모 입력칸이 첫 초점(data-autofocus)이다.
  {
    id: 'modal-admin-refund',
    group: '어드민 · 모달',
    title: '주문 · 강제환불 확인',
    path: '/admin/orders',
    // 모바일 카드와 PC 표가 같은 버튼을 함께 그리고 하나만 보이므로 보이는 버튼을 누른다.
    steps: [{ clickSelector: 'button:has-text("강제환불"):visible' }],
    viewport: true,
  },
  {
    id: 'modal-admin-post-delivery-refund',
    group: '어드민 · 모달',
    title: '주문 · 배송 후 환불 확인',
    path: '/admin/orders',
    steps: [{ clickSelector: 'button:has-text("배송 후 환불"):visible' }],
    viewport: true,
  },
  {
    id: 'modal-admin-post-delivery-refund-filled',
    group: '어드민 · 모달',
    title: '주문 · 배송 후 환불(사유·메모 입력)',
    path: '/admin/orders',
    steps: [
      { clickSelector: 'button:has-text("배송 후 환불"):visible' },
      { click: '꽃 상함' },
      { fill: { label: '메모 (손님에게는 보이지 않음, 필수)', value: '꽃잎이 상해 도착' } },
    ],
    viewport: true,
  },
  {
    id: 'modal-round-cancel',
    group: '판매자 · 모달',
    title: '회차 상세 · 회차 취소',
    path: '/sale-rounds/round-scheduled',
    firestore: true,
    steps: [{ click: '회차 취소' }],
    viewport: true,
  },
  {
    // 수정 화면 상품은 직접 편집한 내용으로 보므로 다시 생성하기가 확인 모달을 연다.
    id: 'modal-product-regenerate',
    group: '판매자 · 모달',
    title: '상품 수정 · 4단계 · 다시 생성 확인',
    path: '/products/product-1/edit',
    steps: [...Array.from({ length: 3 }, () => ({ click: '다음' })), { click: '다시 생성하기' }],
    viewport: true,
  },
];

/** 화면별 상황(shots.mjs가 화면을 열 때 /__scenario로 고른다). 그 경로를 기본 경로 앞에 끼운다. */
export const scenarioRoutes = {
  'legacy-store': [
    [
      'GET',
      /^\/stores\/([^/]+)\/public-profile$/,
      ({ params: [id] }) => ({ body: { id, name: '그린러브 검증 가게', logoUrl: null, salesMode: 'legacy' } }),
    ],
  ],
};

/**
 * UI 교체 대조 화면(ui-stack-migration-plan.md §6 P1·P2a, `shots.mjs --set compare`).
 * 왼쪽 Mantine, 오른쪽 @greenhub/ui를 같은 칸에 그린다. main에는 없는 화면이라 전·후 비교(screens)에 넣지 않는다.
 * 앱은 하네스·dev:local(GREENHUB_LOCAL_RUNTIME=true + next dev)에서만 이 주소를 연다(apps/seller/src/lib/local-preview.ts).
 */
export const compareScreens = [
  { id: 'ui-compare', group: 'UI 대조', title: '컴포넌트 대조', path: '/dev/ui-compare' },
  ...[
    ['modal', 'Mantine Modal'],
    ['dialog', '@greenhub/ui Dialog'],
    ['drawer', 'Mantine Drawer(bottom)'],
    ['sheet', '@greenhub/ui Sheet(bottom)'],
    ['select', 'Mantine Select 목록(묶음·고른 항목)'],
    ['uiselect', '@greenhub/ui Select 목록(묶음·고른 항목)'],
  ].map(([open, title]) => ({
    id: `ui-compare-${open}`,
    group: 'UI 대조',
    title,
    path: `/dev/ui-compare?open=${open}`,
    viewport: true,
    // Select 목록은 사람이 누른 것처럼 연다(Mantine은 이때 입력칸에 초점이 남는다).
    ...(open.endsWith('select') ? { steps: [{ clickSelector: 'main input:not([type=hidden])' }] } : {}),
  })),
];

/**
 * 팔도감 벤치마킹 비교(수정 전·후)용 판매자 화면. features는 그 화면에서 보이는 기능 토글 키다.
 * clicks: 찍기 전에 차례로 누를 글자(없으면 건너뛴다)
 */
export const benchmarkScreens = [
  {
    id: 'bm-seller-settings',
    group: '판매자',
    title: '설정(고객 관리 메뉴)',
    path: '/settings',
    features: ['seller-store', 'reviews'],
  },
  {
    id: 'bm-seller-store-profile',
    group: '판매자',
    title: '가게 소개·품질 보장 설정',
    path: '/settings/store-profile',
    features: ['seller-store', 'quality-guarantee', 'demand-signals'],
  },
  {
    id: 'bm-seller-product-extras',
    group: '판매자',
    title: '상품 수정 · 마지막 단계(추가 정보)',
    path: '/products/product-1/edit',
    clicks: ['다음', '다음', '다음', '다음'],
    features: [
      'card-discount', 'size-info', 'care-guide', 'option-sheet', 'quality-guarantee', 'plant-search',
    ],
  },
  {
    id: 'bm-seller-reviews',
    group: '판매자',
    title: '고객 반응 · 후기',
    path: '/reactions',
    features: ['reviews'],
  },
  {
    id: 'bm-seller-restock',
    group: '판매자',
    title: '고객 반응 · 알림 신청',
    path: '/reactions',
    clicks: ['알림 신청'],
    features: ['restock-alert'],
  },
  {
    id: 'bm-seller-requests',
    group: '판매자',
    title: '고객 반응 · 찾는 상품',
    path: '/reactions',
    clicks: ['찾는 상품'],
    features: ['product-request'],
  },
  {
    id: 'bm-seller-order-gift',
    group: '판매자',
    title: '주문 상세 · 옵션 문구·선물',
    path: '/orders/order-round-gift',
    features: ['option-sheet', 'gift'],
  },
  {
    id: 'bm-admin-partner',
    group: '관리자',
    title: '관리자 · 입점 문의',
    path: '/admin/partner-inquiries',
    features: ['partner-inquiry'],
  },
  {
    id: 'bm-admin-partner-delete',
    group: '관리자',
    title: '관리자 · 입점 문의 · 삭제 확인',
    path: '/admin/partner-inquiries',
    features: ['partner-inquiry'],
    steps: [{ click: '삭제' }],
    viewport: true,
  },
  {
    id: 'bm-admin-reviews',
    group: '관리자',
    title: '관리자 · 숨긴 후기',
    path: '/admin/reviews',
    features: ['reviews'],
  },
  {
    id: 'bm-admin-reviews-unhide',
    group: '관리자',
    title: '관리자 · 숨긴 후기 · 숨김 해제 확인',
    path: '/admin/reviews',
    features: ['reviews'],
    steps: [{ click: '숨김 해제' }],
    viewport: true,
  },
];
