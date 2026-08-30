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

test('개인정보처리방침은 파일럿의 실제 처리 흐름과 권리 행사 정보를 고지한다', () => {
  const source = normalizeWhitespace(
    `${loadSource('app', 'privacy', 'page.tsx')}\n${loadSource('lib', 'publicBusinessInfo.ts')}`,
  );
  const requiredPhrases = [
    '개인정보처리방침',
    '디어 오키드',
    '2026년 8월 30일',
    '카카오 로그인',
    '처리 목적',
    '보유 및 이용기간',
    '처리위탁',
    '국외 처리',
    'Railway Corporation',
    'Vercel Inc.',
    'PortOne',
    'ALIGO',
    '내부 판매 담당자',
    '배송 담당자',
    '선택 마케팅 동의를 새로 수집하거나 마케팅 발송을 운영하지 않습니다',
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
  assert.doesNotMatch(source, /현재 상용 주문·결제·배송 서비스는 운영하지 않습니다/);
  assert.doesNotMatch(source, /자동으로 즉시 삭제/);
});

test('이용약관은 파일럿의 주문·취소·배송 계약을 설명한다', () => {
  const source = normalizeWhitespace(
    `${loadSource('app', 'terms', 'page.tsx')}\n${loadSource('lib', 'publicBusinessInfo.ts')}`,
  );
  const requiredPhrases = [
    '이용약관',
    '디어 오키드',
    '2026년 8월 30일',
    '통제된 공개 파일럿',
    '경기도 이천시',
    'PortOne',
    '주문 접수',
    '주문 마감 전',
    '배송 보류',
    '재배송비',
    '결제사업자',
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
  assert.doesNotMatch(source, /현재 상용 주문·결제·배송 서비스를 운영하지 않습니다/);
});

test('파일럿 거래성 주문 알림 8종은 선택 마케팅과 분리되어 공개된다', () => {
  const source = normalizeWhitespace(
    `${loadSource('app', 'terms', 'page.tsx')}\n${loadSource('app', 'privacy', 'page.tsx')}`,
  );
  const transactionalCodes = [
    'ORDER_ACCEPTED',
    'ORDER_PREPARING',
    'ORDER_DELIVERING',
    'ORDER_DELIVERY_HELD',
    'ORDER_REDELIVERY_PAYMENT_REQUESTED',
    'ORDER_REDELIVERY_SCHEDULED',
    'ORDER_DELIVERED',
    'ORDER_CANCELLED',
  ];

  for (const code of transactionalCodes) {
    assert.match(source, new RegExp(code));
  }

  assert.match(source, /거래성 알림/);
  assert.match(source, /선택 마케팅과 별개/);
});
