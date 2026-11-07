import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadModule(fileName, modules = {}) {
  const source = await readFile(new URL(`./${fileName}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (specifier) => {
      if (specifier in modules) return modules[specifier];
      throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const loadErrorModule = await loadModule('load-error-message.ts');
const {
  ORDER_DETAIL_LOAD_FAILED_MESSAGE,
  ORDER_DETAIL_STALE_MESSAGE,
  orderDetailReadFailureMessage,
} = await loadModule('order-detail-message.ts', {
  '@/lib/load-error-message': loadErrorModule,
});

test('주문 상세 조회 안내는 해요체이고 내부 표현이 없다', () => {
  assert.equal(
    ORDER_DETAIL_STALE_MESSAGE,
    '최신 주문 상태를 확인하지 못했어요. 상태를 다시 확인한 뒤 시도해 주세요.',
  );
  assert.equal(
    ORDER_DETAIL_LOAD_FAILED_MESSAGE,
    '주문 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
  );
  for (const message of [
    ORDER_DETAIL_STALE_MESSAGE,
    ORDER_DETAIL_LOAD_FAILED_MESSAGE,
    orderDetailReadFailureMessage('network'),
    orderDetailReadFailureMessage('server'),
  ]) {
    assert.doesNotMatch(message, /니다|니까|서버|[A-Za-z]/);
  }
});

test('연결 실패는 앱 공통 연결 안내로, 그 밖의 일시 실패는 불러오지 못했다는 안내로 보인다', () => {
  assert.equal(
    orderDetailReadFailureMessage('network'),
    loadErrorModule.CONNECTION_UNSTABLE_MESSAGE,
  );
  assert.equal(orderDetailReadFailureMessage('server'), ORDER_DETAIL_LOAD_FAILED_MESSAGE);
});
