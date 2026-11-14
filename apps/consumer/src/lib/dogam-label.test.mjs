import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./dogam-label.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const shared = {
  LIGHT_LABELS: { bright: '밝은 곳', medium: '반그늘', low: '그늘에서도' },
  PLACEMENT_LABELS: { living: '거실', office: '사무실', bedroom: '침실', store: '매장·개업' },
};
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled)(module, module.exports, (name) => {
  assert.equal(name, '@greenhub/shared');
  return shared;
});
const { dogamLabel, flowerLookRows } = module.exports;

test('도감 라벨은 개화·꽃대·향·관리·크기·빛·놓을 곳 순서로 한 줄을 만든다', () => {
  assert.equal(
    dogamLabel({
      selection: { bloomCondition: 'bud', stemType: '쌍대', fragrance: 'light', careLevel: 'easy' },
      size: { heightCm: 60, potDiameterCm: 12, bloomCount: 8 },
      light: 'medium',
      placements: ['living', 'office'],
    }),
    '봉오리 · 쌍대 · 향 은은함 · 관리 쉬움 · 높이 약 60cm · 화분 지름 12cm · 약 8송이 · 반그늘 · 거실, 사무실',
  );
});

test('빈 칸은 건너뛰고 값이 없으면 빈 문자열이다', () => {
  assert.equal(dogamLabel({ size: { heightCm: 45 } }), '높이 약 45cm');
  assert.equal(dogamLabel({}), '');
  assert.equal(dogamLabel(undefined), '');
});

test('"이 꽃의 모습" 표는 개화 상태·향기·관리 난이도 순서로 이름과 값을 만든다', () => {
  assert.deepEqual(
    flowerLookRows({
      selection: { bloomCondition: 'half', fragrance: 'light', careLevel: 'easy' },
    }),
    [
      { label: '개화 상태', value: '반개화' },
      { label: '향기', value: '은은함' },
      { label: '관리 난이도', value: '쉬움' },
    ],
  );
});

test('"이 꽃의 모습" 표는 값이 없는 줄을 빼고, 하나도 없으면 줄이 없다', () => {
  // 개화만 있음
  assert.deepEqual(flowerLookRows({ selection: { bloomCondition: 'bud' } }), [
    { label: '개화 상태', value: '봉오리' },
  ]);
  // 가운데(향기)만 빠짐: 구분자나 빈 줄 없이 두 줄
  assert.deepEqual(flowerLookRows({ selection: { bloomCondition: 'full', careLevel: 'hard' } }), [
    { label: '개화 상태', value: '활짝 핌' },
    { label: '관리 난이도', value: '어려움' },
  ]);
  // 셋 다 없음
  assert.deepEqual(flowerLookRows({ selection: {} }), []);
  assert.deepEqual(flowerLookRows({}), []);
  assert.deepEqual(flowerLookRows(undefined), []);
  assert.deepEqual(flowerLookRows(null), []);
});

test('"이 꽃의 모습" 표는 빈 문자열·공백·문자열이 아닌 값을 줄로 만들지 않는다', () => {
  assert.deepEqual(
    flowerLookRows({ selection: { bloomCondition: '', fragrance: '   ', careLevel: null } }),
    [],
  );
  assert.deepEqual(flowerLookRows({ selection: { bloomCondition: 0, fragrance: undefined } }), []);
  // 표에 없는 값은 받은 글자를 그대로 쓴다(null·undefined 글자를 만들지 않는다).
  assert.deepEqual(flowerLookRows({ selection: { bloomCondition: ' 만개 직전 ' } }), [
    { label: '개화 상태', value: '만개 직전' },
  ]);
});
