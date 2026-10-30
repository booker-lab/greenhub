import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

test('홈 밖의 상품·결제 화면에도 사업자 정보 footer를 붙인다(PG·카드사 입점 심사 요건)', () => {
  for (const layout of ['../app/products/[id]/layout.tsx', '../app/checkout/layout.tsx']) {
    const source = readFileSync(join(testDirectory, layout), 'utf8');
    assert.match(source, /import BusinessInfoFooter from '@\/components\/BusinessInfoFooter';/, layout);
    assert.ok(source.indexOf('{children}') < source.indexOf('<BusinessInfoFooter />'), layout);
  }
});

test('확정되지 않은 외부 증거는 노출하지 않는다', () => {
  const source = `${loadComponentSource()}\n${loadBusinessInfoSource()}`;

  assert.doesNotMatch(source, /naver\.(?:me|com)/i);
});

test('통신판매업 신고번호는 번호가 있을 때만 그린다', () => {
  const componentSource = loadComponentSource();
  const businessInfoSource = loadBusinessInfoSource();

  // 신고 전에는 빈 값이고, 신고 뒤에는 정본 한 줄만 바꾸면 footer에 나온다.
  assert.match(businessInfoSource, /mailOrderRegistrationNumber: '[^']*' as string/);
  assert.match(
    componentSource,
    /\{PUBLIC_BUSINESS_INFO\.mailOrderRegistrationNumber \? \([\s\S]*통신판매업 신고번호[\s\S]*\) : null\}/,
  );
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

const escrowMarkPath = join(testDirectory, '..', '..', 'public', 'images', 'kb-escrow-mark.gif');

test('KB에스크로이체 구매안전서비스 확인 링크 정본을 둔다', () => {
  const businessInfoSource = loadBusinessInfoSource();

  assert.match(businessInfoSource, /escrow: \{/);
  assert.match(businessInfoSource, /okbfex\.kbstar\.com\/quics\?page=C021590/);
  assert.match(businessInfoSource, /mHValue=da53475d2a0b3ac6d609b85c86745b67/);
});

test('구매안전서비스 마크는 새 탭 일반 링크로 열고 안내 문구를 함께 보인다', () => {
  const componentSource = loadComponentSource();

  assert.match(componentSource, /href=\{PUBLIC_BUSINESS_INFO\.escrow\.verifyUrl\}/);
  assert.match(componentSource, /src=\{PUBLIC_BUSINESS_INFO\.escrow\.markImage\}/);
  assert.match(componentSource, /target="_blank"/);
  assert.match(componentSource, /rel="noopener noreferrer"/);
  assert.match(componentSource, /alt="KB에스크로이체 인증마크"/);
  assert.match(
    componentSource,
    /고객님은 안전거래를 위해 현금 등으로 결제 시 저희 쇼핑몰에서 가입한 KB국민은행의 구매안전서비스를 이용하실 수 있습니다\./,
  );
});

test('구매안전서비스 마크는 서버 컴포넌트에서 로컬 이미지로만 그린다', () => {
  const source = `${loadComponentSource()}\n${loadBusinessInfoSource()}`;

  assert.doesNotMatch(source, /['"]use client['"]/);
  assert.doesNotMatch(source, /window\.open/);
  assert.doesNotMatch(source, /img\d*\.kbstar\.com/);
  assert.match(loadBusinessInfoSource(), /markImage: '\/images\/kb-escrow-mark\.gif'/);
  assert.ok(existsSync(escrowMarkPath), 'public/images/kb-escrow-mark.gif가 있어야 한다');
});
