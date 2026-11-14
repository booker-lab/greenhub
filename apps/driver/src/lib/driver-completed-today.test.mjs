import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyDriverCompletedPhotoStatus,
  driverCompletedStatusLabel,
  formatSeoulClock,
  readDriverCompletedPhoto,
  readDriverCompletedToday,
} from './driver-completed-today.ts';

const validRow = (extra = {}) => ({
  id: 'order-1',
  status: 'DELIVERED',
  deliveredAt: '2026-11-13T05:07:00.000Z',
  address: '경기도 이천시 증포동 새봄마을아파트 103동 1204호',
  deliveryAddress: {
    address: '경기도 이천시 증포동 새봄마을아파트',
    addressDetail: '103동 1204호',
  },
  productName: '동양란 빅립',
  quantity: 3,
  items: [
    { productName: '동양란 빅립', quantity: 1 },
    { productName: '서양란 호접', quantity: 2 },
  ],
  hasPhoto: true,
  ...extra,
});

test('정상 응답은 화면이 쓰는 필드만 골라 순서대로 읽는다', () => {
  const parsed = readDriverCompletedToday({
    date: '2026-11-13',
    orders: [validRow(), validRow({ id: 'order-2', status: 'REVIEWED', hasPhoto: false })],
  });
  assert.equal(parsed?.date, '2026-11-13');
  assert.deepEqual(
    parsed?.orders.map((order) => order.id),
    ['order-1', 'order-2'],
  );
  assert.deepEqual(parsed?.orders[0], validRow());
  assert.equal(parsed?.orders[1].hasPhoto, false);
});

test('손님 이름·전화 같은 계약 밖 필드는 응답에 섞여 와도 옮기지 않는다', () => {
  const parsed = readDriverCompletedToday({
    date: '2026-11-13',
    orders: [validRow({ buyerName: '김그린', buyerPhone: '010-1234-5678', photoUrl: 'https://x' })],
  });
  const row = parsed?.orders[0] ?? {};
  for (const key of ['buyerName', 'buyerPhone', 'photoUrl']) {
    assert.equal(key in row, false, key);
  }
});

test('필수 필드가 어긋난 행은 버리고 나머지는 남긴다', () => {
  const malformed = [
    null,
    'order',
    [],
    validRow({ id: '' }),
    validRow({ id: 7 }),
    validRow({ status: 'DELIVERING' }),
    validRow({ status: 'delivered' }),
    validRow({ deliveredAt: 'not-a-date' }),
    validRow({ deliveredAt: null }),
    validRow({ address: '   ' }),
    validRow({ productName: undefined }),
    validRow({ quantity: 0 }),
    validRow({ quantity: 1.5 }),
    validRow({ quantity: '2' }),
    validRow({ hasPhoto: 'true' }),
    validRow({ hasPhoto: undefined }),
  ];
  const parsed = readDriverCompletedToday({
    date: '2026-11-13',
    orders: [...malformed, validRow({ id: 'ok' })],
  });
  assert.deepEqual(
    parsed?.orders.map((order) => order.id),
    ['ok'],
  );
});

test('같은 id가 다시 나오면 처음 행만 남긴다', () => {
  const parsed = readDriverCompletedToday({
    date: '2026-11-13',
    orders: [validRow(), validRow({ status: 'CANCELLED' })],
  });
  assert.equal(parsed?.orders.length, 1);
  assert.equal(parsed?.orders[0].status, 'DELIVERED');
});

test('선택 필드만 어긋나면 그 필드만 빼고 행은 남긴다', () => {
  const parsed = readDriverCompletedToday({
    date: '2026-11-13',
    orders: [
      validRow({ id: 'a', items: [{ productName: '동양란', quantity: 0 }] }),
      validRow({ id: 'b', items: 'x', deliveryAddress: { address: '' } }),
      validRow({ id: 'c', deliveryAddress: { address: '경기도 이천시', addressDetail: 3 } }),
    ],
  });
  const [a, b, c] = parsed?.orders ?? [];
  assert.equal('items' in a, false);
  assert.equal('items' in b, false);
  assert.equal('deliveryAddress' in b, false);
  assert.deepEqual(c.deliveryAddress, { address: '경기도 이천시' });
});

test('목록이 배열이 아니면 null(조회 실패로 다룬다), 날짜만 어긋나면 date만 null', () => {
  for (const payload of [null, [], 'x', {}, { orders: null }, { orders: {} }]) {
    assert.equal(readDriverCompletedToday(payload), null);
  }
  assert.deepEqual(readDriverCompletedToday({ date: '11/13', orders: [] }), {
    date: null,
    orders: [],
  });
});

test('상태 글자: 구매확정·환불됨, 배송 완료는 글자 없음', () => {
  assert.equal(driverCompletedStatusLabel('REVIEWED'), '구매확정');
  assert.equal(driverCompletedStatusLabel('CANCELLED'), '환불됨');
  assert.equal(driverCompletedStatusLabel('DELIVERED'), null);
});

test('완료 시각은 휴대폰 시간대와 관계없이 서울 HH:mm', () => {
  assert.equal(formatSeoulClock('2026-11-13T05:07:00.000Z'), '14:07');
  // 서울 자정 직후(UTC 전날 15시대)
  assert.equal(formatSeoulClock('2026-11-12T15:03:00.000Z'), '00:03');
  assert.equal(formatSeoulClock('2026-11-13T23:59:00+09:00'), '23:59');
  assert.equal(formatSeoulClock('nope'), null);
});

test('사진 주소는 https만 받는다', () => {
  assert.deepEqual(
    readDriverCompletedPhoto({
      url: 'https://storage.googleapis.com/bucket/photo.jpg?X-Goog-Signature=abc',
      expiresAt: '2026-11-13T05:22:00.000Z',
    }),
    {
      url: 'https://storage.googleapis.com/bucket/photo.jpg?X-Goog-Signature=abc',
      expiresAt: '2026-11-13T05:22:00.000Z',
    },
  );
  assert.equal(readDriverCompletedPhoto({ url: 'https://x.test/p.jpg' })?.expiresAt, null);
  for (const payload of [
    null,
    {},
    { url: '' },
    { url: 'http://storage.googleapis.com/p.jpg' },
    { url: 'javascript:alert(1)' },
    { url: 'data:image/png;base64,AAAA' },
    { url: '/relative.jpg' },
    { url: 42 },
  ]) {
    assert.equal(readDriverCompletedPhoto(payload), null, JSON.stringify(payload));
  }
});

test('사진 조회 실패 분류: 401·403 권한 상실, 404 사진 없음, 그 밖 일시 실패', () => {
  assert.equal(classifyDriverCompletedPhotoStatus(401), 'AUTH_ERROR');
  assert.equal(classifyDriverCompletedPhotoStatus(403), 'AUTH_ERROR');
  assert.equal(classifyDriverCompletedPhotoStatus(404), 'MISSING');
  for (const status of [400, 409, 500, 502, 503]) {
    assert.equal(classifyDriverCompletedPhotoStatus(status), 'FETCH_ERROR', String(status));
  }
});
