import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// 소스를 CommonJS로 바꿔 내보낸 값만 읽는다(React·Next 모듈은 빈 값으로 대신한다).
async function loadModule(fileName) {
  const source = await readFile(new URL(`./${fileName}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(() => ({}), loaded, loaded.exports);
  return { source, exports: loaded.exports };
}

const toast = await loadModule('QuickAddToast.tsx');
const notice = await loadModule('OfflineNotice.tsx');
const { QUICK_ADD_TOAST_BOTTOM } = toast.exports;
const { OFFLINE_NOTICE_HEIGHT_VAR, offlineNoticeBottomOffset, offlineNoticeHeightValue } =
  notice.exports;

/** calc(...) 안의 px 값을 더한다. 홈 표시줄 여백(env)은 0, 띠 높이 변수는 주어진 값(없으면 대체값)으로 본다. */
function resolvePx(expression, variables = {}) {
  const resolved = expression
    .replace(/env\([^)]*\)/g, '0px')
    .replace(/var\((--[\w-]+), ([^)]+)\)/g, (_, name, fallback) => variables[name] ?? fallback);
  assert.match(resolved, /^calc\([\d.px +]+\)$/);
  return [...resolved.matchAll(/(\d+(?:\.\d+)?)px/g)]
    .map((match) => Number(match[1]))
    .reduce((sum, value) => sum + value, 0);
}

test('오프라인 띠가 없으면 담기 알림은 지금처럼 하단 내비 위 12px에 뜬다', () => {
  assert.equal(resolvePx(QUICK_ADD_TOAST_BOTTOM), 64 + 12);
  assert.match(toast.source, /bottom: QUICK_ADD_TOAST_BOTTOM,/);
});

test('오프라인 띠가 떠 있으면 담기 알림은 띠 높이만큼 올라가 띠 위 12px에 뜬다', () => {
  // 담기 알림은 홈(하단 내비가 있는 화면)에서만 뜬다.
  assert.equal(offlineNoticeBottomOffset('/'), 'calc(64px + env(safe-area-inset-bottom))');
  for (const measured of [42, 41.4, 64]) {
    const height = offlineNoticeHeightValue(false, measured);
    const bandTop = resolvePx(offlineNoticeBottomOffset('/')) + Number.parseInt(height, 10);
    const toastBottom = resolvePx(QUICK_ADD_TOAST_BOTTOM, { [OFFLINE_NOTICE_HEIGHT_VAR]: height });
    assert.equal(toastBottom, bandTop + 12, `띠 높이 ${measured}px`);
    assert.ok(Number.parseInt(height, 10) >= measured, '띠 높이는 올려서 알린다');
  }
  // 두 파일이 같은 변수 이름을 쓴다.
  assert.ok(QUICK_ADD_TOAST_BOTTOM.includes(`var(${OFFLINE_NOTICE_HEIGHT_VAR}, 0px)`));
});
