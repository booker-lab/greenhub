import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LEASE_DIRECTORY_ENV_KEY,
  LocalRuntimeLeaseError,
  acquireRuntimeLease,
  isExplicitLeaseDirectoryOverride,
  releaseRuntimeLease,
  resolveLeaseDirectory,
  resolveLeaseFilePath,
  resolveSharedLeaseDirectory,
} from './runtime-lease.mjs';
import { FIXED_PORTS, runLocalRuntime } from './launcher.mjs';

const CHECKOUT_A = 'C:\\Develop\\greenhub';
const CHECKOUT_B = 'C:\\Develop\\greenhub-task-fe-local-01';

function makeTempDir(prefix = 'greenhub-shared-lease-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeTempDir(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function readLeaseDocument(leasePath) {
  return JSON.parse(readFileSync(leasePath, 'utf8'));
}

// TEST 1: 서로 다른 fake repository root/cwd를 사용하더라도 default
// lease path/namespace가 동일하다. checkout 경로는 namespace key가 아니다.
test('TEST1. different checkouts resolve to the same shared default lease namespace', () => {
  const fakeBase = makeTempDir('greenhub-shared-base-');
  try {
    const env = { LOCALAPPDATA: fakeBase };
    const directoryForA = resolveLeaseDirectory({ platform: 'win32', env });
    const directoryForB = resolveLeaseDirectory({ platform: 'win32', env });
    const sharedForA = resolveSharedLeaseDirectory({ platform: 'win32', env });
    const sharedForB = resolveSharedLeaseDirectory({ platform: 'win32', env });

    assert.equal(directoryForA, directoryForB);
    assert.equal(sharedForA, sharedForB);
    assert.equal(directoryForA, sharedForA);
    assert.equal(directoryForA, join(fakeBase, 'Greenhub', 'local-runtime'));

    // checkout 경로는 directory 입력이 아니므로 namespace에 영향을 주지 않는다.
    assert.equal(directoryForA.startsWith(CHECKOUT_A), false);
    assert.equal(directoryForA.startsWith(CHECKOUT_B), false);

    const leasePathForA = resolveLeaseFilePath(directoryForA);
    const leasePathForB = resolveLeaseFilePath(directoryForB);
    assert.equal(leasePathForA, leasePathForB);

    // repository working tree 아래가 아니다.
    assert.equal(leasePathForA.startsWith(CHECKOUT_A), false);
    assert.equal(leasePathForA.startsWith(CHECKOUT_B), false);

    // override가 없을 때 shared default가 사용된다.
    assert.equal(isExplicitLeaseDirectoryOverride({ env }), false);
  } finally {
    removeTempDir(fakeBase);
  }
});

test('TEST1b. launcher does not derive a per-checkout lease directory', async () => {
  const captured = [];
  const failingAcquire = async (options) => {
    captured.push({ ...options });
    throw new LocalRuntimeLeaseError('test-lease-rejected', {
      leasePath: 'test-lease-path',
      reason: 'active-owner',
    });
  };

  for (const repositoryRoot of [CHECKOUT_A, CHECKOUT_B]) {
    await assert.rejects(
      runLocalRuntime({
        baseEnvironment: { NODE_ENV: 'development' },
        repositoryRoot,
        acquireRuntimeLeaseImpl: failingAcquire,
        releaseRuntimeLeaseImpl: async () => ({ released: false, reason: 'no-lease' }),
        portAvailabilityProbe: async () => true,
        spawnImpl: () => {
          throw new Error('spawn must not run when lease rejects');
        },
        signalSource: new EventEmitter(),
        logger: { log: () => {}, error: () => {} },
      }),
      (error) => error instanceof LocalRuntimeLeaseError,
    );
  }

  assert.equal(captured.length, 2);
  // launcher는 checkout마다 다른 directory를 자동 생성하지 않는다:
  // directory 키 자체를 넘기지 않아 shared default resolution에 맡긴다.
  assert.equal('directory' in captured[0], false);
  assert.equal('directory' in captured[1], false);
  assert.equal(captured[0].repositoryRoot, CHECKOUT_A);
  assert.equal(captured[1].repositoryRoot, CHECKOUT_B);
});

// TEST 2: runtime A가 lease를 확보한 상태에서 다른 checkout identity의
// runtime B가 acquire하면 fail-closed 한다.
test('TEST2. second checkout fails closed while first checkout holds the lease', () => {
  const sharedDirectory = makeTempDir();
  try {
    acquireRuntimeLease({
      directory: sharedDirectory,
      checkoutPath: CHECKOUT_A,
      ownerPid: 42421,
      leaseId: 'shared-owner-a',
    });

    assert.throws(
      () =>
        acquireRuntimeLease({
          directory: sharedDirectory,
          checkoutPath: CHECKOUT_B,
          ownerPid: 99999,
          leaseId: 'shared-intruder-b',
          isOwnerAlive: () => true,
        }),
      (error) => {
        assert.ok(error instanceof LocalRuntimeLeaseError);
        assert.equal(error.ownerPid, 42421);
        assert.equal(error.ownerCheckout, CHECKOUT_A);
        assert.match(error.message, /42421/);
        assert.ok(error.message.includes(CHECKOUT_A));
        return true;
      },
    );
  } finally {
    removeTempDir(sharedDirectory);
  }
});

// TEST 3: B 실패 시 A의 lease는 훼손되지 않는다.
test('TEST3. failed second acquire preserves the first owner lease', () => {
  const sharedDirectory = makeTempDir();
  try {
    const owner = acquireRuntimeLease({
      directory: sharedDirectory,
      checkoutPath: CHECKOUT_A,
      ownerPid: 42421,
      leaseId: 'preserve-owner-a',
    });

    assert.throws(() =>
      acquireRuntimeLease({
        directory: sharedDirectory,
        checkoutPath: CHECKOUT_B,
        ownerPid: 99999,
        leaseId: 'preserve-intruder-b',
        isOwnerAlive: () => true,
      }),
    );

    const stored = readLeaseDocument(owner.leasePath);
    assert.equal(stored.leaseId, 'preserve-owner-a');
    assert.equal(stored.ownerPid, 42421);
    assert.equal(stored.checkoutPath, CHECKOUT_A);
  } finally {
    removeTempDir(sharedDirectory);
  }
});

// TEST 4: A가 정상 release하면 B가 이후 acquire할 수 있다.
test('TEST4. second checkout can acquire after first owner releases', () => {
  const sharedDirectory = makeTempDir();
  try {
    const ownerA = acquireRuntimeLease({
      directory: sharedDirectory,
      checkoutPath: CHECKOUT_A,
      ownerPid: 42421,
      leaseId: 'release-owner-a',
    });
    const released = releaseRuntimeLease(ownerA);
    assert.equal(released.released, true);

    const ownerB = acquireRuntimeLease({
      directory: sharedDirectory,
      checkoutPath: CHECKOUT_B,
      ownerPid: 99999,
      leaseId: 'release-owner-b',
      isOwnerAlive: () => true,
    });
    assert.equal(ownerB.leaseId, 'release-owner-b');
    assert.equal(ownerB.checkoutPath, CHECKOUT_B);
    const stored = readLeaseDocument(ownerB.leasePath);
    assert.equal(stored.leaseId, 'release-owner-b');
  } finally {
    removeTempDir(sharedDirectory);
  }
});

// TEST 5: dead-owner stale lease recovery가 기존 계약대로 작동한다.
test('TEST5. dead-owner stale lease is reclaimed under the existing contract', () => {
  const sharedDirectory = makeTempDir();
  try {
    acquireRuntimeLease({
      directory: sharedDirectory,
      checkoutPath: CHECKOUT_A,
      ownerPid: 11111,
      leaseId: 'stale-owner-a',
    });
    const recovered = acquireRuntimeLease({
      directory: sharedDirectory,
      checkoutPath: CHECKOUT_B,
      ownerPid: 22222,
      leaseId: 'stale-recovered-b',
      isOwnerAlive: () => false,
    });
    assert.equal(recovered.leaseId, 'stale-recovered-b');
    assert.notEqual(recovered.leaseId, 'stale-owner-a');
    const stored = readLeaseDocument(recovered.leasePath);
    assert.equal(stored.leaseId, 'stale-recovered-b');
    assert.equal(stored.ownerPid, 22222);
  } finally {
    removeTempDir(sharedDirectory);
  }
});

// TEST 6: explicit test override를 사용하면 테스트끼리 독립시킬 수 있다.
// override는 mutual exclusion을 우회하므로 normal run 분리에 사용하지 않는다.
test('TEST6. explicit test overrides isolate namespaces (and bypass sharing by design)', () => {
  const isolatedA = makeTempDir('greenhub-isolated-a-');
  const isolatedB = makeTempDir('greenhub-isolated-b-');
  try {
    const leaseA = acquireRuntimeLease({
      directory: isolatedA,
      checkoutPath: CHECKOUT_A,
      ownerPid: 42421,
      leaseId: 'isolated-a',
    });
    const leaseB = acquireRuntimeLease({
      directory: isolatedB,
      checkoutPath: CHECKOUT_B,
      ownerPid: 42421,
      leaseId: 'isolated-b',
    });
    assert.notEqual(leaseA.leasePath, leaseB.leasePath);
    assert.equal(readLeaseDocument(leaseA.leasePath).leaseId, 'isolated-a');
    assert.equal(readLeaseDocument(leaseB.leasePath).leaseId, 'isolated-b');

    const dirFromEnvA = resolveLeaseDirectory({
      platform: 'win32',
      env: { [LEASE_DIRECTORY_ENV_KEY]: isolatedA },
    });
    const dirFromEnvB = resolveLeaseDirectory({
      platform: 'win32',
      env: { [LEASE_DIRECTORY_ENV_KEY]: isolatedB },
    });
    assert.equal(dirFromEnvA, isolatedA);
    assert.equal(dirFromEnvB, isolatedB);
    assert.notEqual(dirFromEnvA, dirFromEnvB);
    assert.equal(
      isExplicitLeaseDirectoryOverride({ env: { [LEASE_DIRECTORY_ENV_KEY]: isolatedA } }),
      true,
    );

    // shared default는 env override를 무시하므로 normal run namespace는 하나다.
    const sharedEnv = { LOCALAPPDATA: isolatedA, [LEASE_DIRECTORY_ENV_KEY]: isolatedB };
    assert.equal(
      resolveSharedLeaseDirectory({ platform: 'win32', env: sharedEnv }),
      join(isolatedA, 'Greenhub', 'local-runtime'),
    );
  } finally {
    removeTempDir(isolatedA);
    removeTempDir(isolatedB);
  }
});

// TEST 7: launcher contract상 lease rejection은 child runtime spawn 이전에
// 발생한다 (API/Next/Firebase/port 점유 없음).
test('TEST7. launcher lease rejection happens before preflight and child spawn', async () => {
  const sharedDirectory = makeTempDir();
  let spawnCount = 0;
  let preflightCount = 0;
  try {
    const owner = acquireRuntimeLease({
      directory: sharedDirectory,
      checkoutPath: CHECKOUT_A,
      ownerPid: 42421,
      leaseId: 'launcher-owner-a',
    });

    await assert.rejects(
      runLocalRuntime({
        leaseDirectory: sharedDirectory,
        leaseOptions: { isOwnerAlive: () => true },
        baseEnvironment: { NODE_ENV: 'development' },
        portAvailabilityProbe: async () => {
          preflightCount += 1;
          return true;
        },
        spawnImpl: () => {
          spawnCount += 1;
          return new EventEmitter();
        },
        signalSource: new EventEmitter(),
        logger: { log: () => {}, error: () => {} },
      }),
      (error) => {
        assert.ok(error instanceof LocalRuntimeLeaseError);
        assert.equal(error.ownerPid, 42421);
        assert.equal(error.ownerCheckout, CHECKOUT_A);
        return true;
      },
    );

    assert.equal(spawnCount, 0);
    assert.equal(preflightCount, 0);
    assert.equal(readLeaseDocument(owner.leasePath).leaseId, 'launcher-owner-a');
    assert.deepEqual([...FIXED_PORTS].sort((a, b) => a - b), [3000, 3001, 3002, 3003, 8080, 9099, 9199]);
  } finally {
    removeTempDir(sharedDirectory);
  }
});
