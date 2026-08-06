import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const componentPath = join(testDirectory, 'BusinessInfoFooter.tsx');

function loadComponentSource() {
  return readFileSync(componentPath, 'utf8');
}

test('공개 사업자 정본을 빠짐없이 렌더링한다', () => {
  const source = loadComponentSource();
  const requiredValues = [
    '그린러브',
    '디어오키드',
    '조정연',
    '505-28-01702',
    '010-4452-2104',
    'support@greenlove.co.kr',
  ];

  for (const value of requiredValues) {
    assert.match(source, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('그린러브와 디어오키드의 운영 관계를 명시한다', () => {
  const source = loadComponentSource();

  assert.match(source, /그린러브는 디어오키드가 운영하는 화훼 판매 브랜드입니다\./);
});

test('접근 가능한 footer와 고객센터 링크를 제공한다', () => {
  const source = loadComponentSource();

  assert.match(source, /<footer/);
  assert.match(source, /사업자 정보/);
  assert.match(source, /phoneHref: 'tel:01044522104'/);
  assert.match(source, /emailHref: 'mailto:support@greenlove\.co\.kr'/);
  assert.match(source, /href=\{BUSINESS_INFO\.phoneHref\}/);
  assert.match(source, /href=\{BUSINESS_INFO\.emailHref\}/);
});

test('확정되지 않은 외부 증거는 노출하지 않는다', () => {
  const source = loadComponentSource();

  assert.doesNotMatch(source, /사업장 주소/);
  assert.doesNotMatch(source, /address:/);
  assert.doesNotMatch(source, /naver\.(?:me|com)/i);
  assert.doesNotMatch(source, /통신판매업 신고번호/);
});
