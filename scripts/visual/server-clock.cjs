// 화면 확인용 next 서버의 렌더 시계 고정 — start.mjs가 NODE_OPTIONS=--require로 주입한다.
//
// shots.mjs는 브라우저 시계를 기준 시각(GREENHUB_VISUAL_NOW)에 고정한다(page.clock.setFixedTime).
// 서버가 실제 시각으로 그리면, 오늘 날짜로 그리는 화면(정산 날짜 입력 max·배송 한도 달력의 지난 날 비활성 등)이
// 기준 시각과 실제 시각의 한국 날짜가 다를 때 서버 HTML과 브라우저 렌더가 어긋나 hydration 오류가 난다
// (--now로 다른 날을 주거나, 기본값으로 띄운 뒤 한국 시간 자정을 넘겨 찍을 때). 앱 문제가 아니다.
//
// 그래서 Next가 화면을 그리는 동안(요청·prerender 작업 단위 AsyncLocalStorage 안)에만 인자 없는
// new Date()·Date()·Date.now()가 기준 시각을 돌려주게 한다. 인자가 있는 Date·타이머·performance.now()는 그대로다.
// 프로세스 전체를 고정하면 next dev가 첫 컴파일에서 멈춘다(2026-11-07 실측: CPU를 쓰며 응답 없음).
// Next 작업 단위 저장소(Symbol.for('@next/work-unit-async-storage@<버전>'))를 찾지 못하면 실제 시각 그대로다.
const VISUAL_NOW_ENV = 'GREENHUB_VISUAL_NOW';
const WORK_UNIT_STORAGE_PREFIX = '@next/work-unit-async-storage@';

/** 고정 시각(ms). 값이 없거나 해석할 수 없으면 null(시계를 바꾸지 않는다). */
function fixedNowMs(value) {
  if (value === undefined || value === null || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * RealDate를 감싸, isFixed()가 참일 때 인자 없는 호출만 nowMs를 돌려주는 Date를 만든다.
 * instanceof Date·Date.prototype 메서드·Date.parse/UTC는 원래 Date 것을 그대로 쓴다.
 */
function createFixedDate(RealDate, nowMs, isFixed = () => true) {
  const realNow = RealDate.now.bind(RealDate);
  const current = () => (isFixed() ? nowMs : realNow());
  function FixedDate(...args) {
    // new 없이 부르면 원래 Date처럼 현재 시각 문자열을 돌려준다.
    if (!new.target) return new RealDate(current()).toString();
    return Reflect.construct(RealDate, args.length === 0 ? [current()] : args, new.target);
  }
  // 정적 속성(UTC·parse·prototype 등)은 자기 속성으로 복사한다. Next(node-environment-extensions/date.js)가
  // Date를 다시 감쌀 때 자기 속성만 복사하므로, 프로토타입 체인으로 물려주면 Date.UTC가 사라진다.
  const properties = Object.getOwnPropertyDescriptors(RealDate);
  properties.now = { ...properties.now, value: current };
  Object.defineProperties(FixedDate, properties);
  Object.setPrototypeOf(FixedDate, Object.getPrototypeOf(RealDate));
  return FixedDate;
}

/**
 * Next 작업 단위 저장소 안(화면을 그리는 중)인지 돌려주는 함수를 만든다.
 * 저장소는 Next가 처음 쓸 때 globalThis에 만들므로, 찾을 때까지 매번 다시 찾는다.
 */
function createRenderScopeCheck(root = globalThis) {
  let storages = [];
  return () => {
    if (storages.length === 0) {
      storages = Object.getOwnPropertySymbols(root)
        .filter((key) => key.description?.startsWith(WORK_UNIT_STORAGE_PREFIX))
        .map((key) => root[key])
        .filter((storage) => typeof storage?.getStore === 'function');
    }
    return storages.some((storage) => storage.getStore() !== undefined);
  };
}

const nowMs = fixedNowMs(process.env[VISUAL_NOW_ENV]);
if (nowMs !== null && !globalThis.Date.__greenhubVisualFixed) {
  const FixedDate = createFixedDate(globalThis.Date, nowMs, createRenderScopeCheck());
  Object.defineProperty(FixedDate, '__greenhubVisualFixed', { value: true });
  globalThis.Date = FixedDate;
}

module.exports = {
  createFixedDate,
  createRenderScopeCheck,
  fixedNowMs,
  VISUAL_NOW_ENV,
  WORK_UNIT_STORAGE_PREFIX,
};
