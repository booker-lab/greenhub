import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(
  join(testDirectory, 'BusinessRelationshipNotice.tsx'),
  'utf8',
);
const businessInfoSource = readFileSync(
  join(testDirectory, '..', 'lib', 'publicBusinessInfo.ts'),
  'utf8',
);

test('카카오톡 채널과 운영 사업자의 관계를 상단에 명시한다', () => {
  assert.match(componentSource, /카카오톡 채널/);
  assert.match(componentSource, /PUBLIC_BUSINESS_INFO\.relationship/);
  assert.match(
    businessInfoSource,
    /relationship: '카카오톡 채널 ‘그린러브’와 본 화훼 쇼핑몰은 사업자 ‘디어 오키드’가 운영합니다\.'/,
  );
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
});
