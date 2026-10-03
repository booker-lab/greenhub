import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  API_COMMAND_TIMEOUT_MS,
  API_READ_TIMEOUT_MS,
  API_UPLOAD_TIMEOUT_MS,
  ApiTimeoutError,
  fetchWithTimeout,
  isApiTimeoutError,
  resolveApiTimeoutMs,
} from './api-timeout.ts';

const apiSource = await readFile(new URL('./api.ts', import.meta.url), 'utf8');

// 가짜 fetch: signal이 abort되면 그 사유로 거절하고, 아니면 delayMs 뒤 응답한다.
function fakeFetch({ delayMs, rejectWith } = {}) {
  const calls = [];
  const impl = (url, init) => {
    calls.push({ url, init });
    return new Promise((resolve, reject) => {
      // 실제 fetch처럼 이미 취소된 신호면 즉시 거절한다.
      if (init.signal?.aborted) {
        reject(rejectWith ?? init.signal.reason);
        return;
      }
      const timer =
        delayMs === undefined
          ? null
          : setTimeout(() => resolve(new Response('{}', { status: 200 })), delayMs);
      init.signal?.addEventListener('abort', () => {
        if (timer) clearTimeout(timer);
        reject(rejectWith ?? init.signal.reason);
      });
    });
  };
  return { impl, calls };
}

test('기본 시간 제한: 조회 15초 < 명령 45초 < 업로드 90초', () => {
  assert.equal(API_READ_TIMEOUT_MS, 15_000);
  assert.equal(API_COMMAND_TIMEOUT_MS, 45_000);
  assert.equal(API_UPLOAD_TIMEOUT_MS, 90_000);
  assert.ok(API_READ_TIMEOUT_MS < API_COMMAND_TIMEOUT_MS);
  assert.ok(API_COMMAND_TIMEOUT_MS < API_UPLOAD_TIMEOUT_MS);
});

test('명령·업로드 제한은 서버 알림 최악 대기(약 35초)보다 넉넉하다', () => {
  // 서버(PR #378): ALIGO 호출당 8초 제한, 알림톡 3회×8초 + SMS 1회×8초 + 재시도 대기 최대 3초.
  const serverNotifyWorstMs = 3 * 8_000 + 8_000 + 3_000;
  assert.equal(serverNotifyWorstMs, 35_000);
  assert.ok(API_COMMAND_TIMEOUT_MS > serverNotifyWorstMs);
  // 업로드는 전송 시간(4MB·약 1Mbps ≈ 32초)에 알림 대기가 더해진다.
  assert.ok(API_UPLOAD_TIMEOUT_MS > serverNotifyWorstMs + 32_000);
});

test('메서드·본문으로 기본 제한을 고른다', () => {
  assert.equal(resolveApiTimeoutMs({}), API_READ_TIMEOUT_MS);
  assert.equal(resolveApiTimeoutMs({ method: 'get' }), API_READ_TIMEOUT_MS);
  assert.equal(resolveApiTimeoutMs({ method: 'HEAD' }), API_READ_TIMEOUT_MS);
  assert.equal(resolveApiTimeoutMs({ method: 'PATCH' }), API_COMMAND_TIMEOUT_MS);
  assert.equal(resolveApiTimeoutMs({ method: 'post' }), API_COMMAND_TIMEOUT_MS);
  assert.equal(resolveApiTimeoutMs({ method: 'DELETE' }), API_COMMAND_TIMEOUT_MS);
  // 사진 업로드(FormData)는 메서드와 무관하게 업로드 제한.
  assert.equal(resolveApiTimeoutMs({ method: 'POST', isFormData: true }), API_UPLOAD_TIMEOUT_MS);
});

test('호출자가 명시한 양의 유한수만 기본값을 덮어쓴다', () => {
  assert.equal(resolveApiTimeoutMs({ method: 'PATCH', timeoutMs: 5_000 }), 5_000);
  assert.equal(resolveApiTimeoutMs({ isFormData: true, timeoutMs: 90_000 }), 90_000);
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
    assert.equal(
      resolveApiTimeoutMs({ method: 'PATCH', timeoutMs: invalid }),
      API_COMMAND_TIMEOUT_MS,
      `무효 값 ${invalid}는 기본값`,
    );
  }
});

test('시간 초과 판정은 호출자 취소(AbortError)와 구분된다', () => {
  assert.equal(isApiTimeoutError(new ApiTimeoutError(10)), true);
  assert.equal(isApiTimeoutError({ name: 'ApiTimeoutError' }), true);
  assert.equal(isApiTimeoutError(new DOMException('aborted', 'AbortError')), false);
  assert.equal(isApiTimeoutError(new TypeError('Failed to fetch')), false);
  assert.equal(isApiTimeoutError(null), false);
  // 기존 화면의 "AbortError는 조용히 무시" 분기에 걸리지 않도록 DOMException이 아니다.
  assert.equal(new ApiTimeoutError(10) instanceof DOMException, false);
});

test('응답이 기한 안에 오면 그대로 돌려준다', async () => {
  const { impl, calls } = fakeFetch({ delayMs: 5 });
  const response = await fetchWithTimeout(impl, 'https://api.example.invalid/x', {}, 200);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('기한을 넘기면 ApiTimeoutError로 거절하고 재전송하지 않는다', async () => {
  const { impl, calls } = fakeFetch();
  await assert.rejects(
    fetchWithTimeout(impl, 'https://api.example.invalid/x', { method: 'PATCH' }, 20),
    (cause) => isApiTimeoutError(cause) && cause.timeoutMs === 20,
  );
  assert.equal(calls.length, 1, '시간 초과 뒤 자동 재전송 없음');
});

test('브라우저가 일반 AbortError로 거절해도 시간 초과면 ApiTimeoutError로 바꾼다', async () => {
  const { impl } = fakeFetch({ rejectWith: new DOMException('aborted', 'AbortError') });
  await assert.rejects(fetchWithTimeout(impl, 'https://api.example.invalid/x', {}, 20), (cause) =>
    isApiTimeoutError(cause),
  );
});

test('호출자 취소는 원래 AbortError 그대로 전달한다', async () => {
  const { impl } = fakeFetch();
  const controller = new AbortController();
  const pending = fetchWithTimeout(
    impl,
    'https://api.example.invalid/x',
    { signal: controller.signal },
    1_000,
  );
  controller.abort();
  await assert.rejects(pending, (cause) => {
    assert.equal(isApiTimeoutError(cause), false);
    assert.equal(cause instanceof DOMException && cause.name === 'AbortError', true);
    return true;
  });
});

test('이미 취소된 호출자 신호면 시간 제한 없이 바로 취소된다', async () => {
  const { impl } = fakeFetch();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchWithTimeout(impl, 'https://api.example.invalid/x', { signal: controller.signal }, 1_000),
    (cause) => cause instanceof DOMException && cause.name === 'AbortError',
  );
});

test('네트워크 오류는 시간 초과로 바꾸지 않는다', async () => {
  const impl = () => Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(
    fetchWithTimeout(impl, 'https://api.example.invalid/x', {}, 1_000),
    (cause) => cause instanceof TypeError && !isApiTimeoutError(cause),
  );
});

test('apiFetch는 모든 요청을 fetchWithTimeout + resolveApiTimeoutMs로 보낸다', () => {
  assert.match(apiSource, /fetchWithTimeout\(/);
  assert.match(
    apiSource,
    /resolveApiTimeoutMs\(\{ method: init\.method, isFormData, timeoutMs \}\)/,
  );
  assert.match(apiSource, /timeoutMs\?: number/);
  // 직접 fetch에 호출자 signal을 넘기는 옛 경로가 남지 않는다.
  assert.doesNotMatch(apiSource, /return fetch\(/);
});
