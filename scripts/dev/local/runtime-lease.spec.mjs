import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  acquireRuntimeLease,
  defaultIsOwnerAlive,
  LEASE_FILE_NAME,
  LOCAL_RUNTIME_STACK_PORTS,
  LOCAL_RUNTIME_STACK_RESOURCE_KEY,
  LocalRuntimeLeaseError,
  releaseRuntimeLease,
  resolveLeaseDirectory,
  resolveLeaseFilePath,
} from './runtime-lease.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../../..');
const LEASE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'runtime-lease.mjs')).href;

function makeTempDir(prefix = 'greenhub-lease-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeTempDir(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function baseAcquireOptions(directory, overrides = {}) {
  return {
    directory,
    repositoryRoot: 'C:\\fake\\checkout\\greenhub-task-lease-01',
    launcherIdentity: 'test-launcher',
    ...overrides,
  };
}

test('A. single launcher lease acquisition succeeds with diagnostic metadata', () => {
  const directory = makeTempDir();
  try {
    const lease = acquireRuntimeLease(baseAcquireOptions(directory, { ownerPid: process.pid }));

    assert.equal(lease.resourceKey, LOCAL_RUNTIME_STACK_RESOURCE_KEY);
    assert.equal(lease.ownerPid, process.pid);
    assert.equal(lease.checkoutPath, 'C:\\fake\\checkout\\greenhub-task-lease-01');
    assert.equal(typeof lease.acquiredAt, 'string');
    assert.equal(lease.launcherIdentity, 'test-launcher');
    assert.deepEqual(lease.ports, [...LOCAL_RUNTIME_STACK_PORTS]);
    assert.equal(typeof lease.leaseId, 'string');
    assert.ok(lease.leaseId.length > 0);
    assert.equal(lease.leasePath, resolveLeaseFilePath(directory));
    assert.equal(lease.directory, directory);

    const stored = JSON.parse(readFileSync(lease.leasePath, 'utf8'));
    assert.equal(stored.resourceKey, LOCAL_RUNTIME_STACK_RESOURCE_KEY);
    assert.equal(stored.leaseId, lease.leaseId);
    assert.deepEqual(stored.ports, [...LOCAL_RUNTIME_STACK_PORTS]);
  } finally {
    removeTempDir(directory);
  }
});

test('B. 동일 resource 동시 획득은 정확히 하나만 성공한다 (in-process)', async () => {
  const directory = makeTempDir();
  try {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => acquireRuntimeLease(baseAcquireOptions(directory))),
      Promise.resolve().then(() => acquireRuntimeLease(baseAcquireOptions(directory))),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof LocalRuntimeLeaseError);
  } finally {
    removeTempDir(directory);
  }
});

function runRaceWorker({ directory, leaseId }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'try {',
      `  const { acquireRuntimeLease } = await import(${JSON.stringify(LEASE_MODULE_URL)});`,
      '  const lease = acquireRuntimeLease({',
      `    directory: ${JSON.stringify(directory)},`,
      `    repositoryRoot: ${JSON.stringify('C:\\fake\\checkout\\race-worker')},`,
      `    launcherIdentity: 'race-worker',`,
      `    leaseId: ${JSON.stringify(leaseId)},`,
      '  });',
      '  console.log(JSON.stringify({ ok: true, leaseId: lease.leaseId }));',
      '} catch (error) {',
      '  console.log(JSON.stringify({ ok: false, name: error?.name, reason: error?.reason ?? null }));',
      '}',
      '// owner PID를 race window 동안 alive로 유지한다: 먼저 획득한 worker가',
      '// 종료되면 loser의 probe가 stale로 오판하여 정당하게 회수해 버린다.',
      'await new Promise((resolveSleep) => setTimeout(resolveSleep, 3000));',
    ].join('\n');
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectResult);
    child.once('close', (exitCode) => {
      if (exitCode !== 0) {
        rejectResult(new Error(`race worker exit=${exitCode} stderr=${stderr}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch (error) {
        rejectResult(new Error(`race worker 출력 파싱 실패: ${stdout} / ${stderr}`));
      }
    });
  });
}

test('B-race. 두 OS process가 동시에 획득하면 정확히 하나만 owner가 된다', {
  timeout: 30000,
}, async () => {
  const directory = makeTempDir('greenhub-lease-race-');
  try {
    const [first, second] = await Promise.all([
      runRaceWorker({ directory, leaseId: 'race-worker-1' }),
      runRaceWorker({ directory, leaseId: 'race-worker-2' }),
    ]);
    const winners = [first, second].filter((result) => result.ok === true);
    const losers = [first, second].filter((result) => result.ok !== true);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].name, 'LocalRuntimeLeaseError');

    const stored = JSON.parse(readFileSync(resolveLeaseFilePath(directory), 'utf8'));
    assert.equal(stored.leaseId, winners[0].leaseId);
  } finally {
    removeTempDir(directory);
  }
});

test('C. second active owner attempt는 owner attribution과 함께 fail closed한다', () => {
  const directory = makeTempDir();
  try {
    const owner = acquireRuntimeLease(
      baseAcquireOptions(directory, {
        ownerPid: 42421,
        checkoutPath: 'C:\\Develop\\greenhub-task-fe-local-01',
        leaseId: 'owner-lease-c',
      }),
    );

    assert.throws(
      () =>
        acquireRuntimeLease(
          baseAcquireOptions(directory, {
            ownerPid: 99999,
            checkoutPath: 'C:\\Develop\\greenhub',
            isOwnerAlive: () => true,
          }),
        ),
      (error) => {
        assert.ok(error instanceof LocalRuntimeLeaseError);
        assert.equal(error.ownerPid, 42421);
        assert.equal(error.ownerCheckout, 'C:\\Develop\\greenhub-task-fe-local-01');
        assert.equal(error.resourceKey, LOCAL_RUNTIME_STACK_RESOURCE_KEY);
        assert.deepEqual(error.ports, [...LOCAL_RUNTIME_STACK_PORTS]);
        assert.equal(error.leasePath, owner.leasePath);
        assert.match(error.message, /42421/);
        assert.match(error.message, /greenhub-task-fe-local-01/);
        return true;
      },
    );

    const stored = JSON.parse(readFileSync(owner.leasePath, 'utf8'));
    assert.equal(stored.leaseId, 'owner-lease-c');
  } finally {
    removeTempDir(directory);
  }
});

test('D. owner 종료 stale lease는 안전 조건에서 recovery 가능하다 (injected probe)', () => {
  const directory = makeTempDir();
  try {
    const stale = acquireRuntimeLease(
      baseAcquireOptions(directory, { ownerPid: 11111, leaseId: 'stale-owner' }),
    );
    const recovered = acquireRuntimeLease(
      baseAcquireOptions(directory, {
        ownerPid: 22222,
        checkoutPath: 'C:\\Develop\\greenhub',
        leaseId: 'recovered-owner',
        isOwnerAlive: () => false,
      }),
    );
    assert.equal(recovered.leaseId, 'recovered-owner');
    assert.notEqual(recovered.leaseId, stale.leaseId);
    const stored = JSON.parse(readFileSync(recovered.leasePath, 'utf8'));
    assert.equal(stored.leaseId, 'recovered-owner');
    assert.equal(stored.ownerPid, 22222);
  } finally {
    removeTempDir(directory);
  }
});

test('D-default. 실제 종료된 PID의 stale lease는 기본 probe로 recovery 가능하다', () => {
  const directory = makeTempDir();
  const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  const deadPid = exited.pid;
  assert.ok(Number.isInteger(deadPid) && deadPid > 0);
  assert.equal(defaultIsOwnerAlive(deadPid), false);
  try {
    acquireRuntimeLease(baseAcquireOptions(directory, { ownerPid: deadPid, leaseId: 'dead-owner' }));
    const recovered = acquireRuntimeLease(
      baseAcquireOptions(directory, { ownerPid: process.pid, leaseId: 'live-recovery' }),
    );
    assert.equal(recovered.leaseId, 'live-recovery');
  } finally {
    removeTempDir(directory);
  }
});

test('E. active owner lease는 reclaim하지 않는다 (alive probe + 실제 살아있는 PID)', () => {
  const directory = makeTempDir();
  try {
    acquireRuntimeLease(baseAcquireOptions(directory, { ownerPid: 33333, leaseId: 'active-e' }));
    assert.throws(
      () =>
        acquireRuntimeLease(
          baseAcquireOptions(directory, { ownerPid: 44444, leaseId: 'thief-e', isOwnerAlive: () => true }),
        ),
      (error) => error instanceof LocalRuntimeLeaseError,
    );
    const stored = JSON.parse(readFileSync(resolveLeaseFilePath(directory), 'utf8'));
    assert.equal(stored.leaseId, 'active-e');

    const liveDirectory = makeTempDir('greenhub-lease-live-');
    try {
      acquireRuntimeLease(
        baseAcquireOptions(liveDirectory, { ownerPid: process.pid, leaseId: 'live-owner' }),
      );
      assert.throws(
        () =>
          acquireRuntimeLease(
            baseAcquireOptions(liveDirectory, { ownerPid: 55555, leaseId: 'thief-live' }),
          ),
        (error) => error instanceof LocalRuntimeLeaseError && error.ownerPid === process.pid,
      );
      const liveStored = JSON.parse(readFileSync(resolveLeaseFilePath(liveDirectory), 'utf8'));
      assert.equal(liveStored.leaseId, 'live-owner');
    } finally {
      removeTempDir(liveDirectory);
    }
  } finally {
    removeTempDir(directory);
  }
});

test('E-unknown. owner 생사 판단이 불명확하면 fail closed한다', () => {
  const directory = makeTempDir();
  try {
    acquireRuntimeLease(baseAcquireOptions(directory, { ownerPid: 66666, leaseId: 'unknown-owner' }));
    assert.throws(
      () =>
        acquireRuntimeLease(
          baseAcquireOptions(directory, {
            ownerPid: 77777,
            leaseId: 'thief-unknown',
            isOwnerAlive: () => undefined,
          }),
        ),
      (error) => error instanceof LocalRuntimeLeaseError,
    );
    const stored = JSON.parse(readFileSync(resolveLeaseFilePath(directory), 'utf8'));
    assert.equal(stored.leaseId, 'unknown-owner');
  } finally {
    removeTempDir(directory);
  }
});

test('손상된 lease 파일은 자동 삭제 없이 fail closed한다', () => {
  const directory = makeTempDir();
  try {
    const leasePath = resolveLeaseFilePath(directory);
    mkdirSync(directory, { recursive: true });
    writeFileSync(leasePath, 'not-json{{{', 'utf8');
    assert.throws(
      () => acquireRuntimeLease(baseAcquireOptions(directory)),
      (error) =>
        error instanceof LocalRuntimeLeaseError && error.reason === 'corrupt-lease',
    );
    assert.equal(readFileSync(leasePath, 'utf8'), 'not-json{{{');
  } finally {
    removeTempDir(directory);
  }
});

test('H. 다른 lease instance를 잘못 삭제하지 않는다', () => {
  const directory = makeTempDir();
  try {
    const owner = acquireRuntimeLease(baseAcquireOptions(directory, { leaseId: 'owner-h' }));
    const result = releaseRuntimeLease(
      { leasePath: owner.leasePath, leaseId: 'foreign-instance-id' },
    );
    assert.equal(result.released, false);
    assert.equal(result.reason, 'not-owner');
    const stored = JSON.parse(readFileSync(owner.leasePath, 'utf8'));
    assert.equal(stored.leaseId, 'owner-h');
  } finally {
    removeTempDir(directory);
  }
});

test('G-lease. 정상 shutdown은 own lease만 해제한다', () => {
  const directory = makeTempDir();
  try {
    const owner = acquireRuntimeLease(baseAcquireOptions(directory, { leaseId: 'owner-g' }));
    const released = releaseRuntimeLease(owner);
    assert.equal(released.released, true);

    let missing = false;
    try {
      readFileSync(owner.leasePath, 'utf8');
    } catch (error) {
      missing = error?.code === 'ENOENT';
    }
    assert.equal(missing, true);

    const next = acquireRuntimeLease(baseAcquireOptions(directory, { leaseId: 'owner-g2' }));
    assert.equal(next.leaseId, 'owner-g2');
  } finally {
    removeTempDir(directory);
  }
});

test('I. repository working tree에 lease artifact를 남기지 않는다', () => {
  const fakeLocalAppData = makeTempDir('greenhub-localappdata-');
  try {
    const directory = resolveLeaseDirectory({
      platform: 'win32',
      env: { LOCALAPPDATA: fakeLocalAppData },
    });
    assert.equal(directory, join(fakeLocalAppData, 'Greenhub', 'local-runtime'));
    assert.equal(directory.startsWith(REPOSITORY_ROOT), false);

    const lease = acquireRuntimeLease({
      platform: 'win32',
      env: { LOCALAPPDATA: fakeLocalAppData },
      repositoryRoot: REPOSITORY_ROOT,
      launcherIdentity: 'test-launcher',
    });
    assert.equal(lease.leasePath.startsWith(REPOSITORY_ROOT), false);
    assert.equal(lease.leasePath, join(directory, LEASE_FILE_NAME));

    let repoArtifact = false;
    try {
      readFileSync(join(REPOSITORY_ROOT, LEASE_FILE_NAME), 'utf8');
      repoArtifact = true;
    } catch (error) {
      repoArtifact = false;
    }
    assert.equal(repoArtifact, false);
  } finally {
    removeTempDir(fakeLocalAppData);
  }
});
