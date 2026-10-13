// 소비자 앱 화면 확인용 고정 데이터 — 프런트 개편 1순위 동선(회차 구매).
// 스토어는 회차 직판(round_direct) 모드다. 회차 일정·상품은 seller.mjs와 맞춘다.
// 화면을 추가할 때 경로를 여기에 더한다.
const STORE_ID = 'store-visual-0001';
const STORE_NAME = '디어 오키드';

// 소비자 가짜 계정. /auth/login 응답의 user, /auth/session 응답({id, role, storeId})에 쓰인다.
// 소비자 auth.ts는 role이 consumer·admin일 때만 로그인·세션을 인정한다.
export const user = {
  id: 'consumer-visual-0001',
  email: 'green.kim@example.test',
  name: '김그린',
  role: 'consumer',
  storeId: null,
};

const CREATED_AT = '2026-08-01T01:00:00.000Z';

// ── 상품: 홈 스토어 판별(resolveHomeStoreId)은 상품 storeId가 한 곳일 때만 성립한다 ──
// varietyId를 두지 않아 /varieties 조회를 만들지 않는다. 이미지는 하네스가 외부를 막으므로 비운다.
const PRODUCT_SPECS = [
  {
    name: '빅립',
    price: 30000,
    headline: '입술이 큰 꽃, 한 대로 집안이 환해지는 동양란',
    description:
      '경매에서 갓 들여온 빅립입니다.\n꽃잎이 넓고 색이 진해 거실·사무실 어디에 두어도 잘 어울립니다.',
    colors: ['핑크'],
    fragrance: 'light',
    bloom: 'half',
    care: 'easy',
  },
  {
    name: '만천홍',
    price: 25000,
    headline: '선물용으로 가장 많이 찾는 붉은 동양란',
    description: '붉은 꽃대가 촘촘히 올라온 만천홍입니다.\n개업·승진 선물로 많이 보내십니다.',
    colors: ['레드'],
    fragrance: 'none',
    bloom: 'full',
    care: 'normal',
  },
  {
    name: 'v3',
    price: 45000,
    headline: '꽃대가 셋 올라온 큰 화분',
    description: '꽃대 세 대가 고르게 올라온 v3 품종입니다.\n오래 보시려면 직사광선을 피해 주세요.',
    colors: ['화이트'],
    fragrance: 'light',
    bloom: 'bud',
    care: 'normal',
  },
];
const PRODUCTS = PRODUCT_SPECS.map((spec, i) => ({
  id: `product-${i + 1}`,
  storeId: STORE_ID,
  name: `동양란 ${spec.name}`,
  images: [],
  price: spec.price,
  category: 'orchid',
  saleType: 'normal',
  deliverySize: 'medium',
  isActive: true,
  createdAt: `2026-08-0${i + 1}T01:00:00.000Z`,
  updatedAt: '2026-09-28T01:00:00.000Z',
  selection: {
    colors: spec.colors,
    stemType: '외대',
    fragrance: spec.fragrance,
    bloomCondition: spec.bloom,
    bundleUnit: '1분',
    careLevel: spec.care,
  },
  content: { headline: spec.headline, description: spec.description, isEditedByUser: false },
}));

const PUBLIC_PROFILE = {
  id: STORE_ID,
  name: STORE_NAME,
  logoUrl: null,
  salesMode: 'round_direct',
};

const BANNER = {
  tagText: '이번 주 회차',
  headline: '경매에서 막 나온 동양란',
  subText: '목요일 10시 주문 시작 · 화요일 아침 배송',
  cta1: { label: '회차 보기', href: '/' },
  isActive: true,
};

// ── 회차: seller.mjs와 같은 일정. 공개 목록에는 DRAFT를 넣지 않는다 ──
// 홈은 OPEN 회차를 "이번 주 판매"로, CLOSED 회차를 "지난 회차"로 보인다.
// SCHEDULED 회차는 OPEN 회차가 있으면 홈에 나오지 않지만, 목록에는 실제처럼 둔다.
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
      orderedItemQuantity: 16,
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
];
// 판매 중 회차의 상품별 확정 수량. 두 번째 상품은 한도(10개)를 채워 API가 공개 조회에서
// 계산해 주는 품절(SOLD_OUT) 화면을 확인한다.
const ROUND_ORDERED = [4, 10, 2];
function roundItems(round) {
  return PRODUCTS.map((product, i) => ({
    id: `${round.id}-item-${i + 1}`,
    roundId: round.id,
    storeId: STORE_ID,
    productId: product.id,
    productNameSnapshot: product.name,
    productImageUrlSnapshot: null,
    roundPrice: product.price,
    saleLimitQuantity: 10,
    reservedQuantity: 0,
    orderedQuantity: round.status === 'OPEN' ? ROUND_ORDERED[i] : 0,
    displayOrder: i,
    status: round.status === 'OPEN' && ROUND_ORDERED[i] >= 10 ? 'SOLD_OUT' : 'ACTIVE',
    createdAt: round.createdAt,
    updatedAt: round.updatedAt,
  }));
}

// ── 주문: 회차 주문(schemaVersion 2) — 결제완료·배송중·취소 한 건씩 ──
// 소비자 화면 검증 조건: orderNumber=YYYYMMDD-NNNNNN, saleType normal, deliveryMethod direct,
// deliveryFee 0, orderItems[].unitPrice×quantity=subtotalAmount, 합계=totalAmount.
const DELIVERY_ADDRESS = {
  address: '경기도 이천시 중리천로 115',
  addressDetail: '101동 1203호',
  zipCode: '17379',
};
function orderItem(round, productIndex, quantity) {
  const product = PRODUCTS[productIndex];
  return {
    roundItemId: `${round.id}-item-${productIndex + 1}`,
    productId: product.id,
    productName: product.name,
    productImageUrl: null,
    unitPrice: product.price,
    quantity,
    subtotalAmount: product.price * quantity,
  };
}
function roundOrder(id, orderNumber, round, status, lines, extra = {}) {
  const orderItems = lines.map(([index, quantity]) => orderItem(round, index, quantity));
  const first = orderItems[0];
  return {
    id,
    orderNumber,
    schemaVersion: 2,
    storeId: STORE_ID,
    userId: user.id,
    productId: first.productId,
    productName: first.productName,
    quantity: orderItems.reduce((sum, item) => sum + item.quantity, 0),
    saleType: 'normal',
    status,
    deliveryMethod: 'direct',
    deliveryFee: 0,
    deliveryAddress: DELIVERY_ADDRESS,
    deliveryPhone: '010-1234-5678',
    requestNote: null,
    isMetropolitan: true,
    hubId: null,
    pickupCode: null,
    totalAmount: orderItems.reduce((sum, item) => sum + item.subtotalAmount, 0),
    // 회차 결제 화면과 같은 규칙: 배송 시작일(한국시간) 날짜
    requestedDeliveryDate: round.id === 'round-closed' ? '2026-09-29' : '2026-10-06',
    preparedAt: null,
    cancelReason: null,
    groupBuyConsent: null,
    roundId: round.id,
    roundName: round.name,
    orderItems,
    acquisition: null,
    deliveryHold: null,
    buyerName: user.name,
    ...extra,
  };
}
const ROUND_OPEN = SALE_ROUNDS.find((r) => r.id === 'round-open');
const ROUND_CLOSED = SALE_ROUNDS.find((r) => r.id === 'round-closed');
const ORDERS = [
  roundOrder(
    'order-round-accepted',
    '20261002-000012',
    ROUND_OPEN,
    'ACCEPTED',
    [
      [0, 1],
      [1, 2],
    ],
    {
      requestNote: '현관 앞에 두고 문자 주세요.',
      createdAt: '2026-10-02T03:20:00.000Z',
      updatedAt: '2026-10-02T03:21:00.000Z',
    },
  ),
  roundOrder('order-round-delivering', '20260926-000031', ROUND_CLOSED, 'DELIVERING', [[2, 1]], {
    createdAt: '2026-09-26T05:10:00.000Z',
    updatedAt: '2026-09-28T22:30:00.000Z',
  }),
  roundOrder('order-round-cancelled', '20261001-000004', ROUND_OPEN, 'CANCELLED', [[1, 1]], {
    cancelReason: '고객 요청',
    createdAt: '2026-10-01T02:05:00.000Z',
    updatedAt: '2026-10-01T06:40:00.000Z',
  }),
];

// ── MY: 저장 배송지(/auth/me)·알림 ──
const ME = {
  id: user.id,
  email: user.email,
  name: user.name,
  phone: '010-1234-5678',
  role: 'consumer',
  storeId: null,
  providers: ['kakao'],
  savedAddresses: [
    {
      id: 'address-home',
      label: '집',
      address: DELIVERY_ADDRESS.address,
      addressDetail: DELIVERY_ADDRESS.addressDetail,
      zipCode: DELIVERY_ADDRESS.zipCode,
      isDefault: true,
    },
    {
      id: 'address-office',
      label: '회사',
      address: '경기도 이천시 부악로 40',
      addressDetail: '3층',
      zipCode: '17383',
      isDefault: false,
    },
  ],
  fcmToken: null,
  createdAt: CREATED_AT,
  updatedAt: '2026-09-28T01:00:00.000Z',
};

function notification(id, orderId, templateCode, message, sentAt) {
  return {
    id,
    userId: user.id,
    orderId,
    channel: 'alimtalk',
    templateCode,
    variables: {},
    message,
    phone: '010-1234-5678',
    fcmToken: null,
    status: 'sent',
    sentAt,
    errorMessage: null,
    createdAt: sentAt,
  };
}
const NOTIFICATIONS = [
  notification(
    'notice-0003',
    'order-round-accepted',
    'ROUND_ORDER_CONFIRMED',
    '[그린러브] 10월 6일 배송 회차 주문이 접수되었습니다. 화요일 오전 9시까지 문 앞에 배송합니다.',
    '2026-10-02T03:21:00.000Z',
  ),
  notification(
    'notice-0002',
    'order-round-cancelled',
    'ORDER_CANCELLED',
    '[그린러브] 주문(20261001-000004)이 취소되었습니다. 결제 금액은 3~5영업일 안에 환불됩니다.',
    '2026-10-01T06:40:00.000Z',
  ),
  notification(
    'notice-0001',
    'order-round-delivering',
    'ORDER_DELIVERING',
    '[그린러브] 주문하신 동양란 v3가 배송을 시작했습니다.',
    '2026-09-28T22:30:00.000Z',
  ),
];

/**
 * 브라우저 저장소에만 있는 장바구니·결제 대상. fixture 경로로는 채울 수 없다.
 * 캡처 전에 addInitScript 등으로 넣으면 장바구니·결제 화면이 채워진다(현재 shots.mjs는 쓰지 않는다).
 * - localStorage['greenhub_cart']: 장바구니(useCart)
 * - sessionStorage['checkout_cart']: 결제 대상(/checkout?from=cart)
 */
const CART_ITEMS = [
  [0, 1],
  [1, 2],
].map(([index, quantity]) => {
  const product = PRODUCTS[index];
  return {
    productId: product.id,
    name: product.name,
    price: product.price,
    image: '',
    quantity,
    saleType: 'normal',
    deliveryMethod: 'direct',
    storeId: STORE_ID,
    roundId: 'round-open',
    roundItemId: `round-open-item-${index + 1}`,
    roundPrice: product.price,
  };
});
export const browserStorage = {
  localStorage: { greenhub_cart: JSON.stringify(CART_ITEMS) },
  sessionStorage: { checkout_cart: JSON.stringify(CART_ITEMS) },
};

const notFound = (message) => ({ status: 404, body: { message } });
const publicRounds = SALE_ROUNDS;

/** [메서드, 경로 정규식, 처리 함수] — 첫 일치가 응답한다. 처리 함수는 { status?, body, delay? }를 돌려준다. */
export const routes = [
  // 장바구니·결제 화면이 읽는 서버 검증 응답(쓰기 요청이지만 화면이 응답 내용을 쓴다).
  [
    'POST',
    /^\/stores\/[^/]+\/orders\/validate-cart$/,
    () => ({
      body: {
        ok: true,
        salesMode: 'round_direct',
        roundId: 'round-open',
        itemQuantityTotal: CART_ITEMS.reduce((sum, item) => sum + item.quantity, 0),
        totalAmount: CART_ITEMS.reduce((sum, item) => sum + item.roundPrice * item.quantity, 0),
        items: CART_ITEMS.map((item) => ({
          roundItemId: item.roundItemId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.roundPrice,
          subtotalAmount: item.roundPrice * item.quantity,
        })),
      },
    }),
  ],
  // 홈·하단 메뉴·상품 상세: 일반 상품만 둔다(공동구매 목록은 비움).
  [
    'GET',
    /^\/products$/,
    ({ url }) => ({ body: url.searchParams.get('saleType') === 'group' ? [] : PRODUCTS }),
  ],
  [
    'GET',
    /^\/products\/([^/]+)$/,
    ({ params: [id] }) => {
      const product = PRODUCTS.find((p) => p.id === id);
      return product ? { body: product } : notFound('상품 없음');
    },
  ],
  [
    'GET',
    /^\/stores\/([^/]+)\/public-profile$/,
    ({ params: [id] }) => (id === STORE_ID ? { body: PUBLIC_PROFILE } : notFound('스토어 없음')),
  ],
  ['GET', /^\/stores\/[^/]+\/sale-rounds\/public$/, () => ({ body: { items: publicRounds } })],
  [
    'GET',
    /^\/stores\/[^/]+\/sale-rounds\/public\/([^/]+)$/,
    ({ params: [id] }) => {
      const round = publicRounds.find((r) => r.id === id);
      return round ? { body: { ...round, items: roundItems(round) } } : notFound('회차 없음');
    },
  ],
  ['GET', /^\/banner$/, () => ({ body: BANNER })],
  // MY 주문 목록·주문 상세·주문 완료
  ['GET', /^\/orders$/, () => ({ body: ORDERS })],
  [
    'GET',
    /^\/orders\/([^/]+)$/,
    ({ params: [id] }) => {
      const order = ORDERS.find((o) => o.id === id);
      return order ? { body: order } : notFound('주문 없음');
    },
  ],
  // 배송지(useAddresses는 /auth/me의 savedAddresses를 읽는다)
  ['GET', /^\/auth\/me$/, () => ({ body: ME })],
  ['GET', /^\/notifications\/me$/, () => ({ body: { items: NOTIFICATIONS } })],
];

/**
 * 자동 캡처 대상 화면. id는 파일 이름, group은 보고서 묶음이다.
 * auth: false면 로그인 없이 연다.
 */
export const screens = [
  { id: 'home', group: '둘러보기', title: '홈 · 회차 진행 중', path: '/', auth: false },
  {
    id: 'product-round-open',
    group: '둘러보기',
    title: '상품 상세 · 진행 중 회차',
    path: '/products/product-1?round=round-open',
    auth: false,
  },
  {
    id: 'product-round-soldout',
    group: '둘러보기',
    title: '상품 · 회차 품절',
    path: '/products/product-2?round=round-open',
    auth: false,
  },
  {
    id: 'product-round-closed',
    group: '둘러보기',
    title: '상품 상세 · 마감된 회차',
    path: '/products/product-3?round=round-closed',
    auth: false,
  },
  {
    id: 'login',
    group: '둘러보기',
    // 하네스는 E2E_TEST=true로 띄워서 운영에 없는 이메일 입력칸이 함께 보인다.
    title: '로그인 (이메일 칸은 하네스 전용)',
    path: '/login',
    auth: false,
  },
  { id: 'cart', group: '구매', title: '장바구니', path: '/cart', storage: true },
  { id: 'checkout', group: '구매', title: '결제', path: '/checkout?from=cart', storage: true },
  {
    id: 'order-success',
    group: '구매',
    title: '주문 완료',
    path: '/order/success?orderId=order-round-accepted',
  },
  { id: 'mypage', group: 'MY', title: 'MY', path: '/mypage' },
  {
    id: 'order-accepted',
    group: 'MY',
    title: '주문 상세 · 결제 완료',
    path: '/mypage/orders/order-round-accepted',
  },
  {
    id: 'order-delivering',
    group: 'MY',
    title: '주문 상세 · 배송 중',
    path: '/mypage/orders/order-round-delivering',
  },
  {
    id: 'order-cancelled',
    group: 'MY',
    title: '주문 상세 · 취소',
    path: '/mypage/orders/order-round-cancelled',
  },
  { id: 'addresses', group: 'MY', title: '배송지', path: '/mypage/addresses' },
  { id: 'notifications', group: 'MY', title: '알림', path: '/mypage/notifications' },
  { id: 'terms', group: '안내', title: '이용약관', path: '/terms', auth: false },
  { id: 'privacy', group: '안내', title: '개인정보처리방침', path: '/privacy', auth: false },
];
