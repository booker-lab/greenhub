import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./useDailyCap.ts', import.meta.url), 'utf8');

test('useDailyCap의 기본 daily cap key는 KST business date를 사용한다', () => {
  assert.match(source, /import \{ todayKST \} from '@greenhub\/shared'/);
  assert.match(source, /date \?\? todayKST\(\)/);
  assert.doesNotMatch(source, /toISOString\(\)\.split\('T'\)/);
});
