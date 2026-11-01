import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// 포장 라벨(무료): "없음/문구 넣기" 선택과 결제 전 문구 확인이 서버(resolvePackageLabel)와 같은 기준인지.
const source = await readFile(new URL('./PackageLabelFields.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const labelModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => {
    if (specifier === '@greenhub/shared') return { PACKAGE_LABEL_MAX_LENGTH: 20 };
    if (
      specifier === '@greenhub/ui/components/field' ||
      specifier === '@greenhub/ui/components/input' ||
      specifier === 'react' ||
      specifier === 'react/jsx-runtime'
    ) {
      return {};
    }
    throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
  },
  labelModule,
  labelModule.exports,
);
const { EMPTY_PACKAGE_LABEL, packageLabelPayload } = labelModule.exports;

test('기본은 "없음"이라 문구를 보내지 않는다', () => {
  assert.equal(EMPTY_PACKAGE_LABEL.enabled, false);
  assert.equal(packageLabelPayload(EMPTY_PACKAGE_LABEL), null);
  assert.equal(packageLabelPayload({ enabled: false, text: '적었다가 없음으로 바꿈' }), null);
});

test('"문구 넣기"면 한 줄로 정리한 문구를 보낸다', () => {
  assert.equal(packageLabelPayload({ enabled: true, text: ' 그린\n플라워 ' }), '그린 플라워');
});

test('"문구 넣기"인데 비었거나 20자를 넘으면 결제를 막는다', () => {
  assert.equal(packageLabelPayload({ enabled: true, text: '   ' }), 'invalid');
  assert.equal(packageLabelPayload({ enabled: true, text: '가'.repeat(20) }), '가'.repeat(20));
  assert.equal(packageLabelPayload({ enabled: true, text: '가'.repeat(21) }), 'invalid');
});
