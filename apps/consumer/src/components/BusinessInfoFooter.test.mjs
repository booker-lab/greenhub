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
    '경기도 이천시 백사면 도지리 543-2',
    'support@greenlove.co.kr',
    'Vercel Inc.',
    '09:00~18:00 (점심시간 12:00~13:00)',
  ];

  for (const value of requiredValues) {
    assert.match(source, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('운영 관계 문장은 상단 정본에만 유지하고 footer에서 반복하지 않는다', () => {
  const componentSource = loadComponentSource();
  const businessInfoSource = loadBusinessInfoSource();

  assert.match(
    businessInfoSource,
    /그린러브는 디어 오키드가 운영하는 화훼 쇼핑몰입니다\./,
  );
  assert.doesNotMatch(
    componentSource,
    /PUBLIC_BUSINESS_INFO\.relationship/,
  );
});

test('접근 가능한 footer와 공개 사업자 정보 및 고객센터 링크를 제공한다', () => {
  const componentSource = loadComponentSource();
  const businessInfoSource = loadBusinessInfoSource();

  assert.match(componentSource, /<footer/);
  assert.match(componentSource, /사업자 정보/);
  assert.match(componentSource, /PUBLIC_BUSINESS_INFO\.address/);
  assert.match(componentSource, /PUBLIC_BUSINESS_INFO\.hostingProvider/);
  assert.match(componentSource, /PUBLIC_BUSINESS_INFO\.supportHours/);
  assert.match(businessInfoSource, /phoneHref: 'tel:01044522104'/);
  assert.match(businessInfoSource, /emailHref: 'mailto:support@greenlove\.co\.kr'/);
  assert.match(componentSource, /href=\{PUBLIC_BUSINESS_INFO\.phoneHref\}/);
  assert.match(componentSource, /href=\{PUBLIC_BUSINESS_INFO\.emailHref\}/);
});

test('좁은 화면에서 긴 사업자 정보가 안전하게 줄바꿈된다', () => {
  const componentSource = loadComponentSource();

  assert.match(componentSource, /flexWrap: 'wrap'/);
  assert.match(componentSource, /overflowWrap: 'anywhere'/);
  assert.match(componentSource, /aria-labelledby="business-info-title"/);
  assert.doesNotMatch(componentSource, /['"]use client['"]/);
});

test('확정되지 않은 외부 증거는 노출하지 않는다', () => {
  const source = `${loadComponentSource()}\n${loadBusinessInfoSource()}`;

  assert.doesNotMatch(source, /naver\.(?:me|com)/i);
  assert.doesNotMatch(source, /통신판매업 신고번호/);
});

test('사업자 정보 다음에 공개 법적 고지 링크를 충분한 터치 영역으로 제공한다', () => {
  const source = loadComponentSource();

  assert.match(source, /href="\/privacy"/);
  assert.match(source, />\s*개인정보처리방침\s*</);
  assert.match(source, /href="\/terms"/);
  assert.match(source, />\s*이용약관\s*</);
  assert.match(source, /aria-label="법적 고지"/);
  assert.match(source, /minHeight: 'var\(--touch-target\)'/);
});
