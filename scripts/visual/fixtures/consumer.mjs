// 소비자 앱 화면 확인용 고정 데이터 — 프런트 개편 1순위 동선(회차 구매).
// 스토어는 회차 직판(round_direct) 모드다. 회차 일정·상품은 seller.mjs와 맞춘다.
// 화면을 추가할 때 경로를 여기에 더한다.
import { hoursFromNow } from '../clock.mjs';

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
    extras: {
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
    },
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
    extras: {
      size: { heightCm: 50, potDiameterCm: 15 },
      light: 'bright',
      placements: ['store', 'office'],
      guaranteed: true,
      aliases: ['개업 선물 난'],
    },
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
    extras: {
      size: { heightCm: 70, widthCm: 45, potDiameterCm: 18, bloomCount: 30 },
      light: 'medium',
      placements: ['living'],
    },
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
  // 팔도감 벤치마킹 비교 기능의 상품 추가 정보. 기능이 꺼진 화면은 읽지 않는다.
  ...(spec.extras ?? {}),
}));

const PUBLIC_PROFILE = {
  id: STORE_ID,
  name: STORE_NAME,
  logoUrl: null,
  salesMode: 'round_direct',
  // 비교 기능: 가게 소개·품질 보장·남은 수량 공개
  intro: '매주 경매에서 직접 골라 보내는 이천 꽃집',
  story:
    '매주 경매에서 상태 좋은 동양란만 골라 들여옵니다.\n온실에서 하루 쉬게 한 뒤 직접 차에 실어 문 앞까지 가져다드려요.',
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
// 비교 기능(card-discount): API가 판매 중 회차 상품에 붙여 주는 직전 마감 회차 판매가.
// 빅립은 3,000원 내린 문구가 보이고, 만천홍은 같은 값이라 아무것도 보이지 않으며, v3는 근거가 없다.
const PREVIOUS_ROUND_PRICES = { 'product-1': 33000, 'product-2': 25000 };
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
  // 비교 기능 화면(후기·관리 안내·다시 주문·옵션·선물·포장 라벨)을 보는 배송 완료 주문.
  roundOrder('order-round-delivered', '20260925-000020', ROUND_CLOSED, 'DELIVERED', [[0, 1]], {
    orderItems: [
      {
        ...orderItem(ROUND_CLOSED, 0, 1),
        unitPrice: PRODUCTS[0].price + 13000,
        subtotalAmount: PRODUCTS[0].price + 13000,
        selectedOptions: [
          { groupId: 'g1', groupName: '화분', choiceId: 'c2', choiceLabel: '백자 도자기 화분', priceDelta: 8000 },
          { groupId: 'g2', groupName: '축하 토퍼', choiceId: 'c5', choiceLabel: '祝 生辰', priceDelta: 5000 },
        ],
      },
    ],
    totalAmount: PRODUCTS[0].price + 13000,
    gift: {
      recipientName: '박엄마',
      recipientPhone: '010-1234-5678',
      senderName: '김그린',
      cardMessage: '늘 고마워요. 건강하세요!',
    },
    packageLabel: '김그린',
    createdAt: '2026-09-25T04:00:00.000Z',
    updatedAt: '2026-09-29T00:10:00.000Z',
  }),
  roundOrder('order-round-cancelled', '20261001-000004', ROUND_OPEN, 'CANCELLED', [[1, 1]], {
    cancelReason: '고객 요청',
    createdAt: '2026-10-01T02:05:00.000Z',
    updatedAt: '2026-10-01T06:40:00.000Z',
  }),
];
// MY 주문 목록(/orders)에는 넣지 않고 주문 상세로만 여는 주문. 목록 화면(mypage)의 촬영 결과를 바꾸지 않는다.
// - order-round-held: 고객 사유 배송 보류 + 재배송비 결제 대기(결제 수단 고르기·재배송비 결제 버튼).
//   결제 수단이 2개 이상일 때만 결제 수단 고르기가 보이므로 paymentMethodScreens(--set payment-methods)에서 찍는다.
const HELD_AT = '2026-09-29T01:30:00.000Z';
const DETAIL_ONLY_ORDERS = [
  roundOrder('order-round-held', '20260926-000040', ROUND_CLOSED, 'DELIVERY_HELD', [[2, 1]], {
    createdAt: '2026-09-26T05:40:00.000Z',
    updatedAt: HELD_AT,
    deliveryHold: {
      heldAt: HELD_AT,
      reasonCode: 'CUSTOMER_UNREACHABLE',
      reasonMessage: '받는 분과 연락이 닿지 않아 배송을 보류했습니다.',
      customerResponsible: true,
      redeliveryFee: 5000,
      nextContactAt: null,
      nextDeliveryAt: null,
      resolvedAt: null,
    },
    redeliveryPayment: {
      required: true,
      holdAt: HELD_AT,
      chargeId: null,
      status: 'MISSING',
      canPay: true,
      paid: false,
      requiresRecovery: false,
    },
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
  [2, 1],
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

// ── 팔도감 벤치마킹 비교 기능 응답(기능이 꺼진 화면은 부르지 않는다) ──
const REVIEW_STATS = {
  'product-1': { count: 24, average: 4.8 },
  'product-2': { count: 9, average: 4.6 },
};
const REVIEWS = [
  {
    id: 'review-1',
    productId: 'product-1',
    rating: 5,
    text: '꽃대가 사진보다 튼실하게 왔어요. 화요일 아침에 정확히 문 앞에 있었습니다.',
    authorName: '이*연',
    createdAt: '2026-09-30T02:00:00.000Z',
  },
  {
    id: 'review-2',
    productId: 'product-1',
    rating: 5,
    text: '도자기 화분으로 골랐는데 선물하기 좋네요. 관리법 카드도 들어 있었어요.',
    authorName: '정*호',
    createdAt: '2026-09-23T05:00:00.000Z',
  },
  {
    id: 'review-3',
    productId: 'product-1',
    rating: 4,
    text: '반쯤 핀 상태로 와서 일주일 뒤에 활짝 폈어요.',
    authorName: '최*은',
    createdAt: '2026-09-16T08:00:00.000Z',
  },
];
const benchmarkRoutes = [
  ['GET', /^\/stores\/[^/]+\/review-stats$/, () => ({ body: REVIEW_STATS })],
  [
    'GET',
    /^\/products\/([^/]+)\/reviews$/,
    ({ params: [id] }) => {
      const items = REVIEWS.filter((review) => review.productId === id);
      return { body: { summary: REVIEW_STATS[id] ?? { count: 0, average: 0 }, items } };
    },
  ],
  ['GET', /^\/orders\/[^/]+\/reviews$/, () => ({ body: [] })],
  ['GET', /^\/me\/restock-subscriptions$/, () => ({ body: [] })],
  ['POST', /^\/stores\/[^/]+\/product-requests$/, () => ({ body: { id: 'request-visual' } })],
  ['POST', /^\/partner-inquiries$/, () => ({ body: { id: 'inquiry-visual' } })],
];

/**
 * 화면별 상황. 캡처 스크립트가 화면을 열기 전에 이 경로들을 기본 경로 앞에 끼운다.
 * - scheduled: 판매 중·지난 회차 없이 다음 회차만 예정된 주(오픈 알림·빈 지난 회차 숨김).
 */
export const scenarioRoutes = {
  // 주문 생성 거절(서버 확정 거절 4xx): 결제 화면의 오류 안내(role=alert)를 찍는다.
  'order-reject': [
    [
      'POST',
      /^\/stores\/[^/]+\/orders$/,
      () => ({ status: 409, body: { message: '회차 판매 수량이 모두 찼습니다. 장바구니를 다시 확인해 주세요.' } }),
    ],
  ],
  // 주문 생성 응답을 늦춘다: 결제 버튼의 처리 중 상태(비활성·"처리 중...")를 찍는다.
  'order-slow': [
    [
      'POST',
      /^\/stores\/[^/]+\/orders$/,
      ({ body }) => ({ ...createOrderResponse(body), delay: 30_000 }),
    ],
  ],
  scheduled: [
    [
      'GET',
      /^\/stores\/[^/]+\/sale-rounds\/public$/,
      ({ url }) => ({
        body: {
          items: publicRoundList(
            url,
            SALE_ROUNDS.filter((round) => round.status === 'SCHEDULED'),
          ),
        },
      }),
    ],
  ],
};

const notFound = (message) => ({ status: 404, body: { message } });
const publicRounds = SALE_ROUNDS;

/** 공개 회차 상세(상품 포함). 상세 경로와 목록 `?include=items` 응답이 같은 모양을 쓴다. */
function publicRoundDetail(round) {
  // 비교 기능(demand-signals): showDemandSignals 가게만 API가 붙여 준다.
  const items = roundItems(round).map((item) => {
    const previousRoundPrice =
      round.status === 'OPEN' ? PREVIOUS_ROUND_PRICES[item.productId] : undefined;
    return {
      ...item,
      demand: { remainingQuantity: Math.max(0, item.saleLimitQuantity - item.orderedQuantity) },
      ...(previousRoundPrice === undefined ? {} : { previousRoundPrice }),
    };
  });
  return { ...round, items, demand: { buyerCount: round.counters.orderedDeliveryAddresses } };
}

/**
 * 공개 회차 목록. 앱은 `?include=items&past=N`으로 판매 예정·판매 중 전부와 최신 지난 회차 N개를
 * 상품까지 한 번에 받는다(API sale-rounds.controller `include=items`). 그 밖에는 회차만 준다.
 */
function publicRoundList(url, rounds) {
  if (url.searchParams.get('include') !== 'items') return rounds;
  const past = Number(url.searchParams.get('past') ?? 0);
  const live = rounds.filter((r) => r.status === 'SCHEDULED' || r.status === 'OPEN');
  const closed = rounds
    .filter((r) => r.status === 'CLOSED' || r.status === 'COMPLETED')
    .sort((a, b) => b.schedule.orderOpenAt.localeCompare(a.schedule.orderOpenAt))
    .slice(0, past);
  return [...live, ...closed].map(publicRoundDetail);
}

/**
 * 주문 생성(POST /stores/:storeId/orders) 응답. 결제 버튼을 누른 화면이 이 응답으로 결제창(PortOne stub)을 연다.
 * 금액은 앱이 보낸 회차 상품·옵션으로 계산한다(앱은 장바구니 금액과 다르면 결제창을 열지 않는다).
 * orderId는 주문 완료·주문 상세 화면이 읽는 기존 주문을 돌려준다(결제 완료 뒤 이동 화면을 그대로 찍는다).
 */
function createOrderResponse(body) {
  let request = {};
  try {
    request = JSON.parse(body || '{}');
  } catch {
    /* 빈 본문 */
  }
  const lines = Array.isArray(request.roundItems)
    ? request.roundItems
    : [{ roundItemId: null, productId: request.productId, quantity: request.quantity }];
  let amount = 0;
  const names = [];
  for (const line of lines) {
    const index = line.roundItemId
      ? Number(String(line.roundItemId).split('-item-')[1]) - 1
      : PRODUCTS.findIndex((p) => p.id === line.productId);
    const product = PRODUCTS[index];
    if (!product) continue;
    const delta = (product.options ?? [])
      .flatMap((group) => group.choices)
      .filter((choice) => (line.optionChoiceIds ?? []).includes(choice.id))
      .reduce((sum, choice) => sum + choice.priceDelta, 0);
    amount += (product.price + delta) * Number(line.quantity ?? 0);
    names.push(product.name);
  }
  const name = names.length > 1 ? `${names[0]} 외 ${names.length - 1}건` : (names[0] ?? '주문');
  return {
    body: { orderId: 'order-round-accepted', portonePaymentParams: { name, amount } },
  };
}

/** [메서드, 경로 정규식, 처리 함수] — 첫 일치가 응답한다. 처리 함수는 { status?, body, delay? }를 돌려준다. */
export const routes = [
  // 장바구니·결제 화면이 읽는 서버 검증 응답(쓰기 요청이지만 화면이 응답 내용을 쓴다).
  // 화면이 보낸 회차 상품만 그대로 돌려준다(품절 상품을 빼고 보내면 응답에서도 빠진다).
  [
    'POST',
    /^\/stores\/[^/]+\/orders\/validate-cart$/,
    ({ body }) => {
      let request = {};
      try {
        request = JSON.parse(body || '{}');
      } catch {
        /* 빈 본문 */
      }
      const lines = Array.isArray(request.roundItems) ? request.roundItems : [];
      const items = lines.map((line) => {
        const index = Number(String(line.roundItemId).split('-item-')[1]) - 1;
        const product = PRODUCTS[index];
        const delta = (product?.options ?? [])
          .flatMap((group) => group.choices)
          .filter((choice) => (line.optionChoiceIds ?? []).includes(choice.id))
          .reduce((sum, choice) => sum + choice.priceDelta, 0);
        const unitPrice = (product?.price ?? 0) + delta;
        return {
          roundItemId: line.roundItemId,
          productId: product?.id,
          quantity: line.quantity,
          unitPrice,
          subtotalAmount: unitPrice * line.quantity,
        };
      });
      return {
        body: {
          ok: true,
          salesMode: 'round_direct',
          roundId: request.roundId ?? 'round-open',
          itemQuantityTotal: items.reduce((sum, item) => sum + item.quantity, 0),
          totalAmount: items.reduce((sum, item) => sum + item.subtotalAmount, 0),
          items,
        },
      };
    },
  ],
  ['POST', /^\/stores\/[^/]+\/orders$/, ({ body }) => createOrderResponse(body)],
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
  [
    'GET',
    /^\/stores\/[^/]+\/sale-rounds\/public$/,
    ({ url }) => ({ body: { items: publicRoundList(url, publicRounds) } }),
  ],
  [
    'GET',
    /^\/stores\/[^/]+\/sale-rounds\/public\/([^/]+)$/,
    ({ params: [id] }) => {
      const round = publicRounds.find((r) => r.id === id);
      return round ? { body: publicRoundDetail(round) } : notFound('회차 없음');
    },
  ],
  ['GET', /^\/banner$/, () => ({ body: BANNER })],
  // MY 주문 목록·주문 상세·주문 완료
  ['GET', /^\/orders$/, () => ({ body: ORDERS })],
  [
    'GET',
    /^\/orders\/([^/]+)$/,
    ({ params: [id] }) => {
      const order = ORDERS.find((o) => o.id === id) ?? DETAIL_ONLY_ORDERS.find((o) => o.id === id);
      return order ? { body: order } : notFound('주문 없음');
    },
  ],
  // 배송지(useAddresses는 /auth/me의 savedAddresses를 읽는다)
  ['GET', /^\/auth\/me$/, () => ({ body: ME })],
  ['GET', /^\/notifications\/me$/, () => ({ body: { items: NOTIFICATIONS } })],
  ...benchmarkRoutes,
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
  // ── 결제 동선 단계(UI 교체 P5): 누르고 적은 뒤의 화면·쓰기 요청 본문·결제창 호출 인자·접근성 의미를 남긴다 ──
  {
    id: 'product-quantity',
    group: '결제 동선',
    title: '상품 상세 · 수량 2개',
    path: '/products/product-1?round=round-open',
    steps: [{ press: '수량 늘리기' }],
  },
  {
    // 상단 바 장바구니 아이콘도 이름이 '장바구니'라 두 번째(아래 담기 버튼)를 누른다.
    id: 'product-add-to-cart',
    group: '결제 동선',
    title: '상품 상세 · 장바구니 담기 → 장바구니',
    path: '/products/product-1?round=round-open',
    expectPath: '/cart',
    steps: [{ press: '수량 늘리기' }, { press: '장바구니', nth: 1 }, { waitPath: '/cart' }],
  },
  {
    id: 'cart-quantity',
    group: '결제 동선',
    title: '장바구니 · 첫 상품 수량 늘림',
    path: '/cart',
    storage: true,
    steps: [{ press: '동양란 빅립 수량 늘리기' }],
  },
  {
    id: 'cart-to-checkout',
    group: '결제 동선',
    title: '장바구니 → 결제',
    path: '/cart',
    storage: true,
    expectPath: '/checkout',
    steps: [{ press: '2개 상품 한 번에 결제' }, { waitPath: '/checkout' }],
  },
  {
    id: 'checkout-request-note',
    group: '결제 동선',
    title: '결제 · 요청사항 입력',
    path: '/checkout?from=cart',
    storage: true,
    steps: [{ fill: { label: '요청사항 (선택)', value: '받는 분 김그린 010-0000-0000 / 문구: 개업을 축하합니다' } }],
  },
  {
    id: 'checkout-ready',
    group: '결제 동선',
    title: '결제 · 결제 버튼 직전(변경 확인)',
    path: '/checkout?from=cart',
    storage: true,
    steps: [{ check: '상품·가격·회차 변경 내용을 확인했습니다.' }],
  },
  {
    id: 'checkout-processing',
    group: '결제 동선',
    title: '결제 · 처리 중(주문 생성 응답 대기)',
    path: '/checkout?from=cart',
    storage: true,
    scenario: 'order-slow',
    portone: 'success',
    steps: [
      { check: '상품·가격·회차 변경 내용을 확인했습니다.' },
      { press: '카카오페이로 결제하기' },
    ],
  },
  {
    id: 'checkout-rejected',
    group: '결제 동선',
    title: '결제 · 주문 생성 거절 안내',
    path: '/checkout?from=cart',
    storage: true,
    scenario: 'order-reject',
    portone: 'success',
    expectedErrors: ['status of 409 \\(Conflict\\).*/stores/store-visual-0001/orders\\)$'],
    steps: [
      { check: '상품·가격·회차 변경 내용을 확인했습니다.' },
      { press: '카카오페이로 결제하기' },
    ],
  },
  {
    id: 'checkout-pay-cancelled',
    group: '결제 동선',
    title: '결제 · 결제창 취소 안내',
    path: '/checkout?from=cart',
    storage: true,
    portone: 'cancel',
    steps: [
      { check: '상품·가격·회차 변경 내용을 확인했습니다.' },
      { press: '카카오페이로 결제하기' },
    ],
  },
  {
    // 결제 완료 응답을 받으면 주문 완료 화면으로 바꾼다(router.replace).
    id: 'checkout-paid',
    group: '결제 동선',
    title: '결제 · 결제 완료 → 주문 완료',
    path: '/checkout?from=cart',
    storage: true,
    portone: 'success',
    expectPath: '/order/success',
    steps: [
      { fill: { label: '요청사항 (선택)', value: '문 앞에 두세요' } },
      { check: '상품·가격·회차 변경 내용을 확인했습니다.' },
      { press: '카카오페이로 결제하기' },
      { waitPath: '/order/success' },
    ],
  },
  {
    // 상품 상세 '바로 구매'는 그 상품 하나로 결제 화면을 연다.
    id: 'product-buy-now',
    group: '결제 동선',
    title: '상품 상세 → 바로 구매',
    path: '/products/product-1?round=round-open',
    expectPath: '/checkout',
    steps: [{ press: '바로 구매' }, { waitPath: '/checkout' }],
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
  {
    id: 'notification-settings',
    group: 'MY',
    title: '알림 설정',
    path: '/mypage/notifications/settings',
  },
  { id: 'withdraw', group: 'MY', title: '회원 탈퇴', path: '/mypage/withdraw' },
  { id: 'category', group: '찾기', title: '상품 탭', path: '/category', auth: false },
  { id: 'search', group: '찾기', title: '검색', path: '/search', auth: false },
  {
    id: 'search-result',
    group: '찾기',
    title: '검색 · 결과 "빅립"',
    path: '/search',
    auth: false,
    steps: [{ fill: '빅립' }],
  },
  // 가게가 회차 직배송(round_direct)이면 공동구매 화면은 홈으로 보낸다(apps/consumer/src/app/groupbuy/page.tsx).
  // 이 이동이 그대로인지를 확인하는 화면이다.
  {
    id: 'groupbuy',
    group: '찾기',
    title: '공동구매 → 홈(회차 직배송 가게)',
    path: '/groupbuy',
    expectPath: '/',
    auth: false,
  },
  { id: 'terms', group: '안내', title: '이용약관', path: '/terms', auth: false },
  { id: 'privacy', group: '안내', title: '개인정보처리방침', path: '/privacy', auth: false },
  // 기능 플래그(NEXT_PUBLIC_GREENHUB_FEATURES)가 꺼져 있으면 404인 화면은 넣지 않는다:
  // /guarantee·/partner·/store/[storeId]·/mypage/wishlist·/mypage/purchase-history.
  // 운영 기본값이 비어 있어 지금은 모두 404다. 기능을 켠 모양은 benchmarkScreens가 찍는다.
];

/** 이번 회차 찜(wishlist)은 브라우저에만 있다. wish: true 화면은 열기 전에 이 값을 넣는다. */
export const wishStorage = {
  localStorage: { 'greenhub_round_wish:round-open': JSON.stringify(['product-1', 'product-3']) },
};

/**
 * 팔도감 벤치마킹 비교(수정 전·후)용 화면. features는 그 화면에서 보이는 기능 토글 키다.
 * - scenario: scenarioRoutes 이름(그 화면을 열 때만 경로를 바꾼다)
 * - storage: 장바구니·결제 대상, wish: 이번 회차 찜을 브라우저에 넣고 연다
 * - steps: 찍기 전에 차례로 할 일. { click: '글자' } 또는 { fill: { label, value } } / { fill: '첫 입력칸 값' }.
 *   누를 글자가 없으면(수정 전 화면) 거기서 멈추고 찍는다.
 * - viewport: true면 지금 보이는 화면만 찍는다(아래에서 올라오는 시트 등)
 */
export const benchmarkScreens = [
  {
    id: 'bm-home',
    group: '홈',
    title: '홈 · 회차 진행 중(로그인)',
    path: '/',
    wish: true,
    features: [
      'countdown-date', 'demand-signals', 'card-discount', 'reviews', 'seller-store', 'wishlist',
      'quality-guarantee', 'plant-search', 'partner-inquiry',
    ],
  },
  {
    id: 'bm-home-scheduled',
    group: '홈',
    title: '홈 · 다음 회차만 예정',
    path: '/',
    scenario: 'scheduled',
    features: ['open-alert', 'hide-empty-past', 'countdown-date'],
  },
  {
    id: 'bm-search-alias',
    group: '찾기',
    title: '검색 · 별칭으로 찾기 "개업 선물"',
    path: '/search',
    steps: [{ fill: '개업 선물' }],
    features: ['plant-search'],
  },
  {
    id: 'bm-search-empty',
    group: '찾기',
    title: '검색 · 결과 없음 "수국"',
    path: '/search',
    steps: [{ fill: '수국' }],
    features: ['product-request'],
  },
  {
    id: 'bm-category',
    group: '찾기',
    title: '상품 탭',
    path: '/category',
    features: ['category-round-label', 'product-request'],
  },
  {
    id: 'bm-product',
    group: '상품',
    title: '상품 상세 · 판매 중',
    path: '/products/product-1?round=round-open',
    wish: true,
    features: [
      'detail-images', 'size-info', 'care-guide', 'reviews', 'seller-store', 'quality-guarantee',
      'recommendations', 'card-discount', 'wishlist',
    ],
  },
  {
    id: 'bm-product-options',
    group: '상품',
    title: '상품 상세 · 옵션 시트(축하 토퍼 고르기)',
    path: '/products/product-1?round=round-open',
    viewport: true,
    steps: [
      { click: '장바구니' },
      { click: '祝 開業' },
    ],
    features: ['option-sheet'],
  },
  {
    id: 'bm-product-soldout',
    group: '상품',
    title: '상품 상세 · 품절',
    path: '/products/product-2?round=round-open',
    features: ['restock-alert'],
  },
  {
    id: 'bm-cart',
    group: '구매',
    title: '장바구니(로그인)',
    path: '/cart',
    storage: true,
    features: ['arrival-everywhere', 'icheon-precheck', 'cart-upsell'],
  },
  {
    id: 'bm-cart-guest',
    group: '구매',
    title: '장바구니(비로그인)',
    path: '/cart',
    storage: true,
    auth: false,
    features: ['guest-cart'],
  },
  {
    id: 'bm-login',
    group: '구매',
    title: '로그인',
    path: '/login?callbackUrl=%2Fcart',
    auth: false,
    features: ['guest-cart'],
  },
  {
    id: 'bm-checkout',
    group: '구매',
    title: '결제',
    path: '/checkout?from=cart',
    storage: true,
    features: ['arrival-everywhere'],
  },
  {
    id: 'bm-checkout-gift',
    group: '구매',
    title: '결제 · 선물로 보내요',
    path: '/checkout?from=cart',
    storage: true,
    steps: [
      { click: '선물로 보내요' },
      { fill: { label: '이름', value: '박엄마', nth: 0 } },
      { fill: { label: '이름', value: '김그린', nth: 1 } },
      { fill: { label: '카드 문구', value: '늘 고마워요. 건강하세요!' } },
    ],
    features: ['gift'],
  },
  {
    id: 'bm-checkout-package-label',
    group: '구매',
    title: '결제 · 포장 라벨 문구 넣기',
    path: '/checkout?from=cart',
    storage: true,
    steps: [{ click: '문구 넣기' }, { fill: { label: '라벨 문구', value: '祝 開業 그린상회' } }],
    features: ['option-sheet'],
  },
  {
    // 선물을 채워 결제까지 진행한다. 주문 생성 본문의 gift와 결제창 인자를 남긴다.
    // 선물을 켜면 포장 라벨 칸은 보내는 분 이름으로 합쳐져 보이지 않는다(#705).
    id: 'bm-checkout-gift-paid',
    group: '구매',
    title: '결제 · 선물 → 결제 완료',
    path: '/checkout?from=cart',
    storage: true,
    portone: 'success',
    expectPath: '/order/success',
    steps: [
      { click: '선물로 보내요' },
      { fill: { label: '이름', value: '박엄마', nth: 0 } },
      { fill: { label: '이름', value: '김그린', nth: 1 } },
      { fill: { label: '카드 문구', value: '늘 고마워요. 건강하세요!' } },
      { check: '상품·가격·회차 변경 내용을 확인했습니다.' },
      { press: '카카오페이로 결제하기' },
      { waitPath: '/order/success' },
    ],
    features: ['gift'],
  },
  {
    // 포장 라벨 문구를 넣고 결제까지 진행한다. 주문 생성 본문의 packageLabel을 남긴다.
    id: 'bm-checkout-label-paid',
    group: '구매',
    title: '결제 · 포장 라벨 → 결제 완료',
    path: '/checkout?from=cart',
    storage: true,
    portone: 'success',
    expectPath: '/order/success',
    steps: [
      { click: '문구 넣기' },
      { fill: { label: '라벨 문구', value: '祝 開業 그린상회' } },
      { check: '상품·가격·회차 변경 내용을 확인했습니다.' },
      { press: '카카오페이로 결제하기' },
      { waitPath: '/order/success' },
    ],
    features: ['option-sheet'],
  },
  {
    // 옵션 시트에서 토퍼를 고르고 담는다. 장바구니에 담긴 옵션(optionChoiceIds)을 저장소 기록으로 남긴다.
    id: 'bm-product-options-added',
    group: '상품',
    title: '상품 상세 · 옵션 골라 담기 → 장바구니',
    path: '/products/product-1?round=round-open',
    expectPath: '/cart',
    steps: [
      { click: '장바구니' },
      { click: '祝 開業' },
      { click: '장바구니 담기' },
      { waitPath: '/cart' },
    ],
    features: ['option-sheet'],
  },
  {
    id: 'bm-success',
    group: '구매',
    title: '주문 완료',
    path: '/order/success?orderId=order-round-accepted',
    features: ['order-success-guide'],
  },
  {
    id: 'bm-success-cancelled',
    group: '구매',
    title: '주문 완료 화면 · 결제 취소(실패)',
    path: '/order/success?orderId=order-round-cancelled',
    features: ['payment-fail-stay'],
  },
  {
    id: 'bm-mypage',
    group: 'MY',
    title: 'MY',
    path: '/mypage',
    features: ['wishlist', 'purchase-history'],
  },
  {
    id: 'bm-wishlist',
    group: 'MY',
    title: 'MY · 이번 회차 찜',
    path: '/mypage/wishlist',
    wish: true,
    features: ['wishlist'],
  },
  {
    // 기존 주문 4건 재사용: 빅립 2건(접수·배송 완료)·만천홍 1건(취소 주문은 빠짐)·세 번째 상품 1건.
    id: 'bm-purchase-history',
    group: 'MY',
    title: 'MY · 구매한 꽃',
    path: '/mypage/purchase-history',
    features: ['purchase-history'],
  },
  {
    id: 'bm-order-delivered',
    group: 'MY',
    title: '주문 상세 · 배송 완료(옵션 문구·선물)',
    path: '/mypage/orders/order-round-delivered',
    features: ['reviews', 'care-guide', 'reorder', 'option-sheet', 'gift'],
  },
  {
    id: 'bm-store',
    group: '가게·안내',
    title: '판매자 소개',
    path: '/store/store-visual-0001',
    auth: false,
    features: ['seller-store', 'reviews'],
  },
  {
    id: 'bm-guarantee',
    group: '가게·안내',
    title: '품질 보장 안내',
    path: '/guarantee',
    auth: false,
    features: ['quality-guarantee'],
  },
  {
    id: 'bm-partner',
    group: '가게·안내',
    title: '입점 문의',
    path: '/partner',
    auth: false,
    features: ['partner-inquiry'],
  },
];

/**
 * 결제 수단이 여러 개(카카오페이·네이버페이·카드)일 때만 보이는 화면.
 * 결제 수단 목록은 빌드 때 채널 키로 정해지므로(apps/consumer/src/lib/payment-method-options.ts)
 * `start.mjs consumer --payment-methods all`로 띄운 서버에서 `shots.mjs consumer --set payment-methods`로 찍는다.
 * 기본 묶음(screens)은 카카오페이 하나라 이 화면들과 같은 서버로 찍지 않는다.
 */
export const paymentMethodScreens = [
  {
    id: 'checkout-payment-methods',
    group: '결제 동선',
    title: '결제 · 결제 수단 고르기(카카오페이·네이버페이·카드)',
    path: '/checkout?from=cart',
    storage: true,
    steps: [{ check: '상품·가격·회차 변경 내용을 확인했습니다.' }],
  },
  {
    id: 'order-redelivery-fee',
    group: 'MY',
    title: '주문 상세 · 배송 보류 재배송비 결제(결제 수단 고르기)',
    path: '/mypage/orders/order-round-held',
  },
];
