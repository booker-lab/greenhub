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
const { dogamLabel } = module.exports;

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
