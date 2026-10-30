import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_TESTS,
  judgeStats,
  nonLoopbackBases,
  PROJECTS,
  SPEC_PATTERN,
} from './admin-local-e2e.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('nonLoopbackBases', () => {
  it('비었거나 루프백이면 통과한다', () => {
    assert.deepEqual(nonLoopbackBases({}), []);
    assert.deepEqual(
      nonLoopbackBases({
        SELLER_BASE: 'http://127.0.0.1:3002',
        CONSUMER_BASE: 'http://localhost:3001',
      }),
      [],
    );
  });

  it('운영·원격 주소나 해석할 수 없는 값은 막는다', () => {
    assert.equal(nonLoopbackBases({ SELLER_BASE: 'https://seller.greenlove.co.kr' }).length, 1);
    assert.equal(nonLoopbackBases({ DRIVER_BASE: 'not a url' }).length, 1);
  });
});

describe('judgeStats', () => {
  it('기대 건수를 모두 통과했을 때만 통과한다', () => {
    assert.deepEqual(judgeStats({ expected: EXPECTED_TESTS }), []);
  });

  it('건너뜀·재시도 통과·실패·건수 차이를 모두 문제로 본다', () => {
    assert.match(judgeStats({ expected: EXPECTED_TESTS - 2, skipped: 2 }).join(), /건너뜀 2건/);
    assert.match(judgeStats({ expected: EXPECTED_TESTS - 1, flaky: 1 }).join(), /재시도 통과 1건/);
    assert.match(judgeStats({ expected: EXPECTED_TESTS - 1, unexpected: 1 }).join(), /실패 1건/);
    assert.match(judgeStats({ expected: EXPECTED_TESTS - 1 }).join(), /기대 20건/);
    assert.deepEqual(judgeStats(undefined), ['JSON 보고서에 stats가 없음']);
  });
});

describe('기대 건수', () => {
  it('spec 파일 수가 바뀌면 EXPECTED_TESTS도 같이 고쳐야 한다(파일 5개 × 프로젝트 2개 = 20 기준)', () => {
    const specs = readdirSync(path.join(ROOT, 'apps/e2e/tests')).filter(
      (f) => f.startsWith(SPEC_PATTERN) && f.endsWith('.spec.ts'),
    );
    // 파일 수가 바뀌었는데 이 테스트만 고치고 EXPECTED_TESTS를 그대로 두지 않게, 둘을 함께 적는다.
    assert.equal(
      specs.length,
      5,
      `admin-local spec ${specs.length}개 — EXPECTED_TESTS를 다시 세어 고친다`,
    );
    assert.equal(PROJECTS.length, 2);
    assert.equal(EXPECTED_TESTS, 20);
  });
});
