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
  buildOperatorArgs,
  buildOperatorInvocation,
  DEFAULT_VISIBLE_HOSTNAME,
  DEFAULT_VISIBLE_TUI_PORT,
  main,
  parseArgs,
  probeTcpPort,
} from './open-visible-tui.mjs';

const FORBIDDEN_OPERATOR_SUBCOMMANDS = ['web', 'serve', 'attach'];

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
    ['web'],
    ['serve'],
    ['attach', 'http://127.0.0.1:4096'],
    ['extra'],
  ]) {
    assert.equal(parseArgs(argv).ok, false, `${argv.join(' ')} must be rejected`);
  }

  assert.equal(parseArgs(['--help']).options.help, true);
});

test('the operator topology is one TUI pinned to the repository root on an explicit loopback port', () => {
  const args = buildOperatorArgs({ repositoryRoot: '/repo', port: 4901 });
  assert.deepEqual(args, ['/repo', '--hostname', '127.0.0.1', '--port', '4901']);
  assert.equal(DEFAULT_VISIBLE_HOSTNAME, '127.0.0.1');

  const defaults = buildOperatorArgs({ repositoryRoot: '/repo' });
  assert.deepEqual(defaults, [
    '/repo',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(DEFAULT_VISIBLE_TUI_PORT),
  ]);
});

test('WEB-UI REGRESSION GUARD: the launcher command topology contains no web subcommand', () => {
  for (const repositoryRoot of ['/repo', 'C:\\Develop\\greenhub']) {
    for (const port of [1, 4096, 4901, 65535]) {
      const args = buildOperatorArgs({ repositoryRoot, port });
      for (const forbidden of FORBIDDEN_OPERATOR_SUBCOMMANDS) {
        assert.ok(
          !args.includes(forbidden),
          `${forbidden} must never appear in the operator topology: ${args.join(' ')}`,
        );
      }
      assert.equal(
        args[0],
        repositoryRoot,
        'the first argument must be the project positional, not a subcommand',
      );
      assert.equal(args[1], '--hostname');
      assert.equal(args[2], '127.0.0.1');
      assert.equal(args[3], '--port');
    }
  }
});

test('the operator TUI invocation inherits the sanitized child environment', () => {
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
  const invocation = buildOperatorInvocation({
    opencodeBin: '/fake/opencode',
    env,
    scratchDir,
    port: 4901,
    repositoryRoot: '/repo',
    exists: () => true,
  });

  assert.equal(invocation.resolvedCommand.command, '/fake/opencode');
  assert.equal(invocation.resolvedCommand.source, 'explicit');
  assert.deepEqual(invocation.args, ['/repo', '--hostname', '127.0.0.1', '--port', '4901']);
  for (const dropped of ['GH_TOKEN', 'GITHUB_TOKEN', 'VERCEL_TOKEN', 'FIREBASE_TOKEN']) {
    assert.equal(invocation.env[dropped], undefined, `${dropped} must not reach the TUI`);
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

test('main launches exactly one operator-visible TUI process, not serve + attach', async () => {
  const stderr = createStderrRecorder();
  const children = [];
  let tuiChild = null;
  const spawnFn = (command, args, options) => {
    const child = createFakeChild();
    children.push({ command, args, options, child });
    tuiChild = child;
    return child;
  };

  const pending = main(['--port', '4901'], {
    env: { PATH: process.env.PATH, GH_TOKEN: 'gh' },
    stderr,
    spawnFn,
    repositoryRoot: '/repo',
    probePortFn: async () => false,
  });

  await waitFor(() => tuiChild !== null);
  tuiChild.exitCode = 0;
  tuiChild.emit('exit', 0);
  const code = await pending;

  assert.equal(code, 0);
  assert.equal(children.length, 1, 'exactly one operator-visible process may be spawned');
  const [tui] = children;
  assert.deepEqual(tui.args, ['/repo', '--hostname', '127.0.0.1', '--port', '4901']);
  for (const forbidden of FORBIDDEN_OPERATOR_SUBCOMMANDS) {
    assert.ok(
      !tui.args.includes(forbidden),
      `${forbidden} must never be spawned by the launcher: ${tui.args.join(' ')}`,
    );
  }
  assert.equal(tui.options.cwd, '/repo');
  assert.equal(tui.options.stdio, 'inherit');
  assert.equal(tui.options.windowsHide, false);
  assert.equal(tui.options.env.GH_TOKEN, undefined);
  assert.equal(tui.options.env.GIT_CONFIG_KEY_1, 'protocol.allow');
  assert.ok(
    tui.options.env.GH_CONFIG_DIR.startsWith(tmpdir()),
    'the empty GH config directory must live in launcher scratch',
  );
  assert.equal(
    existsSync(tui.options.env.GH_CONFIG_DIR),
    false,
    'launcher scratch must be removed after the TUI exits',
  );
  const text = stderr.writes.join('');
  assert.match(text, /http:\/\/127\.0\.0\.1:4901/);
  assert.match(text, /GREENHUB_OPENCODE_ATTACH_URL/);
});

test('main refuses to start when the loopback port is already occupied', async () => {
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
    repositoryRoot: '/repo',
    probePortFn: async () => true,
  });

  assert.equal(code, 1);
  assert.equal(children.length, 0, 'no TUI may be spawned when the port is occupied');
  assert.match(stderr.writes.join(''), /already in use/);
  assert.match(stderr.writes.join(''), /VISIBILITY_UNAVAILABLE/);
});

test('main propagates the operator TUI exit code and never spawns a second process', async () => {
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
    repositoryRoot: '/repo',
    probePortFn: async () => false,
  });

  assert.equal(code, 3);
  assert.equal(children.length, 1);
});

test('main reports a TUI process that fails to start', async () => {
  const stderr = createStderrRecorder();
  const children = [];
  const spawnFn = (command, args, options) => {
    const child = createFakeChild();
    children.push({ command, args, options, child });
    setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
    return child;
  };

  const code = await main([], {
    env: { PATH: process.env.PATH },
    stderr,
    spawnFn,
    repositoryRoot: '/repo',
    probePortFn: async () => false,
  });

  assert.equal(code, 1);
  assert.equal(children.length, 1);
  assert.match(stderr.writes.join(''), /operator TUI failed to start/);
});

test('main rejects invalid arguments and prints usage without spawning anything', async () => {
  const stderr = createStderrRecorder();
  let spawned = 0;
  const spawnFn = () => {
    spawned += 1;
    return createFakeChild();
  };

  const invalid = await main(['--port', '0'], { stderr, spawnFn });
  assert.equal(invalid, 1);
  assert.match(stderr.writes.join(''), /--port requires an integer/);

  const help = await main(['--help'], { stderr, spawnFn });
  assert.equal(help, 0);
  assert.match(stderr.writes.join(''), /session selector \(Ctrl\+X L or \/sessions\)/);
  assert.equal(spawned, 0);
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
