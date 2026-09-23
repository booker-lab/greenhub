// Focused regression proof for scripts/agent/open-visible-tui.mjs.
// Uses injected narrow process/network seams only: no real OpenCode process, no
// real server, no window, and no mutation of the Greenhub checkout.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  buildServerInvocation,
  buildTuiInvocation,
  DEFAULT_VISIBLE_TUI_PORT,
  main,
  parseArgs,
  probeTcpPort,
  waitForHealthyServer,
} from './open-visible-tui.mjs';

function createFakeChild() {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal ?? 'SIGTERM');
    child.exitCode = 0;
    child.emit('exit', 0);
    return true;
  };
  return child;
}

function createStderrRecorder() {
  const writes = [];
  return {
    writes,
    write(chunk) {
      writes.push(String(chunk));
    },
  };
}

function healthyFetch() {
  return async () => ({ ok: true, json: async () => ({ healthy: true, version: '1.18.31' }) });
}

function waitFor(predicate, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  return new Promise((resolveWait, rejectWait) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (predicate()) {
        resolveWait();
        return;
      }
      if (Date.now() >= deadline) {
        rejectWait(new Error('condition was not reached in time'));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

test('visible-tui parseArgs accepts only a bounded loopback port and a bin override', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.ok, true);
  assert.equal(defaults.options.port, DEFAULT_VISIBLE_TUI_PORT);
  assert.equal(defaults.options.opencodeBin, null);

  const custom = parseArgs(['--port', '4901', '--opencode-bin', '/opt/opencode']);
  assert.equal(custom.ok, true);
  assert.equal(custom.options.port, 4901);
  assert.equal(custom.options.opencodeBin, '/opt/opencode');

  for (const argv of [
    ['--port'],
    ['--port', '0'],
    ['--port', '70000'],
    ['--port', 'abc'],
    ['--port', '1.5'],
    ['--opencode-bin'],
    ['--hostname', '0.0.0.0'],
    ['--remote', 'http://example.com'],
    ['extra'],
  ]) {
    assert.equal(parseArgs(argv).ok, false, `${argv.join(' ')} must be rejected`);
  }

  assert.equal(parseArgs(['--help']).options.help, true);
});

test('the server invocation binds loopback and inherits the sanitized child environment', () => {
  const env = {
    PATH: 'x',
    GH_TOKEN: 'gh',
    GITHUB_TOKEN: 'github',
    VERCEL_TOKEN: 'vercel',
    FIREBASE_TOKEN: 'firebase',
    GIT_CONFIG_COUNT: '9',
    GIT_CONFIG_KEY_1: 'attacker.injected',
  };
  const scratchDir = join(tmpdir(), 'greenhub-visible-tui-spec-scratch');
  const invocation = buildServerInvocation({
    opencodeBin: '/fake/opencode',
    env,
    scratchDir,
    port: 4901,
    exists: () => true,
  });

  assert.equal(invocation.resolvedCommand.command, '/fake/opencode');
  assert.equal(invocation.resolvedCommand.source, 'explicit');
  assert.deepEqual(invocation.args, ['serve', '--hostname', '127.0.0.1', '--port', '4901']);
  for (const dropped of ['GH_TOKEN', 'GITHUB_TOKEN', 'VERCEL_TOKEN', 'FIREBASE_TOKEN']) {
    assert.equal(invocation.env[dropped], undefined, `${dropped} must not reach the server`);
  }
  assert.equal(
    invocation.env.GIT_CONFIG_COUNT,
    '5',
    'runner-authored Git hardening replaces input',
  );
  assert.equal(invocation.env.GIT_CONFIG_KEY_1, 'protocol.allow');
  assert.notEqual(invocation.env.GIT_CONFIG_KEY_1, 'attacker.injected');
  assert.equal(invocation.env.GH_CONFIG_DIR, join(scratchDir, 'opencode-child-gh-config'));
  assert.equal(invocation.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(invocation.env.GIT_CONFIG_KEY_3, 'push.default');
  assert.equal(invocation.env.GIT_CONFIG_VALUE_3, 'nothing');
});

test('the TUI invocation attaches to the loopback origin and pins the observation directory', () => {
  const invocation = buildTuiInvocation({
    opencodeBin: '/fake/opencode',
    env: { PATH: '/usr/bin' },
    port: 4901,
    repositoryRoot: '/repo',
    exists: () => true,
  });
  assert.equal(invocation.resolvedCommand.command, '/fake/opencode');
  assert.deepEqual(invocation.args, ['attach', 'http://127.0.0.1:4901', '--dir', '/repo']);
  assert.ok(!invocation.args.includes('0.0.0.0'));
});

test('health polling resolves on the first healthy response and reports its version', async () => {
  const result = await waitForHealthyServer({
    url: 'http://127.0.0.1:4096',
    fetchFn: healthyFetch(),
    sleepFn: async () => {},
  });
  assert.deepEqual(result, { ok: true, error: null, version: '1.18.31' });
});

test('health polling retries transient refusals until the server reports healthy', async () => {
  let calls = 0;
  const result = await waitForHealthyServer({
    url: 'http://127.0.0.1:4096',
    timeoutMs: 10000,
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) throw new Error('connect ECONNREFUSED 127.0.0.1:4096');
      return { ok: true, json: async () => ({ healthy: true }) };
    },
    sleepFn: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.version, null);
  assert.equal(calls, 2);
});

test('health polling fails closed at the deadline with the last observed error', async () => {
  let calls = 0;
  const result = await waitForHealthyServer({
    url: 'http://127.0.0.1:4096',
    timeoutMs: 0,
    fetchFn: async () => {
      calls += 1;
      throw new Error('connect ECONNREFUSED 127.0.0.1:4096');
    },
    sleepFn: async () => {},
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
  assert.equal(calls, 1);
});

test('an unhealthy endpoint response is not accepted as ready', async () => {
  const result = await waitForHealthyServer({
    url: 'http://127.0.0.1:4096',
    timeoutMs: 0,
    fetchFn: async () => ({ ok: true, json: async () => ({ healthy: false }) }),
    sleepFn: async () => {},
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /did not report a healthy server/);
});

test('probeTcpPort sees a real loopback listener and clears once it stops', async () => {
  const listener = createServer();
  await new Promise((resolveListen) => listener.listen(0, '127.0.0.1', resolveListen));
  const port = listener.address().port;
  try {
    assert.equal(await probeTcpPort({ port }), true);
  } finally {
    await new Promise((resolveClose) => listener.close(resolveClose));
  }
  assert.equal(await probeTcpPort({ port }), false);
});

test('main starts the sanitized server, attaches the TUI, then stops and cleans up', async () => {
  const stderr = createStderrRecorder();
  const children = [];
  let tuiChild = null;
  const spawnFn = (command, args, options) => {
    const child = createFakeChild();
    children.push({ command, args, options, child });
    if (args[0] === 'attach') tuiChild = child;
    return child;
  };

  const pending = main(['--port', '4901'], {
    env: { PATH: process.env.PATH, GH_TOKEN: 'gh' },
    stderr,
    spawnFn,
    fetchFn: healthyFetch(),
    repositoryRoot: '/repo',
    healthTimeoutMs: 2000,
    probePortFn: async () => false,
  });

  await waitFor(() => tuiChild !== null);
  tuiChild.exitCode = 0;
  tuiChild.emit('exit', 0);
  const code = await pending;

  assert.equal(code, 0);
  assert.equal(children.length, 2);
  const [server, tui] = children;
  assert.equal(server.args[0], 'serve');
  assert.deepEqual(server.args.slice(1, 3), ['--hostname', '127.0.0.1']);
  assert.equal(server.options.env.GH_TOKEN, undefined);
  assert.equal(server.options.windowsHide, true);
  assert.deepEqual(tui.args, ['attach', 'http://127.0.0.1:4901', '--dir', '/repo']);
  assert.equal(tui.options.stdio, 'inherit');
  assert.ok(server.child.killCalls.length >= 1, 'the server must be stopped');
  assert.equal(existsSync(server.options.cwd), false, 'launcher scratch must be removed');
  const text = stderr.writes.join('');
  assert.match(text, /server ready: http:\/\/127\.0\.0\.1:4901/);
  assert.match(text, /GREENHUB_OPENCODE_ATTACH_URL/);
});

test('main reports VISIBILITY_UNAVAILABLE and never starts a TUI when the server is never healthy', async () => {
  const stderr = createStderrRecorder();
  const children = [];
  const spawnFn = (command, args, options) => {
    const child = createFakeChild();
    children.push({ command, args, options, child });
    return child;
  };

  const code = await main(['--port', '4901'], {
    env: { PATH: process.env.PATH },
    stderr,
    spawnFn,
    fetchFn: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:4901');
    },
    repositoryRoot: '/repo',
    healthTimeoutMs: 0,
    probePortFn: async () => false,
  });

  assert.equal(code, 1);
  assert.equal(children.length, 1, 'only the server may be spawned');
  assert.ok(children[0].child.killCalls.length >= 1);
  assert.equal(existsSync(children[0].options.cwd), false);
  assert.match(stderr.writes.join(''), /VISIBILITY_UNAVAILABLE/);
});

test('main refuses to attach when the loopback port is already occupied', async () => {
  const stderr = createStderrRecorder();
  const children = [];
  const spawnFn = (command, args, options) => {
    const child = createFakeChild();
    children.push({ command, args, options, child });
    return child;
  };

  const code = await main(['--port', '4096'], {
    env: { PATH: process.env.PATH },
    stderr,
    spawnFn,
    fetchFn: healthyFetch(),
    repositoryRoot: '/repo',
    healthTimeoutMs: 0,
    probePortFn: async () => true,
  });

  assert.equal(code, 1);
  assert.equal(children.length, 0, 'no server and no TUI may be spawned');
  assert.match(stderr.writes.join(''), /already in use/);
  assert.match(stderr.writes.join(''), /VISIBILITY_UNAVAILABLE/);
});

test('main reports a server that exits before becoming healthy', async () => {
  const stderr = createStderrRecorder();
  const children = [];
  const spawnFn = (command, args, options) => {
    const child = createFakeChild();
    children.push({ command, args, options, child });
    setImmediate(() => {
      child.exitCode = 3;
      child.emit('exit', 3);
    });
    return child;
  };

  const code = await main([], {
    env: { PATH: process.env.PATH },
    stderr,
    spawnFn,
    fetchFn: () => new Promise(() => {}),
    repositoryRoot: '/repo',
    healthTimeoutMs: 2000,
    probePortFn: async () => false,
  });

  assert.equal(code, 1);
  assert.equal(children.length, 1);
  assert.match(stderr.writes.join(''), /VISIBILITY_UNAVAILABLE/);
  assert.match(stderr.writes.join(''), /server exited with code 3/);
});

test('main rejects invalid arguments and prints usage without spawning anything', async () => {
  const stderr = createStderrRecorder();
  let spawned = 0;
  const code = await main(['--port', '0'], {
    stderr,
    spawnFn: () => {
      spawned += 1;
      return createFakeChild();
    },
  });
  assert.equal(code, 1);
  assert.equal(spawned, 0);
  assert.match(stderr.writes.join(''), /--port requires an integer/);
});
