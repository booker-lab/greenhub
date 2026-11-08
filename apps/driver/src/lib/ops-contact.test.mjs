import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DRIVER_OPS_CONTACT } from './ops-contact.ts';

const consumerInfo = await readFile(
  new URL('../../../consumer/src/lib/publicBusinessInfo.ts', import.meta.url),
  'utf8',
);

function consumerValue(key) {
  const match = consumerInfo.match(new RegExp(`\\b${key}: '([^']+)'`));
  assert.ok(match, `소비자 사업자 정보에서 ${key}를 찾지 못했다`);
  return match[1];
}

test('기사 앱 운영 연락처는 소비자 고객센터 번호·운영 시간과 같다', () => {
  assert.equal(DRIVER_OPS_CONTACT.phone, consumerValue('phone'));
  assert.equal(DRIVER_OPS_CONTACT.phoneHref, consumerValue('phoneHref'));
  assert.equal(DRIVER_OPS_CONTACT.hours, consumerValue('supportHours'));
});

test('전화 링크는 표시 번호의 숫자와 같다', () => {
  assert.equal(DRIVER_OPS_CONTACT.phoneHref, `tel:${DRIVER_OPS_CONTACT.phone.replaceAll('-', '')}`);
});
