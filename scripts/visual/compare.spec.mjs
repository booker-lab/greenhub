import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { defaultVisualNow, resolveVisualNow } from './clock.mjs';
import { comparePixels, compareRuns, parseAllowances } from './compare.mjs';
import { decodePng, encodePng } from './png.mjs';
import { expectedPathOf, shotProblems } from './soundness.mjs';
import { pickStable, shootStable } from './stable.mjs';

function image(width, height, rgba = [255, 255, 255, 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

function setPixel(img, x, y, rgba) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

const sound = (id, viewport, file = `${id}-${viewport}.png`) => ({
  id,
  viewport,
  file,
  sound: true,
  problems: [],
});

describe('png', () => {
  it('RGBA를 쓰고 같은 픽셀로 다시 읽는다', () => {
    const img = image(5, 3, [10, 20, 30, 255]);
    setPixel(img, 4, 2, [1, 2, 3, 4]);
    const back = decodePng(encodePng(img));
    assert.equal(back.width, 5);
    assert.equal(back.height, 3);
    assert.deepEqual([...back.data], [...img.data]);
  });

  it('필터가 걸린 RGB PNG(Playwright 형식)를 읽는다', () => {
    // 2x2 RGB, 첫 줄 Sub 필터, 둘째 줄 Up 필터로 직접 만든다.
    const raw = Buffer.from([1, 10, 20, 30, 5, 5, 5, 2, 1, 1, 1, 1, 1, 1]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const chunk = (type, body) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(body.length);
      return Buffer.concat([len, Buffer.from(type), body, Buffer.alloc(4)]);
    };
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const { data } = decodePng(png);
    assert.deepEqual(
      [...data],
      [10, 20, 30, 255, 15, 25, 35, 255, 11, 21, 31, 255, 16, 26, 36, 255],
    );
  });

  it('지원하지 않는 형식은 예외로 멈춘다', () => {
    assert.throws(() => decodePng(Buffer.from('not a png')), /PNG가 아닙니다/);
  });
});

describe('comparePixels', () => {
  it('같은 이미지는 차이 0이다', () => {
    const r = comparePixels(image(4, 4), image(4, 4));
    assert.equal(r.diffCount, 0);
    assert.equal(r.unexplainedCount, 0);
  });

  it('민감도: 1px 바뀐 것을 차이로 잡고 위치를 알려 준다', () => {
    const after = image(4, 4);
    setPixel(after, 2, 1, [254, 255, 255, 255]);
    const r = comparePixels(image(4, 4), after);
    assert.equal(r.diffCount, 1);
    assert.equal(r.unexplainedCount, 1);
    assert.deepEqual(r.bbox, { x: 2, y: 1, width: 1, height: 1 });
  });

  it('허용 영역 안의 차이만 넘기고 영역 밖 차이는 남긴다', () => {
    const after = image(10, 10);
    setPixel(after, 1, 1, [0, 0, 0, 255]);
    setPixel(after, 8, 8, [0, 0, 0, 255]);
    const r = comparePixels(image(10, 10), after, { boxes: [{ x: 0, y: 0, width: 3, height: 3 }] });
    assert.equal(r.diffCount, 2);
    assert.equal(r.allowedCount, 1);
    assert.equal(r.unexplainedCount, 1);
    assert.deepEqual(r.bbox, { x: 8, y: 8, width: 1, height: 1 });
  });

  it('크기가 다르면 "full" 허용이 없는 한 설명되지 않는다', () => {
    assert.equal(comparePixels(image(4, 4), image(4, 5)).unexplainedCount, null);
    assert.equal(comparePixels(image(4, 4), image(4, 5), { full: true }).unexplainedCount, 0);
  });

  it('tolerance를 명시하면 그 이하의 채널 차이를 넘긴다', () => {
    const after = image(2, 2);
    setPixel(after, 0, 0, [253, 255, 255, 255]);
    assert.equal(comparePixels(image(2, 2), after).diffCount, 1);
    assert.equal(comparePixels(image(2, 2), after, { tolerance: 2 }).diffCount, 0);
  });
});

describe('parseAllowances', () => {
  it('사유·영역이 없는 항목은 받지 않는다', () => {
    assert.throws(() => parseAllowances([{ screen: 'a', box: 'full' }]), /reason/);
    assert.throws(() => parseAllowances([{ screen: 'a', reason: 'x' }]), /box/);
    assert.throws(
      () =>
        parseAllowances([{ screen: 'a', reason: 'x', box: { x: 0, y: 0, width: 0, height: 1 } }]),
      /box/,
    );
    assert.throws(() => parseAllowances({}), /배열/);
  });

  it('올바른 항목을 정규화한다', () => {
    const [a] = parseAllowances([
      { screen: 'orders', reason: ' 탭 글자 위치 ', box: { x: 1, y: 2, width: 3, height: 4 } },
    ]);
    assert.equal(a.viewport, null);
    assert.equal(a.reason, '탭 글자 위치');
  });
});

describe('compareRuns', () => {
  const run = (shots, extra = {}) => ({
    visualNow: '2026-10-29T15:00:00.000Z',
    viewports: ['mobile'],
    shots,
    ...extra,
  });

  it('같은 캡처는 통과한다', () => {
    const r = compareRuns(run([sound('a', 'mobile')]), run([sound('a', 'mobile')]), () =>
      image(3, 3),
    );
    assert.equal(r.ok, true);
    assert.equal(r.screens[0].status, 'same');
  });

  it('양쪽이 같은 오류 화면이어도 정상 판정이 없으면 실패다', () => {
    const broken = { ...sound('a', 'mobile'), sound: false, problems: ['fixture 없음: /x'] };
    const r = compareRuns(run([broken]), run([broken]), () => image(3, 3));
    assert.equal(r.ok, false);
    assert.equal(r.screens[0].status, 'unsound');
  });

  it('기준 시각이나 화면 폭이 다르면 비교하지 않는다', () => {
    const shots = [sound('a', 'mobile')];
    assert.equal(
      compareRuns(run(shots), run(shots, { visualNow: '2026-10-30T15:00:00.000Z' }), () =>
        image(1, 1),
      ).ok,
      false,
    );
    assert.equal(
      compareRuns(run(shots), run(shots, { viewports: ['mobile', 'desktop'] }), () => image(1, 1))
        .ok,
      false,
    );
  });

  it('한쪽에만 있는 화면은 실패다', () => {
    const r = compareRuns(
      run([sound('a', 'mobile'), sound('b', 'mobile')]),
      run([sound('a', 'mobile'), sound('c', 'mobile')]),
      () => image(1, 1),
    );
    assert.equal(r.ok, false);
    assert.deepEqual(r.screens.map((s) => s.status).sort(), ['missing', 'new', 'same']);
  });

  it('허용 목록의 영역 안 차이만 있으면 통과하고, 쓰이지 않은 항목을 알려 준다', () => {
    const after = image(4, 4);
    setPixel(after, 0, 0, [0, 0, 0, 255]);
    const allowances = parseAllowances([
      { screen: 'a', viewport: 'mobile', box: { x: 0, y: 0, width: 1, height: 1 }, reason: '의도' },
      { screen: 'b', box: 'full', reason: '안 쓰임' },
    ]);
    const r = compareRuns(
      run([sound('a', 'mobile')]),
      run([sound('a', 'mobile')]),
      (which) => (which === 'after' ? after : image(4, 4)),
      allowances,
    );
    assert.equal(r.ok, true);
    assert.equal(r.screens[0].status, 'allowed');
    assert.deepEqual(
      r.unusedAllowances.map((a) => a.screen),
      ['b'],
    );
  });
});

describe('soundness', () => {
  it('fixture 누락·콘솔 오류·API 요청 실패·멈춘 단계·하네스 미지원·불안정·다른 주소를 문제로 잡는다', () => {
    const problems = shotProblems(
      {
        missing: ['/x'],
        errors: ['boom'],
        failed: ['/driver/orders/o1 net::ERR_CERT_AUTHORITY_INVALID'],
        stepNote: '누를 글자 없음: 저장',
        unsupported: 'Firestore 에뮬레이터 없음',
        unstable: '불안정: 5번 찍어 같은 결과가 두 번 나오지 않음',
        finalPath: '/login',
      },
      '/orders',
    );
    assert.equal(problems.length, 7);
    assert.deepEqual(
      shotProblems({ missing: [], errors: [], finalPath: '/orders' }, '/orders'),
      [],
    );
  });

  it('도착 주소는 query를 뺀 pathname이고 expectPath로 바꿀 수 있다', () => {
    assert.equal(expectedPathOf({ path: '/products/p1?round=r1' }), '/products/p1');
    assert.equal(
      expectedPathOf({ path: '/products/p1', expectPath: '/products/p2' }),
      '/products/p2',
    );
  });
});

describe('stable', () => {
  /** 정해 둔 결과를 차례로 돌려주는 가짜 촬영. */
  function fakeShoot(results) {
    let i = 0;
    const calls = () => i;
    const shoot = async () => {
      const r = results[i];
      i += 1;
      return { hash: r.hash, sound: r.sound ?? true, value: `${r.hash}#${i}` };
    };
    return { shoot, calls };
  }

  it('같은 결과가 두 번째로 나온 시도를 고른다', () => {
    assert.deepEqual(pickStable(['a', 'a']), { index: 1, hash: 'a' });
    assert.deepEqual(pickStable(['a', 'b', 'a']), { index: 2, hash: 'a' });
    assert.deepEqual(pickStable(['a', 'b', 'c', 'b']), { index: 3, hash: 'b' });
    assert.equal(pickStable(['a', 'b', 'c']), null);
    assert.equal(pickStable([]), null);
  });

  it('처음 두 장이 같으면 두 번만 찍는다', async () => {
    const { shoot, calls } = fakeShoot([{ hash: 'a' }, { hash: 'a' }, { hash: 'x' }]);
    const r = await shootStable(shoot, 5);
    assert.equal(r.outcome, 'stable');
    assert.equal(r.attempts, 2);
    assert.equal(r.value, 'a#2');
    assert.equal(calls(), 2);
  });

  it('다르면 다시 찍어 두 번 나온 결과를 쓴다', async () => {
    const { shoot } = fakeShoot([{ hash: 'a' }, { hash: 'b' }, { hash: 'b' }]);
    const r = await shootStable(shoot, 5);
    assert.equal(r.outcome, 'stable');
    assert.equal(r.attempts, 3);
    assert.equal(r.value, 'b#3');
  });

  it('상한까지 같은 결과 두 번이 없으면 불안정이다', async () => {
    const { shoot, calls } = fakeShoot(['a', 'b', 'c', 'd', 'e'].map((hash) => ({ hash })));
    const r = await shootStable(shoot, 5);
    assert.equal(r.outcome, 'unstable');
    assert.equal(r.attempts, 5);
    assert.equal(calls(), 5);
  });

  it('정상 판정에 실패한 시도는 다시 찍어 숨기지 않고 그대로 돌려준다', async () => {
    const { shoot, calls } = fakeShoot([
      { hash: 'a' },
      { hash: 'err', sound: false },
      { hash: 'a' },
    ]);
    const r = await shootStable(shoot, 5);
    assert.equal(r.outcome, 'unsound');
    assert.equal(r.value, 'err#2');
    assert.equal(calls(), 2);
  });

  it('상한은 2 이상이어야 한다', async () => {
    await assert.rejects(shootStable(async () => ({ hash: 'a', sound: true, value: 1 }), 1));
  });
});

describe('clock', () => {
  it('기본 기준 시각은 실제 시각이 속한 한국 날짜의 0시다', () => {
    // 2026-10-30 13:00 UTC = 10/30 22:00 KST → 10/30 0시 KST = 10/29 15:00 UTC
    assert.equal(defaultVisualNow(Date.parse('2026-10-30T13:00:00Z')), '2026-10-29T15:00:00.000Z');
    // 2026-10-30 16:00 UTC = 10/31 01:00 KST → 10/31 0시 KST
    assert.equal(defaultVisualNow(Date.parse('2026-10-30T16:00:00Z')), '2026-10-30T15:00:00.000Z');
  });

  it('--now 값은 ISO로 정규화하고, 해석할 수 없으면 예외다', () => {
    assert.equal(resolveVisualNow('2026-11-01T00:00:00+09:00'), '2026-10-31T15:00:00.000Z');
    assert.throws(() => resolveVisualNow('어제'), /해석할 수 없습니다/);
  });
});
