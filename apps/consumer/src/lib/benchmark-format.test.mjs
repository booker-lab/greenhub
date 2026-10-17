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
const { discountRate, sizeRows, expandPlantQuery, matchesPlantQuery } = module.exports;

test('할인율은 정상가가 회차 가격보다 높을 때만 내림으로 보여준다', () => {
  assert.equal(discountRate(39000, 30000), 23);
  assert.equal(discountRate(30000, 30000), null);
  assert.equal(discountRate(undefined, 30000), null);
  assert.equal(discountRate(30100, 30000), null);
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

test('식물 이름 묶음: 흔한 관엽·화훼 별칭으로도 찾는다', () => {
  assert.ok(matchesPlantQuery('돈나무', ['금전수 대형']));
  assert.ok(matchesPlantQuery('자미오쿨카스', ['금전수']));
  assert.ok(matchesPlantQuery('스투키', ['산세베리아 스투키 화분']));
  assert.ok(matchesPlantQuery('산세비에리아', ['산세베리아']));
  assert.ok(matchesPlantQuery('monstera', ['몬스테라 델리시오사']));
  assert.ok(matchesPlantQuery('맛상게아나', ['행운목']));
  assert.ok(matchesPlantQuery('인도고무나무', ['고무나무 중형']));
  assert.ok(matchesPlantQuery('hydrangea', ['수국 꽃다발']));
  assert.ok(matchesPlantQuery('Tulip', ['튤립 10송이']));
  assert.ok(matchesPlantQuery('carnation', ['카네이션 바구니']));
  assert.ok(matchesPlantQuery('gerbera', ['거베라']));
  assert.ok(matchesPlantQuery('미니장미', ['장미 화분']));
});

test('식물 이름 묶음: 다른 꽃끼리는 섞이지 않는다', () => {
  assert.ok(!matchesPlantQuery('로즈마리', ['장미 화분']));
  assert.ok(!matchesPlantQuery('튤립', ['수국 꽃다발']));
  assert.ok(!matchesPlantQuery('몬스테라', ['고무나무']));
  assert.ok(!matchesPlantQuery('카네이션', ['호접란 빅립']));
  assert.ok(!expandPlantQuery('금전수').includes('행운목'));
});
