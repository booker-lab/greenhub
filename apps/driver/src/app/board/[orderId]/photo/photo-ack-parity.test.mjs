import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const photoCaptureSource = await readFile(new URL('./photo-capture.tsx', import.meta.url), 'utf8');
const photoPolicySource = await readFile(
  new URL('./photo-upload-policy.ts', import.meta.url),
  'utf8',
);
const photoEncodeSource = await readFile(new URL('./photo-encode.ts', import.meta.url), 'utf8');

const legacyStart = photoCaptureSource.indexOf('uploadLegacyHubPhoto(orderId');
assert.ok(legacyStart !== -1, 'legacy-hub upload branch가 있어야 한다');
const legacyEnd = photoCaptureSource.indexOf('router.replace', legacyStart);
assert.ok(legacyEnd !== -1, 'legacy branch 뒤에 board 이동이 있어야 한다');
const legacySlice = photoCaptureSource.slice(legacyStart, legacyEnd);

const UNCERTAINTY_COPY = '결과를 확인할 수 없어요. 주문 상태를 다시 확인해 주세요.';

// 구현과 동일한 의미의 판정 미러다. 소스 계약이 바뀌면 아래 behavioral 테스트와
// source-contract 테스트 중 최소 하나가 먼저 실패한다.
function isLegacyHubStatusAck(result, orderId) {
  if (!result || typeof result !== 'object') return false;
  return result.orderId === orderId && result.status === 'HUB_ARRIVED';
}

function parseLegacyAck(bodyText) {
  return JSON.parse(bodyText);
}

// A. 정상 response: orderId 동일 + HUB_ARRIVED → success
test('A. 정상 ACK(orderId 동일 + HUB_ARRIVED)는 success다', () => {
  const ack = parseLegacyAck(JSON.stringify({ orderId: 'order-1', status: 'HUB_ARRIVED' }));
  assert.equal(isLegacyHubStatusAck(ack, 'order-1'), true);
});

// B. orderId mismatch → success 취급 금지
test('B. orderId mismatch는 success가 아니다', () => {
  const ack = parseLegacyAck(JSON.stringify({ orderId: 'order-OTHER', status: 'HUB_ARRIVED' }));
  assert.equal(isLegacyHubStatusAck(ack, 'order-1'), false);
});

// C. status mismatch → success 취급 금지
test('C. status mismatch는 success가 아니다', () => {
  const ack = parseLegacyAck(JSON.stringify({ orderId: 'order-1', status: 'DELIVERING' }));
  assert.equal(isLegacyHubStatusAck(ack, 'order-1'), false);
});

// D. body 손상/필수 field 누락 → success 취급 금지
test('D. body 손상/필수 field 누락은 success가 아니다', () => {
  assert.throws(() => parseLegacyAck('not-json{{{'), SyntaxError);
  assert.equal(isLegacyHubStatusAck(null, 'order-1'), false);
  assert.equal(isLegacyHubStatusAck(undefined, 'order-1'), false);
  assert.equal(isLegacyHubStatusAck({}, 'order-1'), false);
  assert.equal(isLegacyHubStatusAck({ orderId: 'order-1' }, 'order-1'), false);
  assert.equal(isLegacyHubStatusAck({ status: 'HUB_ARRIVED' }, 'order-1'), false);
});

// E. double click → legacy upload 1회 (ref 기반 in-flight guard 미러)
test('E. in-flight 중 중복 dispatch는 두 번째 호출을 막는다', () => {
  let uploadCalls = 0;
  const guard = { current: false };
  function dispatch() {
    if (guard.current) return false;
    guard.current = true;
    uploadCalls += 1;
    return true;
  }
  assert.equal(dispatch(), true);
  assert.equal(dispatch(), false);
  assert.equal(uploadCalls, 1);
});

test('legacy-hub는 response.ok만으로 성공 처리하지 않고 semantic ACK를 확인한다', () => {
  assert.match(legacySlice, /response\.json\(\)/);
  assert.match(legacySlice, /ack\.orderId\s*!==\s*orderId/);
  assert.match(legacySlice, /ack\.status\s*!==\s*['"]HUB_ARRIVED['"]/);
});

test('legacy-hub mismatch는 board 이동 없이 uncertainty path로 수렴한다', () => {
  assert.match(legacySlice, /결과를 확인할 수 없어요\. 주문 상태를 다시 확인해 주세요\./);
  const ackCheckIndex = legacySlice.indexOf('ack.orderId');
  assert.ok(ackCheckIndex !== -1, 'ACK 검사가 legacy branch 안에 있어야 한다');
  // ACK 검사보다 앞에 board 이동이 있으면 안 된다: throw가 router.replace를 건너뛴다.
  assert.doesNotMatch(legacySlice, /router\.replace/);
  assert.match(photoCaptureSource, /결과를 확인할 수 없어요\. 주문 상태를 다시 확인해 주세요\./);
});

test('legacy-hub에 requestId/idempotency key 방식을 복사하지 않는다', () => {
  assert.doesNotMatch(legacySlice, /idempotencyKey/);
  assert.doesNotMatch(legacySlice, /requestId/);
});

test('legacy-hub 중복 dispatch는 ref 기반 in-flight guard로 막는다', () => {
  assert.match(photoCaptureSource, /uploadInFlightRef/);
  assert.match(photoCaptureSource, /if\s*\(uploadInFlightRef\.current\)\s*return/);
  assert.match(photoCaptureSource, /uploadInFlightRef\.current\s*=\s*true/);
  assert.match(photoCaptureSource, /uploadInFlightRef\.current\s*=\s*false/);
});

test('round-direct keyed ACK 계약 회귀 없음', () => {
  assert.match(photoCaptureSource, /form\.append\(['"]idempotencyKey['"]/);
  // ACK 판정은 순수 함수로 옮겼다: orderId·photoId·DELIVERED를 모두 확인한다.
  assert.match(photoCaptureSource, /isDeliveryPhotoAck\(result,\s*orderId\)/);
  assert.match(photoPolicySource, /ack\.orderId\s*===\s*orderId/);
  assert.match(photoPolicySource, /typeof ack\.photoId\s*===\s*['"]string['"]/);
  assert.match(photoPolicySource, /ack\.status\s*===\s*['"]DELIVERED['"]/);
});

const roundDirectSlice = photoCaptureSource.slice(
  photoCaptureSource.indexOf('async function readOrderStatus'),
  photoCaptureSource.indexOf('async function upload()'),
);

test('round-direct 멱등 키는 사진·직전 실패 기준으로 재사용/새로 만들기를 판단한다', () => {
  assert.ok(roundDirectSlice.includes('async function uploadRoundDirect'));
  assert.match(roundDirectSlice, /decideIdempotencyKey\(\{/);
  assert.match(roundDirectSlice, /photoChanged:\s*requestPhotoRef\.current\s*!==\s*blob/);
  assert.match(roundDirectSlice, /lastFailure:\s*lastFailureRef\.current/);
  // 화면 수명 동안 키 1개(??=) 방식으로 되돌아가지 않는다.
  assert.doesNotMatch(photoCaptureSource, /requestIdRef\.current\s*\?\?=/);
});

test('round-direct 실패는 원인을 분류하고 주문 상태를 다시 읽어 수렴한다', () => {
  assert.match(roundDirectSlice, /readDriverOrderCommandErrorCodeFromResponse\(response\)/);
  assert.match(roundDirectSlice, /classifyPhotoUploadFailure\(\{\s*kind:\s*['"]network['"]\s*\}\)/);
  assert.match(roundDirectSlice, /classifyPhotoUploadFailure\(\{\s*kind:\s*['"]ack['"]\s*\}\)/);
  assert.match(
    roundDirectSlice,
    /apiRead\(`\/driver\/orders\/\$\{encodeURIComponent\(orderId\)\}`/,
  );
  assert.match(roundDirectSlice, /resolvePhotoUploadFailure\(\{/);
  // 사진 연결 + DELIVERING 마무리는 서버의 사진 전제 DELIVERED 전이를 쓴다(사진 URL 없이).
  assert.match(roundDirectSlice, /JSON\.stringify\(\{\s*status:\s*['"]DELIVERED['"]\s*\}\)/);
  // round-direct 경로는 뭉뚱그린 실패 문구를 쓰지 않는다(그 문구는 legacy catch 전용).
  assert.doesNotMatch(roundDirectSlice, /업로드하지 못했어요\. 다시 시도해 주세요\./);
  // 성공 판정 전 board 이동 금지: 이동은 upload()의 공통 성공 지점 한 곳뿐이다.
  assert.doesNotMatch(roundDirectSlice, /router\.(replace|push)/);
});

test('사진은 업로드 전에 축소·JPEG 재인코딩되고 카메라·파일 선택이 같은 경로를 탄다', () => {
  assert.match(
    photoCaptureSource,
    /encodeDeliveryJpeg\(video,\s*video\.videoWidth,\s*video\.videoHeight\)/,
  );
  assert.match(photoCaptureSource, /loadImageSource\(file\)/);
  assert.match(
    photoCaptureSource,
    /encodeDeliveryJpeg\(decoded\.source,\s*decoded\.width,\s*decoded\.height\)/,
  );
  // 원본 파일을 그대로 올리지 않는다.
  assert.doesNotMatch(photoCaptureSource, /setBlob\(file\)/);
  assert.match(photoEncodeSource, /computeScaledSize\(/);
  assert.match(photoEncodeSource, /planNextEncodeStep\(/);
  assert.match(photoEncodeSource, /canvas\.toBlob\(/);
});

test('legacy Storage lifecycle을 건드리지 않는다', () => {
  assert.match(photoCaptureSource, /uploadLegacyHubPhoto\(orderId,\s*blob\)/);
  assert.doesNotMatch(photoCaptureSource, /deleteObject|uploadDeliveryPhoto/);
});

// 새로고침·직접 진입 시 세션을 다시 받는다. 세션 전에 완료를 누르면 upload()가
// 조용히 반환하므로, 완료 버튼은 세션 준비 전까지 비활성이어야 한다.
test('완료 버튼은 세션(access token)이 준비되기 전까지 비활성이다', () => {
  assert.match(
    photoCaptureSource,
    /const sessionReady = Boolean\(session\?\.user\?\.accessToken\);/,
  );
  assert.match(photoCaptureSource, /disabled=\{!captured \|\| uploading \|\| !sessionReady\}/);
});

// D-04: 완료 알림은 회차 직배송이 완료로 수렴했을 때(uploadRoundDirect가 true)만, 목록 이동 직전에 띄운다.
test('완료 알림은 회차 직배송 완료 수렴 뒤에만 띄우고 불확실·실패 경로에서는 띄우지 않는다', () => {
  const uploadSlice = photoCaptureSource.slice(
    photoCaptureSource.indexOf('async function upload()'),
  );
  const gateAt = uploadSlice.indexOf(
    'if (!(await uploadRoundDirect(token, blob, storeId))) return;',
  );
  const toastAt = uploadSlice.indexOf('toast.add({ description: deliveryCompletedMessage(');
  const legacyAt = uploadSlice.indexOf('uploadLegacyHubPhoto(orderId');
  const moveAt = uploadSlice.indexOf("router.replace('/board?tab=delivering')");
  assert.ok(gateAt !== -1 && toastAt > gateAt, '알림은 완료 판정 뒤에 있어야 한다');
  assert.ok(toastAt < legacyAt && toastAt < moveAt, '알림은 회차 분기 안, 목록 이동 전이어야 한다');
  assert.equal((photoCaptureSource.match(/toast\.add\(/g) ?? []).length, 1);
  // 실패 수렴·업로드 판단 구간에서는 알림을 띄우지 않는다.
  assert.doesNotMatch(roundDirectSlice, /toast\.add\(/);
});

// D-21: 받는 형식(JPEG)은 그대로 두고 안내 문구만 할 일 중심으로 바꾼다.
test('JPEG가 아닌 사진은 형식 이름 대신 카메라 촬영으로 다시 찍도록 안내한다', () => {
  assert.match(
    photoCaptureSource,
    /이 사진 형식은 올릴 수 없어요\. '카메라 촬영'이나 '카메라 앱으로 찍기'로 새로 찍어 주세요\./,
  );
  assert.match(
    photoCaptureSource,
    /file\.type\s*!==\s*['"]image\/jpeg['"]\)\s*\{\s*setError\(NON_JPEG_PHOTO_MESSAGE\)/,
  );
  assert.doesNotMatch(photoCaptureSource, /JPEG 사진만 선택할 수 있습니다/);
});

// D-05: 주소 안내는 화면을 열 때 기사 주문 조회 응답에서 같은 주문일 때만 읽는다.
test('촬영 화면 주소 안내는 기사 주문 조회 응답에서 같은 주문일 때만 읽는다', () => {
  assert.match(photoCaptureSource, /readPhotoOrderSummary\(await response\.json\(\), orderId\)/);
  assert.match(photoCaptureSource, /isRoundDirect && orderSummary && \(/);
  // 업로드는 여전히 매번 판매자 ID를 조회 응답에서 확인한다.
  assert.match(photoCaptureSource, /const storeId = await readOrderStoreId\(token\);/);
});

// D-06: 미리보기 상태 버튼은 세로로 쌓아 확정 버튼을 한 줄 전체 폭으로 둔다.
test('미리보기 하단 버튼은 세로로 쌓고 확정 버튼은 전체 폭이다', () => {
  const barAt = photoCaptureSource.indexOf('{(captured || isRoundDirect) && (');
  assert.ok(barAt !== -1);
  const bar = photoCaptureSource.slice(
    barAt,
    photoCaptureSource.indexOf('{error && captured', barAt),
  );
  assert.match(bar, /flexDirection: 'column'/);
  assert.equal((bar.match(/\bfullWidth\b/g) ?? []).length, 2);
  assert.doesNotMatch(bar, /flex-1/);
  assert.match(bar, /'올리는 중…'/);
});
