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
  releaseRuntimeLease,
  updateRuntimeLeaseControl,
} from './runtime-lease.mjs';
import { FIXED_PORTS, preflightPorts, terminateOwnedProcessTree } from './launcher.mjs';
import {
  CANONICAL_STOP_PORTS,
  CLOSED_RESULTS,
  checkCanonicalListenersFree,
  classifyLeaseForStopClosed,
  stopLocalRuntimeClosed,
  waitForStopCompletionClosed,
} from './stop.mjs';

function makeTempDir(prefix = 'greenhub-stop-reuse-49c-') {
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

async function waitForAlive(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (isAlive(pid)) return;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 25));
  }
  throw new Error(`PID ${pid} did not become alive within ${timeoutMs}ms`);
}

async function waitForDeath(pid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!isAlive(pid)) return;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 25));
  }
  throw new Error(`PID ${pid} did not die within ${timeoutMs}ms`);
}

function spawnLongLived() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
  });
  return child;
}

async function cleanupChild(child) {
  try {
    if (child?.pid && isAlive(child.pid)) {
      await terminateOwnedProcessTree(child, { platform: process.platform }).catch(() => {});
    }
  } catch {}
}

function assertEphemeralPorts(ports) {
  for (const port of ports) {
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, `ephemeral port expected, got ${port}`);
    assert.equal(
      FIXED_PORTS.includes(port),
      false,
      `test port ${port} must not collide with canonical FIXED_PORTS`,
    );
  }
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
  assertEphemeralPorts(ports);
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

// 49C-R0. Canonical set is never rewritten by reuse tests.
test('49C-R0. canonical production ports remain fixed', () => {
  assert.deepEqual([...CANONICAL_STOP_PORTS].sort((a, b) => a - b), [3000, 3001, 3002, 3003, 8080, 9099, 9199]);
  assert.deepEqual([...FIXED_PORTS].sort((a, b) => a - b), [3000, 3001, 3002, 3003, 8080, 9099, 9199]);
});

// 49C-R1. normal owned runtime stop: 5-way distinction couples shutdown +
// owner + lease + listeners, with real child/listener proof.
test('49C-R1. normal owned runtime stop couples all five signals', { timeout: 20000 }, async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(2);
  const owned = spawnLongLived();
  let listeners = null;
  try {
    await waitForAlive(owned.pid);
    const handle = acquireRuntimeLease({
      directory,
      ownerPid: owned.pid,
      checkoutPath: 'C:\\fake\\reuse-49c-r1',
      leaseId: 'reuse-49c-r1',
    });
    const updated = updateRuntimeLeaseControl(handle, {
      host: '127.0.0.1',
      port: 48101,
      token: 'tok-49c-r1',
    });
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
        const released = releaseRuntimeLease(handle);
        assert.equal(released.released, true);
        return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
      },
      completionTimeoutMs: 8000,
    });

    // 1. shutdown request accepted
    assert.equal(outcome.result, CLOSED_RESULTS.STOP_COMPLETED);
    assert.equal(outcome.reason, 'shutdown-accepted');
    // 2. targeted owner no longer authoritative
    assert.equal(outcome.detail?.ownerAlive, false);
    await waitForDeath(owned.pid);
    // 3. target lease gone
    assert.equal(outcome.detail?.leaseMissing, true);
    assert.equal(leaseExists(handle.leasePath), false);
    // 4. owned fixed listeners terminated
    assert.equal(outcome.detail?.listenersFree, true);
    assert.deepEqual(outcome.detail?.occupied, []);
    const free = await checkCanonicalListenersFree(canonicalPorts);
    assert.equal(free.free, true);
  } finally {
    await cleanupChild(owned);
    if (listeners) await listeners.closeAll().catch(() => {});
    removeTempDir(directory);
  }
});

// 49C-R2. ALREADY_STOPPING still requires full completion proof.
test('49C-R2. ALREADY_STOPPING converges only with full completion proof', { timeout: 20000 }, async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(2);
  const owned = spawnLongLived();
  let listeners = null;
  try {
    await waitForAlive(owned.pid);
    const handle = acquireRuntimeLease({
      directory,
      ownerPid: owned.pid,
      checkoutPath: 'C:\\fake\\reuse-49c-r2',
      leaseId: 'reuse-49c-r2',
    });
    updateRuntimeLeaseControl(handle, { host: '127.0.0.1', port: 48102, token: 'tok-49c-r2' });
    listeners = await startListeners(canonicalPorts);

    const outcome = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: defaultIsOwnerAlive,
      requestControlShutdownImpl: async () => {
        await terminateOwnedProcessTree(owned, { platform: process.platform });
        await listeners.closeAll();
        listeners = null;
        releaseRuntimeLease(handle);
        return { ok: true, status: 'ALREADY_STOPPING' };
      },
      completionTimeoutMs: 8000,
    });

    assert.equal(outcome.result, CLOSED_RESULTS.STOP_COMPLETED);
    assert.equal(outcome.reason, 'already-stopping');
    assert.equal(outcome.detail?.leaseMissing, true);
    assert.equal(outcome.detail?.ownerAlive, false);
    assert.equal(outcome.detail?.listenersFree, true);
    await waitForDeath(owned.pid);
  } finally {
    await cleanupChild(owned);
    if (listeners) await listeners.closeAll().catch(() => {});
    removeTempDir(directory);
  }
});

// 49C-R3. owner unknown: no STOPPED promotion, lease preserved, no control dial.
test('49C-R3. owner unknown never promotes to STOPPED', async () => {
  const directory = makeTempDir();
  try {
    const canonicalPorts = await allocFreePorts(1);
    const handle = acquireRuntimeLease({
      directory,
      ownerPid: 48111,
      checkoutPath: 'C:\\fake\\reuse-49c-r3',
      leaseId: 'reuse-49c-r3',
    });
    updateRuntimeLeaseControl(handle, { host: '127.0.0.1', port: 48103, token: 'tok-49c-r3' });

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
    assert.equal(outcome.reason, 'owner-unknown');
    assert.equal(controlCalled, false);
    assert.equal(leaseExists(handle.leasePath), true);

    // Completion-level: lease gone + owner unknown + listeners free is still NOT completion.
    const wait = await waitForStopCompletionClosed(
      { leasePath: handle.leasePath, ownerPid: 48111, ports: canonicalPorts },
      { isOwnerAlive: () => undefined, timeoutMs: 300, pollIntervalMs: 50 },
    );
    // Lease still present here, but even the missing-lease variant must not complete:
    // (covered by live 13a; assert the present-lease shape fails closed too)
    assert.equal(wait.completed, false);
  } finally {
    removeTempDir(directory);
  }
});

// 49C-R4. lease removed but listener remains: no STOPPED assumption.
test('49C-R4. lease gone with surviving owned listener is not STOPPED', { timeout: 20000 }, async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(1);
  const listeners = await startListeners(canonicalPorts);
  try {
    // Missing-lease shape: ORPHAN, never ALREADY_STOPPED.
    let controlCalled = false;
    const orphan = await stopLocalRuntimeClosed({
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
    assert.equal(orphan.result, CLOSED_RESULTS.ORPHAN_LISTENER_DETECTED);
    assert.equal(orphan.reason, 'orphan-listener');
    assert.equal(controlCalled, false);
    assert.deepEqual([...orphan.detail.occupied].sort(), [...canonicalPorts].sort());

    // Post-shutdown shape: control accepted, then lease gone + owner dead but
    // owned listener still alive => timeout, never STOP_COMPLETED.
    const owned = spawnLongLived();
    try {
      await waitForAlive(owned.pid);
      const ownedDir = makeTempDir('greenhub-49c-r4-owned-');
      try {
        const handle = acquireRuntimeLease({
          directory: ownedDir,
          ownerPid: owned.pid,
          checkoutPath: 'C:\\fake\\reuse-49c-r4',
          leaseId: 'reuse-49c-r4',
        });
        updateRuntimeLeaseControl(handle, { host: '127.0.0.1', port: canonicalPorts[0], token: 'tok-49c-r4' });
        const outcome = await stopLocalRuntimeClosed({
          directory: ownedDir,
          canonicalPorts,
          isOwnerAlive: (pid) => (pid === owned.pid ? true : defaultIsOwnerAlive(pid)),
          requestControlShutdownImpl: async () => ({ ok: true, status: 'SHUTDOWN_ACCEPTED' }),
          completionTimeoutMs: 500,
        });
        // Lease still present + listeners occupied => shutdown-timeout.
        assert.equal(outcome.result, CLOSED_RESULTS.CONTROL_UNAVAILABLE);
        assert.equal(outcome.reason, 'shutdown-timeout');
        assert.equal(leaseExists(handle.leasePath), true);
      } finally {
        removeTempDir(ownedDir);
      }
    } finally {
      await cleanupChild(owned);
    }

    // Owned listener was never mutated by the stop path.
    const stillOccupied = await checkCanonicalListenersFree(canonicalPorts);
    assert.equal(stillOccupied.free, false);
  } finally {
    await listeners.closeAll();
    removeTempDir(directory);
  }
});

// 49C-R5. listener closed but foreign listener exists: reuse not claimed,
// foreign never killed.
test('49C-R5. foreign listener blocks reuse claim and is preserved', { timeout: 20000 }, async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(2);
  const foreignPort = canonicalPorts[1];
  const foreignListeners = await startListeners([foreignPort]);
  const foreignChild = spawnLongLived();
  try {
    await waitForAlive(foreignChild.pid);

    // Missing-lease shape with foreign occupant: ORPHAN, not ALREADY_STOPPED.
    const orphan = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: () => {
        throw new Error('liveness must not be probed without a lease');
      },
      requestControlShutdownImpl: async () => ({ ok: true, status: 'SHUTDOWN_ACCEPTED' }),
    });
    assert.equal(orphan.result, CLOSED_RESULTS.ORPHAN_LISTENER_DETECTED);
    assert.ok(orphan.detail.occupied.includes(foreignPort));

    // Post-shutdown shape: owned side fully cleaned, foreign still occupies
    // one canonical port => completion cannot prove reuse => non-success.
    const owned = spawnLongLived();
    let ownedListeners = null;
    try {
      await waitForAlive(owned.pid);
      const ownedDir = makeTempDir('greenhub-49c-r5-owned-');
      try {
        const handle = acquireRuntimeLease({
          directory: ownedDir,
          ownerPid: owned.pid,
          checkoutPath: 'C:\\fake\\reuse-49c-r5',
          leaseId: 'reuse-49c-r5',
        });
        updateRuntimeLeaseControl(handle, { host: '127.0.0.1', port: canonicalPorts[0], token: 'tok-49c-r5' });
        ownedListeners = await startListeners([canonicalPorts[0]]);

        const outcome = await stopLocalRuntimeClosed({
          directory: ownedDir,
          canonicalPorts,
          isOwnerAlive: defaultIsOwnerAlive,
          requestControlShutdownImpl: async () => {
            // Owned cleanup only: never touches the foreign port/process.
            await terminateOwnedProcessTree(owned, { platform: process.platform });
            await ownedListeners.closeAll();
            ownedListeners = null;
            releaseRuntimeLease(handle);
            return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
          },
          completionTimeoutMs: 1200,
        });
        assert.notEqual(outcome.result, CLOSED_RESULTS.STOP_COMPLETED);
        assert.equal(outcome.result, CLOSED_RESULTS.CONTROL_UNAVAILABLE);
        assert.equal(outcome.reason, 'shutdown-timeout');
        assert.ok((outcome.detail?.occupied ?? []).includes(foreignPort));
      } finally {
        removeTempDir(ownedDir);
      }
    } finally {
      await cleanupChild(owned);
      if (ownedListeners) await ownedListeners.closeAll().catch(() => {});
    }

    // Foreign listener/process preserved (no arbitrary kill).
    assert.equal(isAlive(foreignChild.pid), true);
    const foreignStillThere = await checkCanonicalListenersFree([foreignPort]);
    assert.equal(foreignStillThere.free, false);
  } finally {
    await cleanupChild(foreignChild);
    await foreignListeners.closeAll();
    removeTempDir(directory);
  }
});

// 49C-R6. fixed-port reuse after successful stop: same canonical set re-binds.
test('49C-R6. same canonical set re-binds after STOP_COMPLETED', { timeout: 20000 }, async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(2);
  const owned = spawnLongLived();
  let listeners = null;
  try {
    await waitForAlive(owned.pid);
    const handle = acquireRuntimeLease({
      directory,
      ownerPid: owned.pid,
      checkoutPath: 'C:\\fake\\reuse-49c-r6',
      leaseId: 'reuse-49c-r6',
    });
    updateRuntimeLeaseControl(handle, { host: '127.0.0.1', port: 48106, token: 'tok-49c-r6' });
    listeners = await startListeners(canonicalPorts);

    const outcome = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: defaultIsOwnerAlive,
      requestControlShutdownImpl: async () => {
        await terminateOwnedProcessTree(owned, { platform: process.platform });
        await listeners.closeAll();
        listeners = null;
        releaseRuntimeLease(handle);
        return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
      },
      completionTimeoutMs: 8000,
    });
    assert.equal(outcome.result, CLOSED_RESULTS.STOP_COMPLETED);
    await waitForDeath(owned.pid);

    // Reuse: the exact same canonical set binds again (next launcher can listen).
    const rebound = await startListeners(canonicalPorts);
    try {
      const occupiedWhileRebound = await checkCanonicalListenersFree(canonicalPorts);
      assert.equal(occupiedWhileRebound.free, false);
    } finally {
      await rebound.closeAll();
    }
    const freeAfterClose = await checkCanonicalListenersFree(canonicalPorts);
    assert.equal(freeAfterClose.free, true);
  } finally {
    await cleanupChild(owned);
    if (listeners) await listeners.closeAll().catch(() => {});
    removeTempDir(directory);
  }
});

// 49C-R7. stale/foreign lease preservation: no delete, no kill.
test('49C-R7. stale and foreign leases are preserved', { timeout: 20000 }, async () => {
  const directory = makeTempDir();
  const foreign = spawnLongLived();
  try {
    await waitForAlive(foreign.pid);

    // Stale: owner dead, no control metadata => STALE_LEASE, file kept.
    const staleDir = makeTempDir('greenhub-49c-r7-stale-');
    try {
      const stalePorts = await allocFreePorts(1);
      const staleHandle = acquireRuntimeLease({
        directory: staleDir,
        ownerPid: 48201,
        checkoutPath: 'C:\\fake\\reuse-49c-r7-stale',
        leaseId: 'reuse-49c-r7-stale',
      });
      let controlCalled = false;
      const staleOutcome = await stopLocalRuntimeClosed({
        directory: staleDir,
        canonicalPorts: stalePorts,
        isOwnerAlive: () => false,
        requestControlShutdownImpl: async () => {
          controlCalled = true;
          return { ok: true, status: 'SHUTDOWN_ACCEPTED' };
        },
      });
      assert.equal(staleOutcome.result, CLOSED_RESULTS.STALE_LEASE);
      assert.equal(controlCalled, false);
      assert.equal(leaseExists(staleHandle.leasePath), true);
    } finally {
      removeTempDir(staleDir);
    }

    // Foreign: resource mismatch wins, file kept, live process kept.
    const foreignHandle = acquireRuntimeLease({
      directory,
      resourceKey: 'FOREIGN_RUNTIME_STACK_49C',
      ownerPid: foreign.pid,
      checkoutPath: 'C:\\foreign\\reuse-49c-r7',
      leaseId: 'foreign-49c-r7',
    });
    const direct = classifyLeaseForStopClosed(
      { resourceKey: 'FOREIGN_RUNTIME_STACK_49C', ownerPid: foreign.pid, leaseId: 'foreign-49c-r7' },
      { resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY, isOwnerAlive: () => true },
    );
    assert.equal(direct.outcome, CLOSED_RESULTS.FOREIGN_RUNTIME_PRESERVED);
    assert.equal(leaseExists(foreignHandle.leasePath), true);
    assert.equal(isAlive(foreign.pid), true);
  } finally {
    await cleanupChild(foreign);
    removeTempDir(directory);
  }
});

// 49C-R8. timeout returns non-success and preserves lease.
test('49C-R8. shutdown timeout never becomes STOP_COMPLETED', { timeout: 20000 }, async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(1);
  const owned = spawnLongLived();
  let listeners = null;
  try {
    await waitForAlive(owned.pid);
    const handle = acquireRuntimeLease({
      directory,
      ownerPid: owned.pid,
      checkoutPath: 'C:\\fake\\reuse-49c-r8',
      leaseId: 'reuse-49c-r8',
    });
    updateRuntimeLeaseControl(handle, { host: '127.0.0.1', port: 48108, token: 'tok-49c-r8' });
    listeners = await startListeners(canonicalPorts);

    // Control accepted but nothing cleans up: lease present + owner alive +
    // listeners occupied => timeout.
    const outcome = await stopLocalRuntimeClosed({
      directory,
      canonicalPorts,
      isOwnerAlive: () => true,
      requestControlShutdownImpl: async () => ({ ok: true, status: 'SHUTDOWN_ACCEPTED' }),
      completionTimeoutMs: 500,
    });
    assert.equal(outcome.result, CLOSED_RESULTS.CONTROL_UNAVAILABLE);
    assert.equal(outcome.reason, 'shutdown-timeout');
    assert.equal(leaseExists(handle.leasePath), true);
  } finally {
    await cleanupChild(owned);
    if (listeners) await listeners.closeAll().catch(() => {});
    removeTempDir(directory);
  }
});

// 49C-R9. second launcher admission after STOPPED: preflight + lease acquire.
test('49C-R9. second launcher is admitted after STOPPED', { timeout: 25000 }, async () => {
  const directory = makeTempDir();
  const canonicalPorts = await allocFreePorts(2);
  const owned = spawnLongLived();
  let listeners = null;
  try {
    await waitForAlive(owned.pid);
    const first = acquireRuntimeLease({
      directory,
      ownerPid: owned.pid,
      checkoutPath: 'C:\\fake\\reuse-49c-r9-first',
      leaseId: 'reuse-49c-r9-first',
    });
    updateRuntimeLeaseControl(first, { host: '127.0.0.1', port: 48109, token: 'tok-49c-r9' });
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

    // Launcher admission simulation: lease acquire + port preflight on the
    // same canonical set, then real bind. No launcher/lease semantics changed;
    // this test only reads their admission contract.
    const preflight = await preflightPorts(canonicalPorts);
    assert.ok(preflight.every((entry) => entry.available));

    const second = acquireRuntimeLease({
      directory,
      ownerPid: process.pid,
      checkoutPath: 'C:\\fake\\reuse-49c-r9-second',
      leaseId: 'reuse-49c-r9-second',
    });
    assert.equal(second.leaseId, 'reuse-49c-r9-second');
    const stored = JSON.parse(readFileSync(second.leasePath, 'utf8'));
    assert.equal(stored.leaseId, 'reuse-49c-r9-second');

    const rebound = await startListeners(canonicalPorts);
    await rebound.closeAll();

    releaseRuntimeLease(second);
    assert.equal(leaseExists(second.leasePath), false);
  } finally {
    await cleanupChild(owned);
    if (listeners) await listeners.closeAll().catch(() => {});
    removeTempDir(directory);
  }
});
