import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const boardSource = await readFile(new URL('./_client.tsx', import.meta.url), 'utf8');
const cardSource = await readFile(
  new URL('../../components/OrderCard.tsx', import.meta.url),
  'utf8',
);
const detailSource = await readFile(new URL('./[orderId]/page.tsx', import.meta.url), 'utf8');
const mapSource = await readFile(new URL('../map/page.tsx', import.meta.url), 'utf8');
const paymentSource = await readFile(
  new URL('./_lib/redelivery-payment.ts', import.meta.url),
  'utf8',
);
const photoCaptureSource = await readFile(
  new URL('./[orderId]/photo/photo-capture.tsx', import.meta.url),
  'utf8',
);
const pilotPhotoRouteSource = await readFile(
  new URL('./[orderId]/photo/round-direct/page.tsx', import.meta.url),
  'utf8',
);
const legacyPhotoRouteSource = await readFile(
  new URL('./[orderId]/photo/page.tsx', import.meta.url),
  'utf8',
);
const legacyStorageSource = await readFile(
  new URL('./[orderId]/photo/legacy-hub-photo.ts', import.meta.url),
  'utf8',
);
const driverConfigSource = await readFile(
  new URL('../../../next.config.ts', import.meta.url),
  'utf8',
);

test('Driver Board는 Driver role API에서 세 상태를 조회한다', () => {
  assert.match(boardSource, /apiFetch\(\s*['"]\/driver\/orders['"]/);
  assert.doesNotMatch(boardSource, /onSnapshot|collection\(db|from ['"]firebase\/firestore['"]/);
});

test('API 결과의 PREPARING·DELIVERING·DELIVERY_HELD를 각각의 Board 탭에 유지한다', () => {
  assert.match(boardSource, /setPreparing\(orders\.filter/);
  assert.match(boardSource, /order\.status\s*===\s*['"]PREPARING['"]/);
  assert.match(
    boardSource,
    /order\.status\s*===\s*['"]DELIVERING['"]\s*\|\|\s*order\.status\s*===\s*['"]DELIVERY_HELD['"]/,
  );
});

test('주문 카드는 안정적인 test id와 배송 보류 상태 배지를 제공한다', () => {
  assert.match(cardSource, /data-testid=\{`driver-order-\$\{order\.id\}`\}/);
  assert.match(cardSource, /order\.status\s*===\s*['"]DELIVERY_HELD['"]/);
  assert.match(cardSource, />\s*배송 보류\s*</);
});

test('Driver 상세는 Driver detail API를 사용하고 raw Firestore 주문을 읽지 않는다', () => {
  assert.match(detailSource, /apiFetch\([\s\S]*driver\/orders/);
  assert.doesNotMatch(detailSource, /onSnapshot|doc\(db|from ['"]firebase\/firestore['"]/);
});

test('Driver Map은 Driver 목록 API를 사용하고 raw Firestore 주문을 읽지 않는다', () => {
  assert.match(mapSource, /apiFetch\(\s*['"]\/driver\/orders['"]/);
  assert.doesNotMatch(mapSource, /onSnapshot|collection\(db|from ['"]firebase\/firestore['"]/);
});

test('보류·준비 주문 상세는 결제 의미에 따라 배송 시작·재개를 차단하거나 허용한다', () => {
  assert.match(detailSource, /isDeliveryStartAllowed\(order\.redeliveryPayment\)/);
  assert.match(detailSource, /deliveryStartAllowed\s*\?/);
  assert.match(detailSource, /disabled/);
  assert.match(detailSource, /isHeld[\s\S]*updateStatus\(['"]DELIVERING['"]\)/);
  assert.match(detailSource, />\s*배송 재개\s*</);
  assert.match(
    detailSource,
    /result\.orderId\s*!==\s*orderId\s*\|\|\s*result\.status\s*!==\s*status/,
  );
  assert.match(detailSource, /배송 완료 사진 촬영/);
});

test('Driver Card는 결제 대기·완료·운영 확인 상태를 표시한다', () => {
  assert.match(cardSource, /getRedeliveryPaymentPresentation\(order\.redeliveryPayment\)/);
  assert.match(cardSource, /payment\.label/);
  assert.match(paymentSource, /재배송비 결제 대기/);
  assert.match(paymentSource, /재배송비 결제 완료/);
  assert.match(paymentSource, /운영 확인 필요/);
});

test('Driver 배송 시작 판정은 required·paid·requiresRecovery만 사용하고 canPay를 사용하지 않는다', () => {
  assert.match(paymentSource, /payment\.required\s*===\s*false/);
  assert.match(paymentSource, /payment\.paid\s*===\s*true/);
  assert.match(paymentSource, /payment\.requiresRecovery\s*===\s*false/);
  assert.doesNotMatch(paymentSource, /canPay/);
  assert.doesNotMatch(boardSource, /canPay/);
  assert.doesNotMatch(detailSource, /canPay/);
});

test('MISSING·PENDING·실패 계열 결제 상태는 Driver 배송을 차단한다', () => {
  assert.match(paymentSource, /if\s*\(!payment\)\s*return\s*false/);
  assert.match(paymentSource, /['"]MISSING['"]/);
  assert.match(paymentSource, /['"]PENDING['"]/);
  assert.match(paymentSource, /['"]FAILED['"]/);
  assert.match(paymentSource, /['"]REFUNDED['"]/);
  assert.match(paymentSource, /['"]MISMATCHED['"]/);
});

test('Driver Board·상세는 orderCharges와 raw payment 필드를 직접 조회·조합하지 않는다', () => {
  for (const source of [boardSource, cardSource, detailSource, paymentSource]) {
    assert.doesNotMatch(source, /orderCharges/);
    assert.doesNotMatch(source, /deliveryHold\.(redeliveryFee|chargeId)/);
  }
});

test('사진 화면은 heading과 촬영·최종 완료 버튼의 접근 가능한 이름을 제공한다', () => {
  assert.match(photoCaptureSource, /<Title[^>]*order=\{1\}[^>]*>/);
  assert.match(photoCaptureSource, /배송 완료 사진/);
  assert.match(photoCaptureSource, /aria-label=['"]사진 촬영['"]/);
  assert.match(photoCaptureSource, /['"]사진 촬영['"]/);
  assert.match(photoCaptureSource, /['"]사진을 등록하고 배송 완료['"]/);
  assert.match(photoCaptureSource, /disabled=\{[^}]*!captured/);
});

test('직배송 사진 링크는 정확한 Pilot 경로로 분리하고 legacy 링크를 보존한다', () => {
  assert.match(detailSource, /\/photo\/round-direct\?storeId=/);
  assert.doesNotMatch(detailSource, /flow=round-direct/);
  assert.match(detailSource, /\/photo\?storeId=/);
  assert.match(pilotPhotoRouteSource, /mode="round-direct"/);
  assert.match(legacyPhotoRouteSource, /mode="legacy"/);
  assert.doesNotMatch(legacyPhotoRouteSource, /flow/);
});

test('Driver Permissions-Policy는 전역 deny와 정확한 Pilot route 허용을 분리한다', () => {
  assert.match(driverConfigSource, /camera=\(\), microphone=\(\), geolocation=\(\)/);
  assert.match(driverConfigSource, /source:\s*['"]\/\(\.\*\)['"]/);
  assert.match(driverConfigSource, /source:\s*['"]\/board\/:orderId\/photo\/round-direct['"]/);
  assert.match(driverConfigSource, /camera=\(self\), microphone=\(\), geolocation=\(\)/);
  assert.doesNotMatch(driverConfigSource, /camera=\*/);
  assert.doesNotMatch(driverConfigSource, /microphone=\(self\)|geolocation=\(self\)/);
});

test('Pilot 사진 화면은 JPEG 파일 대체 경로와 기존 업로드 계약을 유지한다', () => {
  assert.match(photoCaptureSource, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(photoCaptureSource, /카메라 촬영/);
  assert.match(photoCaptureSource, /facingMode:\s*['"]environment['"]/);
  assert.match(photoCaptureSource, /audio:\s*false/);
  assert.match(photoCaptureSource, /canvas\.toBlob/);
  assert.match(photoCaptureSource, /type="file"/);
  assert.match(photoCaptureSource, /isRoundDirect\s*&&\s*\(\s*<input/);
  assert.match(photoCaptureSource, /accept="image\/jpeg"/);
  assert.match(photoCaptureSource, /capture="environment"/);
  assert.match(photoCaptureSource, /file\.type\s*!==\s*['"]image\/jpeg['"]/);
  assert.match(photoCaptureSource, /new FileReader\(\)/);
  assert.match(photoCaptureSource, /reader\.readAsDataURL\(file\)/);
  assert.match(photoCaptureSource, /form\.append\(['"]photo['"],\s*blob/);
  assert.match(photoCaptureSource, /form\.append\(['"]idempotencyKey['"]/);
  assert.match(photoCaptureSource, /result\.photoId/);
  assert.match(photoCaptureSource, /result\.orderId\s*!==\s*orderId/);
  assert.match(photoCaptureSource, /result\.status\s*!==\s*['"]DELIVERED['"]/);
  assert.doesNotMatch(photoCaptureSource, /uploadBytes|getDownloadURL|firebase\/storage/);
  assert.doesNotMatch(photoCaptureSource, /multiple/);
  assert.doesNotMatch(photoCaptureSource, /get\(['"]flow['"]\)/);
});

test('카메라 스트림은 video 마운트 뒤 연결되고 프레임 준비 전 촬영을 막는다', () => {
  assert.match(photoCaptureSource, /useEffect/);
  assert.match(photoCaptureSource, /video\.srcObject\s*=\s*stream/);
  assert.match(photoCaptureSource, /HTMLMediaElement\.HAVE_CURRENT_DATA/);
  assert.match(photoCaptureSource, /video\.videoWidth\s*>\s*0/);
  assert.match(photoCaptureSource, /video\.videoHeight\s*>\s*0/);
  assert.match(photoCaptureSource, /disabled=\{!frameReady\}/);
  assert.match(photoCaptureSource, /nextBlob\.type\s*!==\s*['"]image\/jpeg['"]/);
  assert.match(photoCaptureSource, /nextBlob\.size\s*<=\s*0/);
  assert.match(photoCaptureSource, /track\.stop\(\)/);
});

test('legacy 사진 흐름과 Storage 계약은 공통 UI 추출 뒤에도 유지된다', () => {
  assert.match(photoCaptureSource, /uploadLegacyHubPhoto/);
  assert.match(photoCaptureSource, /status:\s*['"]HUB_ARRIVED['"]/);
  assert.match(legacyStorageSource, /uploadBytes/);
  assert.match(legacyStorageSource, /getDownloadURL/);
  assert.match(legacyStorageSource, /contentType:\s*['"]image\/jpeg['"]/);
});
