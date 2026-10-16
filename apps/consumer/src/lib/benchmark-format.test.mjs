import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./benchmark-format.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { discountRate, sizeSummary, sizeRows, expandPlantQuery, matchesPlantQuery } = module.exports;

test('할인율은 정상가가 회차 가격보다 높을 때만 내림으로 보여준다', () => {
  assert.equal(discountRate(39000, 30000), 23);
  assert.equal(discountRate(30000, 30000), null);
  assert.equal(discountRate(undefined, 30000), null);
  assert.equal(discountRate(30100, 30000), null);
});

test('크기 요약은 있는 값만 이어 붙인다', () => {
  assert.equal(sizeSummary({ heightCm: 60, potDiameterCm: 15, bloomCount: 18 }), '높이 60cm · 화분 15cm · 꽃 18송이');
  assert.equal(sizeSummary({ widthCm: 40 }), '폭 40cm');
  assert.equal(sizeSummary({}), null);
  assert.deepEqual(sizeRows({ heightCm: 60, bloomCount: 18 }), [
    ['높이', '60cm'],
    ['꽃 송이', '약 18송이'],
  ]);
});

test('식물 검색은 별칭·학명으로도 찾고, 상관없는 이름은 찾지 않는다', () => {
  assert.ok(expandPlantQuery('팔레놉시스').includes('호접란'));
  assert.ok(matchesPlantQuery('phalaenopsis', ['호접란 빅립']));
  assert.ok(matchesPlantQuery('빅 립', ['호접란 빅립']));
  assert.ok(!matchesPlantQuery('카스테라', ['호접란 빅립']));
  assert.ok(!matchesPlantQuery('  ', ['호접란 빅립']));
});
