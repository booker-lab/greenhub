// 기사 앱 화면 확인용 고정 데이터.
// 응답 모양은 API DriverService.projectOrder(apps/api/src/driver/driver.service.ts)의 투영을 따른다.
// 전화번호는 실제 규칙대로 배정 기사에게 보이는 단계에서만 넣는다
// (판매자 전화: 준비 중, 손님 전화: 직배송 배송 중·보류).
const STORE_ID = 'store-visual-0001';
const DRIVER_ID = 'driver-visual-0001';

// 승인된 기사 계정 — 기사 앱 로컬 로그인(authorizeLocalDriver)은 role=driver·driverApproved=true만 받는다.
export const user = {
  id: DRIVER_ID,
  email: 'visual-driver@local.test',
  name: '검증 기사',
  role: 'driver',
  driverApproved: true,
  storeId: null,
};

const NO_REDELIVERY = {
  required: false,
  holdAt: null,
  chargeId: null,
  status: 'NOT_REQUIRED',
  canPay: false,
  paid: false,
  requiresRecovery: false,
};

function driverOrder(id, extra) {
  return {
    id,
    storeId: STORE_ID,
    schemaVersion: 2,
    roundId: 'round-open',
    deliveryMethod: 'direct',
    buyerName: '김그린',
    address: '경기도 이천시 부발읍 경충대로 2091',
    deliveryAddress: { address: '경기도 이천시 부발읍 경충대로 2091' },
    hubName: null,
    hubAddress: null,
    productName: '동양란 빅립',
    quantity: 1,
    preparedAt: '2026-10-05T21:00:00.000Z',
    updatedAt: '2026-10-05T21:00:00.000Z',
    lat: null,
    lng: null,
    redeliveryPayment: NO_REDELIVERY,
    ...extra,
  };
}

const ORDERS = [
  driverOrder('order-prep-1', {
    status: 'PREPARING',
    productName: '동양란 빅립',
    sellerPhone: '010-4452-2104',
    requestNote: '경비실에 맡겨 주세요',
  }),
  driverOrder('order-prep-2', {
    status: 'PREPARING',
    buyerName: '이난초',
    address: '경기도 이천시 증포동 403',
    deliveryAddress: { address: '경기도 이천시 증포동 403' },
    productName: '동양란 만천홍',
    quantity: 2,
    preparedAt: '2026-10-05T21:10:00.000Z',
    sellerPhone: '010-4452-2104',
  }),
  driverOrder('order-deliv-1', {
    status: 'DELIVERING',
    buyerName: '박화분',
    address: '경기도 이천시 중리천로 115 3층',
    deliveryAddress: { address: '경기도 이천시 중리천로 115 3층' },
    productName: '동양란 v3',
    preparedAt: '2026-10-05T20:50:00.000Z',
    buyerPhone: '010-1234-5678',
    requestNote: '도착 전에 전화 주세요',
  }),
  driverOrder('order-held-1', {
    status: 'DELIVERY_HELD',
    buyerName: '최꽃님',
    address: '경기도 이천시 마장면 서이천로 578',
    deliveryAddress: { address: '경기도 이천시 마장면 서이천로 578' },
    productName: '동양란 빅립',
    preparedAt: '2026-10-05T20:40:00.000Z',
    buyerPhone: '010-9876-5432',
    deliveryHold: {
      reasonCode: 'CUSTOMER_UNREACHABLE',
      reasonMessage: '두 번 전화했지만 받지 않음',
      customerResponsible: true,
      redeliveryFee: 3000,
      nextContactAt: '2026-10-06T01:00:00.000Z',
      nextDeliveryAt: null,
    },
    redeliveryPayment: {
      required: true,
      holdAt: '2026-10-06T00:30:00.000Z',
      chargeId: 'charge-visual-0001',
      status: 'PENDING',
      canPay: true,
      paid: false,
      requiresRecovery: false,
    },
  }),
];

/** 목록은 상세 전용 필드(전화·요청사항·보류 사유 등)를 빼고 돌려준다(API view=list와 같게). */
function listView(order) {
  const {
    storeId: _s,
    schemaVersion: _v,
    roundId: _r,
    deliveryAddress: _a,
    requestNote: _n,
    deliveryHold: _h,
    sellerPhone: _sp,
    buyerPhone: _bp,
    ...rest
  } = order;
  return rest;
}

export const routes = [
  ['GET', /^\/driver\/orders$/, () => ({ body: ORDERS.map(listView) })],
  [
    'GET',
    /^\/driver\/orders\/([^/]+)$/,
    ({ params: [id] }) => {
      const order = ORDERS.find((o) => o.id === id);
      return order ? { body: order } : { status: 404, body: { message: '주문 없음' } };
    },
  ],
];

/** 자동 캡처 대상 화면. 지도 화면의 카카오맵은 외부 스크립트라 하네스에서는 그려지지 않는다. */
export const screens = [
  { id: 'login', group: '기사', title: '로그인', path: '/login', auth: false },
  { id: 'board', group: '기사', title: '배송판', path: '/board' },
  {
    id: 'board-preparing',
    group: '기사',
    title: '주문 상세 · 준비 중',
    path: '/board/order-prep-1',
  },
  {
    id: 'board-delivering',
    group: '기사',
    title: '주문 상세 · 배송 중',
    path: '/board/order-deliv-1',
  },
  { id: 'board-held', group: '기사', title: '주문 상세 · 배송 보류', path: '/board/order-held-1' },
  {
    id: 'board-delivering-tab',
    group: '기사',
    title: '배송판 · 배송 중 탭',
    path: '/board?tab=delivering',
  },
  // 모달·전체 화면 덮개·알림은 지금 보이는 화면이 중요해 화면 크기 그대로 찍는다(viewport: true).
  {
    id: 'modal-hold',
    group: '기사',
    title: '배송 보류 모달',
    path: '/board/order-deliv-1',
    steps: [{ click: '배송 보류' }],
    viewport: true,
  },
  {
    id: 'photo-round-direct',
    group: '기사',
    title: '배송 완료 사진 촬영',
    path: '/board/order-deliv-1/photo/round-direct',
    viewport: true,
  },
  // 헤드리스 브라우저에는 카메라가 없어 getUserMedia가 거절된다 → 앱이 권한 안내 문구를 띄운다.
  {
    id: 'photo-camera-denied',
    group: '기사',
    title: '배송 완료 사진 · 카메라 권한 없음',
    path: '/board/order-deliv-1/photo/round-direct',
    steps: [{ click: '카메라 촬영' }],
    viewport: true,
  },
  // 알림(toast): 가짜 API는 상태 변경 PATCH에 200 {}을 돌려준다. 앱은 ACK(orderId·status)가 맞지 않으므로
  // 다시 보내지 않고 주문을 다시 읽는다(불확실 수렴). 다시 읽어도 준비 중이라 "확실하지 않음"·"아직 처리되지 않음"
  // 두 알림이 뜬다(apps/driver/src/app/board/[orderId]/page.tsx).
  {
    id: 'toast-status-uncertain',
    group: '기사',
    title: '알림 · 상태 변경 확인 못 함',
    path: '/board/order-prep-1',
    steps: [{ click: '수거 완료 / 배송 시작' }],
    viewport: true,
    // 알림이 들어오는 전환(높이·위치) 중 그려진 그림이 남아 찍을 때마다 1px씩 달라진다(shots.mjs 참고).
    freezeTransitions: true,
  },
  { id: 'map', group: '기사', title: '지도', path: '/map' },
  { id: 'profile', group: '기사', title: '내 정보', path: '/profile' },
];
