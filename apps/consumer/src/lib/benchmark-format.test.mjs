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
const {
  priceDropFromPreviousRound,
  previousRoundDropLabel,
  sizeRows,
  expandPlantQuery,
  matchesPlantQuery,
} = module.exports;

test('지난 회차 대비 가격은 지금 가격이 더 낮을 때만 내린 금액을 돌려준다', () => {
  assert.equal(priceDropFromPreviousRound(33000, 30000), 3000);
  assert.equal(priceDropFromPreviousRound(30000, 30000), null);
  assert.equal(priceDropFromPreviousRound(29000, 30000), null);
  assert.equal(priceDropFromPreviousRound(undefined, 30000), null);
  assert.equal(priceDropFromPreviousRound(Number.NaN, 30000), null);
});

test('내린 금액 문구는 천 단위 콤마를 넣는다', () => {
  assert.equal(previousRoundDropLabel(3000), '지난 회차보다 3,000원 내렸어요');
  assert.equal(previousRoundDropLabel(500), '지난 회차보다 500원 내렸어요');
  assert.equal(previousRoundDropLabel(1234567), '지난 회차보다 1,234,567원 내렸어요');
});

test('크기 요약은 있는 값만 이어 붙인다', () => {
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
