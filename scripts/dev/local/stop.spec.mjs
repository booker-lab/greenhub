import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acquireRuntimeLease,
  defaultIsOwnerAlive,
  LOCAL_RUNTIME_STACK_RESOURCE_KEY,
  readRuntimeLease,
  releaseRuntimeLease,
  resolveLeaseFilePath,
  updateRuntimeLeaseControl,
} from './runtime-lease.mjs';
import { FIXED_PORTS, terminateOwnedProcessTree } from './launcher.mjs';
import {
  CANONICAL_STOP_PORTS,
  CLOSED_RESULTS,
  checkCanonicalListenersFree,
  classifyLeaseForStopClosed,
  stopLocalRuntimeClosed,
  waitForStopCompletionClosed,
} from './stop.mjs';

function makeTempDir(prefix = 'greenhub-stop-closed-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeTempDir(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForDeath(pid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!isAlive(pid)) return;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 25));
  }
  throw new Error(`PID ${pid} did not die within ${timeoutMs}ms`);
}

async function waitForAlive(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (isAlive(pid)) return;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 25));
  }
  throw new Error(`PID ${pid} did not become alive within ${timeoutMs}ms`);
}

function spawnLongLived() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
  });
  return child;
}

async function allocFreePorts(count) {
  const servers = [];
  const ports = [];
  for (let i = 0; i < count; i += 1) {
    const server = createServer();
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen({ port: 0, host: '127.0.0.1', exclusive: true }, () => {
        const address = server.address();
        ports.push(address.port);
        resolveListen();
      });
    });
    servers.push(server);
  }
  for (const server of servers) {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
  }
  return ports;
}

async function startListeners(ports) {
  const servers = [];
  for (const port of ports) {
    const server = createServer();
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen({ port, host: '127.0.0.1', exclusive: true }, resolveListen);
    });
    servers.push(server);
  }
  return {
    servers,
    closeAll: async () => {
      for (const server of servers) {
        await new Promise((resolveClose) => {
          try {
            server.close(() => resolveClose());
          } catch {
            resolveClose();
          }
        });
      }
    },
  };
}

function leaseExists(leasePath) {
  try {
    readFileSync(leasePath, 'utf8');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

// 0. Canonical production ports are unchanged (ephemeral only in tests).
test('0. canonical production ports remain fixed', () => {
  assert.deepEqual([...CANONICAL_STOP_PORTS].sort((a, b) => a - b), [3000, 3001, 3002, 3003, 8080, 9099, 9199]);
  assert.deepEqual([...FIXED_PORTS].sort((a, b) => a - b), [3000, 3001, 3002, 3003, 8080, 9099, 9199]);
});

// 1. normal owned STOP_COMPLETED (process + listener + lease coupled).
test('1. normal owned STOP_COMPLETED couples process, listener, lease', async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(2);
  const owned = spawnLongLived();
  let listeners = null;
  try {
    await waitForAlive(owned.pid);
    const handle = acquireRuntimeLease({
      directory,
      ownerPid: owned.pid,
      checkoutPath: 'C:\\fake\\stop-closed-01',
      leaseId: 'stop-closed-01',
    });
    const controlUpdate = updateRuntimeLeaseControl(handle, {
      host: '127.0.0.1',
      port: 45678,
      token: 'tok-closed-01',
    });
    assert.equal(controlUpdate.updated, true);
    listeners = await startListeners(canonicalPorts);

    let controlCalled = false;
    const outcome = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: defaultIsOwnerAlive,
      requestControlShutdownImpl: async () => {
        controlCalled = true;
        // Simulate launcher cleanup: kill owned tree, release listeners, release own lease.
        await terminateOwnedProcessTree(owned, { platform: process.platform });
        await listeners.closeAll();
        listeners = null;
        const released = releaseRuntimeLease(handle);
        assert.equal(released.released, true);
        return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
      },
      completionTimeoutMs: 8000,
    });

    assert.equal(controlCalled, true);
    assert.equal(outcome.result, CLOSED_RESULTS.STOP_COMPLETED);
    await waitForDeath(owned.pid);
    assert.equal(isAlive(owned.pid), false);
    const free = await checkCanonicalListenersFree(canonicalPorts);
    assert.equal(free.free, true);
    assert.equal(leaseExists(handle.leasePath), false);
    assert.equal(outcome.detail?.leaseMissing, true);
    assert.equal(outcome.detail?.ownerAlive, false);
    assert.equal(outcome.detail?.listenersFree, true);
  } finally {
    try {
      if (owned.pid && isAlive(owned.pid)) {
        await terminateOwnedProcessTree(owned, { platform: process.platform }).catch(() => {});
      }
    } catch {}
    if (listeners) await listeners.closeAll().catch(() => {});
    removeTempDir(directory);
  }
});

// 2. Windows owned child tree death proof (bounded polling, foreign preserved).
test('2. owned child tree death is proven, foreign preserved', { timeout: 20000 }, async () => {
  const owned = spawnLongLived();
  const foreign = spawnLongLived();
  try {
    await waitForAlive(owned.pid);
    await waitForAlive(foreign.pid);
    await terminateOwnedProcessTree(owned, { platform: process.platform });
    // Windows taskkill is async: bounded polling proves death.
    await waitForDeath(owned.pid);
    assert.equal(isAlive(owned.pid), false);
    assert.equal(isAlive(foreign.pid), true);
  } finally {
    try {
      if (isAlive(foreign.pid)) {
        await terminateOwnedProcessTree(foreign, { platform: process.platform }).catch(() => {});
      }
    } catch {}
    try {
      if (isAlive(owned.pid)) {
        if (process.platform === 'win32') {
          await terminateOwnedProcessTree(owned, { platform: process.platform }).catch(() => {});
        } else {
          try { process.kill(owned.pid, 'SIGKILL'); } catch {}
        }
      }
    } catch {}
  }
});

// 3. listener occupied -> free.
test('3. canonical listener occupied transitions to free', async () => {
  const canonicalPorts = await allocFreePorts(2);
  const listeners = await startListeners(canonicalPorts);
  try {
    const occupied = await checkCanonicalListenersFree(canonicalPorts);
    assert.equal(occupied.free, false);
    assert.deepEqual([...occupied.occupied].sort((a, b) => a - b), [...canonicalPorts].sort((a, b) => a - b));
  } finally {
    await listeners.closeAll();
  }
  const free = await checkCanonicalListenersFree(canonicalPorts);
  assert.equal(free.free, true);
  assert.deepEqual(free.occupied, []);
});

// 4. own lease release (leaseId-guarded unlink only).
test('4. own lease release removes own leaseId only', () => {
  const directory = makeTempDir();
  try {
    const owner = acquireRuntimeLease({ directory, ownerPid: process.pid, leaseId: 'own-04', checkoutPath: 'C:\\fake' });
    const foreignAttempt = releaseRuntimeLease({ leasePath: owner.leasePath, leaseId: 'forged-04' });
    assert.equal(foreignAttempt.released, false);
    assert.equal(foreignAttempt.reason, 'not-owner');
    assert.equal(leaseExists(owner.leasePath), true);
    const released = releaseRuntimeLease(owner);
    assert.equal(released.released, true);
    assert.equal(leaseExists(owner.leasePath), false);
  } finally {
    removeTempDir(directory);
  }
});

// 5. immediate second acquisition (reuse proof after STOP_COMPLETED).
test('5. STOP_COMPLETED allows immediate second acquisition', async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(2);
  const owned = spawnLongLived();
  let listeners = null;
  try {
    await waitForAlive(owned.pid);
    const first = acquireRuntimeLease({
      directory,
      ownerPid: owned.pid,
      checkoutPath: 'C:\\fake\\reuse-05',
      leaseId: 'reuse-first-05',
    });
    const updated = updateRuntimeLeaseControl(first, { host: '127.0.0.1', port: 45778, token: 'tok-reuse-05' });
    assert.equal(updated.updated, true);
    listeners = await startListeners(canonicalPorts);
    const outcome = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: defaultIsOwnerAlive,
      requestControlShutdownImpl: async () => {
        await terminateOwnedProcessTree(owned, { platform: process.platform });
        await listeners.closeAll();
        listeners = null;
        releaseRuntimeLease(first);
        return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
      },
      completionTimeoutMs: 8000,
    });
    assert.equal(outcome.result, CLOSED_RESULTS.STOP_COMPLETED);
    await waitForDeath(owned.pid);
    // Immediate reuse in the same canonical namespace.
    const second = acquireRuntimeLease({
      directory,
      ownerPid: process.pid,
      checkoutPath: 'C:\\fake\\reuse-05-second',
      leaseId: 'reuse-second-05',
    });
    assert.equal(second.leaseId, 'reuse-second-05');
    assert.notEqual(second.leaseId, first.leaseId);
    const stored = JSON.parse(readFileSync(second.leasePath, 'utf8'));
    assert.equal(stored.leaseId, 'reuse-second-05');
  } finally {
    try {
      if (owned.pid && isAlive(owned.pid)) {
        await terminateOwnedProcessTree(owned, { platform: process.platform }).catch(() => {});
      }
    } catch {}
    if (listeners) await listeners.closeAll().catch(() => {});
    removeTempDir(directory);
  }
});

// 6. second stop -> ALREADY_STOPPED (idempotent, no control dial).
test('6. second stop after completion is ALREADY_STOPPED', async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(2);
  try {
    // No lease, listeners free.
    let controlCalled = false;
    const outcome = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: () => {
        throw new Error('liveness must not be probed without a lease');
      },
      requestControlShutdownImpl: async () => {
        controlCalled = true;
        return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
      },
    });
    assert.equal(outcome.result, CLOSED_RESULTS.ALREADY_STOPPED);
    assert.equal(controlCalled, false);
  } finally {
    removeTempDir(directory);
  }
});

// 7. foreign live process preserved (resource mismatch, no kill/delete).
test('7. foreign live process and lease are preserved', async () => {
  const directory = makeTempDir();
  const foreign = spawnLongLived();
  try {
    await waitForAlive(foreign.pid);
    const foreignHandle = acquireRuntimeLease({
      directory,
      resourceKey: 'FOREIGN_RUNTIME_STACK',
      ownerPid: foreign.pid,
      checkoutPath: 'C:\\foreign\\checkout',
      leaseId: 'foreign-live-07',
    });
    // Stop in the canonical namespace must not touch the foreign file when
    // read through the canonical resourceKey (missing), and must not touch
    // foreign when classified directly.
    const direct = classifyLeaseForStopClosed(
      { resourceKey: 'FOREIGN_RUNTIME_STACK', ownerPid: foreign.pid, leaseId: 'foreign-live-07' },
      { resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY, isOwnerAlive: () => true },
    );
    assert.equal(direct.outcome, CLOSED_RESULTS.FOREIGN_RUNTIME_PRESERVED);

    let controlCalled = false;
    const outcome = await stopLocalRuntimeClosed({
      directory,
      resourceKey: 'FOREIGN_RUNTIME_STACK',
      canonicalPorts: await allocFreePorts(1),
      isOwnerAlive: () => true,
      requestControlShutdownImpl: async () => {
        controlCalled = true;
        return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
      },
    });
    // When the caller explicitly targets the foreign namespace, classification
    // still preserves without control dial when resourceKey differs from the
    // canonical expectation? Here resourceKey matches the stored foreign key,
    // but liveness is live so it would be READY if control existed. Without
    // control metadata it fails closed as CONTROL_UNAVAILABLE, never kills.
    // The key preservation assertions hold either way.
    assert.equal(controlCalled, false);
    assert.ok(
      outcome.result === CLOSED_RESULTS.FOREIGN_RUNTIME_PRESERVED ||
        outcome.result === CLOSED_RESULTS.CONTROL_UNAVAILABLE,
    );
    assert.equal(leaseExists(foreignHandle.leasePath), true);
    const stored = JSON.parse(readFileSync(foreignHandle.leasePath, 'utf8'));
    assert.equal(stored.leaseId, 'foreign-live-07');
    assert.equal(isAlive(foreign.pid), true);

    // Canonical-namespace stop with a foreign document must preserve.
    const foreignDoc = {
      resourceKey: 'FOREIGN_RESOURCE_07',
      ownerPid: foreign.pid,
      leaseId: 'foreign-live-07',
      control: { host: '127.0.0.1', port: 45999, token: 'tok-foreign-07' },
    };
    const classified = classifyLeaseForStopClosed(foreignDoc, {
      resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY,
      isOwnerAlive: () => true,
    });
    assert.equal(classified.outcome, CLOSED_RESULTS.FOREIGN_RUNTIME_PRESERVED);
  } finally {
    try {
      if (isAlive(foreign.pid)) {
        await terminateOwnedProcessTree(foreign, { platform: process.platform }).catch(() => {});
      }
    } catch {}
    removeTempDir(directory);
  }
});

// 8. foreign namespace preserved (resource mismatch wins over stale).
test('8. foreign namespace is preserved even when owner is dead', async () => {
  const directory = makeTempDir();
  try {
    const canonicalPorts = await allocFreePorts(1);
    const foreignHandle = acquireRuntimeLease({
      directory,
      resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY,
      ownerPid: 11111,
      checkoutPath: 'C:\\foreign\\ns-08',
      leaseId: 'foreign-ns-08',
    });
    // Rewrite the stored document to a foreign namespace under the SAME file
    // name (file-per-key naming would otherwise make it a different file).
    // readRuntimeLease surfaces this as corrupt-with-foreign-document, which
    // the closed stop maps to FOREIGN preservation (no delete, no kill).
    const raw = JSON.parse(readFileSync(foreignHandle.leasePath, 'utf8'));
    raw.resourceKey = 'FOREIGN_NAMESPACE_08';
    const { writeFileSync } = await import('node:fs');
    writeFileSync(foreignHandle.leasePath, JSON.stringify(raw, null, 2), 'utf8');

    let controlCalled = false;
    const outcome = await stopLocalRuntimeClosed({
      directory,
      resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY,
      canonicalPorts,
      isOwnerAlive: () => false,
      requestControlShutdownImpl: async () => {
        controlCalled = true;
        return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
      },
    });
    assert.equal(outcome.result, CLOSED_RESULTS.FOREIGN_RUNTIME_PRESERVED);
    assert.equal(controlCalled, false);
    assert.equal(leaseExists(foreignHandle.leasePath), true);
    const stored = JSON.parse(readFileSync(foreignHandle.leasePath, 'utf8'));
    assert.equal(stored.leaseId, 'foreign-ns-08');
    assert.equal(stored.resourceKey, 'FOREIGN_NAMESPACE_08');
  } finally {
    removeTempDir(directory);
  }
});

// 9. unknown liveness preserved (no control dial, lease kept).
test('9. unknown owner liveness is preserved without control dial', async () => {
  const directory = makeTempDir();
  try {
    const canonicalPorts = await allocFreePorts(1);
    const handle = acquireRuntimeLease({
      directory,
      ownerPid: 22222,
      checkoutPath: 'C:\\fake\\unknown-09',
      leaseId: 'unknown-09',
    });
    updateRuntimeLeaseControl(handle, { host: '127.0.0.1', port: 45889, token: 'tok-unknown-09' });
    let controlCalled = false;
    const outcome = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: () => undefined,
      requestControlShutdownImpl: async () => {
        controlCalled = true;
        return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
      },
    });
    assert.equal(outcome.result, CLOSED_RESULTS.OWNER_LIVENESS_UNKNOWN);
    assert.equal(controlCalled, false);
    assert.equal(leaseExists(handle.leasePath), true);
    const stored = JSON.parse(readFileSync(handle.leasePath, 'utf8'));
    assert.equal(stored.leaseId, 'unknown-09');
  } finally {
    removeTempDir(directory);
  }
});

// 10. stale dead owner classification (preserved, no auto-delete).
test('10. stale dead owner is classified and preserved', async () => {
  const directory = makeTempDir();
  try {
    const canonicalPorts = await allocFreePorts(1);
    const handle = acquireRuntimeLease({
      directory,
      ownerPid: 33333,
      checkoutPath: 'C:\\fake\\stale-10',
      leaseId: 'stale-10',
    });
    let controlCalled = false;
    const outcome = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: () => false,
      requestControlShutdownImpl: async () => {
        controlCalled = true;
        return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
      },
    });
    assert.equal(outcome.result, CLOSED_RESULTS.STALE_LEASE);
    assert.equal(controlCalled, false);
    assert.equal(leaseExists(handle.leasePath), true);
    const stored = JSON.parse(readFileSync(handle.leasePath, 'utf8'));
    assert.equal(stored.leaseId, 'stale-10');
  } finally {
    removeTempDir(directory);
  }
});

// 11. missing lease + surviving listener -> ORPHAN_LISTENER_DETECTED.
test('11. missing lease with surviving listener is ORPHAN_LISTENER_DETECTED', async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(2);
  const listeners = await startListeners(canonicalPorts);
  try {
    let controlCalled = false;
    const outcome = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: () => {
        throw new Error('liveness must not be probed without a lease');
      },
      requestControlShutdownImpl: async () => {
        controlCalled = true;
        return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
      },
    });
    assert.equal(outcome.result, CLOSED_RESULTS.ORPHAN_LISTENER_DETECTED);
    assert.equal(controlCalled, false);
    assert.deepEqual([...outcome.detail.occupied].sort((a, b) => a - b), [...canonicalPorts].sort((a, b) => a - b));
  } finally {
    await listeners.closeAll();
    removeTempDir(directory);
  }
});

// 12. command/control failure never becomes STOP_COMPLETED.
test('12. control failure is preserved and never STOP_COMPLETED', async () => {
  const directory = makeTempDir();
  try {
    const canonicalPorts = await allocFreePorts(1);
    const handle = acquireRuntimeLease({
      directory,
      ownerPid: process.pid,
      checkoutPath: 'C:\\fake\\control-fail-12',
      leaseId: 'control-fail-12',
    });
    updateRuntimeLeaseControl(handle, { host: '127.0.0.1', port: 45991, token: 'tok-fail-12' });

    const refused = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: () => true,
      requestControlShutdownImpl: async () => ({
        ok: false,
        result: CLOSED_RESULTS.CONTROL_UNAVAILABLE,
        reason: 'control-unreachable',
      }),
    });
    assert.equal(refused.result, CLOSED_RESULTS.CONTROL_UNAVAILABLE);
    assert.equal(leaseExists(handle.leasePath), true);

    const thrown = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: () => true,
      requestControlShutdownImpl: async () => {
        throw new Error('control-request-failed');
      },
    });
    assert.equal(thrown.result, CLOSED_RESULTS.CONTROL_UNAVAILABLE);
    assert.equal(leaseExists(handle.leasePath), true);
  } finally {
    removeTempDir(directory);
  }
});

// 13. false-positive regression: unknown/missing, accepted-only, kill-only are not completion.
test('13. legacy false positives never become STOP_COMPLETED', async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(1);
  try {
    // a. leaseMissing + ownerUnknown is NOT completion even when listeners are free.
    const unknownWait = await waitForStopCompletionClosed(
      { leasePath: resolveLeaseFilePath(directory), ownerPid: 44444, ports: canonicalPorts },
      { isOwnerAlive: () => undefined, timeoutMs: 300, pollIntervalMs: 50 },
    );
    assert.equal(unknownWait.completed, false);
    assert.equal(unknownWait.leaseMissing, true);
    assert.equal(unknownWait.ownerAlive, undefined);

    // b. control accepted alone (lease present, owner alive, listeners occupied) is NOT completion.
    const owned = spawnLongLived();
    await waitForAlive(owned.pid);
    const occPorts = await allocFreePorts(1);
    const occ = await startListeners(occPorts);
    let occDirHandle;
    try {
      const occDir = makeTempDir('greenhub-stop-fp-');
      try {
        occDirHandle = acquireRuntimeLease({
          directory: occDir,
          ownerPid: owned.pid,
          checkoutPath: 'C:\\fake\\fp-13b',
          leaseId: 'fp-13b',
        });
        updateRuntimeLeaseControl(occDirHandle, { host: '127.0.0.1', port: 45992, token: 'tok-fp-13b' });
        const acceptedOnly = await stopLocalRuntimeClosed({
          directory: occDir,
          canonicalPorts: occPorts,
          isOwnerAlive: () => true,
          requestControlShutdownImpl: async () => ({ ok: true, status: 'SHUTDOWN_ACCEPTED' }),
          completionTimeoutMs: 400,
        });
        assert.notEqual(acceptedOnly.result, CLOSED_RESULTS.STOP_COMPLETED);
        assert.equal(acceptedOnly.result, CLOSED_RESULTS.CONTROL_UNAVAILABLE);
        assert.equal(leaseExists(occDirHandle.leasePath), true);
      } finally {
        removeTempDir(occDir);
      }
    } finally {
      await occ.closeAll();
      if (isAlive(owned.pid)) {
        await terminateOwnedProcessTree(owned, { platform: process.platform }).catch(() => {});
      }
    }

    // c. process death alone (lease present + listeners occupied) is NOT completion.
    const solo = spawnLongLived();
    await waitForAlive(solo.pid);
    const soloPorts = await allocFreePorts(1);
    const soloListeners = await startListeners(soloPorts);
    const soloDir = makeTempDir('greenhub-stop-fp-solo-');
    try {
      const soloHandle = acquireRuntimeLease({
        directory: soloDir,
        ownerPid: solo.pid,
        checkoutPath: 'C:\\fake\\fp-13c',
        leaseId: 'fp-13c',
      });
      await terminateOwnedProcessTree(solo, { platform: process.platform });
      await waitForDeath(solo.pid);
      const killOnly = await waitForStopCompletionClosed(
        { leasePath: soloHandle.leasePath, ownerPid: solo.pid, ports: soloPorts },
        { isOwnerAlive: () => false, timeoutMs: 400, pollIntervalMs: 50 },
      );
      // Process dead + lease present + listeners occupied => not completed.
      assert.equal(killOnly.completed, false);
      assert.equal(killOnly.leaseMissing, false);
    } finally {
      await soloListeners.closeAll().catch(() => {});
      removeTempDir(soloDir);
    }

    // d. classify distinguishes unknown / foreign / orphan shapes.
    const unknown = classifyLeaseForStopClosed(
      { resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY, ownerPid: 55555, leaseId: 'x', control: { host: '127.0.0.1', port: 1, token: 't' } },
      { isOwnerAlive: () => undefined },
    );
    const foreign = classifyLeaseForStopClosed(
      { resourceKey: 'FOREIGN_13', ownerPid: 55555, leaseId: 'x', control: { host: '127.0.0.1', port: 1, token: 't' } },
      { isOwnerAlive: () => true },
    );
    assert.equal(unknown.outcome, CLOSED_RESULTS.OWNER_LIVENESS_UNKNOWN);
    assert.equal(foreign.outcome, CLOSED_RESULTS.FOREIGN_RUNTIME_PRESERVED);
    assert.notEqual(unknown.outcome, foreign.outcome);
    const missingOrphan = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts: await (async () => {
        const p = await allocFreePorts(1);
        const l = await startListeners(p);
        // Keep listeners alive during the call by stashing globally for this subcase.
        globalThis.__fp13Listeners = l;
        return p;
      })(),
      isOwnerAlive: () => true,
    });
    assert.equal(missingOrphan.result, CLOSED_RESULTS.ORPHAN_LISTENER_DETECTED);
    await globalThis.__fp13Listeners.closeAll().catch(() => {});
  } finally {
    removeTempDir(directory);
  }
});
