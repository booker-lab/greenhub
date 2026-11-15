import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./touch-target.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'touch-target.ts',
}).outputText;
const touchModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  () => {
    throw new Error('예상하지 못한 모듈 요청');
  },
  touchModule,
  touchModule.exports,
);
const {
  TOUCH_CHECKBOX,
  TOUCH_HEIGHT,
  TOUCH_ICON,
  TOUCH_TARGET_PX,
  touchButtonClassName,
  touchButtonHeight,
} = touchModule.exports;

const baseCss = await readFile(
  new URL('../../../../packages/ui/src/styles/base.css', import.meta.url),
  'utf8',
);

// Tailwind 간격 한 단계는 0.25rem(4px)이다.
const SPACING_PX = 4;
const stepPx = (className, prefix) => {
  const step = className.split(' ').find((part) => part.startsWith(`${prefix}-`));
  return step ? Number(step.slice(prefix.length + 1)) * SPACING_PX : null;
};

test('소비자 눌리는 영역 값은 공용 --touch-target과 같다', () => {
  const token = baseCss.match(/--touch-target:\s*(\d+)px;/);
  assert.ok(token, 'base.css에 --touch-target이 있어야 한다');
  assert.equal(TOUCH_TARGET_PX, Number(token[1]));
  assert.equal(stepPx(TOUCH_HEIGHT, 'h'), TOUCH_TARGET_PX);
  assert.equal(stepPx(TOUCH_ICON, 'size'), TOUCH_TARGET_PX);
});

test('44px보다 작은 공용 버튼 크기는 모두 44px로 키우고 13px 글자는 15px로 올린다', () => {
  for (const size of ['default', 'md', 'compact-sm']) {
    const className = touchButtonClassName(size);
    assert.equal(stepPx(className, 'h'), TOUCH_TARGET_PX, size);
    assert.equal(stepPx(className, 'min-w'), TOUCH_TARGET_PX, size);
    assert.doesNotMatch(className, /text-/, size);
    assert.equal(touchButtonHeight(size), TOUCH_TARGET_PX, size);
  }
  // 공용 xs·sm·compact-xs는 13px(text-xs)라 15px(text-sm)로 올리고, 버튼의 줄 높이 1은 유지한다.
  for (const size of ['xs', 'sm', 'compact-xs']) {
    const className = touchButtonClassName(size);
    assert.equal(stepPx(className, 'h'), TOUCH_TARGET_PX, size);
    assert.match(className, /(^| )text-sm( |$)/, size);
    assert.match(className, /(^| )leading-none( |$)/, size);
  }
  for (const size of ['icon', 'icon-xs', 'icon-sm', 'icon-lg']) {
    assert.equal(stepPx(touchButtonClassName(size), 'size'), TOUCH_TARGET_PX, size);
  }
  // 크기를 주지 않으면 공용 기본 크기(default)로 본다.
  assert.equal(touchButtonClassName(undefined), touchButtonClassName('default'));
});

test('이미 44px보다 큰 lg(50px)는 건드리지 않는다', () => {
  assert.equal(touchButtonClassName('lg'), '');
  assert.equal(touchButtonHeight('lg'), undefined);
});

test('체크박스는 네모를 키우지 않고 라벨 줄을 44px로 만든다', () => {
  // 라벨 20px + 위아래 12px씩 = 44px, 줄 전체를 12px씩 당겨 배치는 그대로 둔다.
  assert.match(TOUCH_CHECKBOX, /\[&_label\]:py-3/);
  assert.match(TOUCH_CHECKBOX, /(^| )-my-3( |$)/);
  assert.doesNotMatch(TOUCH_CHECKBOX, /size-/);
});

test('소비자 Button·LoadingButton 래퍼는 공용 부품에 44px 클래스만 덧씌운다', async () => {
  const button = await readFile(new URL('../components/Button.tsx', import.meta.url), 'utf8');
  const loading = await readFile(
    new URL('../components/LoadingButton.tsx', import.meta.url),
    'utf8',
  );
  assert.match(button, /from '@greenhub\/ui\/components\/button'/);
  assert.match(button, /cn\(touchButtonClassName\(size\), className\)/);
  assert.match(loading, /from '@greenhub\/ui\/components\/loading-button'/);
  assert.match(loading, /touchButtonClassName\(size\)/);
  assert.match(loading, /buttonHeight=\{buttonHeight \?\? touchButtonHeight\(size\)\}/);
});
