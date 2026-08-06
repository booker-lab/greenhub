import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const componentPath = join(testDirectory, 'BusinessInfoFooter.tsx');
const businessInfoPath = join(testDirectory, '..', 'lib', 'publicBusinessInfo.ts');

function loadComponentSource() {
  return readFileSync(componentPath, 'utf8');
}

function loadBusinessInfoSource() {
  return readFileSync(businessInfoPath, 'utf8');
}

test('공개 사업자 정본을 빠짐없이 렌더링한다', () => {
  const source = `${loadComponentSource()}\n${loadBusinessInfoSource()}`;
  const requiredValues = [
    '그린러브',
    '디어 오키드',
    '조정연',
    '505-28-01702',
    '010-4452-2104',
    'support@greenlove.co.kr',
  ];

  for (const value of requiredValues) {
    assert.match(source, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('그린러브와 디어 오키드의 운영 관계를 명시한다', () => {
  const source = `${loadComponentSource()}\n${loadBusinessInfoSource()}`;

  assert.match(
    source,
    /그린러브는 디어 오키드가 운영하는 화훼 쇼핑몰입니다\./,
  );
});

test('접근 가능한 footer와 고객센터 링크를 제공한다', () => {
  const componentSource = loadComponentSource();
  const businessInfoSource = loadBusinessInfoSource();

  assert.match(componentSource, /<footer/);
  assert.match(componentSource, /사업자 정보/);
  assert.match(businessInfoSource, /phoneHref: 'tel:01044522104'/);
  assert.match(businessInfoSource, /emailHref: 'mailto:support@greenlove\.co\.kr'/);
  assert.match(componentSource, /href=\{PUBLIC_BUSINESS_INFO\.phoneHref\}/);
  assert.match(componentSource, /href=\{PUBLIC_BUSINESS_INFO\.emailHref\}/);
});

test('확정되지 않은 외부 증거는 노출하지 않는다', () => {
  const source = `${loadComponentSource()}\n${loadBusinessInfoSource()}`;

  assert.doesNotMatch(source, /사업장 주소/);
  assert.doesNotMatch(source, /address:/);
  assert.doesNotMatch(source, /naver\.(?:me|com)/i);
  assert.doesNotMatch(source, /통신판매업 신고번호/);
});
