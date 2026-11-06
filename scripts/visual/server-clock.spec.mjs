import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  createFixedDate,
  createRenderScopeCheck,
  fixedNowMs,
  WORK_UNIT_STORAGE_PREFIX,
} = require('./server-clock.cjs');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 앱 todayKST(packages/shared/src/date.ts)와 같은 계산. */
const todayKST = (DateCtor) =>
  new DateCtor(DateCtor.now() + KST_OFFSET_MS).toISOString().slice(0, 10);

describe('server-clock', () => {
  it('인자 없는 Date·Date.now만 고정하고 인자가 있는 Date는 그대로 둔다', () => {
    const now = Date.parse('2026-11-04T15:00:00.000Z');
    const FixedDate = createFixedDate(Date, now);
    assert.equal(FixedDate.now(), now);
    assert.equal(new FixedDate().getTime(), now);
    assert.equal(new FixedDate(0).getTime(), 0);
    assert.equal(new FixedDate(2026, 0, 1).getFullYear(), 2026);
    assert.equal(FixedDate.parse('2026-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'));
    assert.equal(FixedDate.UTC(2026, 0, 1), Date.UTC(2026, 0, 1));
    assert.equal(FixedDate(), new Date(now).toString());
    assert.ok(new FixedDate() instanceof Date);
    assert.ok(new Date() instanceof FixedDate);
  });

  it('정적 속성을 자기 속성으로 가져 Next처럼 자기 속성만 복사해 감싸도 Date.UTC가 남는다', () => {
    const FixedDate = createFixedDate(Date, 0);
    // next/dist/server/node-environment-extensions/date.js의 createDate와 같은 방식
    const wrapped = Object.defineProperties(
      function Date1() {},
      Object.getOwnPropertyDescriptors(FixedDate),
    );
    assert.equal(wrapped.UTC(2026, 0, 1), Date.UTC(2026, 0, 1));
    assert.equal(wrapped.parse('2026-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'));
    assert.equal(wrapped.now(), 0);
  });

  it('한국 시간 자정 직전·직후의 오늘 날짜가 브라우저 고정 시각과 같다', () => {
    // 2026-11-04 23:59:59.999 KST(직전)와 2026-11-05 00:00 KST(직후)
    assert.equal(
      todayKST(createFixedDate(Date, Date.parse('2026-11-04T14:59:59.999Z'))),
      '2026-11-04',
    );
    assert.equal(
      todayKST(createFixedDate(Date, Date.parse('2026-11-04T15:00:00.000Z'))),
      '2026-11-05',
    );
  });

  it('기준 시각이 없거나 해석할 수 없으면 시계를 바꾸지 않는다', () => {
    assert.equal(fixedNowMs(undefined), null);
    assert.equal(fixedNowMs(''), null);
    assert.equal(fixedNowMs('not-a-date'), null);
    assert.equal(fixedNowMs('2026-11-05T00:00:00+09:00'), Date.parse('2026-11-04T15:00:00Z'));
  });

  it('Next 작업 단위 저장소 안(렌더 중)에서만 고정하고 밖에서는 실제 시각이다', () => {
    const root = {};
    const isRendering = createRenderScopeCheck(root);
    const now = Date.parse('2026-11-04T15:00:00.000Z');
    const FixedDate = createFixedDate(Date, now, isRendering);
    // 저장소가 아직 없으면(Next가 쓰기 전) 실제 시각
    assert.notEqual(FixedDate.now(), now);
    const storage = new AsyncLocalStorage();
    root[Symbol.for(`${WORK_UNIT_STORAGE_PREFIX}16.4.2`)] = storage;
    assert.notEqual(new FixedDate().getTime(), now);
    storage.run({ type: 'request' }, () => {
      assert.equal(FixedDate.now(), now);
      assert.equal(new FixedDate().getTime(), now);
    });
    assert.notEqual(FixedDate.now(), now);
  });

  it('--require로 주입하면 렌더 중에만 기준 시각이 된다', () => {
    const out = execFileSync(
      process.execPath,
      [
        '--require',
        path.join(HERE, 'server-clock.cjs'),
        '-e',
        [
          "const { AsyncLocalStorage } = require('node:async_hooks');",
          "const s = (globalThis[Symbol.for('@next/work-unit-async-storage@16.4.2')] = new AsyncLocalStorage());",
          'const outside = Date.now();',
          's.run({}, () => console.log(outside !== Date.now(), Date.now(), new Date().toISOString()));',
        ].join('\n'),
      ],
      {
        env: { ...process.env, GREENHUB_VISUAL_NOW: '2026-11-05T00:00:00+09:00' },
        encoding: 'utf8',
      },
    ).trim();
    const at = Date.parse('2026-11-04T15:00:00Z');
    assert.equal(out, `true ${at} ${new Date(at).toISOString()}`);
  });
});
