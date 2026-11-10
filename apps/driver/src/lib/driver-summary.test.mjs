import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readDriverSummaryCompletedToday } from './driver-summary.ts';

const boardSource = await readFile(new URL('../app/board/_client.tsx', import.meta.url), 'utf8');

test('completedToday가 0 이상 정수일 때만 읽는다', () => {
  assert.equal(readDriverSummaryCompletedToday({ completedToday: 3 }), 3);
  assert.equal(readDriverSummaryCompletedToday({ completedToday: 0 }), 0);
});

test('필드 없음·형식 어긋남은 null(화면은 그 부분만 숨긴다)', () => {
  for (const payload of [
    null,
    [],
    {},
    { completedToday: '3' },
    { completedToday: -1 },
    { completedToday: 1.5 },
    { completedToday: Number.NaN },
  ]) {
    assert.equal(readDriverSummaryCompletedToday(payload), null);
  }
});

test('작업 보드는 목록과 같은 apiRead·scope 가드·재조회 시점으로 요약을 읽고 실패하면 그 부분만 숨긴다', () => {
  assert.match(
    boardSource,
    /apiRead\('\/driver\/summary', token, \{ signal: controller\.signal \}\)/,
  );
  const at = boardSource.indexOf("apiRead('/driver/summary'");
  const block = boardSource.slice(at, at + 600);
  assert.match(block, /if \(!isCurrent\(\)\) return;/);
  assert.match(block, /\.catch\(\(\) => null\)/);
  // 목록 조회 effect 안에 있다(같은 의존성·재조회 시점).
  const effectEnd = boardSource.indexOf('sessionStatus, reloadKey]');
  assert.ok(at !== -1 && at < effectEnd);
  assert.match(boardSource, /오늘 완료 \{completedToday\}곳/);
});
