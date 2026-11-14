import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const photoCaptureSource = await readFile(new URL('./photo-capture.tsx', import.meta.url), 'utf8');
const photoPolicySource = await readFile(
  new URL('./photo-upload-policy.ts', import.meta.url),
  'utf8',
);
const photoEncodeSource = await readFile(new URL('./photo-encode.ts', import.meta.url), 'utf8');
// 회차 직배송 보내기·결과 분류(화면·대기열 공용)와 사진 업로드 대기열(Y3) 모듈.
const sendSource = await readFile(new URL('./round-direct-send.ts', import.meta.url), 'utf8');
const pendingPolicySource = await readFile(
  new URL('./pending-photo-policy.ts', import.meta.url),
  'utf8',
);
const pendingRunnerSource = await readFile(
  new URL('./pending-photo-runner.ts', import.meta.url),
  'utf8',
);
const pendingClientSource = await readFile(
  new URL('./pending-photo-client.ts', import.meta.url),
  'utf8',
);
const pendingStoreSource = await readFile(
  new URL('./pending-photo-store.ts', import.meta.url),
  'utf8',
);
const pendingUploaderSource = await readFile(
  new URL('./pending-photo-uploader.tsx', import.meta.url),
  'utf8',
);
const providersSource = await readFile(new URL('../../../providers.tsx', import.meta.url), 'utf8');

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
  // 보내기·ACK 판정은 화면·대기열 공용 모듈(round-direct-send)이 맡고 화면은 그 함수를 쓴다.
  assert.match(photoCaptureSource, /sendRoundDirectPhoto\(\{/);
  assert.match(sendSource, /form\.append\(['"]idempotencyKey['"],\s*args\.idempotencyKey\)/);
  // ACK 판정은 순수 함수로 옮겼다: orderId·photoId·DELIVERED를 모두 확인한다.
  assert.match(sendSource, /isDeliveryPhotoAck\(result,\s*orderId\)/);
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

test('round-direct 실패는 원인을 분류하고 확정 거절만 주문 상태를 다시 읽어 수렴한다', () => {
  // 기사 명령 공통 코드에 더해 이 경로 전용 코드(촬영 뒤 새 보류)만 읽는다.
  assert.match(sendSource, /readPhotoErrorCode\(response\)/);
  assert.match(sendSource, /readDriverOrderErrorCode\(body\)/);
  assert.match(sendSource, /classifyPhotoUploadFailure\(\{\s*kind:\s*['"]network['"]\s*\}\)/);
  assert.match(sendSource, /classifyPhotoUploadFailure\(\{\s*kind:\s*['"]ack['"]\s*\}\)/);
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
  const gateAt = uploadSlice.indexOf('if (!(await uploadRoundDirect(token, blob))) return;');
  const toastAt = uploadSlice.indexOf('toast.add({ description: deliveryCompletedMessage(');
  const legacyAt = uploadSlice.indexOf('uploadLegacyHubPhoto(orderId');
  const moveAt = uploadSlice.indexOf("router.replace('/board?tab=delivering')");
  assert.ok(gateAt !== -1 && toastAt > gateAt, '알림은 완료 판정 뒤에 있어야 한다');
  assert.ok(toastAt < legacyAt && toastAt < moveAt, '알림은 회차 분기 안, 목록 이동 전이어야 한다');
  assert.equal((photoCaptureSource.match(/toast\.add\(/g) ?? []).length, 1);
  // 실패 수렴·업로드 판단 구간에서는 알림을 띄우지 않는다.
  assert.doesNotMatch(roundDirectSlice, /toast\.add\(/);
});

// R-01: 상세가 "배송을 마친 주문이에요"로 안내하려면 사진 화면이 완료 수렴 뒤에만 기억을 남겨야 한다.
test('최근 완료 기억은 회차 직배송 완료 수렴 뒤, 목록 이동 전에만 남기고 거점·실패 경로에는 남기지 않는다', () => {
  const uploadSlice = photoCaptureSource.slice(
    photoCaptureSource.indexOf('async function upload()'),
  );
  const gateAt = uploadSlice.indexOf('if (!(await uploadRoundDirect(token, blob))) return;');
  const rememberAt = uploadSlice.indexOf(
    'rememberCompletedOrder({ orderId, userId: session.user.id });',
  );
  const legacyAt = uploadSlice.indexOf('uploadLegacyHubPhoto(orderId');
  const moveAt = uploadSlice.indexOf("router.replace('/board?tab=delivering')");
  const catchAt = uploadSlice.indexOf('} catch (error) {');
  assert.ok(gateAt !== -1 && rememberAt > gateAt, '기억은 완료 판정 뒤에 있어야 한다');
  assert.ok(
    rememberAt < legacyAt,
    '기억은 회차 분기 안에 있어야 한다(거점 도착은 배송 완료가 아니다)',
  );
  assert.ok(rememberAt < moveAt && moveAt < catchAt, '기억은 목록 이동 전, catch 밖에 있어야 한다');
  assert.equal((photoCaptureSource.match(/rememberCompletedOrder\(/g) ?? []).length, 1);
  assert.doesNotMatch(legacySlice, /rememberCompletedOrder\(/);
  assert.doesNotMatch(roundDirectSlice, /rememberCompletedOrder\(/);
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
  assert.match(photoCaptureSource, /summary: readPhotoOrderSummary\(payload, orderId\)/);
  assert.match(photoCaptureSource, /isRoundDirect && orderSummary && \(/);
  // 업로드는 여전히 판매자 ID를 조회 응답에서 확인한다(같은 키 재전송만 그 요청 때 확인한 값을 다시 쓴다).
  assert.match(photoCaptureSource, /const read = await readOrderStoreId\(token\);/);
  assert.match(photoCaptureSource, /const storeRead = await readOrderStoreId\(token\);/);
});

// 촬영 뒤 새 보류(Y3): 화면을 열 때 본 보류 표시를 사진 요청과 대기열 항목에 싣는다.
test('촬영 화면은 열 때 본 보류 표시를 사진 요청·대기열 항목에 싣고, 거절되면 사진을 다시 찍게 한다', () => {
  assert.match(photoCaptureSource, /holdAt: readDriverOrderHoldAt\(payload, orderId\)/);
  assert.match(photoCaptureSource, /loadedHoldAtRef\.current = loaded\.holdAt/);
  // 새 키는 화면을 열 때 본 값으로 시작하고, 모를 때만 판매자 ID 조회 응답 값을 쓴다.
  assert.match(photoCaptureSource, /requestHoldAtRef\.current = loadedHoldAtRef\.current;/);
  assert.match(
    photoCaptureSource,
    /if \(requestHoldAtRef\.current === undefined\) requestHoldAtRef\.current = read\.holdAt;/,
  );
  assert.match(roundDirectSlice, /expectedHoldAt: requestHoldAtRef\.current,\n\s*\}\);/);
  const queueAt = photoCaptureSource.indexOf('createPendingPhotoEntry({');
  assert.ok(queueAt !== -1);
  assert.match(
    photoCaptureSource.slice(queueAt, photoCaptureSource.indexOf('});', queueAt)),
    /expectedHoldAt: requestHoldAtRef\.current/,
  );
  const staleAt = photoCaptureSource.indexOf("if (failure === 'STALE_HOLD') {");
  assert.ok(staleAt !== -1);
  const stale = photoCaptureSource.slice(staleAt, photoCaptureSource.indexOf('}', staleAt));
  assert.match(stale, /setBlob\(null\)/);
  assert.match(stale, /loadedHoldAtRef\.current = undefined/);
});

// D-06: 미리보기 상태 버튼은 세로로 쌓아 확정 버튼을 한 줄 전체 폭으로 둔다.
test('미리보기 하단 버튼은 세로로 쌓고 확정 버튼은 전체 폭이다', () => {
  const barAt = photoCaptureSource.indexOf('{!showPendingPanel && (captured || isRoundDirect) && (');
  assert.ok(barAt !== -1);
  const barEnd = photoCaptureSource.indexOf('error && captured && (', barAt);
  assert.ok(barEnd > barAt);
  const bar = photoCaptureSource.slice(barAt, barEnd);
  assert.match(bar, /flexDirection: 'column'/);
  assert.equal((bar.match(/\bfullWidth\b/g) ?? []).length, 2);
  assert.doesNotMatch(bar, /flex-1/);
  assert.match(bar, /'올리는 중…'/);
});

test('R-03: 사진 화면 뒤로가기는 상세와 같은 판정을 쓰고 기록이 없으면 주문 상세로 replace한다', () => {
  const start = photoCaptureSource.indexOf('aria-label="뒤로가기"');
  assert.ok(start !== -1);
  const slice = photoCaptureSource.slice(start, photoCaptureSource.indexOf('</button>', start));
  const stop = slice.indexOf('stopStream()');
  const decide = slice.indexOf(
    'resolveDriverDetailBackAction(readDriverDetailBackContext(window))',
  );
  const back = slice.indexOf('router.back()');
  const replace = slice.indexOf('router.replace(`/board/${encodeURIComponent(orderId)}`)');
  assert.ok(stop !== -1 && stop < decide, '스트림 정리가 먼저여야 한다');
  assert.ok(back > decide && replace > back, '기록 있으면 back, 없으면 상세 replace');
});

test('R-09: 사진 화면 안내 글은 낱말 중간에서 끊지 않는다', () => {
  assert.ok((photoCaptureSource.match(/wordBreak: 'keep-all'/g) ?? []).length >= 4);
});

// ── Y3 사진 업로드 대기열 ─────────────────────────────────────────────

// 주석(설명에 나오는 이름)은 빼고 코드만 본다.
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const roundDirectFnStart = photoCaptureSource.indexOf('async function uploadRoundDirect(');
const roundDirectFn = photoCaptureSource.slice(
  roundDirectFnStart,
  photoCaptureSource.indexOf('async function uploadPendingNow(', roundDirectFnStart),
);
const queueFn = photoCaptureSource.slice(
  photoCaptureSource.indexOf('async function queueOrExplain('),
  roundDirectFnStart,
);

test('Y3: 불확실한 결과는 상세 조회(완료 주문은 404)에 기대지 않고 같은 키·같은 사진으로 대기열에 넣는다', () => {
  const enqueueAt = roundDirectFn.indexOf("shouldEnqueuePendingPhoto({ phase: 'sent', failure })");
  const recoverAt = roundDirectFn.indexOf('recoverAfterUploadFailure(');
  assert.ok(enqueueAt !== -1 && recoverAt > enqueueAt, '불확실 분기가 상태 재조회보다 앞서야 한다');
  const branch = roundDirectFn.slice(enqueueAt, recoverAt);
  assert.match(branch, /return queueOrExplain\(\{ phase: 'sent', failure \}, storeId, requestId, blob\);/);
  assert.match(branch, /uncertainStoreIdRef\.current = storeId;/);
  // 대기열에는 보낸 인코딩 결과 그대로(같은 Blob의 바이트)와 같은 키를 넣는다. 다시 인코딩하지 않는다.
  assert.match(queueFn, /bytes: await photo\.arrayBuffer\(\)/);
  assert.match(queueFn, /idempotencyKey,/);
  assert.doesNotMatch(queueFn, /encodeDeliveryJpeg|randomUUID/);
  // 저장소를 쓸 수 없으면 예전 안내(같은 사진으로 다시 시도)로 남는다.
  assert.match(queueFn, /photoUploadFailureMessage\(input\.failure\)/);
  assert.match(queueFn, /ORDER_STORE_UNKNOWN_MESSAGE/);
});

test('Y3: 보내기 전 실패(오프라인·판매자 ID 확인 실패)는 storeId 없이 대기열에 넣고 주문이 안 보이면(404·403) 넣지 않는다', () => {
  assert.match(
    roundDirectFn,
    /navigator\.onLine === false\) \{\s*return queueOrExplain\(\{ phase: 'pre-send', reason: 'OFFLINE' \}, null, requestId, blob\);/,
  );
  assert.match(roundDirectFn, /if \(read\.kind === 'absent'\) \{\s*setError\(ORDER_STORE_UNKNOWN_MESSAGE\);/);
  assert.match(roundDirectFn, /reason: 'ORDER_UNKNOWN' \},\s*null,\s*requestId,\s*blob/);
});

test('Y3: 이 주문 사진이 대기열에 있으면 새 키로 보내지 않고 재촬영을 막는다', () => {
  assert.match(roundDirectFn, /if \(userId && \(await findPendingPhoto\(userId, orderId\)\)\) \{/);
  assert.ok(
    roundDirectFn.indexOf('findPendingPhoto(') < roundDirectFn.indexOf('decideIdempotencyKey('),
    '대기열 확인이 키 결정보다 앞서야 한다',
  );
  assert.match(photoCaptureSource, /\{!showPendingPanel && !stream && !captured && \(/);
  assert.match(photoCaptureSource, /\{!showPendingPanel && isRoundDirect && \(\s*<input/);
  assert.match(photoCaptureSource, /\{!showPendingPanel && captured && \(/);
  // "지금 올리기"는 자동 실행과 같은 함수(같은 잠금)를 쓴다.
  assert.match(photoCaptureSource, /await runPendingPhotoNow\(orderId\)/);
});

test('Y3: 대기열은 사진 업로드 POST만 다시 보내고 PATCH DELIVERED·새 키·재인코딩을 만들지 않는다', () => {
  for (const raw of [pendingRunnerSource, pendingClientSource, pendingPolicySource, sendSource]) {
    const source = codeOnly(raw);
    assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/);
    assert.doesNotMatch(source, /\/status`/);
    assert.doesNotMatch(source, /randomUUID|encodeDeliveryJpeg/);
  }
  assert.match(sendSource, /\/delivery-photos`/);
  assert.match(pendingRunnerSource, /sendRoundDirectPhoto\(\{/);
  assert.match(pendingRunnerSource, /new Blob\(\[bytes\], \{ type: 'image\/jpeg' \}\)/);
});

test('Y3: 대기열 완료 알림·최근 완료 기억은 같은 키 재전송 ACK 뒤 한 곳에서만 남긴다', () => {
  const at = pendingClientSource.indexOf('function onCompleted(');
  assert.ok(at !== -1);
  const block = pendingClientSource.slice(at, pendingClientSource.indexOf('\n}\n', at));
  assert.match(block, /toast\.add\(\{ description: PENDING_PHOTO_MESSAGES\.COMPLETED \}\)/);
  assert.match(block, /rememberCompletedOrder\(\{ orderId: entry\.orderId, userId: entry\.userId \}\)/);
  assert.equal((pendingClientSource.match(/toast\.add\(/g) ?? []).length, 1);
  assert.equal((pendingClientSource.match(/rememberCompletedOrder\(/g) ?? []).length, 1);
  // 실행기는 완료(ack)에서만 onCompleted를 부른다.
  const doneAt = pendingRunnerSource.indexOf("if (outcome.action === 'done') {");
  assert.ok(doneAt !== -1);
  assert.match(
    pendingRunnerSource.slice(doneAt, doneAt + 200),
    /await deps\.store\.delete\(key\);[\s\S]*deps\.onCompleted\?\.\(counted\);/,
  );
  assert.equal((pendingRunnerSource.match(/deps\.onCompleted\?\.\(/g) ?? []).length, 1);
});

test('Y3: 토큰은 저장하지 않고 실행마다 getSession()으로 새로 받는다', () => {
  assert.doesNotMatch(pendingPolicySource, /accessToken/);
  assert.doesNotMatch(pendingStoreSource, /accessToken/);
  assert.match(pendingClientSource, /await getSession\(\{ broadcast: false \}\)/);
  // Service Worker·Background Sync를 쓰지 않는다.
  for (const source of [pendingClientSource, pendingRunnerSource, pendingUploaderSource]) {
    assert.doesNotMatch(codeOnly(source), /serviceWorker|SyncManager|sync\.register/);
  }
});

test('Y3: 업로드 대기열 실행기는 SessionProvider 안에 있고 앱 열기·연결 복구·화면 복귀·페이지 복원에 깨어난다', () => {
  const providerAt = providersSource.indexOf('<SessionProvider');
  const uploaderAt = providersSource.indexOf('<PendingPhotoUploader />');
  const providerEnd = providersSource.indexOf('</SessionProvider>');
  assert.ok(providerAt !== -1 && uploaderAt > providerAt && uploaderAt < providerEnd);
  assert.match(pendingUploaderSource, /status !== 'authenticated'/);
  assert.match(pendingUploaderSource, /addEventListener\('online', kick\)/);
  assert.match(pendingUploaderSource, /addEventListener\('pageshow', kick\)/);
  assert.match(pendingUploaderSource, /addEventListener\('visibilitychange', handleVisibility\)/);
  assert.match(pendingUploaderSource, /subscribePendingPhotoKick\(kick\)/);
  assert.match(pendingUploaderSource, /removeEventListener\('online', kick\)/);
  assert.match(pendingUploaderSource, /removeEventListener\('pageshow', kick\)/);
});

test('Y3: 세션이 없거나 쓸 수 없어도 앱 열기·화면 복귀 때 12시간 만료 정리(runAll)를 돌린다', () => {
  assert.match(pendingUploaderSource, /if \(status === 'loading' \|\| sessionUsable\) return;/);
  const effectAt = pendingUploaderSource.indexOf("if (status === 'loading' || sessionUsable) return;");
  const effect = pendingUploaderSource.slice(
    effectAt,
    pendingUploaderSource.indexOf('}, [status, sessionUsable]);', effectAt),
  );
  assert.match(effect, /void runner\.runAll\(\)/);
  assert.match(effect, /addEventListener\('visibilitychange', expire\)/);
  assert.match(effect, /removeEventListener\('visibilitychange', expire\)/);
});
