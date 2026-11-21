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
    "const EFFECTIVE_DATE = '2026년 11월 28일'",
    '이번 개정 전 공개본의 시행일은 2026년 11월 8일',
    '그 전은 2026년 11월 1일',
    '개인정보 보호책임자: {PUBLIC_BUSINESS_INFO.representative}',
    '회원 탈퇴는 마이페이지의',
    '진행 중인 주문이 있으면 그 주문이 끝난 뒤 탈퇴할 수 있습니다',
    '카카오 로그인 연결 해제도 함께 요청하며',
    '주문·결제 기록(주문 당시 받는 분 이름·연락처·주소 포함)은 위 법정 보존기간 동안 보관',
    '카카오맵',
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
  assert.doesNotMatch(source, /회원 탈퇴 기능은 아직 제공하지 않으며/);
});

test('이용약관은 파일럿의 주문·취소·배송 계약을 설명한다', () => {
  const source = normalizeWhitespace(
    `${loadSource('app', 'terms', 'page.tsx')}\n${loadSource('lib', 'publicBusinessInfo.ts')}`,
  );
  const requiredPhrases = [
    '이용약관',
    '디어 오키드',
    '2026년 11월 1일',
    '주문을 접수하지 않고 결제 금액을 결제사업자를 통해 환불',
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
  // 공개 방침은 알림 8종을 알림 내역 화면과 같은 이름으로 적는다(2026-11-28 시행 개정). 내부 코드는 보이지 않는다.
  const transactionalNames = [
    '결제 완료',
    '상품 준비 중',
    '배송 시작',
    '배송 보류',
    '재배송비 결제 요청',
    '재배송 예정',
    '배송 완료',
    '주문 취소',
  ];

  for (const name of transactionalNames) {
    assert.match(source, new RegExp(`<li>${name}</li>`));
  }
  assert.doesNotMatch(loadSource('app', 'privacy', 'page.tsx'), /<li>ORDER_[A-Z_]+<\/li>/);
  assert.match(source, /현재 회차 직배송의 거래성 주문 알림은 다음 8종입니다/);

  assert.match(source, /거래성 알림/);
  assert.match(source, /선택 마케팅과 별개/);
});

test('개정 전 개인정보처리방침(2026-11-08 시행판)을 글자 그대로 보관하고 현재 방침에서 연결한다', () => {
  const archive = normalizeWhitespace(loadSource('app', 'privacy', '2026-11-08', 'page.tsx'));
  // 보관본은 당시 공개본 그대로라 시행일·알림 표기(내부 코드)가 당시 값이다.
  assert.match(archive, /const EFFECTIVE_DATE = '2026년 11월 8일'/);
  assert.match(archive, /<li>ORDER_ACCEPTED<\/li>/);
  assert.match(archive, /이전 버전의 개인정보처리방침입니다\./);
  assert.match(archive, /2026년 11월 8일부터 11월 27일까지 적용됩니다\./);
  assert.match(archive, /<a href="\/privacy">현재 개인정보처리방침<\/a>/);
  assert.match(archive, /canonical: '\/privacy\/2026-11-08'/);
  assert.match(archive, /robots: \{ index: false, follow: true \}/);

  const current = normalizeWhitespace(loadSource('app', 'privacy', 'page.tsx'));
  assert.match(current, /<Section id="changes" title="10\. 방침의 변경">/);
  assert.match(current, /<a href="\/privacy\/2026-11-08">2026년 11월 8일 시행 개인정보처리방침<\/a>/);
});

test('방침 개정 안내는 시행 전(한국 시간 2026-11-27까지)에만 브라우저에서 보인다', () => {
  const source = loadSource('components', 'PolicyChangeNotice.tsx');

  // 홈은 정적으로 만들어지므로 날짜 판단은 브라우저에서 한다. 첫 HTML에는 없다.
  assert.match(source, /^'use client';/);
  assert.match(source, /Date\.parse\('2026-11-28T00:00:00\+09:00'\)/);
  assert.match(source, /useState\(false\)/);
  assert.match(source, /setVisible\(Date\.now\(\) < NOTICE_END_MS\)/);
  assert.match(source, /href="\/privacy#changes"/);
  assert.match(source, /개인정보처리방침 개정\(11월 28일 시행\)/);
  assert.match(source, /minHeight: 'var\(--touch-target\)'/);

  const footer = loadSource('components', 'BusinessInfoFooter.tsx');
  assert.match(footer, /import PolicyChangeNotice from '@\/components\/PolicyChangeNotice';/);
  assert.match(footer, /<PolicyChangeNotice \/>/);
});
