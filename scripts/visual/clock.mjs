// 화면 확인 하네스의 고정 시각 — 같은 시각으로 찍어야 작업 전·후 캡처를 픽셀로 비교할 수 있다.
//
// start.mjs가 시각을 정해 환경 변수와 runtime.json에 남기고, fixture는 이 시각 기준 상대값으로 회차 일정을 만든다.
// shots.mjs는 브라우저 시계를 이 시각에 고정한다(page.clock.setFixedTime, 타이머는 그대로 돈다).
//
// 기본값은 실행한 날의 한국 시간 0시다.
// - 서버(next dev)는 실제 시각으로 그리므로, 날짜가 같아야 서버가 그린 날짜 글자와 브라우저가 어긋나지 않는다.
// - 고정 시각이 실제 시각보다 앞서지 않아야 에뮬레이터 토큰 등의 만료 계산이 꼬이지 않는다.
// 다른 날 찍은 캡처와 비교하려면 두 번 모두 --now <ISO>로 같은 시각을 준다.
export const VISUAL_NOW_ENV = 'GREENHUB_VISUAL_NOW';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** 실제 시각이 속한 한국 날짜의 0시(UTC ISO). */
export function defaultVisualNow(realMs = Date.now()) {
  const kstMidnight = Math.floor((realMs + KST_OFFSET_MS) / (24 * HOUR_MS)) * 24 * HOUR_MS;
  return new Date(kstMidnight - KST_OFFSET_MS).toISOString();
}

/** --now 값 검증. 비어 있으면 기본값, 해석할 수 없으면 예외. */
export function resolveVisualNow(value, realMs = Date.now()) {
  if (value === undefined || value === null || value === '') return defaultVisualNow(realMs);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`--now 시각을 해석할 수 없습니다: ${value}`);
  return new Date(ms).toISOString();
}

/** fixture가 읽는 현재 고정 시각. start.mjs·shots.mjs가 fixture를 import하기 전에 환경 변수를 정한다. */
export function visualNow() {
  return resolveVisualNow(process.env[VISUAL_NOW_ENV]);
}

/** 고정 시각에서 hours 시간 뒤(음수면 앞)의 UTC ISO. */
export function hoursFromNow(hours) {
  return new Date(Date.parse(visualNow()) + hours * HOUR_MS).toISOString();
}
