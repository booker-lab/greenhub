import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';

import {
  buildChildSpecs,
  buildRuntimeEnvironment,
  ChildProcessExitError,
  checkReadinessOnce,
  createLocalRuntime,
  FIXED_PORTS,
  LOCAL_BROWSER_URLS,
  LocalRuntimeConfigurationError,
  LocalRuntimeError,
  PortCollisionError,
  parseLauncherOptions,
  ReadinessTimeoutError,
  runLocalRuntime,
  terminateOwnedProcessTree,
  waitForReadiness,
} from './launcher.mjs';

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  return child;
}

function waitForServerListening(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function spawnLongLivedProcess() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
  });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessState(pid, expected, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (isProcessAlive(pid) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`PID ${pid} 상태가 ${expected}가 되지 않았습니다.`);
}

test('동결된 포트·marker·Firebase identity를 모든 child spec에 투영한다', () => {
  const specs = buildChildSpecs({
    baseEnvironment: {
      PATH: 'test-path',
      NODE_ENV: 'development',
      PORTONE_V2_SECRET: '외부 비밀값',
      ALIGO_API_KEY: '외부 비밀값',
      KAKAO_CLIENT_SECRET: '외부 비밀값',
      GEMINI_API_KEY: '외부 비밀값',
      GOOGLE_API_KEY: '외부 비밀값',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"private_key":"외부 비밀값"}',
      FIREBASE_SERVICE_ACCOUNT_PATH: 'C:\\비밀\\firebase-adminsdk.json',
      JWT_SECRET: '외부 비밀값',
      JWT_REFRESH_SECRET: '외부 비밀값',
      NEXTAUTH_SECRET: '외부 비밀값',
      NEXT_PUBLIC_KAKAO_MAP_KEY: '외부 비밀값',
      E2E_TEST: 'true',
      E2E_TEST_SECRET: '외부 비밀값',
      CORS_ORIGIN: 'https://production.example',
      VERCEL_ENV: 'preview',
    },
    platform: 'win32',
    pnpmCommand: 'pnpm.cmd',
    firebaseCommand: 'firebase.cmd',
    repositoryRoot: 'C:\\repo',
  });

  assert.equal(specs.length, 5);
  assert.deepEqual(
    specs.map((spec) => spec.name),
    ['firebase-emulator-suite', 'api', 'consumer', 'seller-admin', 'driver'],
  );
  assert.deepEqual(
    specs.filter((spec) => spec.name !== 'firebase-emulator-suite').map((spec) => spec.env.PORT),
    ['3000', '3001', '3002', '3003'],
  );
  assert.deepEqual(specs.find((spec) => spec.name === 'consumer').args, [
    '--filter',
    'consumer',
    'dev',
    '--port',
    '3001',
  ]);
  assert.deepEqual(specs.find((spec) => spec.name === 'seller-admin').args, [
    '--filter',
    'seller',
    'dev',
    '--port',
    '3002',
  ]);

  for (const spec of specs) {
    assert.equal(spec.env.GREENHUB_LOCAL_RUNTIME, 'true');
    assert.equal(spec.env.NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME, 'true');
    assert.equal(spec.env.NODE_ENV, 'development');
    assert.equal(spec.env.GREENHUB_SCHEDULES_ENABLED, 'false');
    assert.equal(
      spec.env.CORS_ORIGIN,
      'http://localhost:3001,http://localhost:3002,http://localhost:3003',
    );
    assert.equal(spec.env.FIREBASE_PROJECT_ID, 'greenhub-local');
    assert.equal(spec.env.FIREBASE_STORAGE_BUCKET, 'greenhub-local.appspot.com');
    assert.equal(spec.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
    assert.equal(spec.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
    assert.equal(spec.env.STORAGE_EMULATOR_HOST, '127.0.0.1:9199');
    assert.equal(
      spec.env.GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY,
      'DENY_ALL_EXTERNAL_PROVIDER_DISPATCH',
    );
    assert.equal(spec.env.PORTONE_V2_SECRET, '');
    assert.equal(spec.env.ALIGO_API_KEY, '');
    assert.equal(spec.env.KAKAO_CLIENT_SECRET, '');
    assert.equal(spec.env.GEMINI_API_KEY, '');
    assert.equal(spec.env.GOOGLE_API_KEY, '');
    assert.equal(spec.env.FIREBASE_SERVICE_ACCOUNT_JSON, '');
    assert.equal(spec.env.FIREBASE_SERVICE_ACCOUNT_PATH, '');
    assert.equal(spec.env.JWT_SECRET, 'greenhub-local-jwt-secret');
    assert.equal(spec.env.JWT_REFRESH_SECRET, 'greenhub-local-jwt-refresh-secret');
    assert.equal(spec.env.NEXTAUTH_SECRET, '');
    assert.equal(spec.env.NEXT_PUBLIC_KAKAO_MAP_KEY, '');
    assert.equal(spec.env.E2E_TEST, '');
    assert.equal(spec.env.E2E_TEST_SECRET, '');
    assert.equal('VERCEL_ENV' in spec.env, false);
  }

  const appUrls = new Map([
    ['consumer', 'http://localhost:3001'],
    ['seller-admin', 'http://localhost:3002'],
    ['driver', 'http://localhost:3003'],
  ]);
  for (const spec of specs.filter((candidate) => appUrls.has(candidate.name))) {
    assert.equal(spec.env.NEXTAUTH_URL, appUrls.get(spec.name));
    assert.equal(spec.env.AUTH_URL, appUrls.get(spec.name));
  }
});

test('production marker가 있으면 local child 환경을 만들지 않고 fail-closed한다', () => {
  assert.throws(
    () => buildRuntimeEnvironment({ NODE_ENV: 'production' }),
    (error) => error instanceof LocalRuntimeConfigurationError,
  );
  assert.throws(
    () => buildRuntimeEnvironment({ VERCEL_ENV: 'production' }),
    (error) => error instanceof LocalRuntimeConfigurationError,
  );
  const environment = buildRuntimeEnvironment(
    { NODE_ENV: 'development' },
    { NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'green-e4fe3' },
  );
  assert.equal(environment.NODE_ENV, 'development');
  assert.equal(environment.FIREBASE_PROJECT_ID, 'greenhub-local');
});

test('production marker가 있으면 launcher도 child spawn 전에 fail-closed한다', async () => {
  let spawnCount = 0;
  await assert.rejects(
    runLocalRuntime({
      baseEnvironment: { NODE_ENV: 'production' },
      spawnImpl: () => {
        spawnCount += 1;
        return fakeChild(2000 + spawnCount);
      },
      signalSource: new EventEmitter(),
    }),
    (error) => error instanceof LocalRuntimeConfigurationError,
  );
  assert.equal(spawnCount, 0);
});

test('포트 충돌은 child spawn보다 먼저 실패하고 spawn을 0회로 유지한다', async () => {
  let spawnCount = 0;
  await assert.rejects(
    runLocalRuntime({
      baseEnvironment: { NODE_ENV: 'development' },
      portAvailabilityProbe: async (port) => port !== 3000,
      spawnImpl: () => {
        spawnCount += 1;
        return fakeChild(1000 + spawnCount);
      },
      signalSource: new EventEmitter(),
    }),
    (error) => error instanceof PortCollisionError && error.ports.includes(3000),
  );
  assert.equal(spawnCount, 0);
});

test('실제 점유 listener가 있으면 launcher는 child를 하나도 시작하지 않는다', async () => {
  const port = 3000;
  const server = createServer();
  let spawnCount = 0;
  await waitForServerListening(server, port);

  try {
    await assert.rejects(
      runLocalRuntime({
        ports: [port],
        baseEnvironment: { NODE_ENV: 'development' },
        spawnImpl: () => {
          spawnCount += 1;
          return fakeChild(2500 + spawnCount);
        },
        signalSource: new EventEmitter(),
      }),
      (error) => error instanceof PortCollisionError && error.ports.includes(port),
    );
    assert.equal(spawnCount, 0);
  } finally {
    await closeServer(server);
  }
});

test('readiness aggregate는 세 emulator listener와 네 HTTP 조건을 모두 확인한다', async () => {
  const probedPorts = [];
  const requestedUrls = [];
  const result = await checkReadinessOnce({
    portProbe: async (port) => {
      probedPorts.push(port);
      return true;
    },
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return {
        status: 200,
        json: async () => (url.endsWith('/health') ? { status: 'ok' } : {}),
      };
    },
  });

  assert.equal(result.ready, true);
  assert.deepEqual(
    probedPorts.sort((left, right) => left - right),
    [8080, 9099, 9199],
  );
  assert.deepEqual(requestedUrls.sort(), [
    'http://localhost:3000/health',
    'http://localhost:3001/login',
    'http://localhost:3002/login',
    'http://localhost:3003/login',
  ]);
});

test('readiness timeout은 마지막 aggregate 실패를 보존한다', async () => {
  await assert.rejects(
    waitForReadiness({
      timeoutMs: 1,
      pollIntervalMs: 0,
      portProbe: async () => false,
      fetchImpl: async () => ({ status: 503, json: async () => ({}) }),
      requestTimeoutMs: 10,
    }),
    (error) => error.name === 'ReadinessTimeoutError' && error.result.failures.length > 0,
  );
});

test('readiness failure 뒤 owned child cleanup이 실행되고 브라우저는 열지 않는다', async () => {
  const cleanedPids = [];
  let nextPid = 4500;
  let browserOpenCount = 0;

  await assert.rejects(
    runLocalRuntime({
      baseEnvironment: { NODE_ENV: 'development' },
      portAvailabilityProbe: async () => true,
      spawnImpl: () => fakeChild(nextPid++),
      readinessOptions: {
        timeoutMs: 1,
        pollIntervalMs: 0,
        portProbe: async () => false,
        fetchImpl: async () => ({ status: 503, json: async () => ({}) }),
      },
      openBrowserImpl: async () => {
        browserOpenCount += 1;
      },
      terminateProcessTree: async (child) => {
        cleanedPids.push(child.pid);
      },
      signalSource: new EventEmitter(),
      openBrowser: true,
    }),
    (error) => error instanceof ReadinessTimeoutError,
  );

  assert.equal(browserOpenCount, 0);
  assert.deepEqual(
    cleanedPids.sort((left, right) => left - right),
    [4500, 4501, 4502, 4503, 4504],
  );
});

test('브라우저 열기는 READY 로그 뒤에만 실행되고 API URL은 포함하지 않는다', async () => {
  const events = [];
  const cleanedPids = [];
  const signalSource = new EventEmitter();
  let nextPid = 4700;

  const exitCode = await runLocalRuntime({
    baseEnvironment: { NODE_ENV: 'development' },
    portAvailabilityProbe: async () => true,
    spawnImpl: () => fakeChild(nextPid++),
    readinessOptions: {
      portProbe: async () => true,
      fetchImpl: async (url) => ({
        status: 200,
        json: async () => (url.endsWith('/health') ? { status: 'ok' } : {}),
      }),
    },
    openBrowser: true,
    openBrowserImpl: async (urls) => {
      events.push({ kind: 'browser', urls });
      signalSource.emit('SIGINT');
    },
    terminateProcessTree: async (child) => {
      cleanedPids.push(child.pid);
    },
    signalSource,
    logger: {
      log: (message) => events.push({ kind: 'log', message }),
      error: () => {},
    },
  });

  assert.equal(exitCode, 130);
  assert.equal(events[0].kind, 'log');
  assert.match(events[0].message, /READY/);
  assert.equal(events[1].kind, 'browser');
  assert.deepEqual(events[1].urls, LOCAL_BROWSER_URLS);
  assert.equal(
    events[1].urls.some((url) => url.includes(':3000')),
    false,
  );
  assert.deepEqual(
    cleanedPids.sort((left, right) => left - right),
    [4700, 4701, 4702, 4703, 4704],
  );
});

test('browser 기본값은 닫혀 있고 명시적 옵션만 연다', () => {
  assert.equal(parseLauncherOptions([], {}).openBrowser, false);
  assert.equal(parseLauncherOptions(['--open-browser'], {}).openBrowser, true);
  assert.equal(
    parseLauncherOptions(['--no-browser'], { GREENHUB_OPEN_BROWSER: 'true' }).openBrowser,
    false,
  );
});

test('owned process tree cleanup은 정확한 child PID만 Windows taskkill에 전달한다', async () => {
  const calls = [];
  const child = fakeChild(4242);
  await terminateOwnedProcessTree(child, {
    platform: 'win32',
    execFileImpl: (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback(null);
    },
  });

  assert.deepEqual(calls, [
    {
      command: 'taskkill.exe',
      args: ['/PID', '4242', '/T', '/F'],
      options: { windowsHide: true },
    },
  ]);
});

test('실제 OS process cleanup은 launcher가 시작한 process만 종료하고 unrelated process는 보존한다', {
  timeout: 20000,
}, async () => {
  const owned = spawnLongLivedProcess();
  const unrelated = spawnLongLivedProcess();

  try {
    await waitForProcessState(owned.pid, true);
    await waitForProcessState(unrelated.pid, true);
    await terminateOwnedProcessTree(owned, { platform: process.platform });
    await waitForProcessState(owned.pid, false);
    assert.equal(isProcessAlive(unrelated.pid), true);
  } finally {
    await terminateOwnedProcessTree(unrelated, { platform: process.platform });
    await waitForProcessState(unrelated.pid, false).catch(() => {});
  }
});

test('startup failure 뒤 launcher가 시작한 child 전부를 정리하고 unrelated PID를 건드리지 않는다', async () => {
  const children = [];
  const cleanedPids = [];
  let spawnCount = 0;

  await assert.rejects(
    runLocalRuntime({
      baseEnvironment: { NODE_ENV: 'development' },
      portAvailabilityProbe: async () => true,
      spawnImpl: () => {
        const child = fakeChild(5000 + spawnCount);
        spawnCount += 1;
        children.push(child);
        if (spawnCount === 2) {
          setTimeout(() => child.emit('error', new Error('기동 실패')), 0);
        }
        return child;
      },
      terminateProcessTree: async (child) => {
        cleanedPids.push(child.pid);
      },
      signalSource: new EventEmitter(),
    }),
    (error) => error instanceof LocalRuntimeError || error instanceof ChildProcessExitError,
  );

  assert.equal(spawnCount, 5);
  assert.deepEqual(
    cleanedPids.sort((left, right) => left - right),
    [5000, 5001, 5002, 5003, 5004],
  );
  assert.equal(cleanedPids.includes(9999), false);
  assert.equal(children.length, 5);
});

test('owned child의 정상 코드 조기 종료도 premature termination failure로 처리한다', async () => {
  const cleanedPids = [];
  let nextPid = 5500;
  let firstChild;

  await assert.rejects(
    runLocalRuntime({
      baseEnvironment: { NODE_ENV: 'development' },
      portAvailabilityProbe: async () => true,
      spawnImpl: () => {
        const child = fakeChild(nextPid++);
        if (!firstChild) {
          firstChild = child;
          setTimeout(() => {
            child.exitCode = 0;
            child.emit('exit', 0, null);
          }, 0);
        }
        return child;
      },
      terminateProcessTree: async (child) => {
        cleanedPids.push(child.pid);
      },
      signalSource: new EventEmitter(),
    }),
    (error) => error instanceof ChildProcessExitError && error.code === 0,
  );

  assert.deepEqual(
    cleanedPids.sort((left, right) => left - right),
    [5500, 5501, 5502, 5503, 5504],
  );
});

test('interrupt 요청은 idempotent cleanup으로 수렴한다', async () => {
  const cleanedPids = [];
  let nextPid = 6000;
  const runtime = createLocalRuntime({
    baseEnvironment: { NODE_ENV: 'development' },
    platform: 'win32',
    spawnImpl: () => fakeChild(nextPid++),
    terminateProcessTree: async (child) => {
      cleanedPids.push(child.pid);
    },
  });

  runtime.start();
  runtime.requestStop(130, 'SIGINT');
  assert.deepEqual(await runtime.waitForTermination(), {
    kind: 'stop',
    exitCode: 130,
    signal: 'SIGINT',
  });
  await runtime.cleanup();
  await runtime.cleanup();

  assert.deepEqual(
    cleanedPids.sort((left, right) => left - right),
    [6000, 6001, 6002, 6003, 6004],
  );
});

test('브라우저 URL은 API 없이 세 login 화면만 가진다', () => {
  assert.deepEqual(LOCAL_BROWSER_URLS, [
    'http://localhost:3001/login',
    'http://localhost:3002/login',
    'http://localhost:3003/login',
  ]);
});

test('동결된 fixed port 집합을 축소하지 않는다', () => {
  assert.deepEqual(FIXED_PORTS, [3000, 3001, 3002, 3003, 8080, 9099, 9199]);
});
