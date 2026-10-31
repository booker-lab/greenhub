import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compareRuns } from './compare.mjs';
import {
  expectedKeys,
  incompleteReason,
  isComplete,
  pendingShots,
  resumeManifest,
  upsertShot,
  writeJsonAtomic,
} from './manifest-store.mjs';

const SCREENS = [{ id: 'a' }, { id: 'b' }];
const VIEWPORTS = ['mobile', 'desktop'];
const shot = (id, viewport, extra = {}) => ({
  id,
  viewport,
  file: `${id}-${viewport}.png`,
  sound: true,
  problems: [],
  ...extra,
});
const fresh = (extra = {}) => ({
  app: 'seller',
  label: 'x',
  createdAt: '2026-10-31T00:00:00.000Z',
  visualNow: '2026-10-30T15:00:00.000Z',
  viewports: VIEWPORTS,
  set: null,
  expected: expectedKeys(SCREENS, VIEWPORTS),
  complete: false,
  shots: [],
  ...extra,
});

describe('manifest-store: 화면마다 중간 저장·이어 찍기', () => {
  it('원자적 쓰기는 임시 파일을 남기지 않고 마지막 값만 남긴다', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-store-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'manifest.json');
    writeJsonAtomic(file, { n: 1 });
    writeJsonAtomic(file, { n: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 2 });
    assert.deepEqual(fs.readdirSync(dir), ['manifest.json']);
  });

  it('같은 화면(id + 폭)은 바꾸고 다른 화면은 더한다', () => {
    const m = fresh();
    upsertShot(m, shot('a', 'mobile', { sound: false }));
    upsertShot(m, shot('b', 'mobile'));
    upsertShot(m, shot('a', 'mobile'));
    assert.equal(m.shots.length, 2);
    assert.equal(m.shots.find((s) => s.id === 'a').sound, true);
  });

  it('찍기로 한 화면이 모두 있어야 끝난 묶음이다', () => {
    const m = fresh();
    for (const v of VIEWPORTS) upsertShot(m, shot('a', v));
    assert.equal(isComplete(m), false);
    for (const v of VIEWPORTS) upsertShot(m, shot('b', v));
    assert.equal(isComplete(m), true);
  });

  it('이어 찍기는 기록이 있는 화면을 건너뛰고, --only로 고른 화면은 다시 찍는다', () => {
    const m = fresh({ shots: [shot('a', 'mobile'), shot('b', 'mobile')] });
    const keys = (list) => list.map((p) => `${p.screen.id}@${p.viewport}`);
    assert.deepEqual(keys(pendingShots(SCREENS, VIEWPORTS, m, { resume: true })), [
      'a@desktop',
      'b@desktop',
    ]);
    assert.deepEqual(
      keys(pendingShots([{ id: 'a' }], VIEWPORTS, m, { resume: true, only: ['a'] })),
      ['a@mobile', 'a@desktop'],
    );
    // 이어 찍기가 아니면 전부 찍는다(예전 동작).
    assert.equal(pendingShots(SCREENS, VIEWPORTS, m).length, 4);
  });

  it('기준 시각·화면 폭·화면 묶음·앱이 다르면 이어 찍지 않는다', () => {
    const prev = fresh({ shots: [shot('a', 'mobile')] });
    assert.equal(resumeManifest(null, fresh()).manifest, null);
    for (const extra of [
      { visualNow: '2026-11-01T15:00:00.000Z' },
      { viewports: ['mobile'] },
      { set: 'benchmark' },
      { app: 'driver' },
    ]) {
      const r = resumeManifest(prev, fresh(extra));
      assert.equal(r.manifest, null, JSON.stringify(extra));
      assert.equal(r.problems.length, 1);
    }
    const ok = resumeManifest(prev, fresh({ createdAt: '2026-10-31T01:00:00.000Z' }));
    assert.deepEqual(ok.problems, []);
    assert.deepEqual(ok.manifest.shots, prev.shots);
    assert.deepEqual(ok.manifest.resumedFrom, [prev.createdAt]);
    assert.equal(ok.manifest.complete, false);
  });
});

describe('끊긴 묶음은 판정하지 않는다(판정 결과 보존)', () => {
  const image = { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) };
  const done = (shots) => fresh({ complete: true, shots });

  it('같은 곳에서 끊긴 두 묶음도 일부만 비교해 통과시키지 않는다', () => {
    const partial = fresh({ shots: [shot('a', 'mobile')] });
    const result = compareRuns(partial, partial, () => image);
    assert.equal(result.ok, false);
    assert.equal(result.problems.length, 2);
    assert.match(result.problems[0], /before 촬영이 끝나지 않았습니다\(남은 화면 3장\)/);
    assert.match(incompleteReason(partial, 'after'), /after/);
  });

  it('끝난 묶음과 예전 manifest(complete 없음)는 예전처럼 비교한다', () => {
    const all = expectedKeys(SCREENS, VIEWPORTS).map((k) => shot(...k.split('@')));
    const legacy = { ...done(all) };
    delete legacy.complete;
    delete legacy.expected;
    assert.equal(incompleteReason(legacy, 'before'), null);
    const result = compareRuns(legacy, done(all), () => image);
    assert.equal(result.ok, true);
    assert.equal(result.screens.length, 4);
    assert.ok(result.screens.every((s) => s.status === 'same'));
  });
});
