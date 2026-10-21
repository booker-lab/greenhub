import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./review-photo.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const {
  REVIEW_PHOTO_ENCODE_STEPS,
  canAddReviewPhotos,
  computeScaledSize,
  planReviewPhotoEncode,
  reviewPhotoTargetBytes,
  selectReviewPhotos,
} = module.exports;

const MAX = 3;
const FIVE_MB = 5 * 1024 * 1024;
const jpg = (name) => ({ name, type: 'image/jpeg' });

test('사진은 후기 하나에 3장까지만 담고, 넘치면 안내한다', () => {
  assert.deepEqual(selectReviewPhotos(0, [jpg('a'), jpg('b')], MAX), {
    accepted: [jpg('a'), jpg('b')],
    message: null,
  });
  const over = selectReviewPhotos(2, [jpg('c'), jpg('d')], MAX);
  assert.deepEqual(over.accepted, [jpg('c')]);
  assert.equal(over.message, '사진은 3장까지 올릴 수 있어요.');
  assert.deepEqual(selectReviewPhotos(3, [jpg('e')], MAX).accepted, []);
});

test('사진이 아닌 파일은 담지 않는다', () => {
  const result = selectReviewPhotos(0, [{ name: 'x.pdf', type: 'application/pdf' }, jpg('a')], MAX);
  assert.deepEqual(result.accepted, [jpg('a')]);
  assert.equal(result.message, '사진 파일만 올릴 수 있어요.');
});

test('줄인 크기는 비율을 지키고 확대하지 않는다', () => {
  assert.deepEqual(computeScaledSize(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(computeScaledSize(800, 600, 1600), { width: 800, height: 600 });
  assert.equal(computeScaledSize(0, 600, 1600), null);
  assert.equal(computeScaledSize(Number.NaN, 600, 1600), null);
});

test('서버 한도보다 작게 줄이고, 마지막 단계에서도 크면 포기한다', () => {
  const target = reviewPhotoTargetBytes(FIVE_MB);
  assert.ok(target < FIVE_MB);
  assert.equal(planReviewPhotoEncode(0, target, target), 'accept');
  assert.equal(planReviewPhotoEncode(0, target + 1, target), 'retry');
  assert.equal(
    planReviewPhotoEncode(REVIEW_PHOTO_ENCODE_STEPS.length - 1, target + 1, target),
    'give-up',
  );
  assert.equal(planReviewPhotoEncode(0, 0, target), 'retry');
});

test('숨겨진 후기나 3장을 채운 후기에는 사진을 더하지 않는다', () => {
  assert.equal(canAddReviewPhotos({ hidden: false, photoUrls: ['a'] }, MAX), true);
  assert.equal(canAddReviewPhotos({ hidden: false }, MAX), true);
  assert.equal(canAddReviewPhotos({ hidden: true, photoUrls: [] }, MAX), false);
  assert.equal(canAddReviewPhotos({ hidden: false, photoUrls: ['a', 'b', 'c'] }, MAX), false);
});
