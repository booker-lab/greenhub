import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./DetailExtras.tsx', import.meta.url), 'utf8');
const defaultExport = source.slice(source.indexOf('export default function DetailExtras'));

test('상품 정보 고시 칸은 기능 토글 검사 없이 항상 그린다', () => {
  const line = defaultExport.split('\n').find((row) => row.includes('<ProductNoticeSection'));
  assert.ok(line, 'DetailExtras가 ProductNoticeSection을 그려야 한다');
  // `{조건 && <ProductNoticeSection …` 처럼 조건을 걸면 줄이 태그로 시작하지 않는다.
  assert.match(line.trim(), /^<ProductNoticeSection /, '고시 칸에 조건을 걸면 안 된다');
});

test('토글이 모두 꺼졌을 때의 조기 반환이 고시 칸을 막지 않는다', () => {
  assert.doesNotMatch(defaultExport, /anyOn/);
  assert.doesNotMatch(defaultExport, /return null/);
});

test('고시는 접힌 칸으로 그리고 빈 값은 상품 이름·매장명·사업자 대표 번호로 채운다', () => {
  const section = source.slice(
    source.indexOf('export function ProductNoticeSection'),
    source.indexOf('function Recommendations'),
  );
  assert.match(section, /<details>/);
  assert.match(section, /상품 정보 고시/);
  assert.match(section, /resolveProductNotice\(product\.notice/);
  assert.match(section, /itemName: product\.name/);
  assert.match(section, /storeName\?\.trim\(\) \|\| PUBLIC_BUSINESS_INFO\.businessName/);
  assert.match(section, /csPhone: PUBLIC_BUSINESS_INFO\.phone/);
});

test('생산자 칸이 비어 있으면 토글과 상관없이 매장 소개를 읽어 매장명을 쓴다', () => {
  assert.match(defaultExport, /!product\.notice\?\.producer\?\.trim\(\)/);
  assert.match(defaultExport, /storeName=\{store\?\.name \?\? null\}/);
});
