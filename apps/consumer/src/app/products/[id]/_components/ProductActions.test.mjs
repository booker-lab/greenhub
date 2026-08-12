import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const componentPath = join(testDirectory, 'ProductActions.tsx');

function loadComponentSource() {
  return readFileSync(componentPath, 'utf8');
}

test('판매자 연락처는 공개 사업자 정보의 주소와 전화번호를 사용한다', () => {
  const source = loadComponentSource();

  assert.match(source, /PUBLIC_BUSINESS_INFO\.address/);
  assert.match(source, /PUBLIC_BUSINESS_INFO\.phone/);
  assert.doesNotMatch(source, /store\.address/);
  assert.doesNotMatch(source, /store\.phone/);
});
