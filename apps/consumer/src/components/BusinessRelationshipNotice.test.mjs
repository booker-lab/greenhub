import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(join(testDirectory, 'BusinessRelationshipNotice.tsx'), 'utf8');
const businessInfoSource = readFileSync(
  join(testDirectory, '..', 'lib', 'publicBusinessInfo.ts'),
  'utf8',
);

test('쇼핑몰과 운영 사업자의 관계를 자연스러운 핵심 문장으로 명시한다', () => {
  assert.match(componentSource, /카카오톡 채널/);
  assert.match(componentSource, /PUBLIC_BUSINESS_INFO\.relationship/);
  assert.match(
    businessInfoSource,
    /relationship: '그린러브는 디어 오키드가 운영하는 화훼 쇼핑몰입니다\.'/,
  );
});

test('공식 카카오톡 채널명과 안전한 새 창 링크를 제공한다', () => {
  assert.match(businessInfoSource, /name: '그린러브'/);
  assert.match(businessInfoSource, /url: 'https:\/\/pf\.kakao\.com\/_vGfjX'/);
  assert.match(componentSource, /PUBLIC_BUSINESS_INFO\.kakaoChannel\.url/);
  assert.match(componentSource, /PUBLIC_BUSINESS_INFO\.kakaoChannel\.name/);
  assert.match(componentSource, /target="_blank"/);
  assert.match(componentSource, /rel="noopener noreferrer"/);
});

test('첫 화면 정적 증빙으로 대표 판매상품 타일 3개와 상세 링크를 제공한다', () => {
  const products = [
    ['오렌지 글로우', '49b0a370-e0ab-4f19-b8e6-2de0e9b2e867'],
    ['빅립', '19009e23-33e4-463f-9953-5be860fe56b6'],
    ['만천홍', '0a96f85d-b906-439c-a38c-f469a21e1dbf'],
  ];

  for (const [name, id] of products) {
    assert.match(businessInfoSource, new RegExp(name));
    assert.match(businessInfoSource, new RegExp(`https://greenlove\\.co\\.kr/products/${id}`));
  }

  assert.match(componentSource, /PUBLIC_BUSINESS_INFO\.featuredProducts\.map/);
  assert.match(componentSource, /그린러브 대표 판매상품/);
  assert.match(componentSource, /listStyle: 'none'/);
  assert.match(componentSource, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(140px, 1fr\)\)'/);
  assert.match(componentSource, /상품 보기/);
  assert.doesNotMatch(componentSource, /<img/);
  assert.doesNotMatch(componentSource, /price/);
  assert.doesNotMatch(businessInfoSource, /price:/);
});

test('상단에서는 상세 사업자정보를 반복하지 않고 footer 역할로 남긴다', () => {
  assert.doesNotMatch(componentSource, /<dl/);
  assert.doesNotMatch(componentSource, /PUBLIC_BUSINESS_INFO\.businessName/);
  assert.doesNotMatch(componentSource, /PUBLIC_BUSINESS_INFO\.representative/);
  assert.doesNotMatch(componentSource, /PUBLIC_BUSINESS_INFO\.registrationNumber/);
});

test('공개 승인된 최소 사업자 정본만 제공한다', () => {
  const requiredValues = ['그린러브', '디어 오키드', '조정연', '505-28-01702'];

  for (const value of requiredValues) {
    assert.match(businessInfoSource, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.doesNotMatch(businessInfoSource, /address:/);
  assert.doesNotMatch(businessInfoSource, /gmail\.com/i);
});

test('의미 있는 안내 구획과 제목을 제공한다', () => {
  assert.match(componentSource, /<section/);
  assert.match(componentSource, /aria-labelledby="business-relationship-title"/);
  assert.match(componentSource, /<h2[^>]*id="business-relationship-title"/);
  assert.match(componentSource, /그린러브 운영 안내/);
  assert.doesNotMatch(componentSource, /['"]use client['"]/);
});
