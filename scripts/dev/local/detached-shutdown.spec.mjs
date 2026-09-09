import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  FIXED_PORTS,
  isAuthorizedShutdownRequest,
  JAVA_RUNTIME_CONTRACT,
  LOCAL_SHUTDOWN_CONTROL_HOST,
  LOCAL_SHUTDOWN_CONTROL_PATH,
  runLocalRuntime,
  startLocalShutdownControl,
} from './launcher.mjs';
import {
  acquireRuntimeLease,
  isValidShutdownControl,
  LOCAL_RUNTIME_STACK_RESOURCE_KEY,
  readRuntimeLease,
  releaseRuntimeLease,
  resolveLeaseFilePath,
  updateRuntimeLeaseControl,
} from './runtime-lease.mjs';
import {
  classifyLeaseForStop,
  requestControlShutdown,
  stopLocalRuntime,
  STOP_RESULTS,
} from './stop.mjs';

const TEST_JAVA_RUNTIME = Object.freeze({
  executable: 'C:\\Java\\21\\bin\\java.exe',
  javaHome: 'C:\\Java\\21',
  majorVersion: JAVA_RUNTIME_CONTRACT.minimumMajorVersion,
  source: 'test',
});

function makeTempDir(prefix = 'greenhub-detached-shutdown-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeTempDir(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.kill = () => true;
  return child;
}

function postShutdown({ host, port, body, timeoutMs = 3000 }) {
  const payload = JSON.stringify(body);
  return new Promise((resolveResult, rejectResult) => {
    const request = httpRequest(
      {
        host,
        port,
        path: LOCAL_SHUTDOWN_CONTROL_PATH,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), connection: 'close' },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.once('end', () => {
          resolveResult({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        });
        response.once('error', rejectResult);
      },
    );
    request.once('error', rejectResult);
    request.end(payload);
  });
}

// A. shutdown request authentication/identity
test('A. correct lease identity is accepted', async () => {
  let calls = 0;
  const control = await startLocalShutdownControl({
    expectedLeaseId: 'lease-correct',
    expectedToken: 'token-correct',
    expectedResourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY,
    onValidShutdown: () => {
      calls += 1;
      return { alreadyStopping: calls > 1 };
    },
    logger: { log: () => {}, error: () => {} },
  });
  try {
    const response = await postShutdown({
      host: '127.0.0.1',
      port: control.port,
      body: { leaseId: 'lease-correct', token: 'token-correct', resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY },
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /SHUTDOWN_ACCEPTED/);
    assert.equal(calls, 1);
  } finally {
    await control.close();
  }
});

test('A. wrong lease identity is rejected without shutdown', async () => {
  let calls = 0;
  const control = await startLocalShutdownControl({
    expectedLeaseId: 'lease-real',
    expectedToken: 'token-real',
    onValidShutdown: () => {
      calls += 1;
      return {};
    },
    logger: { log: () => {}, error: () => {} },
  });
  try {
    for (const badBody of [
      { leaseId: 'lease-forged', token: 'token-real', resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY },
      { leaseId: 'lease-real', token: 'token-forged', resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY },
      { leaseId: 'lease-real', token: 'token-real', resourceKey: 'FOREIGN_RESOURCE' },
      { leaseId: '', token: 'token-real' },
    ]) {
      const response = await postShutdown({ host: '127.0.0.1', port: control.port, body: badBody });
      assert.equal(response.statusCode, 403);
      assert.match(response.body, /LEASE_MISMATCH/);
    }
    assert.equal(calls, 0);
    assert.equal(isAuthorizedShutdownRequest({ leaseId: 'lease-real', token: 'token-real' }, { leaseId: 'lease-real', token: 'token-real' }), true);
    assert.equal(isAuthorizedShutdownRequest({ leaseId: 'wrong', token: 'token-real' }, { leaseId: 'lease-real', token: 'token-real' }), false);
  } finally {
    await control.close();
  }
});

// B. shutdown idempotency
test('B. duplicate shutdown requests do not duplicate cleanup', async () => {
  let shutdownCalls = 0;
  let stopping = false;
  const control = await startLocalShutdownControl({
    expectedLeaseId: 'lease-idem',
    expectedToken: 'token-idem',
    onValidShutdown: () => {
      const alreadyStopping = stopping;
      if (!alreadyStopping) {
        shutdownCalls += 1;
        stopping = true;
      }
      return { alreadyStopping };
    },
    logger: { log: () => {}, error: () => {} },
  });
  try {
    const first = await postShutdown({ host: '127.0.0.1', port: control.port, body: { leaseId: 'lease-idem', token: 'token-idem' } });
    const second = await postShutdown({ host: '127.0.0.1', port: control.port, body: { leaseId: 'lease-idem', token: 'token-idem' } });
    assert.match(first.body, /SHUTDOWN_ACCEPTED/);
    assert.match(second.body, /ALREADY_STOPPING/);
    assert.equal(shutdownCalls, 1);
  } finally {
    await control.close();
  }
});

test('B. launcher release path is idempotent across duplicate explicit shutdowns', async () => {
  const directory = makeTempDir();
  const signalSource = new EventEmitter();
  const cleaned = [];
  let nextPid = 9100;
  let releaseCalls = 0;
  const acquireWrapped = async (options) => acquireRuntimeLease({ ...options, directory });
  const releaseWrapped = async (handle) => {
    releaseCalls += 1;
    return releaseRuntimeLease(handle);
  };
  try {
    const runPromise = runLocalRuntime({
      leaseDirectory: directory,
      baseEnvironment: { NODE_ENV: 'development' },
      portAvailabilityProbe: async () => true,
      spawnImpl: () => fakeChild(nextPid++),
      readinessOptions: {
        portProbe: async () => true,
        fetchImpl: async (url) => ({ status: 200, json: async () => (url.endsWith('/health') ? { status: 'ok' } : {}) }),
      },
      terminateProcessTree: async (child) => {
        cleaned.push(child.pid);
      },
      acquireRuntimeLeaseImpl: acquireWrapped,
      releaseRuntimeLeaseImpl: releaseWrapped,
      generateControlToken: () => 'idem-token-01',
      signalSource,
      logger: { log: () => {}, error: () => {} },
      javaRuntime: TEST_JAVA_RUNTIME,
    });
    // Wait for lease + control metadata to appear, then issue two explicit shutdowns.
    const leasePath = resolveLeaseFilePath(directory);
    let document;
    const deadline = Date.now() + 10000;
    while (Date.now() <= deadline) {
      try {
        document = JSON.parse(readFileSync(leasePath, 'utf8'));
        if (document?.control?.port) break;
      } catch {}
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
    }
    assert.ok(document?.control?.port, 'control metadata가 lease에 기록되어야 한다');
    const [first, second] = await Promise.all([
      requestControlShutdown({
        host: '127.0.0.1',
        port: document.control.port,
        leaseId: document.leaseId,
        token: 'idem-token-01',
      }),
      requestControlShutdown({
        host: '127.0.0.1',
        port: document.control.port,
        leaseId: document.leaseId,
        token: 'idem-token-01',
      }),
    ]);
    assert.equal(first.ok, true);
    // Second concurrent shutdown may win ALREADY_STOPPING or lose the race
    // because the launcher already closed the control server after the first
    // accepted shutdown. Either way duplicate cleanup/release must not occur.
    if (second.ok) {
      assert.ok(second.status === 'SHUTDOWN_ACCEPTED' || second.status === 'ALREADY_STOPPING');
    } else {
      assert.equal(second.result, STOP_RESULTS.CONTROL_UNAVAILABLE);
    }
    const exitCode = await runPromise;
    assert.equal(exitCode, 0);
    assert.deepEqual(cleaned.sort((a, b) => a - b), [9100, 9101, 9102, 9103, 9104]);
    // releaseOwnLease nulls the handle: duplicate cleanup/release converges to one real release.
    assert.equal(releaseCalls, 1);
  } finally {
    removeTempDir(directory);
  }
});

// C. loopback-only contract
test('C. shutdown control is loopback-only', async () => {
  assert.equal(LOCAL_SHUTDOWN_CONTROL_HOST, '127.0.0.1');
  assert.throws(
    () =>
      startLocalShutdownControl({
        expectedLeaseId: 'x',
        host: '0.0.0.0',
        onValidShutdown: () => ({}),
      }),
    /loopback/,
  );
  const refused = await requestControlShutdown({ host: '0.0.0.0', port: 1, leaseId: 'x', token: 'y' });
  assert.equal(refused.ok, false);
  assert.equal(refused.result, STOP_RESULTS.CONTROL_UNAVAILABLE);

  const control = await startLocalShutdownControl({
    expectedLeaseId: 'lease-loop',
    expectedToken: 'token-loop',
    onValidShutdown: () => ({}),
    logger: { log: () => {}, error: () => {} },
  });
  try {
    const address = control.server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(control.host, '127.0.0.1');
  } finally {
    await control.close();
  }

  assert.equal(isValidShutdownControl({ host: '0.0.0.0', port: 1234, token: 't' }), false);
  assert.equal(isValidShutdownControl({ host: '127.0.0.1', port: 1234, token: 't' }), true);
  const classified = classifyLeaseForStop(
    { resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY, ownerPid: process.pid, leaseId: 'l', control: { host: '0.0.0.0', port: 1234, token: 't' } },
    { isOwnerAlive: () => true },
  );
  assert.equal(classified.outcome, STOP_RESULTS.CONTROL_UNAVAILABLE);
});

// D. stale/no-active-runtime behavior
test('D. no active runtime does not touch any process', async () => {
  const directory = makeTempDir();
  try {
    let controlCalled = false;
    const outcome = await stopLocalRuntime({
      directory,
      isOwnerAlive: () => {
        throw new Error('liveness must not be probed without a lease');
      },
      requestControlShutdownImpl: async () => {
        controlCalled = true;
        return { ok: true };
      },
    });
    assert.equal(outcome.result, STOP_RESULTS.NO_ACTIVE_RUNTIME);
    assert.equal(controlCalled, false);
  } finally {
    removeTempDir(directory);
  }
});

test('D. stale lease is reported without killing any process', async () => {
  const directory = makeTempDir();
  try {
    acquireRuntimeLease({ directory, ownerPid: 11111, leaseId: 'stale-detached', checkoutPath: 'C:\\fake\\checkout' });
    let controlCalled = false;
    const outcome = await stopLocalRuntime({
      directory,
      isOwnerAlive: () => false,
      requestControlShutdownImpl: async () => {
        controlCalled = true;
        return { ok: true };
      },
    });
    assert.equal(outcome.result, STOP_RESULTS.STALE_LEASE);
    assert.equal(controlCalled, false);
    // stale lease file is preserved for the existing reclaim contract (next start reclaims).
    const stored = JSON.parse(readFileSync(resolveLeaseFilePath(directory), 'utf8'));
    assert.equal(stored.leaseId, 'stale-detached');
  } finally {
    removeTempDir(directory);
  }
});

test('D. unknown owner liveness fails closed without control dial', async () => {
  const directory = makeTempDir();
  try {
    acquireRuntimeLease({ directory, ownerPid: 22222, leaseId: 'unknown-detached', checkoutPath: 'C:\\fake' });
    let controlCalled = false;
    const outcome = await stopLocalRuntime({
      directory,
      isOwnerAlive: () => undefined,
      requestControlShutdownImpl: async () => {
        controlCalled = true;
        return { ok: true };
      },
    });
    assert.equal(outcome.result, STOP_RESULTS.CONTROL_UNAVAILABLE);
    assert.equal(controlCalled, false);
  } finally {
    removeTempDir(directory);
  }
});

// E. lease release semantics
test('E. control metadata update requires ownership', () => {
  const directory = makeTempDir();
  try {
    const owner = acquireRuntimeLease({ directory, ownerPid: process.pid, leaseId: 'owner-e', checkoutPath: 'C:\\fake' });
    const ok = updateRuntimeLeaseControl(owner, { host: '127.0.0.1', port: 41234, token: 'tok-e' });
    assert.equal(ok.updated, true);
    const stored = JSON.parse(readFileSync(owner.leasePath, 'utf8'));
    assert.deepEqual(stored.control, { host: '127.0.0.1', port: 41234, token: 'tok-e' });
    assert.equal(stored.leaseId, 'owner-e');

    const forged = updateRuntimeLeaseControl(
      { leasePath: owner.leasePath, leaseId: 'forged-id', resourceKey: LOCAL_RUNTIME_STACK_RESOURCE_KEY },
      { host: '127.0.0.1', port: 45678, token: 'tok-forged' },
    );
    assert.equal(forged.updated, false);
    assert.equal(forged.reason, 'not-owner');
    const preserved = JSON.parse(readFileSync(owner.leasePath, 'utf8'));
    assert.equal(preserved.leaseId, 'owner-e');
    assert.deepEqual(preserved.control, { host: '127.0.0.1', port: 41234, token: 'tok-e' });

    const wrongRelease = releaseRuntimeLease({ leasePath: owner.leasePath, leaseId: 'forged-id' });
    assert.equal(wrongRelease.released, false);
    assert.equal(wrongRelease.reason, 'not-owner');
    const stillThere = JSON.parse(readFileSync(owner.leasePath, 'utf8'));
    assert.equal(stillThere.leaseId, 'owner-e');

    const released = releaseRuntimeLease(owner);
    assert.equal(released.released, true);
  } finally {
    removeTempDir(directory);
  }
});

test('E. explicit shutdown releases own lease without creating a stale lease', async () => {
  const directory = makeTempDir();
  const signalSource = new EventEmitter();
  let nextPid = 9300;
  try {
    const runPromise = runLocalRuntime({
      leaseDirectory: directory,
      baseEnvironment: { NODE_ENV: 'development' },
      portAvailabilityProbe: async () => true,
      spawnImpl: () => fakeChild(nextPid++),
      readinessOptions: {
        portProbe: async () => true,
        fetchImpl: async (url) => ({ status: 200, json: async () => (url.endsWith('/health') ? { status: 'ok' } : {}) }),
      },
      terminateProcessTree: async () => {},
      generateControlToken: () => 'release-token-e',
      signalSource,
      logger: { log: () => {}, error: () => {} },
      javaRuntime: TEST_JAVA_RUNTIME,
    });
    const leasePath = resolveLeaseFilePath(directory);
    let document;
    const deadline = Date.now() + 10000;
    while (Date.now() <= deadline) {
      try {
        document = JSON.parse(readFileSync(leasePath, 'utf8'));
        if (document?.control?.port) break;
      } catch {}
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
    }
    assert.ok(document?.control?.port);
    const requested = await requestControlShutdown({
      host: '127.0.0.1',
      port: document.control.port,
      leaseId: document.leaseId,
      token: 'release-token-e',
    });
    assert.equal(requested.ok, true);
    const exitCode = await runPromise;
    assert.equal(exitCode, 0);
    const read = readRuntimeLease({ directory });
    assert.equal(read.state, 'missing');
    assert.deepEqual([...FIXED_PORTS].sort((a, b) => a - b), [3000, 3001, 3002, 3003, 8080, 9099, 9199]);
  } finally {
    removeTempDir(directory);
  }
});

// F. signal handler and explicit shutdown share one cleanup path
test('F. SIGINT and explicit shutdown converge on requestShutdown + cleanup/release', async () => {
  async function runOnce({ via }) {
    const directory = makeTempDir();
    const signalSource = new EventEmitter();
    const cleaned = [];
    let nextPid = 9400;
    try {
      let controlPort = 0;
      let controlLeaseId = '';
      let controlToken = '';
      const runPromise = runLocalRuntime({
        leaseDirectory: directory,
        baseEnvironment: { NODE_ENV: 'development' },
        portAvailabilityProbe: async () => true,
        spawnImpl: () => fakeChild(nextPid++),
        readinessOptions: {
          portProbe: async () => true,
          fetchImpl: async (url) => ({ status: 200, json: async () => (url.endsWith('/health') ? { status: 'ok' } : {}) }),
        },
        terminateProcessTree: async (child) => {
          cleaned.push(child.pid);
        },
        openBrowserImpl: async () => {
          if (via === 'signal') signalSource.emit('SIGINT');
        },
        openBrowser: via === 'signal',
        generateControlToken: () => `token-f-${via}`,
        signalSource,
        logger: { log: () => {}, error: () => {} },
        javaRuntime: TEST_JAVA_RUNTIME,
      });
      if (via === 'explicit') {
        const leasePath = resolveLeaseFilePath(directory);
        const deadline = Date.now() + 10000;
        while (Date.now() <= deadline) {
          try {
            const document = JSON.parse(readFileSync(leasePath, 'utf8'));
            if (document?.control?.port) {
              controlPort = document.control.port;
              controlLeaseId = document.leaseId;
              controlToken = document.control.token;
              break;
            }
          } catch {}
          await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
        }
        assert.ok(controlPort);
        const requested = await requestControlShutdown({
          host: '127.0.0.1',
          port: controlPort,
          leaseId: controlLeaseId,
          token: controlToken,
        });
        assert.equal(requested.ok, true);
      }
      const exitCode = await runPromise;
      const leaseGone = readRuntimeLease({ directory }).state === 'missing';
      return { exitCode, cleaned: [...cleaned].sort((a, b) => a - b), leaseGone };
    } finally {
      removeTempDir(directory);
    }
  }

  const viaSignal = await runOnce({ via: 'signal' });
  assert.equal(viaSignal.exitCode, 130);
  assert.deepEqual(viaSignal.cleaned, [9400, 9401, 9402, 9403, 9404]);
  assert.equal(viaSignal.leaseGone, true);

  const viaExplicit = await runOnce({ via: 'explicit' });
  assert.equal(viaExplicit.exitCode, 0);
  assert.deepEqual(viaExplicit.cleaned, [9400, 9401, 9402, 9403, 9404]);
  assert.equal(viaExplicit.leaseGone, true);
});
