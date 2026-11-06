import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./RoundTile.tsx', import.meta.url), 'utf8');
const extrasSource = await readFile(new URL('./benchmark/CardExtras.tsx', import.meta.url), 'utf8');

// 그리드 판정 함수만 떼어 실행한다(나머지는 React 컴포넌트라 소스로 확인한다).
function loadPure() {
  const start = source.indexOf('const FEATURE_EVERY');
  const end = source.indexOf('function roundItemHref');
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', compiled)(module, module.exports);
  return module.exports;
}
const { isFeatureTile, unavailableLabel } = loadPure();

test('7개마다 첫 상품을 2칸 대표 타일로 키운다', () => {
  const featured = [...Array(15).keys()].filter((index) => isFeatureTile(index));
  assert.deepEqual(featured, [0, 7, 14]);
  assert.match(source, /feature \? '8\/5' : '4\/5'/);
  assert.match(source, /col-span-2/);
});

test('품절과 열린 회차의 판매 종료 상품만 그리드에서 빼고, 지난 회차는 그대로 둔다', () => {
  const open = { status: 'OPEN' };
  const scheduled = { status: 'SCHEDULED' };
  const closedRound = { status: 'CLOSED' };
  assert.equal(unavailableLabel({ status: 'SOLD_OUT' }, open, false), '품절');
  assert.equal(unavailableLabel({ status: 'SOLD_OUT' }, scheduled, false), '품절');
  assert.equal(unavailableLabel({ status: 'CLOSED' }, open, false), '판매 종료');
  assert.equal(unavailableLabel({ status: 'CLOSED' }, closedRound, false), null);
  assert.equal(unavailableLabel({ status: 'OPEN' }, open, false), null);
  assert.equal(unavailableLabel({ status: 'SOLD_OUT' }, open, true), null);
  assert.match(source, /다음 회차에 다시 올라와요/);
});

test('타일마다 붙던 도착·판매 예정 태그가 없고 + 버튼 원에는 그림자가 없다', () => {
  assert.doesNotMatch(source, /deliveryDayTag|'판매 예정'|boxShadow/);
});

test('남은 수량은 가격 줄 오른쪽 검정 글자로 한 번만 쓴다', () => {
  assert.match(source, /isFeatureOn\('demand-signals'\) && !isPast \? item\.demand\?\.remainingQuantity/);
  assert.match(source, /remaining <= 0 \|\| remaining > 5/);
  assert.match(source, /\{remaining\}개 남음/);
  assert.match(source, /<CardMeta item=\{item\} isPast=\{isPast\} showLowStock=\{false\} \/>/);
  assert.match(extrasSource, /showLowStock && isFeatureOn\('demand-signals'\)/);
});
