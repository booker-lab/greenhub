import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { waitForExpectedPath } from './navigation.mjs';

/** 가짜 page: moveAfterMs 뒤 주소가 to로 바뀐다(null이면 바뀌지 않음). waitForURL은 Playwright처럼 시간 초과에 reject한다. */
function fakePage(from, to, moveAfterMs) {
  let current = `http://visual.invalid${from}`;
  if (to !== null) setTimeout(() => (current = `http://visual.invalid${to}`), moveAfterMs);
  return {
    url: () => current,
    waitForURL(match, { timeout }) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (match(new URL(current))) return resolve();
          if (Date.now() - started >= timeout) return reject(new Error('Timeout'));
          setTimeout(tick, 5);
        };
        tick();
      });
    },
  };
}

describe('의도한 이동을 기다린 뒤 찍기(expectPath)', () => {
  it('이미 그 주소면 기다리지 않고 settle도 부르지 않는다', async () => {
    let settled = 0;
    const result = await waitForExpectedPath(fakePage('/cart', null), '/cart', {
      settle: async () => settled++,
    });
    assert.deepEqual(result, { reached: true, moved: false });
    assert.equal(settled, 0);
  });

  it('늦게 옮겨 가도(대기보다 짧게) 도착할 때까지 기다리고, 옮겨 간 화면을 settle한다', async () => {
    let settled = 0;
    const result = await waitForExpectedPath(fakePage('/groupbuy', '/', 120), '/', {
      timeout: 1_000,
      settle: async () => settled++,
    });
    assert.deepEqual(result, { reached: true, moved: true });
    assert.equal(settled, 1);
  });

  it('시간 안에 옮겨 가지 않으면 도착 못 함으로 돌려준다(판정을 느슨하게 하지 않는다)', async () => {
    const page = fakePage('/groupbuy', null);
    const result = await waitForExpectedPath(page, '/', { timeout: 100 });
    assert.deepEqual(result, { reached: false, moved: false });
    assert.equal(new URL(page.url()).pathname, '/groupbuy');
  });

  it('다른 주소로 옮겨 가면 도착 못 함이지만 옮겨 간 화면은 settle한다', async () => {
    let settled = 0;
    const result = await waitForExpectedPath(fakePage('/groupbuy', '/login', 20), '/', {
      timeout: 150,
      settle: async () => settled++,
    });
    assert.deepEqual(result, { reached: false, moved: true });
    assert.equal(settled, 1);
  });
});
