import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./DeliveryDatePicker.tsx', import.meta.url), 'utf8');

test('배송일 picker는 KST today와 UTC 독립 달력 계산을 사용한다', () => {
  assert.match(source, /import \{ todayKST \} from '@greenhub\/shared'/);
  assert.match(source, /const todayStr = todayKST\(\)/);
  assert.match(source, /Date\.UTC\(year, month, 1\)/);
  assert.match(source, /getUTCDay\(\)/);
  assert.doesNotMatch(source, /toISOString\(\)\.split\('T'\)/);
});

test('배송일 picker의 선택일 표시는 Asia/Seoul 기준이다', () => {
  assert.match(source, /T00:00:00\+09:00/);
  assert.match(source, /timeZone: 'Asia\/Seoul'/);
});
