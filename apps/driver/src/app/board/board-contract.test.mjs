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
const detailHelperSource = await readFile(
  new URL('./_lib/driver-order-detail.ts', import.meta.url),
  'utf8',
);
const holdModalSource = await readFile(
  new URL('./[orderId]/_components/DeliveryHoldModal.tsx', import.meta.url),
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
    /isDriverOrderStatusAck\(result,\s*orderId,\s*status\)/,
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

test('Board 조회 실패는 빈 목록이 아닌 재시도 계약을 제공한다', () => {
  assert.match(boardSource, /다시 시도/);
  assert.match(boardSource, /setReloadKey\(\(key\)\s*=>\s*key\s*\+\s*1\)/);
});

test('Board 재시도는 목록 fetch를 다시 실행한다', () => {
  assert.match(boardSource, /sessionStatus,\s*reloadKey\]/);
});

test('Board는 initial loading과 background refreshing을 분리한다', () => {
  assert.match(boardSource, /refreshing/);
  assert.match(boardSource, /setRefreshing\(true\)/);
  assert.match(boardSource, /최신 정보를 확인하는 중입니다/);
});

test('Board는 성공한 조회를 기억하고 refresh 실패에 이전 목록을 유지한다', () => {
  assert.match(boardSource, /hasSuccessfulReadRef/);
  assert.match(boardSource, /hasSuccessfulRead/);
  assert.match(boardSource, /기존 목록을 보여줍니다/);
});

test('Board는 request sequence로 stale 응답 덮어쓰기를 막는다', () => {
  assert.match(boardSource, /requestIdRef/);
  assert.match(boardSource, /requestId === requestIdRef\.current/);
});

test('Board는 focus 복귀와 visible 복귀에 재조회하고 listener를 정리한다', () => {
  assert.match(boardSource, /addEventListener\(['"]focus['"]/);
  assert.match(boardSource, /addEventListener\(['"]visibilitychange['"]/);
  assert.match(boardSource, /visibilityState\s*===\s*['"]visible['"]/);
  assert.match(boardSource, /removeEventListener\(['"]focus['"]/);
  assert.match(boardSource, /removeEventListener\(['"]visibilitychange['"]/);
});

test('Board는 usable token 없음을 auth-required로 표시하고 empty와 분리한다', () => {
  assert.match(boardSource, /authRequired/);
  assert.match(boardSource, /로그인이 필요합니다/);
});

test('Board의 error-only와 empty 렌더는 성공 기록으로 분리된다', () => {
  assert.match(boardSource, /error && !hasSuccessfulRead/);
  assert.match(boardSource, /오늘 수거할 주문이 없습니다/);
});

test('Detail read 실패는 NOT_FOUND·AUTH_ERROR·FETCH_ERROR로 분리된다', () => {
  assert.match(detailHelperSource, /NOT_FOUND/);
  assert.match(detailHelperSource, /AUTH_ERROR/);
  assert.match(detailHelperSource, /FETCH_ERROR/);
  assert.match(detailSource, /toDriverOrderReadError/);
  assert.match(detailSource, /readError/);
  assert.match(detailSource, /주문을 찾을 수 없습니다/);
  assert.match(detailSource, /주문 정보를 불러오지 못했습니다/);
});

test('Detail read는 sequence guard와 manual retry를 제공한다', () => {
  assert.match(detailSource, /readSeqRef/);
  assert.match(detailSource, /seq === readSeqRef\.current/);
  assert.match(detailSource, /setReadKey\(\(key\)\s*=>\s*key\s*\+\s*1\)/);
  assert.match(detailSource, /다시 확인/);
});

test('Detail은 성공 ACK 후 authoritative GET으로 수렴한다', () => {
  assert.match(detailSource, /isDriverOrderStatusAck/);
  assert.match(detailSource, /\/driver\/orders\/\$\{encodeURIComponent\(orderId\)\}/);
  assert.match(detailSource, /setOrder\(fresh\)/);
});

test('Detail은 readback 실패를 command 실패와 분리하고 자동 resend하지 않는다', () => {
  assert.match(detailSource, /readbackWarning/);
  assert.match(detailSource, /처리는 완료되었지만 최신 상태를 확인하지 못했습니다/);
  assert.doesNotMatch(detailSource, /setTimeout\(updateStatus/);
  assert.doesNotMatch(detailSource, /setInterval/);
});

test('Detail은 시작·재개 후 서버 상태로 CTA를 다시 계산한다', () => {
  assert.match(detailSource, /상태 다시 확인/);
  assert.match(detailSource, /readDetail\(token\)/);
});

test('DeliveryHoldModal 저장 성공은 parent readback으로 수렴한다', () => {
  assert.match(holdModalSource, /onSaved/);
  assert.match(holdModalSource, /onSaved\?\.\(\)/);
  assert.match(detailSource, /onSaved=\{/);
});

test('Detail에 새로운 payment 권한 계산이 생기지 않는다', () => {
  assert.doesNotMatch(detailSource, /canPay/);
  assert.doesNotMatch(detailSource, /orderCharges/);
  assert.doesNotMatch(detailSource, /deliveryHold\.(redeliveryFee|chargeId)/);
  assert.match(detailSource, /isDeliveryStartAllowed\(order\.redeliveryPayment\)/);
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

// DRIVER-BOARD-EMPTY-REFRESH-FAILURE-RECOVERY-01 focused regression.
// _client.tsx의 실제 render precedence를 그대로 미러한 resolver다.
// 순서가 바뀌면 아래 index-order 테스트가 먼저 실패하도록 source 순서와 함께 검증한다.
function resolveBoardView(state) {
  const {
    loading,
    authRequired,
    error,
    hasSuccessfulRead,
    refreshing,
    ordersLength,
  } = state;
  if (loading) return 'INITIAL_LOADING';
  if (authRequired) return 'AUTH_REQUIRED';
  if (error && !hasSuccessfulRead) return 'INITIAL_READ_FAILURE';
  if (error && hasSuccessfulRead) {
    return ordersLength === 0 ? 'STALE_EMPTY_FAILURE' : 'STALE_RESULTS_FAILURE';
  }
  if (refreshing && hasSuccessfulRead && ordersLength === 0) return 'REVALIDATING_EMPTY';
  if (ordersLength === 0) return 'SUCCESSFUL_EMPTY';
  return 'SUCCESSFUL_RESULTS';
}

test('Board read-state precedence는 INITIAL > AUTH > INITIAL_FAILURE > STALE > EMPTY > RESULTS다', () => {
  const idxLoading = boardSource.indexOf('{loading ?');
  const idxAuth = boardSource.indexOf('authRequired ?');
  const idxInitialFailure = boardSource.indexOf('error && !hasSuccessfulRead');
  const idxStale = boardSource.indexOf('error && hasSuccessfulRead');
  const idxRevalidating = boardSource.indexOf('refreshing && hasSuccessfulRead');
  const idxFreshEmpty = boardSource.indexOf('오늘 수거할 주문이 없습니다');
  assert.ok(idxLoading !== -1, 'loading branch가 있어야 한다');
  assert.ok(idxAuth !== -1, 'auth branch가 있어야 한다');
  assert.ok(idxInitialFailure !== -1, 'initial failure branch가 있어야 한다');
  assert.ok(idxStale !== -1, 'stale failure branch가 있어야 한다');
  assert.ok(idxRevalidating !== -1, 'revalidating-empty branch가 있어야 한다');
  assert.ok(idxFreshEmpty !== -1, 'genuine empty copy가 있어야 한다');
  assert.ok(idxLoading < idxAuth, 'loading이 auth보다 먼저다');
  assert.ok(idxAuth < idxInitialFailure, 'auth가 initial failure보다 먼저다');
  assert.ok(idxInitialFailure < idxStale, 'initial failure가 stale보다 먼저다');
  assert.ok(idxStale < idxRevalidating, 'stale이 revalidating보다 먼저다');
  assert.ok(idxRevalidating < idxFreshEmpty, 'revalidating이 genuine empty보다 먼저다');
  // resolver 순서와 source 순서가 일치한다.
  assert.equal(
    resolveBoardView({
      loading: false,
      authRequired: false,
      error: 'x',
      hasSuccessfulRead: true,
      refreshing: false,
      ordersLength: 0,
    }),
    'STALE_EMPTY_FAILURE',
  );
});

test('1. first success []는 genuine empty다', () => {
  assert.equal(
    resolveBoardView({
      loading: false,
      authRequired: false,
      error: null,
      hasSuccessfulRead: true,
      refreshing: false,
      ordersLength: 0,
    }),
    'SUCCESSFUL_EMPTY',
  );
  // genuine empty 분기는 fresh copy를 쓰고 error를 쓰지 않는다.
  const genuineStart = boardSource.lastIndexOf(') : orders.length === 0 ? (');
  assert.ok(genuineStart !== -1, 'genuine empty branch가 있어야 한다');
  const genuineEnd = boardSource.indexOf(') : (', genuineStart);
  const genuineSlice = boardSource.slice(genuineStart, genuineEnd);
  assert.match(genuineSlice, /오늘 수거할 주문이 없습니다/);
  assert.match(genuineSlice, /현재 배송 중인 주문이 없습니다/);
  assert.doesNotMatch(genuineSlice, /\{error\}/);
  assert.doesNotMatch(genuineSlice, /마지막 확인 당시/);
});

test('2. first failure는 error이며 empty가 아니다', () => {
  assert.equal(
    resolveBoardView({
      loading: false,
      authRequired: false,
      error: '주문을 불러오지 못했습니다.',
      hasSuccessfulRead: false,
      refreshing: false,
      ordersLength: 0,
    }),
    'INITIAL_READ_FAILURE',
  );
  assert.match(boardSource, /주문을 불러오지 못했습니다\. 잠시 후 다시 시도해주세요/);
});

test('3. success [] → refresh failure는 stale-error state다 (fresh empty 금지)', () => {
  assert.equal(
    resolveBoardView({
      loading: false,
      authRequired: false,
      error: '최신 주문을 불러오지 못했습니다.',
      hasSuccessfulRead: true,
      refreshing: false,
      ordersLength: 0,
    }),
    'STALE_EMPTY_FAILURE',
  );
  const idxStale = boardSource.indexOf('error && hasSuccessfulRead');
  const idxRevalidating = boardSource.indexOf('refreshing && hasSuccessfulRead');
  const staleSlice = boardSource.slice(idxStale, idxRevalidating);
  assert.match(staleSlice, /\{error\}/);
  assert.match(staleSlice, /마지막 확인 당시/);
  assert.match(staleSlice, /다시 시도/);
  assert.match(staleSlice, /setReloadKey\(\(key\)\s*=>\s*key\s*\+\s*1\)/);
  assert.doesNotMatch(staleSlice, /오늘 수거할 주문이 없습니다/);
  assert.doesNotMatch(staleSlice, /현재 배송 중인 주문이 없습니다/);
});

test('4. stale-empty → retry → [] success는 다시 genuine empty다', () => {
  // retry 중간(revalidating)은 fresh empty가 아니다.
  assert.equal(
    resolveBoardView({
      loading: false,
      authRequired: false,
      error: null,
      hasSuccessfulRead: true,
      refreshing: true,
      ordersLength: 0,
    }),
    'REVALIDATING_EMPTY',
  );
  // retry 성공은 error를 제거한다.
  assert.match(boardSource, /hasSuccessfulReadRef\.current = true/);
  assert.match(boardSource, /setHasSuccessfulRead\(true\)/);
  const successBlock = boardSource.slice(
    boardSource.indexOf('.then((orders)'),
    boardSource.indexOf('.catch('),
  );
  assert.match(successBlock, /setError\(null\)/);
  assert.equal(
    resolveBoardView({
      loading: false,
      authRequired: false,
      error: null,
      hasSuccessfulRead: true,
      refreshing: false,
      ordersLength: 0,
    }),
    'SUCCESSFUL_EMPTY',
  );
});

test('5. success [orders] → refresh failure는 이전 목록 + warning을 유지한다', () => {
  assert.equal(
    resolveBoardView({
      loading: false,
      authRequired: false,
      error: '최신 주문을 불러오지 못했습니다.',
      hasSuccessfulRead: true,
      refreshing: false,
      ordersLength: 2,
    }),
    'STALE_RESULTS_FAILURE',
  );
  assert.match(boardSource, /최신 주문을 불러오지 못했습니다\. 기존 목록을 보여줍니다/);
  assert.match(boardSource, /\(이전 목록 표시 중\)/);
  assert.match(boardSource, /orders\.map\(\(order\)/);
  // refresh 실패는 list를 지우지 않는다: stale 분기에는 setPreparing([])이 없다.
  const catchBlock = boardSource.slice(boardSource.indexOf('.catch('), boardSource.indexOf('.finally('));
  const refreshStart = catchBlock.indexOf('if (hasSuccessfulReadRef.current)');
  const elseMarker = catchBlock.indexOf('} else {', refreshStart);
  assert.ok(refreshStart !== -1 && elseMarker !== -1, 'refresh/initial 분기가 있어야 한다');
  const refreshBranch = catchBlock.slice(refreshStart, elseMarker);
  assert.doesNotMatch(refreshBranch, /setPreparing\(\[\]\)/);
  assert.doesNotMatch(refreshBranch, /setDelivering\(\[\]\)/);
});

test('6. success [orders] → refresh success []는 genuine empty로 수렴한다', () => {
  const successBlock = boardSource.slice(
    boardSource.indexOf('.then((orders)'),
    boardSource.indexOf('.catch('),
  );
  assert.match(successBlock, /setPreparing\(orders\.filter/);
  assert.match(successBlock, /setDelivering\(/);
  assert.equal(
    resolveBoardView({
      loading: false,
      authRequired: false,
      error: null,
      hasSuccessfulRead: true,
      refreshing: false,
      ordersLength: 0,
    }),
    'SUCCESSFUL_EMPTY',
  );
});

test('7. auth loss는 empty가 아닌 auth state이며 성공 기록을 초기화한다', () => {
  assert.equal(
    resolveBoardView({
      loading: false,
      authRequired: true,
      error: null,
      hasSuccessfulRead: true,
      refreshing: false,
      ordersLength: 0,
    }),
    'AUTH_REQUIRED',
  );
  assert.equal(
    resolveBoardView({
      loading: false,
      authRequired: true,
      error: 'x',
      hasSuccessfulRead: false,
      refreshing: false,
      ordersLength: 0,
    }),
    'AUTH_REQUIRED',
  );
  // auth 상실 시 stale 보호 데이터를 유지하지 않고 성공 기록도 초기화한다.
  assert.match(boardSource, /hasSuccessfulReadRef\.current = false/);
  assert.match(boardSource, /setHasSuccessfulRead\(false\)/);
  assert.match(boardSource, /로그인이 필요합니다/);
});

test('8. stale old request는 retry를 덮어쓰지 못한다', () => {
  assert.match(boardSource, /requestIdRef/);
  assert.match(boardSource, /requestId === requestIdRef\.current/);
  assert.match(boardSource, /controller\.abort\(\)/);
  assert.match(boardSource, /AbortController/);
  const guardSlice = boardSource.slice(boardSource.indexOf('const isCurrent'), boardSource.indexOf('.finally('));
  assert.match(guardSlice, /if \(!isCurrent\(\)\) return/);
});

test('9. preparing/delivering 탭 count/filter 회귀 없음', () => {
  assert.match(boardSource, /setPreparing\(orders\.filter/);
  assert.match(boardSource, /order\.status\s*===\s*['"]PREPARING['"]/);
  assert.match(
    boardSource,
    /order\.status\s*===\s*['"]DELIVERING['"]\s*\|\|\s*order\.status\s*===\s*['"]DELIVERY_HELD['"]/,
  );
  // stale-empty와 revalidating-empty도 탭 의미를 보존한다.
  assert.match(boardSource, /마지막 확인 당시 수거할 주문이 없었습니다/);
  assert.match(boardSource, /마지막 확인 당시 배송 중인 주문이 없었습니다/);
  assert.match(boardSource, /오늘 수거할 주문이 없습니다/);
  assert.match(boardSource, /현재 배송 중인 주문이 없습니다/);
  assert.match(boardSource, /count: preparing\.length/);
  assert.match(boardSource, /count: delivering\.length/);
});

test('10. focus/visibility revalidation 회귀 없음', () => {
  assert.match(boardSource, /addEventListener\(['"]focus['"]/);
  assert.match(boardSource, /addEventListener\(['"]visibilitychange['"]/);
  assert.match(boardSource, /visibilityState\s*===\s*['"]visible['"]/);
  assert.match(boardSource, /removeEventListener\(['"]focus['"]/);
  assert.match(boardSource, /removeEventListener\(['"]visibilitychange['"]/);
  assert.match(boardSource, /setReloadKey\(\(key\)\s*=>\s*key\s*\+\s*1\)/);
  // background refresh는 loading과 분리된다.
  assert.match(boardSource, /setRefreshing\(true\)/);
  assert.match(boardSource, /최신 정보를 확인하는 중입니다/);
});
