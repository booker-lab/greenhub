import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildDriverOrderDetailScope,
  buildDriverStatusConfirmContent,
  classifyDriverOrderCommandError,
  classifyDriverOrderReadError,
  DRIVER_HOLD_SAVED_MESSAGE,
  DRIVER_NON_REDELIVERABLE_HOLD_MESSAGE,
  DRIVER_ORDER_COMPLETED_SCREEN_MESSAGE,
  DRIVER_ORDER_NOT_FOUND_SCREEN_MESSAGE,
  DRIVER_RESUME_SUCCESS_MESSAGE,
  DRIVER_START_SUCCESS_FALLBACK_MESSAGE,
  DriverOrderReadError,
  driverDetailListHref,
  driverOrderItemCount,
  isDriverHoldResumable,
  isDriverOrderCommandAuthLoss,
  isDriverOrderCommandContinuationCurrent,
  isDriverOrderStatusAck,
  isDriverStatusConfirmCurrent,
  readDriverDetailBackContext,
  readDriverOrderCommandErrorCodeFromResponse,
  readDriverOrderErrorCode,
  resolveDriverCommandSuccessMessage,
  resolveDriverDetailBackAction,
  resolveDriverOrderNotFoundScreen,
  toDriverOrderNetworkError,
  toDriverOrderReadError,
} from './driver-order-detail.ts';

test('404은 NOT_FOUND로 분류한다', () => {
  assert.equal(classifyDriverOrderReadError(404), 'NOT_FOUND');
  assert.equal(toDriverOrderReadError(404).kind, 'NOT_FOUND');
});

test('401·403은 AUTH_ERROR로 분류한다', () => {
  assert.equal(classifyDriverOrderReadError(401), 'AUTH_ERROR');
  assert.equal(classifyDriverOrderReadError(403), 'AUTH_ERROR');
  assert.equal(toDriverOrderReadError(401).kind, 'AUTH_ERROR');
  assert.equal(toDriverOrderReadError(403).kind, 'AUTH_ERROR');
});

test('5xx·기타 non-ok는 FETCH_ERROR로 분류한다', () => {
  for (const status of [400, 429, 500, 502, 503]) {
    assert.equal(classifyDriverOrderReadError(status), 'FETCH_ERROR');
    assert.equal(toDriverOrderReadError(status).kind, 'FETCH_ERROR');
  }
});

test('network exception은 FETCH_ERROR가 된다', () => {
  const error = toDriverOrderNetworkError();
  assert.ok(error instanceof DriverOrderReadError);
  assert.equal(error.kind, 'FETCH_ERROR');
  assert.equal(error.status, null);
});

test('semantic ACK: orderId와 status가 모두 일치해야 true', () => {
  assert.equal(
    isDriverOrderStatusAck({ orderId: 'o1', status: 'DELIVERING' }, 'o1', 'DELIVERING'),
    true,
  );
});

test('semantic ACK: orderId 불일치는 false', () => {
  assert.equal(
    isDriverOrderStatusAck({ orderId: 'other', status: 'DELIVERING' }, 'o1', 'DELIVERING'),
    false,
  );
});

test('semantic ACK: status 불일치는 false', () => {
  assert.equal(
    isDriverOrderStatusAck({ orderId: 'o1', status: 'PREPARING' }, 'o1', 'DELIVERING'),
    false,
  );
});

test('detail scope는 orderId·user·role·token을 모두 구분한다', () => {
  const base = { orderId: 'o1', userId: 'u1', role: 'driver', token: 't1' };
  assert.equal(buildDriverOrderDetailScope(base), buildDriverOrderDetailScope(base));
  assert.notEqual(
    buildDriverOrderDetailScope(base),
    buildDriverOrderDetailScope({ ...base, orderId: 'o2' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope(base),
    buildDriverOrderDetailScope({ ...base, userId: 'u2' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope(base),
    buildDriverOrderDetailScope({ ...base, role: 'admin' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope(base),
    buildDriverOrderDetailScope({ ...base, token: 't2' }),
  );
  assert.notEqual(
    buildDriverOrderDetailScope(base),
    buildDriverOrderDetailScope({ orderId: 'o1', userId: null, role: null, token: null }),
  );
});

test('command 401·403만 authority loss다 (legacy fail-closed fallback)', () => {
  assert.equal(isDriverOrderCommandAuthLoss(401), true);
  assert.equal(isDriverOrderCommandAuthLoss(403), true);
  for (const status of [404, 409, 422, 500]) {
    assert.equal(isDriverOrderCommandAuthLoss(status), false);
  }
});

test('command continuation은 동일 seq·scope일 때만 current다', () => {
  const scope = buildDriverOrderDetailScope({
    orderId: 'o1',
    userId: 'u1',
    role: 'driver',
    token: 't1',
  });
  const other = buildDriverOrderDetailScope({
    orderId: 'o1',
    userId: 'u2',
    role: 'driver',
    token: 't2',
  });
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scope,
      currentSeq: 1,
      currentScope: scope,
    }),
    true,
  );
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scope,
      currentSeq: 2,
      currentScope: scope,
    }),
    false,
  );
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scope,
      currentSeq: 1,
      currentScope: other,
    }),
    false,
  );
  assert.equal(
    isDriverOrderCommandContinuationCurrent({
      snapshotSeq: 1,
      snapshotScope: scope,
      currentSeq: 1,
      currentScope: null,
    }),
    false,
  );
});

// DRIVER-DETAIL-COMMAND-ERROR-CODE-CLIENT-CONVERGENCE-01 pure contract.
// status + stable error-code → client recovery classification.

// 1. 401 → AUTHORITY_LOSS (code 무관).
test('1. 401은 code와 무관하게 AUTHORITY_LOSS다', () => {
  assert.equal(classifyDriverOrderCommandError({ status: 401, code: null }), 'AUTHORITY_LOSS');
  assert.equal(
    classifyDriverOrderCommandError({ status: 401, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'AUTHORITY_LOSS',
  );
  assert.equal(
    classifyDriverOrderCommandError({ status: 401, code: 'DRIVER_ORDER_AUTHORITY_DENIED' }),
    'AUTHORITY_LOSS',
  );
  assert.equal(
    classifyDriverOrderCommandError({ status: 401, code: 'DRIVER_ORDER_NOT_FOUND' }),
    'AUTHORITY_LOSS',
  );
});

// 2. 403 + AUTHORITY_DENIED → AUTHORITY_LOSS.
test('2. 403 + DRIVER_ORDER_AUTHORITY_DENIED는 AUTHORITY_LOSS다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_AUTHORITY_DENIED' }),
    'AUTHORITY_LOSS',
  );
});

// 3. 403 + STATE_CONFLICT → STATE_CONFLICT (auth-loss 아님).
test('3. 403 + DRIVER_ORDER_STATE_CONFLICT는 STATE_CONFLICT이며 auth-loss가 아니다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'STATE_CONFLICT',
  );
  assert.notEqual(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'AUTHORITY_LOSS',
  );
});

// 4. 409 + STATE_CONFLICT → STATE_CONFLICT.
test('4. 409 + DRIVER_ORDER_STATE_CONFLICT는 STATE_CONFLICT다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 409, code: 'DRIVER_ORDER_STATE_CONFLICT' }),
    'STATE_CONFLICT',
  );
});

// 5. 404 + NOT_FOUND → NOT_FOUND.
test('5. 404 + DRIVER_ORDER_NOT_FOUND는 NOT_FOUND다', () => {
  assert.equal(
    classifyDriverOrderCommandError({ status: 404, code: 'DRIVER_ORDER_NOT_FOUND' }),
    'NOT_FOUND',
  );
});

// 6. unknown/missing-code 403 → fail-closed AUTHORITY_LOSS.
test('6. code 없는 unknown 403은 fail-closed AUTHORITY_LOSS다', () => {
  assert.equal(classifyDriverOrderCommandError({ status: 403, code: null }), 'AUTHORITY_LOSS');
  assert.equal(classifyDriverOrderCommandError({ status: 403, code: undefined }), 'AUTHORITY_LOSS');
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'SOME_UNKNOWN' }),
    'AUTHORITY_LOSS',
  );
  assert.equal(classifyDriverOrderCommandError({ status: 403, code: '' }), 'AUTHORITY_LOSS');
});

// 7. malformed error body → crash 없음, null, 자동 resend 없음 (분류는 fail-closed).
test('7. malformed error body는 null이며 crash 없이 fail-closed 분류한다', async () => {
  assert.equal(readDriverOrderErrorCode(null), null);
  assert.equal(readDriverOrderErrorCode(undefined), null);
  assert.equal(readDriverOrderErrorCode('FORBIDDEN'), null);
  assert.equal(readDriverOrderErrorCode(403), null);
  assert.equal(readDriverOrderErrorCode({}), null);
  assert.equal(readDriverOrderErrorCode({ code: null }), null);
  assert.equal(readDriverOrderErrorCode({ code: 403 }), null);
  assert.equal(readDriverOrderErrorCode({ code: 'UNKNOWN_CODE' }), null);
  assert.equal(
    readDriverOrderErrorCode({ code: 'DRIVER_ORDER_AUTHORITY_DENIED' }),
    'DRIVER_ORDER_AUTHORITY_DENIED',
  );
  // Response json 파싱 실패도 throw 없이 null이다.
  const malformed = {
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  };
  assert.equal(await readDriverOrderCommandErrorCodeFromResponse(malformed), null);
  const emptyThrow = {
    json: async () => {
      throw new Error('empty body');
    },
  };
  assert.equal(
    classifyDriverOrderCommandError({
      status: 409,
      code: await readDriverOrderCommandErrorCodeFromResponse(emptyThrow),
    }),
    'UNCERTAIN',
  );
  // 403 malformed는 authority protection을 낮추지 않는다.
  assert.equal(
    classifyDriverOrderCommandError({
      status: 403,
      code: await readDriverOrderCommandErrorCodeFromResponse(malformed),
    }),
    'AUTHORITY_LOSS',
  );
});

// 404 body 미판독/코드 없음은 새로운 성공 의미를 추론하지 않는다 (UNCERTAIN).
test('404 unknown 코드는 NOT_FOUND가 아니라 UNCERTAIN이다', () => {
  assert.equal(classifyDriverOrderCommandError({ status: 404, code: null }), 'UNCERTAIN');
  assert.equal(classifyDriverOrderCommandError({ status: 404, code: 'UNKNOWN' }), 'UNCERTAIN');
});

// 예상 밖 4xx/5xx + ratified 코드 없음은 UNCERTAIN이며 성공으로 추론하지 않는다.
test('unknown 4xx/5xx는 UNCERTAIN이며 성공·resend를 유도하지 않는다', () => {
  assert.equal(classifyDriverOrderCommandError({ status: 409, code: null }), 'UNCERTAIN');
  assert.equal(classifyDriverOrderCommandError({ status: 500, code: null }), 'UNCERTAIN');
  assert.equal(classifyDriverOrderCommandError({ status: 422, code: null }), 'UNCERTAIN');
  assert.equal(classifyDriverOrderCommandError({ status: 400, code: null }), 'UNCERTAIN');
});

// 12. DRIVER_ORDER_ALREADY_APPLIED를 client에서 새로 생성·추론하지 않는다.
test('12. DRIVER_ORDER_ALREADY_APPLIED는 인식하지 않으며 새 의미를 만들지 않는다', async () => {
  assert.equal(readDriverOrderErrorCode({ code: 'DRIVER_ORDER_ALREADY_APPLIED' }), null);
  assert.equal(
    classifyDriverOrderCommandError({ status: 409, code: 'DRIVER_ORDER_ALREADY_APPLIED' }),
    'UNCERTAIN',
  );
  assert.equal(
    classifyDriverOrderCommandError({ status: 403, code: 'DRIVER_ORDER_ALREADY_APPLIED' }),
    'AUTHORITY_LOSS',
  );
  const helperSource = await readFile(new URL('./driver-order-detail.ts', import.meta.url), 'utf8');
  // 새로 정의하지 않는다: const 정의나 union 타입 추가로 만들지 않는다.
  assert.doesNotMatch(helperSource, /export const \w*ALREADY_APPLIED/);
  assert.doesNotMatch(helperSource, /\|\s*'DRIVER_ORDER_ALREADY_APPLIED'/);
  assert.doesNotMatch(helperSource, /return\s*'DRIVER_ORDER_ALREADY_APPLIED'/);
});

// shared SSOT와 동일한 wire 문자열만 인식한다 (client UX 의미를 shared에 넣지 않음).
test('shared stable code와 동일한 wire 문자열을 소비한다', async () => {
  const helperSource = await readFile(new URL('./driver-order-detail.ts', import.meta.url), 'utf8');
  assert.match(helperSource, /DRIVER_ORDER_AUTHORITY_DENIED/);
  assert.match(helperSource, /DRIVER_ORDER_STATE_CONFLICT/);
  assert.match(helperSource, /DRIVER_ORDER_NOT_FOUND/);
  const sharedSource = await readFile(
    new URL('../../../../../../packages/shared/src/driver-order-error.types.ts', import.meta.url),
    'utf8',
  );
  for (const code of [
    'DRIVER_ORDER_AUTHORITY_DENIED',
    'DRIVER_ORDER_STATE_CONFLICT',
    'DRIVER_ORDER_NOT_FOUND',
  ]) {
    assert.match(sharedSource, new RegExp(code));
    assert.match(helperSource, new RegExp(code));
  }
  assert.doesNotMatch(sharedSource, /AUTHORITY_LOSS/);
  assert.doesNotMatch(sharedSource, /STATE_CONFLICT.*recovery|recovery.*STATE_CONFLICT/);
});

// D-16. 상세 뒤로가기: 앱 안 이전 기록이 있을 때만 back, 아니면 상태에 맞는 목록 탭으로 replace.
test('D-16. 목록 탭: 배송 중·보류는 배송 중 탭, 그 밖은 기본 탭이다', () => {
  assert.equal(driverDetailListHref('DELIVERING'), '/board?tab=delivering');
  assert.equal(driverDetailListHref('DELIVERY_HELD'), '/board?tab=delivering');
  assert.equal(driverDetailListHref('PREPARING'), '/board');
  assert.equal(driverDetailListHref(undefined), '/board');
});

test('D-16. Navigation API가 있으면 canGoBack을 그대로 따른다', () => {
  const base = { historyLength: 5, referrer: '', origin: 'https://d.example', onLandingPage: true };
  assert.equal(resolveDriverDetailBackAction({ ...base, canGoBack: true }), 'back');
  assert.equal(resolveDriverDetailBackAction({ ...base, canGoBack: false }), 'list');
});

test('D-16. Navigation API가 없으면 기록 길이·처음 연 화면·referrer로 추정한다', () => {
  const origin = 'https://d.example';
  // 새 탭에서 바로 연 상세: 기록 없음.
  assert.equal(
    resolveDriverDetailBackAction({ historyLength: 1, referrer: '', origin, onLandingPage: true }),
    'list',
  );
  // 메신저 등 다른 사이트에서 연 첫 화면.
  assert.equal(
    resolveDriverDetailBackAction({
      historyLength: 3,
      referrer: 'https://chat.example/room',
      origin,
      onLandingPage: true,
    }),
    'list',
  );
  // referrer가 비어 있는 첫 화면(바로가기·정책으로 지워짐)은 앱 밖으로 나가지 않는 쪽.
  assert.equal(
    resolveDriverDetailBackAction({ historyLength: 2, referrer: '', origin, onLandingPage: true }),
    'list',
  );
  // 앱 안에서 연 첫 화면, 또는 앱 안 이동 뒤.
  assert.equal(
    resolveDriverDetailBackAction({
      historyLength: 2,
      referrer: 'https://d.example/board',
      origin,
      onLandingPage: true,
    }),
    'back',
  );
  assert.equal(
    resolveDriverDetailBackAction({ historyLength: 2, referrer: '', origin, onLandingPage: false }),
    'back',
  );
});

test('D-16. 브라우저 값 읽기: 처음 연 경로를 읽지 못하면 처음 연 화면으로 본다', () => {
  const win = (overrides = {}) => ({
    history: { length: 2 },
    location: { origin: 'https://d.example', pathname: '/board/o1' },
    document: { referrer: '' },
    ...overrides,
  });
  assert.deepEqual(readDriverDetailBackContext(win()), {
    canGoBack: undefined,
    historyLength: 2,
    referrer: '',
    origin: 'https://d.example',
    onLandingPage: true,
    currentPathname: '/board/o1',
    previousPathname: undefined,
  });
  const landedOnBoard = readDriverDetailBackContext(
    win({
      navigation: { canGoBack: true },
      performance: { getEntriesByType: () => [{ name: 'https://d.example/board' }] },
    }),
  );
  assert.equal(landedOnBoard.canGoBack, true);
  assert.equal(landedOnBoard.onLandingPage, false);
  const landedHere = readDriverDetailBackContext(
    win({ performance: { getEntriesByType: () => [{ name: 'https://d.example/board/o1' }] } }),
  );
  assert.equal(landedHere.onLandingPage, true);
  const broken = readDriverDetailBackContext(
    win({
      navigation: { canGoBack: 'yes' },
      performance: { getEntriesByType: () => [{ name: '::' }] },
    }),
  );
  assert.equal(broken.canGoBack, undefined);
  assert.equal(broken.onLandingPage, true);
});

// 세션이 끝나 다시 로그인한 뒤(callbackUrl 복귀) 상세·사진 화면의 뒤로가기(findings §5.4).
// 바로 앞 기록이 로그인 화면이면 back은 /login으로 가고, 로그인한 기사라 proxy가 같은 화면으로 다시 보낸다.
// 로그아웃(signOut)이 남긴 같은 화면 기록으로 가도 같은 화면이 다시 뜰 뿐이다. 둘 다 부모 화면으로 replace한다.
test('로그인 복귀: 바로 앞 기록이 로그인 화면이거나 같은 화면이면 back 대신 부모 화면으로 보낸다', () => {
  const base = {
    canGoBack: true,
    historyLength: 4,
    referrer: '',
    origin: 'https://d.example',
    onLandingPage: true,
    currentPathname: '/board/o1',
  };
  assert.equal(resolveDriverDetailBackAction({ ...base, previousPathname: '/login' }), 'list');
  assert.equal(resolveDriverDetailBackAction({ ...base, previousPathname: '/board/o1' }), 'list');
  // 앱 안에서 정상으로 들어온 경우(목록 → 상세, 상세 → 사진)는 그대로 back이다.
  assert.equal(resolveDriverDetailBackAction({ ...base, previousPathname: '/board' }), 'back');
  assert.equal(
    resolveDriverDetailBackAction({
      ...base,
      currentPathname: '/board/o1/photo/round-direct',
      previousPathname: '/board/o1',
    }),
    'back',
  );
  // 앞 기록을 읽지 못하면 이전 판정 그대로다.
  assert.equal(resolveDriverDetailBackAction({ ...base, previousPathname: undefined }), 'back');
  assert.equal(resolveDriverDetailBackAction({ ...base, canGoBack: false }), 'list');
});

test('로그인 복귀: Navigation API가 없으면 처음 연 화면의 referrer가 로그인 화면일 때 부모 화면으로 보낸다', () => {
  const ctx = {
    historyLength: 3,
    origin: 'https://d.example',
    onLandingPage: true,
    currentPathname: '/board/o1',
  };
  assert.equal(
    resolveDriverDetailBackAction({
      ...ctx,
      referrer: 'https://d.example/login?reason=expired&callbackUrl=%2Fboard%2Fo1',
    }),
    'list',
  );
  assert.equal(
    resolveDriverDetailBackAction({ ...ctx, referrer: 'https://d.example/board' }),
    'back',
  );
  // 앱 안 이동 뒤에는 referrer가 바뀌지 않으므로 보지 않는다.
  assert.equal(
    resolveDriverDetailBackAction({
      ...ctx,
      onLandingPage: false,
      referrer: 'https://d.example/login?callbackUrl=%2Fboard%2Fo1',
    }),
    'back',
  );
});

test('로그인 복귀: 브라우저 값 읽기는 Navigation API의 바로 앞 기록 경로를 읽는다', () => {
  const win = (navigation) => ({
    history: { length: 3 },
    location: { origin: 'https://d.example', pathname: '/board/o1' },
    document: { referrer: '' },
    navigation,
  });
  const entries = [
    { url: 'https://d.example/board' },
    { url: 'https://d.example/login?reason=expired&callbackUrl=%2Fboard%2Fo1' },
    { url: 'https://d.example/board/o1' },
  ];
  const afterLogin = readDriverDetailBackContext(
    win({ canGoBack: true, currentEntry: { index: 2 }, entries: () => entries }),
  );
  assert.equal(afterLogin.previousPathname, '/login');
  assert.equal(afterLogin.currentPathname, '/board/o1');
  assert.equal(resolveDriverDetailBackAction(afterLogin), 'list');
  const fromBoard = readDriverDetailBackContext(
    win({ canGoBack: true, currentEntry: { index: 1 }, entries: () => entries }),
  );
  assert.equal(fromBoard.previousPathname, '/board');
  // 첫 기록·깨진 값·entries 없음은 undefined(이전 판정 그대로).
  for (const navigation of [
    { canGoBack: false, currentEntry: { index: 0 }, entries: () => entries },
    { canGoBack: true, currentEntry: null, entries: () => entries },
    { canGoBack: true, currentEntry: { index: 1 }, entries: () => [{ url: null }, {}] },
    { canGoBack: true, currentEntry: { index: 1 }, entries: () => [{ url: '::' }, {}] },
    {
      canGoBack: true,
      currentEntry: { index: 1 },
      entries: () => {
        throw new Error('blocked');
      },
    },
    { canGoBack: true },
    undefined,
  ]) {
    assert.equal(readDriverDetailBackContext(win(navigation)).previousPathname, undefined);
  }
});

test('D-17. 주문 없음 화면은 이유를 해요체로 알린다', () => {
  assert.equal(DRIVER_ORDER_NOT_FOUND_SCREEN_MESSAGE, '다른 기사가 맡았거나 이미 끝난 주문이에요.');
});

test('D-02. 상품 수는 상품 목록 수량 합계, 어긋나면 주문 수량, 모르면 null', () => {
  assert.equal(
    driverOrderItemCount(
      [
        { productName: 'a', quantity: 1 },
        { productName: 'b', quantity: 2 },
      ],
      9,
    ),
    3,
  );
  assert.equal(driverOrderItemCount([{ productName: 'a', quantity: 0 }], 2), 2);
  assert.equal(driverOrderItemCount(undefined, 4), 4);
  assert.equal(driverOrderItemCount([], 0), null);
  assert.equal(driverOrderItemCount(null, undefined), null);
});

test('D-02. 확인 창은 연 상태(수거 대기·보류)와 지금 상태가 같을 때만 유효하다', () => {
  assert.equal(isDriverStatusConfirmCurrent('START', 'PREPARING'), true);
  assert.equal(isDriverStatusConfirmCurrent('RESUME', 'DELIVERY_HELD'), true);
  assert.equal(isDriverStatusConfirmCurrent('START', 'DELIVERING'), false);
  assert.equal(isDriverStatusConfirmCurrent('RESUME', 'PREPARING'), false);
  assert.equal(isDriverStatusConfirmCurrent(null, 'PREPARING'), false);
});

test('D-02. 배송 시작 확인 창: 동·호수·상품 수·손님 알림·배정 안내', () => {
  const address = { base: '경기도 이천시 테스트로 1', detail: '101동 202호' };
  const neutral = buildDriverStatusConfirmContent({ kind: 'START', address, itemCount: 2 });
  assert.equal(neutral.title, '배송을 시작할까요?');
  assert.equal(neutral.place, '101동 202호');
  assert.equal(neutral.placeBase, '경기도 이천시 테스트로 1');
  assert.equal(neutral.itemsLine, '상품 총 2개');
  assert.equal(neutral.notice, '손님에게 배송 시작 알림이 가요.');
  // 배정 여부를 모르면 단정하지 않는다.
  assert.equal(neutral.assignment, '이 주문을 맡아 배송을 시작해요.');
  assert.equal(neutral.confirmLabel, '배송 시작');
  assert.match(
    buildDriverStatusConfirmContent({ kind: 'START', address, itemCount: 2, assignedToMe: false })
      .assignment,
    /아직 아무도 맡지 않은 주문이에요/,
  );
  assert.equal(
    buildDriverStatusConfirmContent({ kind: 'START', address, itemCount: 2, assignedToMe: true })
      .assignment,
    null,
  );
  // 동·호수를 나눌 수 없으면 전체 주소, 수량을 모르면 상품 줄 없음.
  const whole = buildDriverStatusConfirmContent({
    kind: 'START',
    address: { base: '경기도 이천시 테스트로 1 101동', detail: null },
    itemCount: null,
  });
  assert.equal(whole.place, '경기도 이천시 테스트로 1 101동');
  assert.equal(whole.placeBase, null);
  assert.equal(whole.itemsLine, null);
});

test('D-02. 배송 재개 확인 창: 재배송 일정 알림, 배정 안내 없음', () => {
  const content = buildDriverStatusConfirmContent({
    kind: 'RESUME',
    address: { base: '경기도 이천시 테스트로 1', detail: '101동 202호' },
    itemCount: 1,
    assignedToMe: false,
  });
  assert.equal(content.title, '배송을 다시 시작할까요?');
  assert.equal(content.notice, '손님에게 재배송 일정 알림이 가요.');
  assert.equal(content.assignment, null);
  assert.equal(content.confirmLabel, '배송 재개');
});

test('R-01. 방금 완료한 주문의 주문 없음 화면은 완료 안내와 배송 중 탭으로 보낸다', () => {
  assert.equal(DRIVER_ORDER_COMPLETED_SCREEN_MESSAGE, '배송을 마친 주문이에요.');
  assert.deepEqual(resolveDriverOrderNotFoundScreen({ recentlyCompleted: true }), {
    message: '배송을 마친 주문이에요.',
    listHref: '/board?tab=delivering',
  });
  // 기억이 없거나 읽지 못하면 D-17 안내와 기본 탭 그대로다.
  assert.deepEqual(resolveDriverOrderNotFoundScreen({ recentlyCompleted: false }), {
    message: DRIVER_ORDER_NOT_FOUND_SCREEN_MESSAGE,
    listHref: '/board',
  });
});

test('R-06. 시작·재개·보류 저장 결과 알림은 다시 읽은 상태가 요청과 같을 때만 고른다', () => {
  const message = (args) => resolveDriverCommandSuccessMessage(args);
  // 수거 대기 → 배송 중: 동·호수(거점은 거점 이름)를 앞에 쓴다. 모르면 동·호수 없이 쓴다.
  assert.equal(
    message({
      requestedStatus: 'DELIVERING',
      fromStatus: 'PREPARING',
      freshStatus: 'DELIVERING',
      place: '101동 1203호',
    }),
    '101동 1203호 배송을 시작했어요.',
  );
  for (const place of [null, undefined, '', '  ']) {
    assert.equal(
      message({
        requestedStatus: 'DELIVERING',
        fromStatus: 'PREPARING',
        freshStatus: 'DELIVERING',
        place,
      }),
      DRIVER_START_SUCCESS_FALLBACK_MESSAGE,
    );
  }
  assert.equal(DRIVER_START_SUCCESS_FALLBACK_MESSAGE, '배송을 시작했어요.');
  // 배송 보류 → 배송 중: 재개.
  assert.equal(
    message({
      requestedStatus: 'DELIVERING',
      fromStatus: 'DELIVERY_HELD',
      freshStatus: 'DELIVERING',
      place: '101동 1203호',
    }),
    '배송을 다시 시작했어요.',
  );
  assert.equal(DRIVER_RESUME_SUCCESS_MESSAGE, '배송을 다시 시작했어요.');
  // 보류 저장.
  assert.equal(
    message({
      requestedStatus: 'DELIVERY_HELD',
      fromStatus: 'DELIVERING',
      freshStatus: 'DELIVERY_HELD',
    }),
    '배송 보류를 저장했어요.',
  );
  assert.equal(DRIVER_HOLD_SAVED_MESSAGE, '배송 보류를 저장했어요.');
  // 다시 읽은 상태가 요청과 다르면(다른 처리가 끼어듦) 알리지 않는다.
  assert.equal(
    message({
      requestedStatus: 'DELIVERING',
      fromStatus: 'PREPARING',
      freshStatus: 'DELIVERY_HELD',
    }),
    null,
  );
  assert.equal(
    message({
      requestedStatus: 'DELIVERY_HELD',
      fromStatus: 'DELIVERING',
      freshStatus: 'DELIVERING',
    }),
    null,
  );
  // 그 밖의 전이(완료는 별도 안내, 알 수 없는 출발 상태)는 이 알림을 쓰지 않는다.
  assert.equal(
    message({ requestedStatus: 'DELIVERED', fromStatus: 'DELIVERING', freshStatus: 'DELIVERED' }),
    null,
  );
  assert.equal(
    message({ requestedStatus: 'DELIVERING', fromStatus: 'DELIVERING', freshStatus: 'DELIVERING' }),
    null,
  );
});

test('상품 파손 보류는 배송 재개 대상이 아니고, 상세는 재개 버튼 대신 가게로 돌려줄 것을 안내한다', async () => {
  assert.equal(isDriverHoldResumable({ reasonCode: 'PRODUCT_DAMAGED' }), false);
  for (const reasonCode of [
    'WEATHER',
    'RECEIPT_REFUSED',
    'ACCESS_UNAVAILABLE',
    'CUSTOMER_UNREACHABLE',
  ]) {
    assert.equal(isDriverHoldResumable({ reasonCode }), true, reasonCode);
  }
  // 보류 내용이 없으면 기존처럼 결제 게이트(deliveryStartAllowed)가 재개를 판정한다.
  assert.equal(isDriverHoldResumable(null), true);
  assert.equal(
    DRIVER_NON_REDELIVERABLE_HOLD_MESSAGE,
    '상품을 가게로 돌려주세요. 판매자가 확인한 뒤 주문을 취소·환불해요.',
  );
  const pageSource = await readFile(new URL('../[orderId]/page.tsx', import.meta.url), 'utf8');
  const noticeAt = pageSource.indexOf('!isDriverHoldResumable(order.deliveryHold) && (');
  const resumeGuardAt = pageSource.indexOf(
    'isDriverHoldResumable(order.deliveryHold) &&',
    noticeAt + 1,
  );
  const resumeButtonAt = pageSource.indexOf("openStatusConfirm('RESUME')");
  assert.ok(noticeAt !== -1, '파손 보류 안내가 있다');
  assert.ok(
    resumeGuardAt > noticeAt && resumeGuardAt < resumeButtonAt,
    '재개 버튼은 재개 가능한 보류에만',
  );
  assert.ok(pageSource.includes('{DRIVER_NON_REDELIVERABLE_HOLD_MESSAGE}'));
});

// S-05(2026-11-14): 고객 사유 보류 상품은 그날 가게로 돌려준다.
test('고객 책임 보류(상품 파손 제외, 풀리지 않음)만 반납 안내 대상이다', async () => {
  const { isCustomerResponsibleHold, DRIVER_CUSTOMER_HOLD_RETURN_MESSAGE } = await import(
    './driver-order-detail.ts'
  );
  assert.equal(
    isCustomerResponsibleHold({
      customerResponsible: true,
      reasonCode: 'RECEIPT_REFUSED',
      resolvedAt: null,
    }),
    true,
  );
  assert.equal(
    isCustomerResponsibleHold({ customerResponsible: true, reasonCode: 'ACCESS_UNAVAILABLE' }),
    true,
  );
  assert.equal(
    isCustomerResponsibleHold({
      customerResponsible: false,
      reasonCode: 'WEATHER',
      resolvedAt: null,
    }),
    false,
  );
  assert.equal(
    isCustomerResponsibleHold({
      customerResponsible: true,
      reasonCode: 'PRODUCT_DAMAGED',
      resolvedAt: null,
    }),
    false,
  );
  assert.equal(
    isCustomerResponsibleHold({
      customerResponsible: true,
      reasonCode: 'ACCESS_UNAVAILABLE',
      resolvedAt: '2026-11-14T01:00:00.000Z',
    }),
    false,
  );
  assert.equal(isCustomerResponsibleHold(null), false);
  assert.equal(
    DRIVER_CUSTOMER_HOLD_RETURN_MESSAGE,
    '상품을 오늘 가게로 돌려주세요. 재배송이 정해지면 다시 수거해요.',
  );
});
