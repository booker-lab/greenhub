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
  hiddenReviewNotice,
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

test('숨겨진 내 후기 안내는 사유 분류를 보여주고, 분류가 없으면 사유 없이 안내한다', () => {
  assert.equal(
    hiddenReviewNotice('광고·스팸'),
    '숨겨진 후기예요. 사유: 광고·스팸. 다른 고객에게는 보이지 않고 별점에도 들어가지 않아요.',
  );
  assert.equal(
    hiddenReviewNotice(undefined),
    '숨겨진 후기예요. 다른 고객에게는 보이지 않고 별점에도 들어가지 않아요.',
  );
});
