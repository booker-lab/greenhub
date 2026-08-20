import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const componentDirectory = dirname(fileURLToPath(import.meta.url));
const source = (relativePath) => readFileSync(join(componentDirectory, relativePath), 'utf8');

const resilientSource = source('ResilientImage.tsx');
const bannerSource = source('HeroBanner.tsx');
const productCardSource = source('ProductCard.tsx');
const homeSource = source('HomeProductList.tsx');
const deadlineSource = source('DeadlineSection.tsx');
const productImagesSource = source('../app/products/[id]/_components/ProductImages.tsx');
const productInfoSource = source('../app/products/[id]/_components/ProductInfo.tsx');
const productActionsSource = source('../app/products/[id]/_components/LegacyProductActions.tsx');

test('공통 이미지 경계는 원본과 대체 이미지 실패를 각각 한 번만 처리한다', () => {
  assert.match(resilientSource, /^'use client';/);
  assert.match(resilientSource, /import Image, \{ type ImageProps \} from 'next\/image';/);
  assert.match(resilientSource, /type ImagePhase = 'primary' \| 'fallback' \| 'terminal';/);
  assert.match(resilientSource, /fallbackSrc && fallbackSrc !== src/);
  assert.match(resilientSource, /return 'terminal';/);
  assert.match(resilientSource, /onError=\{handleError\}/);
  assert.match(resilientSource, /phase === 'terminal'/);
});

test('배너 사진 실패는 이미지 구획만 숨기고 문구와 버튼은 유지한다', () => {
  assert.match(bannerSource, /import ResilientImage from '@\/components\/ResilientImage';/);
  assert.match(bannerSource, /<ResilientImage/);
  assert.doesNotMatch(bannerSource, /fallbackSrc=/);
  assert.match(bannerSource, /banner\.headline/);
  assert.match(bannerSource, /banner\.cta1/);
});

test('상품 대표 사진은 모든 카드와 상세에서 같은 로컬 대체 이미지를 사용한다', () => {
  for (const componentSource of [
    productCardSource,
    homeSource,
    deadlineSource,
    productImagesSource,
  ]) {
    assert.match(componentSource, /ResilientImage/);
    assert.match(componentSource, /fallbackSrc=\{PRODUCT_IMAGE_FALLBACK\}/);
  }
  assert.match(resilientSource, /PRODUCT_IMAGE_FALLBACK = '\/icons\/icon-192x192\.png'/);
});

test('자유 비율 상세 이미지 실패는 해당 이미지만 숨긴다', () => {
  assert.match(resilientSource, /export function HideOnErrorImage/);
  assert.match(resilientSource, /if \(failed\) return null;/);
  assert.match(productInfoSource, /<HideOnErrorImage/);
});

test('스토어 로고 미등록과 로드 실패는 같은 첫 글자 아바타로 수렴한다', () => {
  assert.match(productActionsSource, /function StoreInitialAvatar/);
  assert.match(productActionsSource, /fallback=\{<StoreInitialAvatar name=\{store\.name\} \/>\}/);
  assert.match(productActionsSource, /<StoreInitialAvatar name=\{store\.name\} \/>/);
  assert.match(productActionsSource, /name\.trim\(\)\.charAt\(0\) \|\| '그'/);
});
