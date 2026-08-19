import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appDirectory = dirname(fileURLToPath(import.meta.url));
const consumerSourceDirectory = join(appDirectory, '..');

function loadSource(...segments) {
  return readFileSync(join(consumerSourceDirectory, ...segments), 'utf8');
}

function normalizeWhitespace(source) {
  return source.replace(/\s+/g, ' ');
}

test('법적 문서 공통 셸은 공개 Server Component와 접근 가능한 이동 링크를 제공한다', () => {
  const source = loadSource('components', 'LegalDocumentPage.tsx');

  assert.doesNotMatch(source, /['"]use client['"]/);
  assert.match(source, /href="\/"/);
  assert.match(source, /aria-label="법적 문서"/);
  assert.match(source, /paddingBottom/);
  assert.match(source, /PUBLIC_BUSINESS_INFO/);
});

test('개인정보처리방침은 현재 처리 흐름과 권리 행사 정보를 빠짐없이 고지한다', () => {
  const source = normalizeWhitespace(
    `${loadSource('app', 'privacy', 'page.tsx')}\n${loadSource('lib', 'publicBusinessInfo.ts')}`,
  );
  const requiredPhrases = [
    '개인정보처리방침',
    '디어 오키드',
    '2026년 8월 19일',
    '카카오 로그인',
    '처리 목적',
    '보유 및 이용기간',
    '처리위탁',
    '국외 처리',
    'Railway Corporation',
    'Vercel Inc.',
    '브라우저 저장소',
    '이용자의 권리',
    'support@greenlove.co.kr',
    '010-4452-2104',
  ];

  for (const phrase of requiredPhrases) {
    assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(source, /href="\/terms"/);
  assert.doesNotMatch(source, /마케팅 목적 쿠키를 사용합니다/);
  assert.doesNotMatch(source, /자동으로 즉시 삭제/);
});

test('이용약관은 현재 비판매 경계와 향후 판매 개시 전 조건을 구분한다', () => {
  const source = normalizeWhitespace(
    `${loadSource('app', 'terms', 'page.tsx')}\n${loadSource('lib', 'publicBusinessInfo.ts')}`,
  );
  const requiredPhrases = [
    '이용약관',
    '디어 오키드',
    '2026년 8월 19일',
    '현재 상용 주문·결제·배송 서비스를 운영하지 않습니다',
    '매매계약의 성립을 뜻하지 않습니다',
    '판매기능 활성화 전',
    '청약철회',
    '관할법원',
    'support@greenlove.co.kr',
  ];

  for (const phrase of requiredPhrases) {
    assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(source, /href="\/privacy"/);
  assert.doesNotMatch(source, /교환[·ㆍ\s]*반품 불가/);
  assert.doesNotMatch(source, /공정거래위원회 표준약관/);
});
