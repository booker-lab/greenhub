// Focused deterministic proof for scripts/agent/run-night.mjs (N1-N13).
//
// In-process coverage uses the explicit `invokeBuild` / `readLiveMain` /
// `signalSource` seams of `runNight`; no real OpenCode, no GitHub, and no
// mutation of the Greenhub checkout. N7/N8 additionally run the real
// `run-night.mjs` CLI as a real child process, driving the real `run-build.mjs`
// and a deterministic fake OpenCode executable, and deliver a real console
// Ctrl+C on Windows (AttachConsole + GenerateConsoleCtrlEvent) or a real
// SIGINT on POSIX. N13 proves the existing VISIBLE_TUI attachment contract
// survives the whole real chain against a real loopback TUI server.
//
// The real operator TUI (`open-visible-tui.mjs` with the interactive OpenCode
// client) is an operator-observed Windows run; see the GA-06 N13 evidence. This
// spec proves the same attachment mechanics deterministically in CI.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALREADY_SATISFIED,
  BLOCKED_EXTERNAL,
  BUILD_CHILD_FAILED,
  defaultInvokeBuild,
  FRONTIER_COMPLETE,
  HUMAN_DECISION_REQUIRED,
  INVALID_BUILD_REQUEST,
  INVALID_NIGHT_REQUEST,
  MAX_CYCLES_REACHED,
  MAX_MINUTES_REACHED,
  NIGHT_STATUSES,
  NO_EXECUTABLE_FRONTIER,
  NO_PROGRESS,
  PROOF_FAILED,
  PUBLICATION_FAILED,
  parseArgs,
  parseBuildResultOutput,
  runNight,
  USER_STOPPED,
} from './run-night.mjs';
import { OPENCODE_ATTACH_URL_ENV } from './run-once.mjs';

const RUN_NIGHT_PATH = fileURLToPath(new URL('./run-night.mjs', import.meta.url));

// ---------------------------------------------------------------------------
// Fixture lifetime ownership (development-authority section 7.1)
// ---------------------------------------------------------------------------

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function removeTreeRobust(target) {
  const remove = () =>
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  try {
    remove();
  } catch {
    const stack = [target];
    while (stack.length > 0) {
      const current = stack.pop();
      let stats = null;
      try {
        stats = lstatSync(current);
      } catch {
        continue;
      }
      try {
        chmodSync(current, 0o700);
      } catch {
        // best-effort attribute clear; the retry below reports any real failure
      }
      if (stats.isDirectory()) {
        let entries = [];
        try {
          entries = readdirSync(current);
        } catch {
          entries = [];
        }
        for (const entry of entries) stack.push(join(current, entry));
      }
    }
    remove();
  }
}

function cleanupFixturePaths(paths, { removeTree = removeTreeRobust } = {}) {
  const errors = [];
  for (const target of paths) {
    if (target == null) continue;
    try {
      removeTree(target);
    } catch (error) {
      errors.push(`removal failed for ${target}: ${errorMessage(error)}`);
    }
    if (existsSync(target)) errors.push(`fixture path still exists: ${target}`);
  }
  return errors;
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepository(directory) {
  git(directory, ['init', '-b', 'main']);
  git(directory, ['config', 'user.email', 'run-night-spec@local']);
  git(directory, ['config', 'user.name', 'run-night-spec']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
}

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'greenhub-run-night-spec-'));
  const bare = mkdtempSync(join(tmpdir(), 'greenhub-run-night-spec-remote-'));
  const requestDir = mkdtempSync(join(tmpdir(), 'greenhub-run-night-spec-requests-'));
  const createdPaths = [root, bare, requestDir];
  try {
    git(bare, ['init', '--bare', '-b', 'main']);
    initRepository(root);
    writeFileSync(join(root, 'proof-ok.cjs'), 'process.exit(0);\n');
    for (const relative of [
      'AGENTS.md',
      'docs/README.md',
      'docs/memory.md',
      'docs/PROJECT_MAP.md',
      'docs/BACKLOG.md',
      'docs/authority.md',
      'docs/specs/ops/development-authority.md',
    ]) {
      const absolute = join(root, relative);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `fixture ${relative}\n`);
    }
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'base']);
    const baseSha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['remote', 'add', 'origin', bare]);
    git(root, ['push', '-u', 'origin', 'main']);
    return { root, bare, requestDir, baseSha };
  } catch (error) {
    try {
      git(root, ['worktree', 'prune']);
    } catch {
      // the recorded paths below are the ownership boundary, not the prune
    }
    const cleanupErrors = cleanupFixturePaths(createdPaths);
    if (error instanceof Error) {
      error.fixturePaths = [...createdPaths];
      if (cleanupErrors.length > 0) error.fixtureCleanupErrors = cleanupErrors;
    }
    throw error;
  }
}

function removeFixture(fixture, { removeTree = removeTreeRobust } = {}) {
  try {
    git(fixture.root, ['worktree', 'prune']);
  } catch {
    // prune is best-effort; the recorded paths below are the ownership boundary
  }
  const errors = cleanupFixturePaths([fixture.root, fixture.bare, fixture.requestDir], {
    removeTree,
  });
  if (errors.length > 0) {
    throw new Error(`fixture cleanup failed: ${errors.join('; ')}`);
  }
}

async function withFixture(body) {
  const fixture = buildFixture();
  let result;
  const errors = [];
  try {
    result = await body(fixture);
  } catch (error) {
    errors.push(error);
  }
  try {
    removeFixture(fixture);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, '테스트와 fixture 저장소 정리가 실패했습니다');
  return result;
}

async function withScratch(body) {
  const scratch = mkdtempSync(join(tmpdir(), 'greenhub-run-night-spec-scratch-'));
  let result;
  const failures = [];
  try {
    result = await body(scratch);
  } catch (error) {
    failures.push(error);
  }
  const errors = cleanupFixturePaths([scratch]);
  if (errors.length > 0) failures.push(new Error(errors.join('; ')));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, '테스트와 임시 디렉터리 정리가 실패했습니다');
  return result;
}

const DEFAULT_REQUEST = [
  'MODE: BUILD',
  '',
  'Fresh `origin/main` 기준으로 다음 실행 가능한 product frontier 1개를 자율적으로',
  '선택해 구현·검증·게시·정리까지 완료하고 종료하라.',
  '',
  'authority order: `docs/BACKLOG.md`, `docs/authority.md`',
  'stop: frontier 1개 완료 후 다음 frontier 선택 없이 종료',
].join('\n');

function requestFileFor(fixture, text) {
  const file = join(fixture.requestDir, `request-${Math.random().toString(16).slice(2)}.txt`);
  writeFileSync(file, text, 'utf8');
  return file;
}

function shaFor(index) {
  return index.toString(16).padStart(40, '0');
}

function syntheticCycleResult({
  status,
  reason = `${status} synthetic`,
  selected = null,
  admitted = [],
  childCalls = 1,
  prNumbers = [],
  mergeShas = [],
  startMain = null,
  endMain = null,
  escalationToken = null,
  executorModes = [],
}) {
  const attemptCount = Math.max(
    executorModes.length,
    prNumbers.length > 0 || mergeShas.length > 0 ? 1 : 0,
  );
  const attempts = [];
  for (let index = 0; index < attemptCount; index += 1) {
    attempts.push({
      taskId: `T${index + 1}`,
      child: {
        status: 'SUCCESS',
        ...(executorModes[index] === undefined ? {} : { executor: { mode: executorModes[index] } }),
        publication: {
          pr: index === 0 && prNumbers.length > 0 ? { number: prNumbers[0] } : null,
          merge: index === 0 && mergeShas.length > 0 ? { mergeSha: mergeShas[0] } : null,
        },
      },
    });
  }
  return {
    status,
    reason,
    mode: 'BUILD',
    nextFrontierSelected: false,
    observedMain: { remoteSha: startMain, fetchedSha: startMain, stable: true, observations: [] },
    decision:
      status === FRONTIER_COMPLETE
        ? {
            status: 'FRONTIER',
            reason,
            selected: { id: selected?.id ?? 'F1', kind: selected?.kind ?? 'PRODUCT' },
            escalationToken: null,
          }
        : {
            status,
            reason,
            selected: null,
            escalationToken: escalationToken ?? null,
          },
    batch: {
      admitted: admitted.map((id) => ({ id, kind: 'PRODUCT' })),
      deferred: [],
    },
    goalResult: {
      liveMain: {
        atStart: startMain === null ? null : { fetchedSha: startMain },
        atEnd: endMain === null ? null : { fetchedSha: endMain },
      },
      attempts,
    },
    childCalls,
  };
}

// ---------------------------------------------------------------------------
// In-process Night harness
// ---------------------------------------------------------------------------

function createNightHarness({ buildCycle, mains = null, requestText = DEFAULT_REQUEST }) {
  const buildCalls = [];
  const logLines = [];
  const stderrChunks = [];
  const signalSource = new EventEmitter();
  let mainIndex = 0;
  const readLiveMain = () => {
    mainIndex += 1;
    if (typeof mains === 'function') return mains(mainIndex);
    const sequence = mains ?? [];
    return sequence[Math.min(mainIndex - 1, sequence.length - 1)];
  };
  const invokeBuild = async (input) => {
    buildCalls.push(input);
    const result = buildCycle(buildCalls.length);
    const stdout = typeof result === 'string' ? result : JSON.stringify(result);
    return {
      exitCode: 0,
      signal: null,
      stdout,
      stderrBytes: 0,
      stdoutOverflow: false,
      startErrorCode: null,
      startErrorMessage: null,
    };
  };
  return {
    buildCalls,
    logLines,
    stderrChunks,
    signalSource,
    deps: {
      invokeBuild,
      readLiveMain,
      signalSource,
      log: (message) => logLines.push(String(message)),
      stderr: { write: (chunk) => stderrChunks.push(String(chunk)) },
      env: { PATH: process.env.PATH ?? '' },
    },
    requestText,
  };
}

async function runHarness(harness, options = {}) {
  return runNight(
    {
      requestText: harness.requestText,
      repositoryRoot: process.cwd(),
      remote: 'origin',
      maxCycles: 10,
      ...options,
    },
    harness.deps,
  );
}

const CYCLE_COMPLETE = (index) =>
  syntheticCycleResult({
    status: FRONTIER_COMPLETE,
    selected: { id: `F${index}` },
    admitted: [`F${index}`],
    childCalls: 1,
  });

// ---------------------------------------------------------------------------
// N1 — multi-cycle continuation on independent fresh-main contexts
// ---------------------------------------------------------------------------

test('N1 — FRONTIER_COMPLETE continues, ALREADY_SATISFIED stops, exactly three fresh-main cycles', async () => {
  const mains = [shaFor(1), shaFor(2), shaFor(2), shaFor(3), shaFor(3), shaFor(4)];
  const harness = createNightHarness({
    mains,
    buildCycle: (index) => {
      if (index === 1) {
        return syntheticCycleResult({
          status: FRONTIER_COMPLETE,
          selected: { id: 'F1' },
          admitted: ['F1'],
          childCalls: 2,
          prNumbers: [101],
          mergeShas: [shaFor(2)],
          startMain: shaFor(1),
          endMain: shaFor(2),
        });
      }
      if (index === 2) {
        return syntheticCycleResult({
          status: FRONTIER_COMPLETE,
          selected: { id: 'F2' },
          admitted: ['F2'],
          childCalls: 1,
          prNumbers: [102],
          mergeShas: [shaFor(3)],
          startMain: shaFor(2),
          endMain: shaFor(3),
        });
      }
      return syntheticCycleResult({
        status: ALREADY_SATISFIED,
        reason: 'authority is already satisfied',
        startMain: shaFor(3),
        endMain: shaFor(4),
      });
    },
  });

  const result = await runHarness(harness);

  assert.equal(result.status, ALREADY_SATISFIED);
  assert.equal(result.stopReason, `cycle 3 reached product terminal ${ALREADY_SATISFIED}`);
  assert.equal(harness.buildCalls.length, 3);
  assert.equal(result.bound.cyclesStarted, 3);
  assert.equal(result.bound.cyclesCompleted, 3);
  assert.equal(result.bound.maxCyclesReached, false);
  assert.equal(result.liveMain.atStart, shaFor(1));
  assert.equal(result.liveMain.atEnd, shaFor(4));
  assert.equal(result.childCalls, 4);
  assert.equal(result.nextFrontierSelected, false);
  assert.deepEqual(
    result.cycles.map((cycle) => cycle.status),
    [FRONTIER_COMPLETE, FRONTIER_COMPLETE, ALREADY_SATISFIED],
  );
  assert.deepEqual(
    result.cycles.map((cycle) => cycle.liveMainStart),
    [shaFor(1), shaFor(2), shaFor(3)],
  );
  assert.deepEqual(
    result.cycles.map((cycle) => cycle.liveMainEnd),
    [shaFor(2), shaFor(3), shaFor(4)],
  );
  assert.deepEqual(
    result.cycles.map((cycle) => cycle.publication.mergeShas),
    [[shaFor(2)], [shaFor(3)], []],
  );
  assert.deepEqual(result.productFrontiersCompleted, ['F1', 'F2']);
  // Every cycle received the same request and no prior-cycle selector state.
  for (const call of harness.buildCalls) {
    assert.equal(call.requestText, DEFAULT_REQUEST);
    assert.equal(call.cwd, process.cwd());
    assert.equal(call.buildScriptPath.endsWith('run-build.mjs'), true);
    assert.equal(Object.hasOwn(call, 'previousCycle'), false);
    assert.equal(Object.hasOwn(call, 'decision'), false);
  }
  const logs = harness.logLines.join('\n');
  assert.match(logs, /\[NIGHT RUN\] Ctrl\+C once = stop safely after the current BUILD cycle\./);
  assert.match(logs, /\[NIGHT RUN\] the current BUILD will not be killed mid-publication\./);
  assert.match(logs, /\[NIGHT RUN\] cycle 3\/10/);
  assert.match(logs, /\[NIGHT RUN\] starting from live main 0+3\b/);
});

// ---------------------------------------------------------------------------
// N2 — finite max-cycles bound
// ---------------------------------------------------------------------------

test('N2 — a permanently FRONTIER_COMPLETE stream stops exactly at --max-cycles', async () => {
  for (const maxCycles of [1, 4]) {
    const harness = createNightHarness({
      buildCycle: CYCLE_COMPLETE,
      mains: (index) => shaFor(index),
    });
    const result = await runHarness(harness, { maxCycles });
    assert.equal(result.status, MAX_CYCLES_REACHED, `maxCycles=${maxCycles}`);
    assert.equal(result.stopReason, 'max-cycles bound reached');
    assert.equal(harness.buildCalls.length, maxCycles);
    assert.equal(result.cycles.length, maxCycles);
    assert.equal(result.bound.maxCyclesReached, true);
    assert.equal(result.operatorStop.requested, false);
  }
});

// ---------------------------------------------------------------------------
// N3 / N4 — human-decision and external-block stops
// ---------------------------------------------------------------------------

test('N3 — HUMAN_DECISION_REQUIRED starts no further BUILD cycle', async () => {
  const harness = createNightHarness({
    buildCycle: () =>
      syntheticCycleResult({
        status: HUMAN_DECISION_REQUIRED,
        reason: 'policy fork',
        escalationToken: 'PRODUCT_POLICY_FORK',
      }),
  });
  const result = await runHarness(harness);
  assert.equal(result.status, HUMAN_DECISION_REQUIRED);
  assert.equal(harness.buildCalls.length, 1);
  assert.deepEqual(result.humanDecisionRequired, {
    cycle: 1,
    reason: 'policy fork',
    escalationToken: 'PRODUCT_POLICY_FORK',
  });
  assert.equal(result.cycles.length, 1);
});

test('N4 — BLOCKED_EXTERNAL starts no further BUILD cycle', async () => {
  const harness = createNightHarness({
    buildCycle: () =>
      syntheticCycleResult({ status: BLOCKED_EXTERNAL, reason: 'provider unavailable' }),
  });
  const result = await runHarness(harness);
  assert.equal(result.status, BLOCKED_EXTERNAL);
  assert.equal(harness.buildCalls.length, 1);
  assert.deepEqual(result.blockedExternal, { cycle: 1, reason: 'provider unavailable' });
});

// ---------------------------------------------------------------------------
// N5 — failure and unknown-terminal stops
// ---------------------------------------------------------------------------

test('N5 — proof/publication/invalid/unparseable terminals start no further cycle', async () => {
  const cases = [PROOF_FAILED, PUBLICATION_FAILED, INVALID_BUILD_REQUEST];
  for (const status of cases) {
    const harness = createNightHarness({
      buildCycle: () => syntheticCycleResult({ status, reason: `${status} synthetic` }),
    });
    const result = await runHarness(harness);
    assert.equal(result.status, status, status);
    assert.equal(harness.buildCalls.length, 1, status);
    assert.equal(result.failures.length, 1, status);
    assert.equal(result.failures[0].status, status, status);
  }

  const garbageHarness = createNightHarness({
    buildCycle: () => 'not a JSON terminal at all',
  });
  const garbage = await runHarness(garbageHarness);
  assert.equal(garbage.status, BUILD_CHILD_FAILED);
  assert.equal(garbageHarness.buildCalls.length, 1);
  assert.match(garbage.failures[0].reason, /did not produce a parseable terminal/);

  const unknownHarness = createNightHarness({
    buildCycle: () => JSON.stringify({ status: 'SOMETHING_UNKNOWN' }),
  });
  const unknown = await runHarness(unknownHarness);
  assert.equal(unknown.status, BUILD_CHILD_FAILED);
  assert.equal(unknownHarness.buildCalls.length, 1);
  assert.match(unknown.failures[0].reason, /not a declared BUILD status/);

  const startFailureHarness = createNightHarness({
    buildCycle: () => syntheticCycleResult({ status: FRONTIER_COMPLETE }),
  });
  startFailureHarness.deps.invokeBuild = async () => ({
    exitCode: null,
    signal: null,
    stdout: '',
    stderrBytes: 0,
    stdoutOverflow: false,
    startErrorCode: 'ENOENT',
    startErrorMessage: 'spawn failed',
  });
  const startFailure = await runHarness(startFailureHarness);
  assert.equal(startFailure.status, BUILD_CHILD_FAILED);
  assert.equal(startFailureHarness.buildCalls.length, 0);
  assert.match(startFailure.failures[0].reason, /failed to start/);
});

test('H1/H2 — JSON 완료 뒤 실제 자식 종료 상태도 확인하고 비정상이면 계속하지 않는다', async () => {
  const successHarness = createNightHarness({
    mains: [shaFor(1), shaFor(2), shaFor(2), shaFor(3), shaFor(3), shaFor(4)],
    buildCycle: (index) =>
      index === 1
        ? syntheticCycleResult({
            status: FRONTIER_COMPLETE,
            selected: { id: 'F1' },
            admitted: ['F1'],
            childCalls: 1,
          })
        : syntheticCycleResult({ status: ALREADY_SATISFIED }),
  });
  const success = await runHarness(successHarness);
  assert.equal(success.status, ALREADY_SATISFIED);
  assert.equal(successHarness.buildCalls.length, 2);

  for (const terminal of [
    { exitCode: 7, signal: null },
    { exitCode: null, signal: 'SIGTERM' },
  ]) {
    const failureHarness = createNightHarness({
      buildCycle: () =>
        syntheticCycleResult({
          status: FRONTIER_COMPLETE,
          selected: { id: 'F1' },
          admitted: ['F1'],
          childCalls: 1,
        }),
    });
    const invokeBuild = failureHarness.deps.invokeBuild;
    failureHarness.deps.invokeBuild = async (input) => ({
      ...(await invokeBuild(input)),
      ...terminal,
    });
    const result = await runHarness(failureHarness);
    assert.equal(result.status, BUILD_CHILD_FAILED);
    assert.equal(failureHarness.buildCalls.length, 1);
    assert.deepEqual(result.completedFrontiers, []);
    assert.match(result.failures[0].reason, /자식 프로세스가 비정상 종료되었습니다/);
  }
});

test('H3 — 완성된 성공 JSON보다 실제 프로세스 종료를 기다린다', async () => {
  const buildTerminal = JSON.stringify(
    syntheticCycleResult({
      status: FRONTIER_COMPLETE,
      selected: { id: 'F1' },
      admitted: ['F1'],
      childCalls: 1,
    }),
  );
  const source =
    `process.stdout.write(${JSON.stringify(buildTerminal)}); ` +
    'setTimeout(() => process.exit(7), 150);';
  let stdoutObserved = false;
  let settled = false;
  const completion = defaultInvokeBuild({
    buildScriptPath: '-e',
    args: [source],
    cwd: process.cwd(),
    env: process.env,
    requestText: 'MODE: BUILD\r\nunicode: 초록\r\n',
    stderr: { write() {} },
    spawnFn: (command, args, options) => {
      const child = spawn(command, args, options);
      child.stdout.once('data', () => {
        stdoutObserved = true;
      });
      return child;
    },
  }).then((result) => {
    settled = true;
    return result;
  });

  await waitFor(() => stdoutObserved, { message: '자식 성공 JSON이 출력되지 않았습니다' });
  assert.equal(settled, false);
  const result = await completion;
  assert.equal(result.exitCode, 7);
  assert.equal(result.signal, null);
  assert.equal(parseBuildResultOutput(result.stdout).ok, true);
});

test('H4/H5 — 요청 stdin의 동기·비동기 오류와 조기 닫힘을 자식 종료 뒤 회수한다', async () => {
  for (const failureKind of ['동기', '비동기', '조기닫힘']) {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    if (failureKind === '동기') {
      child.stdin.end = () => {
        throw new Error('동기 pipe 오류');
      };
    } else if (failureKind === '조기닫힘') {
      child.stdin.end = () => {
        child.stdin.emit('close');
      };
    }

    let settled = false;
    const completion = defaultInvokeBuild({
      buildScriptPath: 'fixture.mjs',
      args: [],
      cwd: process.cwd(),
      env: {},
      requestText: 'MODE: BUILD\r\n요청 ✓\r\n',
      stderr: { write() {} },
      spawnFn: () => child,
    }).then((result) => {
      settled = true;
      return result;
    });
    if (failureKind === '비동기') {
      child.stdin.emit('error', new Error('EPIPE'));
    }
    await new Promise((resolveNext) => setImmediate(resolveNext));
    assert.equal(settled, false, failureKind);
    child.emit('close', 1, null);
    const result = await completion;
    assert.equal(result.startErrorCode, 'STDIN_WRITE_FAILED', failureKind);
    assert.equal(result.exitCode, 1, failureKind);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  }
});

test('H4 — 조기 종료한 synthetic child에 성공 JSON이 있어도 다음 cycle을 시작하지 않는다', {
  timeout: 30000,
}, async () => {
  const requestText = 'x'.repeat(32 * 1024 * 1024);
  const harness = createNightHarness({ requestText, buildCycle: CYCLE_COMPLETE });
  let childInvocation = null;
  harness.deps.invokeBuild = async (input) => {
    harness.buildCalls.push(input);
    const terminal = JSON.stringify(CYCLE_COMPLETE(1));
    const source =
      `process.stdout.write(${JSON.stringify(terminal)}); ` +
      'setTimeout(() => process.exit(0), 100);';
    childInvocation = await defaultInvokeBuild({
      buildScriptPath: '-e',
      args: [source],
      cwd: input.cwd,
      env: process.env,
      requestText: input.requestText,
      stderr: { write() {} },
    });
    return childInvocation;
  };

  const result = await runHarness(harness);
  assert.equal(parseBuildResultOutput(childInvocation.stdout).ok, true);
  assert.equal(childInvocation.exitCode, 0);
  assert.equal(childInvocation.startErrorCode, 'STDIN_WRITE_FAILED');
  assert.equal(result.status, BUILD_CHILD_FAILED);
  assert.equal(harness.buildCalls.length, 1);
  assert.equal(result.cycles.length, 1);
  assert.deepEqual(result.completedFrontiers, []);
});

// ---------------------------------------------------------------------------
// N6 — Ctrl+C between cycles
// ---------------------------------------------------------------------------

test('N6 — a SIGINT between cycles stops before the next BUILD without killing anything', async () => {
  const harness = createNightHarness({
    mains: [shaFor(1), shaFor(2), shaFor(2), shaFor(3)],
    buildCycle: CYCLE_COMPLETE,
  });
  let yields = 0;
  harness.deps.yieldToSignals = async () => {
    yields += 1;
    if (yields === 2) harness.signalSource.emit('SIGINT');
  };

  const result = await runHarness(harness, { maxCycles: 5 });

  assert.equal(result.status, USER_STOPPED);
  assert.equal(harness.buildCalls.length, 1);
  assert.equal(result.bound.cyclesStarted, 1);
  assert.equal(result.operatorStop.requested, true);
  assert.equal(result.operatorStop.duringCycle, false);
  assert.equal(result.operatorStop.stoppedBeforeNextBuild, true);
  assert.equal(result.operatorStop.cyclesFinishedAfterRequest, 0);
  assert.match(harness.logLines.join('\n'), /\[NIGHT RUN\] stop requested\./);
});

// ---------------------------------------------------------------------------
// N9 — no-progress / oscillation guard
// ---------------------------------------------------------------------------

test('N9 — repeated FRONTIER_COMPLETE without live-main movement stops bounded', async () => {
  const harness = createNightHarness({
    mains: () => shaFor(7),
    buildCycle: CYCLE_COMPLETE,
  });
  const result = await runHarness(harness);
  assert.equal(result.status, NO_PROGRESS);
  assert.equal(result.progressGuard.triggered, true);
  assert.equal(result.progressGuard.kind, 'NO_MAIN_MOVEMENT');
  assert.equal(harness.buildCalls.length, 1);
  assert.equal(result.bound.cyclesCompleted, 1);
});

test('N9b — an A->B->A oscillation is detected by repeated cycle fingerprint', async () => {
  const a = shaFor(10);
  const b = shaFor(11);
  const harness = createNightHarness({
    mains: [a, b, b, a, a, b],
    buildCycle: () =>
      syntheticCycleResult({
        status: FRONTIER_COMPLETE,
        selected: { id: 'F1' },
        admitted: ['F1'],
        childCalls: 1,
      }),
  });
  const result = await runHarness(harness);
  assert.equal(result.status, NO_PROGRESS);
  assert.equal(result.progressGuard.kind, 'REPEATED_CYCLE');
  assert.equal(harness.buildCalls.length, 3);
  assert.equal(result.bound.cyclesCompleted, 3);
});

test('N9c — unknown live-main movement is treated as unproven progress', async () => {
  const harness = createNightHarness({
    buildCycle: () =>
      JSON.stringify({
        status: FRONTIER_COMPLETE,
        reason: 'progress without observed movement',
        decision: { status: 'FRONTIER', selected: { id: 'F1', kind: 'PRODUCT' } },
        batch: { admitted: [{ id: 'F1', kind: 'PRODUCT' }], deferred: [] },
        goalResult: { liveMain: { atStart: null, atEnd: null }, attempts: [] },
        childCalls: 1,
      }),
    mains: () => {
      throw new Error('live main is temporarily unobservable');
    },
  });
  const result = await runHarness(harness);
  assert.equal(result.status, NO_PROGRESS);
  assert.equal(result.progressGuard.kind, 'UNPROVEN_MAIN_MOVEMENT');
  assert.equal(harness.buildCalls.length, 1);
});

// ---------------------------------------------------------------------------
// N10 — request reuse without loss or mutation
// ---------------------------------------------------------------------------

test('N10 — the exact same request text reaches every cycle unchanged', async () => {
  const requestText = 'MODE: BUILD\r\n\r\n유니코드 ✓ line 1\r\nline 2 with trailing spaces   \r\n';
  const harness = createNightHarness({
    requestText,
    mains: [shaFor(1), shaFor(2), shaFor(2), shaFor(3), shaFor(3), shaFor(4)],
    buildCycle: (index) =>
      index <= 2
        ? syntheticCycleResult({
            status: FRONTIER_COMPLETE,
            selected: { id: `F${index}` },
            childCalls: 1,
          })
        : syntheticCycleResult({ status: ALREADY_SATISFIED }),
  });
  const result = await runHarness(harness);
  assert.equal(result.status, ALREADY_SATISFIED);
  assert.equal(harness.buildCalls.length, 3);
  for (const call of harness.buildCalls) {
    assert.equal(call.requestText, requestText);
  }
  assert.equal(result.request.source, 'inline');
  assert.equal(result.request.characters, requestText.length);
  assert.equal(result.request.reusedAcrossCycles, true);
});

// ---------------------------------------------------------------------------
// N13 — VISIBLE_TUI preservation (in-process contract)
// ---------------------------------------------------------------------------

test('N13a — an operator attach URL is explicitly preserved into every BUILD child env', async () => {
  const attach = 'http://127.0.0.1:4096';
  let probes = 0;
  const harness = createNightHarness({
    mains: [shaFor(1), shaFor(2), shaFor(2), shaFor(3)],
    buildCycle: (index) =>
      index === 1
        ? syntheticCycleResult({
            status: FRONTIER_COMPLETE,
            selected: { id: 'F1' },
            childCalls: 1,
            executorModes: ['VISIBLE_TUI'],
          })
        : syntheticCycleResult({ status: ALREADY_SATISFIED }),
  });
  harness.deps.env = { PATH: 'fake-path', [OPENCODE_ATTACH_URL_ENV]: `  ${attach}  ` };
  harness.deps.probeVisibleServer = () => {
    probes += 1;
    return { attempted: true, ok: true, error: null };
  };

  const result = await runHarness(harness);

  assert.equal(probes, 1);
  assert.equal(result.status, ALREADY_SATISFIED);
  assert.equal(result.visibility.requested, true);
  assert.equal(result.visibility.attachUrl, attach);
  assert.equal(result.visibility.health, 'HEALTHY');
  assert.equal(result.visibility.preservedToBuildChildren, true);
  assert.deepEqual(result.visibility.mutationExecutorModes, ['VISIBLE_TUI']);
  assert.equal(result.visibility.visibleTuiTasks, 1);
  assert.equal(harness.buildCalls.length, 2);
  for (const call of harness.buildCalls) {
    assert.equal(call.env[OPENCODE_ATTACH_URL_ENV], attach);
    assert.equal(call.env.PATH, 'fake-path');
  }
  assert.equal(harness.buildCalls[0].env[OPENCODE_ATTACH_URL_ENV], attach);
  assert.match(
    harness.logLines.join('\n'),
    /\[NIGHT RUN\] visible OpenCode TUI http:\/\/127\.0\.0\.1:4096 \(HEALTHY\)/,
  );
  assert.match(harness.logLines.join('\n'), /\/sessions or Ctrl\+X L/);
});

test('N13a2 — no attach URL means no visibility request and no injected env var', async () => {
  let probes = 0;
  const harness = createNightHarness({
    mains: [shaFor(1), shaFor(2)],
    buildCycle: () => syntheticCycleResult({ status: ALREADY_SATISFIED }),
  });
  harness.deps.env = { PATH: 'fake-path' };
  harness.deps.probeVisibleServer = () => {
    probes += 1;
    return { attempted: true, ok: true, error: null };
  };

  const result = await runHarness(harness);

  assert.equal(probes, 0);
  assert.equal(result.visibility.requested, false);
  assert.equal(result.visibility.attachUrl, null);
  assert.equal(result.visibility.health, 'NOT_REQUESTED');
  assert.equal(result.visibility.preservedToBuildChildren, false);
  assert.equal(harness.buildCalls.length, 1);
  assert.equal(Object.hasOwn(harness.buildCalls[0].env, OPENCODE_ATTACH_URL_ENV), false);
});

test('N13b — an invalid or unavailable attach target fails closed with no BUILD and no HEADLESS downgrade', async () => {
  const invalidHarness = createNightHarness({ buildCycle: CYCLE_COMPLETE });
  invalidHarness.deps.env = { [OPENCODE_ATTACH_URL_ENV]: 'http://example.com:4096' };
  invalidHarness.deps.probeVisibleServer = () => {
    throw new Error('an invalid attach target must not be probed');
  };
  const invalid = await runHarness(invalidHarness);
  assert.equal(invalid.status, BLOCKED_EXTERNAL);
  assert.equal(invalid.visibility.health, 'INVALID');
  assert.equal(invalid.visibility.preservedToBuildChildren, false);
  assert.equal(invalidHarness.buildCalls.length, 0);
  assert.match(invalid.stopReason, /VISIBILITY_UNAVAILABLE/);

  const downHarness = createNightHarness({ buildCycle: CYCLE_COMPLETE });
  downHarness.deps.env = { [OPENCODE_ATTACH_URL_ENV]: 'http://127.0.0.1:4096' };
  downHarness.deps.probeVisibleServer = () => ({
    attempted: true,
    ok: false,
    error: 'connect ECONNREFUSED 127.0.0.1:4096',
  });
  const down = await runHarness(downHarness);
  assert.equal(down.status, BLOCKED_EXTERNAL);
  assert.equal(down.visibility.health, 'UNAVAILABLE');
  assert.equal(down.visibility.preservedToBuildChildren, false);
  assert.equal(downHarness.buildCalls.length, 0);
  assert.match(down.stopReason, /VISIBILITY_UNAVAILABLE/);
  assert.match(down.stopReason, /never downgraded to HEADLESS/);
});

// ---------------------------------------------------------------------------
// N11 — foreign state preservation after a Night Run stop
// ---------------------------------------------------------------------------

test('N11 — canonical foreign dirty state, worktrees, and temp dirs survive untouched', async () => {
  const fixture = buildFixture();
  const foreignTemp = mkdtempSync(join(tmpdir(), 'greenhub-run-night-spec-foreign-'));
  const foreignWorktree = mkdtempSync(join(tmpdir(), 'greenhub-run-night-spec-foreign-wt-'));
  rmSync(foreignWorktree, { recursive: true, force: true });
  try {
    git(fixture.root, ['worktree', 'add', '--detach', foreignWorktree, 'HEAD']);
    writeFileSync(
      join(fixture.root, 'docs/authority.md'),
      'fixture docs/authority.md\nforeign dirty edit\n',
    );
    writeFileSync(join(fixture.root, 'foreign-untracked.txt'), 'foreign\n');
    writeFileSync(join(foreignWorktree, 'worktree-marker.txt'), 'foreign worktree\n');
    writeFileSync(join(foreignTemp, 'temp-marker.txt'), 'foreign temp\n');
    const before = git(fixture.root, ['status', '--porcelain']);
    const worktreesBefore = git(fixture.root, ['worktree', 'list']);

    const harness = createNightHarness({
      mains: [shaFor(1), shaFor(2), shaFor(2), shaFor(3)],
      buildCycle: CYCLE_COMPLETE,
    });
    let yields = 0;
    harness.deps.yieldToSignals = async () => {
      yields += 1;
      if (yields === 2) harness.signalSource.emit('SIGINT');
    };
    const result = await runHarness(harness, { maxCycles: 3 });
    assert.equal(result.status, USER_STOPPED);
    assert.equal(result.operatorStop.stoppedBeforeNextBuild, true);
    assert.equal(result.bound.cyclesStarted, 1);

    assert.equal(
      readFileSync(join(fixture.root, 'docs/authority.md'), 'utf8'),
      'fixture docs/authority.md\nforeign dirty edit\n',
    );
    assert.equal(readFileSync(join(fixture.root, 'foreign-untracked.txt'), 'utf8'), 'foreign\n');
    assert.equal(
      readFileSync(join(foreignWorktree, 'worktree-marker.txt'), 'utf8'),
      'foreign worktree\n',
    );
    assert.equal(readFileSync(join(foreignTemp, 'temp-marker.txt'), 'utf8'), 'foreign temp\n');
    assert.equal(git(fixture.root, ['status', '--porcelain']), before);
    assert.equal(git(fixture.root, ['worktree', 'list']), worktreesBefore);
  } finally {
    removeTreeRobust(foreignTemp);
    try {
      git(fixture.root, ['worktree', 'remove', '--force', foreignWorktree]);
    } catch {
      removeTreeRobust(foreignWorktree);
    }
    removeFixture(fixture);
  }
});

// ---------------------------------------------------------------------------
// N7 / N8 — real child process, real run-build, real console Ctrl+C
// ---------------------------------------------------------------------------

const FAKE_OPENCODE_SOURCE = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  'const dir = process.env.GREENHUB_NIGHT_FAKE_DIR;',
  "if (!dir) { console.error('fake opencode: GREENHUB_NIGHT_FAKE_DIR is required'); process.exit(2); }",
  'const args = process.argv.slice(2);',
  "const dirIndex = args.indexOf('--dir');",
  'const workspace = dirIndex >= 0 ? args[dirIndex + 1] : null;',
  "const startFile = path.join(dir, 'start-' + process.pid + '.json');",
  'fs.writeFileSync(startFile, JSON.stringify({ pid: process.pid, workspace, args: args.length }));',
  "process.on('SIGINT', () => {",
  "  fs.writeFileSync(path.join(dir, 'sigint-' + process.pid + '.json'), JSON.stringify({ pid: process.pid }));",
  '});',
  'const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);',
  "const proceed = path.join(dir, 'proceed');",
  'const deadline = Date.now() + 120000;',
  'while (!fs.existsSync(proceed)) {',
  "  if (Date.now() > deadline) { fs.writeFileSync(path.join(dir, 'timeout-' + process.pid), ''); process.exit(3); }",
  '  sleep(25);',
  '}',
  'const decision = {',
  '  status: "HUMAN_DECISION_REQUIRED",',
  '  reason: "night-run spec synthetic selector decision",',
  '  authority_resolved: ["docs/BACKLOG.md", "docs/authority.md"],',
  '  escalation_token: "PRODUCT_POLICY_FORK",',
  '};',
  "process.stdout.write(JSON.stringify({ type: 'text', part: { text: JSON.stringify(decision) } }) + '\\n');",
  "fs.writeFileSync(path.join(dir, 'done-' + process.pid + '.json'), JSON.stringify({ pid: process.pid }));",
  'process.exit(0);',
  '',
].join('\n');

// N13 chain: the fake OpenCode behaves as the selector (reads a valid
// deterministic decision from the events dir) and as the attached mutation
// (records `--attach`, writes the owned deliverable in `--dir`). This lets the
// real run-build -> run-goal -> run-publish-once -> run-once chain prove
// VISIBLE_TUI preservation without a real model.
const FAKE_VISIBLE_OPENCODE_SOURCE = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  'const dir = process.env.GREENHUB_NIGHT_FAKE_DIR;',
  "if (!dir) { console.error('fake opencode: GREENHUB_NIGHT_FAKE_DIR is required'); process.exit(2); }",
  'const args = process.argv.slice(2);',
  'const valueOf = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : null; };',
  'const title = valueOf("--title");',
  'const attach = valueOf("--attach");',
  'const workspace = valueOf("--dir");',
  "const marker = 'invoke-' + process.pid + '-' + Math.random().toString(16).slice(2) + '.json';",
  'fs.writeFileSync(path.join(dir, marker), JSON.stringify({ pid: process.pid, title, attach, workspace, args: args.length }));',
  'if (title !== null && title.indexOf("selector") >= 0) {',
  "  const decision = JSON.parse(fs.readFileSync(path.join(dir, 'selector-decision.json'), 'utf8'));",
  "  process.stdout.write(JSON.stringify({ type: 'text', part: { text: JSON.stringify(decision) } }) + '\\n');",
  '  process.exit(0);',
  '}',
  'if (attach === null) {',
  '  fs.writeFileSync(path.join(dir, "mutation-without-attach"), "");',
  '  process.exit(4);',
  '}',
  'process.on("SIGINT", () => fs.writeFileSync(path.join(dir, "mutation-sigint"), ""));',
  'fs.writeFileSync(path.join(dir, "mutation-ready"), "");',
  'const deadline = Date.now() + 60000;',
  'const timer = setInterval(() => {',
  '  if (!fs.existsSync(path.join(dir, "proceed"))) {',
  '    if (Date.now() > deadline) process.exit(5);',
  '    return;',
  '  }',
  '  clearInterval(timer);',
  'const writePath = process.env.GREENHUB_NIGHT_FAKE_WRITE;',
  'if (workspace !== null && writePath) {',
  '  const absolute = path.join(workspace, writePath);',
  '  fs.mkdirSync(path.dirname(absolute), { recursive: true });',
  "  fs.writeFileSync(absolute, 'delivered by the attached visible session\\n');",
  '}',
  'fs.writeFileSync(path.join(dir, "mutation-done"), "");',
  'process.exit(0);',
  '}, 25);',
  '',
].join('\n');

function createFakeNightOpencode({ source = FAKE_OPENCODE_SOURCE, writePath = null } = {}) {
  const binDir = mkdtempSync(join(tmpdir(), 'greenhub-run-night-fake-opencode-'));
  const eventsDir = mkdtempSync(join(tmpdir(), 'greenhub-run-night-fake-events-'));
  writeFileSync(join(binDir, 'fake-opencode.cjs'), source, 'utf8');
  if (process.platform === 'win32') {
    writeFileSync(
      join(binDir, 'opencode.cmd'),
      '@echo off\r\n"%~dp0\\fake-opencode.cjs" %*\r\n',
      'utf8',
    );
  } else {
    const executable = join(binDir, 'opencode');
    writeFileSync(executable, `#!/usr/bin/env node\n${source}`, 'utf8');
    chmodSync(executable, 0o755);
  }
  return {
    binDir,
    eventsDir,
    env: {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      GREENHUB_NIGHT_FAKE_DIR: eventsDir,
      ...(writePath === null ? {} : { GREENHUB_NIGHT_FAKE_WRITE: writePath }),
    },
    readEvents(prefix) {
      if (!existsSync(eventsDir)) return [];
      return readdirSync(eventsDir)
        .filter((name) => name.startsWith(prefix))
        .map((name) => JSON.parse(readFileSync(join(eventsDir, name), 'utf8')));
    },
    remove() {
      cleanupFixturePaths([binDir, eventsDir]);
    },
  };
}

// Minimal real loopback TUI-owned server stand-in: the visible preflight,
// attach, and instance disposal all talk to a real HTTP listener.
async function startFakeTuiServer() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (request.url?.startsWith('/global/health')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ healthy: true }));
      return;
    }
    if (request.url?.startsWith('/instance/dispose')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ disposed: true }));
      return;
    }
    if (request.url?.startsWith('/mcp')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{}');
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

function visibleCriterion() {
  return {
    id: 'C1',
    statement: 'docs/feature.md exists at live main',
    authority: ['docs/authority.md'],
    check: 'PATH_PRESENT',
    class: 'AUTONOMOUS',
    path: 'docs/feature.md',
  };
}

function visibleGoal() {
  return {
    GOAL: 'Close exactly one bounded product frontier at live main.',
    ACCEPTANCE_AUTHORITY: ['docs/BACKLOG.md', 'docs/authority.md'],
    PRESERVE: ['docs/authority.md'],
    AUTONOMOUSLY_ALLOWED: ['docs'],
    ESCALATE_IF: ['PRODUCT_POLICY_FORK'],
    STOP_WHEN: ['all declared criteria are satisfied or a finite terminal remains'],
    CRITERIA: [visibleCriterion()],
    TASK_CATALOG: [
      {
        id: 'T1',
        outcome: 'Create the declared deliverable inside the allowed boundary.',
        preserve: 'Unrelated files and runtime behavior.',
        closes: ['C1'],
        allow: ['docs/feature.md'],
        proof: ['node proof-ok.cjs'],
        proof_owner: [[]],
        semantic_owner: ['docs/feature.md'],
        publication: 'required',
        commit_message: 'docs: deliver the bounded outcome',
        pr_title: 'docs: deliver the bounded outcome',
        escalate_only_if: [],
        depends_on: [],
      },
    ],
    PLANNER: { enabled: false },
    BUDGET: { max_iterations: 2, max_tasks: 2 },
  };
}

function visibleSelectorDecision() {
  return {
    status: 'FRONTIER',
    reason: 'the missing deliverable is the only open product frontier',
    authority_resolved: ['docs/BACKLOG.md', 'docs/authority.md'],
    considered: [
      {
        priority: 1,
        id: 'F1',
        statement: 'docs/feature.md is missing at live main.',
        kind: 'PRODUCT',
        criteria: [visibleCriterion()],
        satisfied: false,
        reconciliation: 'IMPLEMENTATION_GAP',
      },
    ],
    selected: {
      priority: 1,
      id: 'F1',
      statement: 'docs/feature.md is missing at live main.',
      kind: 'PRODUCT',
      why_selected: 'the only considered open product frontier',
      goal: visibleGoal(),
    },
  };
}

const WINDOWS_START_WRAPPER = [
  'param(',
  '  [Parameter(Mandatory = $true)][string]$NodePath,',
  '  [Parameter(Mandatory = $true)][string]$ArgumentString,',
  '  [Parameter(Mandatory = $true)][string]$WorkingDirectory,',
  '  [Parameter(Mandatory = $true)][string]$PathValue,',
  '  [Parameter(Mandatory = $true)][string]$FakeDir,',
  '  [Parameter(Mandatory = $true)][string]$OutFile,',
  '  [Parameter(Mandatory = $true)][string]$ErrFile,',
  '  [Parameter(Mandatory = $true)][string]$PidFile,',
  '  [Parameter(Mandatory = $true)][string]$ExitFile,',
  '  [Parameter(Mandatory = $true)][string]$ExtraEnvFile',
  ')',
  '$signature = @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class NightProcessExit {',
  '  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);',
  '  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);',
  '  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);',
  '}',
  '"@',
  'Add-Type -TypeDefinition $signature',
  '$env:PATH = $PathValue',
  '$env:GREENHUB_NIGHT_FAKE_DIR = $FakeDir',
  'if (Test-Path -LiteralPath $ExtraEnvFile) {',
  '  $extra = Get-Content -LiteralPath $ExtraEnvFile -Raw | ConvertFrom-Json',
  '  foreach ($property in $extra.PSObject.Properties) {',
  '    Set-Item -Path ("env:" + $property.Name) -Value ([string]$property.Value)',
  '  }',
  '}',
  '$p = Start-Process -FilePath $NodePath -ArgumentList $ArgumentString -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile -PassThru',
  'if ($null -eq $p) { Set-Content -LiteralPath $ExitFile -Value -1; exit 1 }',
  'Set-Content -LiteralPath $PidFile -Value $p.Id',
  '$handle = [NightProcessExit]::OpenProcess((0x00100000 -bor 0x1000), $false, $p.Id)',
  '$p.WaitForExit()',
  'if ($handle -eq [IntPtr]::Zero) {',
  '  Set-Content -LiteralPath $ExitFile -Value -1',
  '} else {',
  '  $code = 0',
  '  [NightProcessExit]::GetExitCodeProcess($handle, [ref]$code) | Out-Null',
  '  [NightProcessExit]::CloseHandle($handle) | Out-Null',
  '  Set-Content -LiteralPath $ExitFile -Value $code',
  '}',
  '',
].join('\n');

const WINDOWS_SEND_CTRL_C = [
  'param([Parameter(Mandatory = $true)][int]$TargetPid)',
  '$signature = @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class NightConsoleCtrl {',
  '  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();',
  '  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint dwProcessId);',
  '  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);',
  '  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);',
  '}',
  '"@',
  'Add-Type -TypeDefinition $signature',
  '# The helper must survive the console event it generates for the target.',
  '[NightConsoleCtrl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null',
  '[NightConsoleCtrl]::FreeConsole() | Out-Null',
  '$attached = $false',
  'for ($i = 0; $i -lt 40; $i++) {',
  '  if ([NightConsoleCtrl]::AttachConsole([uint32]$TargetPid)) { $attached = $true; break }',
  '  Start-Sleep -Milliseconds 100',
  '}',
  'if (-not $attached) { Write-Output "ATTACH_FAILED"; exit 2 }',
  'if (-not [NightConsoleCtrl]::GenerateConsoleCtrlEvent(0, 0)) { Write-Output "CTRL_C_FAILED"; exit 2 }',
  'Start-Sleep -Milliseconds 300',
  '[NightConsoleCtrl]::FreeConsole() | Out-Null',
  'Write-Output "CTRL_C_SENT"',
  'exit 0',
  '',
].join('\n');

function quoteForStartProcess(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function spawnPowerShell(scriptPath, args, { timeoutMs = 30000 } = {}) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs },
  );
}

async function waitFor(predicate, { timeoutMs = 60000, intervalMs = 50, message }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(message ?? 'timed out waiting for condition');
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
}

function startRealNight({
  scratch,
  fixture,
  fake,
  requestText = DEFAULT_REQUEST,
  maxCycles = 5,
  extraEnv = {},
}) {
  const requestFile = requestFileFor(fixture, requestText);
  const baseArgs = [
    RUN_NIGHT_PATH,
    '--request',
    requestFile,
    '--repo',
    fixture.root,
    '--remote',
    'origin',
    '--max-cycles',
    String(maxCycles),
  ];
  if (process.platform === 'win32') {
    const outFile = join(scratch, 'night-out.json');
    const errFile = join(scratch, 'night-err.log');
    const pidFile = join(scratch, 'night-pid.txt');
    const exitFile = join(scratch, 'night-exit.txt');
    const helperPath = join(scratch, 'send-ctrlc.ps1');
    const wrapperPath = join(scratch, 'start-night.ps1');
    const extraEnvFile = join(scratch, 'extra-env.json');
    writeFileSync(wrapperPath, WINDOWS_START_WRAPPER, 'utf8');
    writeFileSync(helperPath, WINDOWS_SEND_CTRL_C, 'utf8');
    writeFileSync(extraEnvFile, JSON.stringify(extraEnv), 'utf8');
    const argumentString = baseArgs.map(quoteForStartProcess).join(' ');
    const wrapper = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        wrapperPath,
        '-NodePath',
        process.execPath,
        '-ArgumentString',
        argumentString,
        '-WorkingDirectory',
        fixture.root,
        '-PathValue',
        fake.env.PATH,
        '-FakeDir',
        fake.eventsDir,
        '-OutFile',
        outFile,
        '-ErrFile',
        errFile,
        '-PidFile',
        pidFile,
        '-ExitFile',
        exitFile,
        '-ExtraEnvFile',
        extraEnvFile,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    const readPid = () => {
      if (!existsSync(pidFile)) return null;
      const value = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      return Number.isInteger(value) && value > 0 ? value : null;
    };
    return {
      kind: 'windows',
      async sendStop() {
        const pid = await waitFor(readPid, {
          timeoutMs: 30000,
          message: 'Night Run pid was never published',
        });
        const output = spawnPowerShell(helperPath, ['-TargetPid', String(pid)]);
        assert.match(output, /CTRL_C_SENT/, `console Ctrl+C was not delivered: ${output}`);
      },
      async hasExited() {
        return existsSync(exitFile);
      },
      async waitForExit({ timeoutMs = 120000 } = {}) {
        await waitFor(() => existsSync(exitFile), {
          timeoutMs,
          message: 'timed out waiting for Night Run exit',
        });
        return {
          code: Number.parseInt(readFileSync(exitFile, 'utf8').trim(), 10),
          stdout: readFileSync(outFile, 'utf8'),
          stderr: readFileSync(errFile, 'utf8'),
        };
      },
      cleanup() {
        const pid = readPid();
        if (pid !== null) {
          try {
            execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
              stdio: 'ignore',
              timeout: 10000,
            });
          } catch {
            // best-effort test cleanup only
          }
        }
        try {
          wrapper.kill();
        } catch {
          // best-effort test cleanup only
        }
      },
    };
  }

  const child = spawn(process.execPath, baseArgs, {
    cwd: fixture.root,
    env: { ...fake.env, ...extraEnv },
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
  const exitPromise = new Promise((resolveExit) => {
    child.on('close', (code) => resolveExit({ code, stdout, stderr }));
    child.on('error', (error) => resolveExit({ code: null, stdout, stderr: `${stderr}${error}` }));
  });
  return {
    kind: 'posix',
    async sendStop() {
      assert.equal(child.exitCode, null, 'Night Run already exited before SIGINT');
      process.kill(child.pid, 'SIGINT');
    },
    async hasExited() {
      return child.exitCode !== null;
    },
    async waitForExit({ timeoutMs = 120000 } = {}) {
      let timer = null;
      const timeout = new Promise((resolveTimeout) => {
        timer = setTimeout(
          () => resolveTimeout({ code: null, stdout, stderr: `${stderr}\ntimeout` }),
          timeoutMs,
        );
      });
      const result = await Promise.race([exitPromise, timeout]);
      if (timer !== null) clearTimeout(timer);
      return result;
    },
    cleanup() {
      try {
        child.kill('SIGKILL');
      } catch {
        // best-effort test cleanup only
      }
    },
  };
}

async function runRealNightProof({ maxCycles = 5, signals = 1 }) {
  await withScratch(async (scratch) => {
    await withFixture(async (fixture) => {
      const fake = createFakeNightOpencode();
      const foreignTemp = mkdtempSync(join(tmpdir(), 'greenhub-run-night-spec-foreign-'));
      fixture.foreignScratch = foreignTemp;
      const foreignWorktree = join(scratch, 'foreign-worktree');
      git(fixture.root, ['worktree', 'add', '--detach', foreignWorktree, 'HEAD']);
      writeFileSync(
        join(fixture.root, 'docs/authority.md'),
        'fixture docs/authority.md\nforeign dirty\n',
      );
      writeFileSync(join(fixture.root, 'foreign-untracked.txt'), 'foreign untracked\n');
      writeFileSync(join(foreignWorktree, 'foreign-worktree-file.txt'), 'foreign worktree\n');
      writeFileSync(join(foreignTemp, 'foreign-temp.txt'), 'foreign temp\n');
      const foreignStatusBefore = git(fixture.root, ['status', '--porcelain']);

      let night = null;
      try {
        night = startRealNight({ scratch, fixture, fake, maxCycles });
        await waitFor(() => fake.readEvents('start-').length >= 1, {
          message: 'the real run-build selector never started the fake OpenCode',
          timeoutMs: 90000,
        });

        for (let index = 0; index < signals; index += 1) {
          await night.sendStop();
          await new Promise((resolveWait) => setTimeout(resolveWait, 250));
        }
        if (signals > 1) {
          assert.equal(
            await night.hasExited(),
            false,
            'Night Run exited while a BUILD cycle was still active',
          );
        }

        writeFileSync(join(fake.eventsDir, 'proceed'), '');

        const exited = await night.waitForExit();
        assert.equal(
          typeof exited.code,
          'number',
          `Night Run did not exit normally: ${JSON.stringify(exited)}`,
        );
        assert.equal(exited.code, 130, exited.stderr);
        const payload = JSON.parse(exited.stdout);
        assert.equal(payload.status, USER_STOPPED);
        assert.equal(payload.bound.cyclesStarted, 1);
        assert.equal(payload.cycles.length, 1);
        assert.equal(payload.cycles[0].status, HUMAN_DECISION_REQUIRED);
        assert.equal(payload.operatorStop.requested, true);
        assert.equal(payload.operatorStop.duringCycle, true);
        assert.equal(payload.operatorStop.signals, signals);
        assert.equal(payload.operatorStop.cyclesFinishedAfterRequest, 1);
        assert.equal(payload.nextFrontierSelected, false);
        assert.match(exited.stderr, /\[NIGHT RUN\] stop requested\./);
        assert.match(exited.stderr, /current BUILD will finish safely/);
        if (signals > 1) {
          assert.match(
            exited.stderr,
            /safe stop already requested; current BUILD is reaching its terminal/,
          );
        }

        // The active BUILD child reached its own terminal instead of being killed.
        assert.equal(fake.readEvents('sigint-').length, 0, 'the BUILD child received SIGINT');
        assert.equal(fake.readEvents('done-').length, 1, 'the selector child never finished');
        assert.equal(fake.readEvents('start-').length, 1, 'a second BUILD cycle started');
        const selectorWorkspace = fake.readEvents('start-')[0].workspace;
        await waitFor(() => !existsSync(selectorWorkspace), {
          message: `run-build selector workspace was not cleaned: ${selectorWorkspace}`,
          timeoutMs: 30000,
        });

        // Foreign state is preserved exactly.
        assert.equal(
          readFileSync(join(fixture.root, 'foreign-untracked.txt'), 'utf8'),
          'foreign untracked\n',
        );
        assert.equal(
          readFileSync(join(foreignWorktree, 'foreign-worktree-file.txt'), 'utf8'),
          'foreign worktree\n',
        );
        assert.equal(readFileSync(join(foreignTemp, 'foreign-temp.txt'), 'utf8'), 'foreign temp\n');
        assert.equal(git(fixture.root, ['status', '--porcelain']), foreignStatusBefore);
        assert.match(git(fixture.root, ['worktree', 'list']), /foreign-worktree/);
      } finally {
        writeFileSync(join(fake.eventsDir, 'proceed'), '');
        night?.cleanup();
        removeTreeRobust(foreignTemp);
        fake.remove();
      }
    });
  });
}

test('H3 — Windows는 성공 JSON보다 실제 프로세스 종료 후의 exit code를 읽는다', {
  skip: process.platform !== 'win32',
  timeout: 30000,
}, async () => {
  await withScratch(async (scratch) => {
    const probePath = join(scratch, 'windows-exit-probe.cjs');
    const wrapperPath = join(scratch, 'windows-exit-wrapper.ps1');
    const outFile = join(scratch, 'windows-exit-out.json');
    const errFile = join(scratch, 'windows-exit-err.log');
    const pidFile = join(scratch, 'windows-exit-pid.txt');
    const exitFile = join(scratch, 'windows-exit-result.txt');
    const extraEnvFile = join(scratch, 'windows-exit-env.json');
    const terminal = JSON.stringify({ status: FRONTIER_COMPLETE });
    writeFileSync(
      probePath,
      `process.stdout.write(${JSON.stringify(terminal)}); setTimeout(() => process.exit(37), 200);`,
      'utf8',
    );
    writeFileSync(wrapperPath, WINDOWS_START_WRAPPER, 'utf8');
    writeFileSync(extraEnvFile, '{}', 'utf8');

    spawnPowerShell(wrapperPath, [
      '-OutFile',
      outFile,
      '-ErrFile',
      errFile,
      '-PidFile',
      pidFile,
      '-ExitFile',
      exitFile,
      '-NodePath',
      process.execPath,
      '-ArgumentString',
      quoteForStartProcess(probePath),
      '-WorkingDirectory',
      scratch,
      '-PathValue',
      process.env.PATH ?? '',
      '-FakeDir',
      scratch,
      '-ExtraEnvFile',
      extraEnvFile,
    ]);

    assert.equal(JSON.parse(readFileSync(outFile, 'utf8')).status, FRONTIER_COMPLETE);
    assert.equal(Number.parseInt(readFileSync(exitFile, 'utf8').trim(), 10), 37);
  });
});

test('N7 — real console Ctrl+C during an active BUILD: child finishes, no new cycle, USER_STOPPED', {
  timeout: 240000,
}, async () => {
  await runRealNightProof({ maxCycles: 5, signals: 1 });
});

test('N8 — repeated Ctrl+C converges on one graceful stop instead of a hard kill', {
  timeout: 240000,
}, async () => {
  await runRealNightProof({ maxCycles: 5, signals: 3 });
});

test('H8 — VISIBLE_TUI 중 Night Run Ctrl+C는 mutation child와 visible server를 보존한다', {
  timeout: 240000,
}, async () => {
  await withScratch(async (scratch) => {
    await withFixture(async (fixture) => {
      const tui = await startFakeTuiServer();
      const fake = createFakeNightOpencode({
        source: FAKE_VISIBLE_OPENCODE_SOURCE,
        writePath: 'docs/feature.md',
      });
      writeFileSync(
        join(fake.eventsDir, 'selector-decision.json'),
        JSON.stringify(visibleSelectorDecision()),
        'utf8',
      );
      let night = null;
      try {
        night = startRealNight({
          scratch,
          fixture,
          fake,
          maxCycles: 2,
          extraEnv: { [OPENCODE_ATTACH_URL_ENV]: tui.url },
        });
        await waitFor(() => existsSync(join(fake.eventsDir, 'mutation-ready')), {
          timeoutMs: 90000,
          message: '연결된 가짜 mutation이 시작되지 않았습니다',
        });
        await night.sendStop();
        assert.equal(await night.hasExited(), false);
        writeFileSync(join(fake.eventsDir, 'proceed'), '');
        const exited = await night.waitForExit({ timeoutMs: 180000 });
        assert.equal(exited.code, 130, exited.stderr);
        const payload = JSON.parse(exited.stdout);
        assert.equal(payload.status, USER_STOPPED);
        assert.equal(payload.operatorStop.duringCycle, true);
        assert.equal(payload.bound.cyclesStarted, 1);
        assert.equal(payload.cycles.length, 1);
        assert.equal(existsSync(join(fake.eventsDir, 'mutation-done')), true);
        assert.equal(existsSync(join(fake.eventsDir, 'mutation-sigint')), false);
        const cycleDiagnostics = JSON.stringify({
          status: payload.status,
          stopReason: payload.stopReason,
          cycle: payload.cycles[0] ?? null,
        });
        assert.equal(payload.bound.cyclesStarted, 1, cycleDiagnostics);
        assert.equal(payload.visibility.requested, true, cycleDiagnostics);
        assert.equal(payload.visibility.attachUrl, tui.url, cycleDiagnostics);
        assert.equal(payload.visibility.health, 'HEALTHY', cycleDiagnostics);
        assert.equal(payload.visibility.preservedToBuildChildren, true, cycleDiagnostics);
        assert.deepEqual(
          payload.visibility.mutationExecutorModes,
          ['VISIBLE_TUI'],
          cycleDiagnostics,
        );
        assert.equal(payload.visibility.visibleTuiTasks, 1, cycleDiagnostics);
        assert.equal(
          payload.cycles[0].executorModes.includes('VISIBLE_TUI'),
          true,
          cycleDiagnostics,
        );
        assert.equal(payload.cycles[0].visibleTuiTaskCount, 1, cycleDiagnostics);

        const invocations = fake.readEvents('invoke-');
        assert.equal(invocations.length, 2, JSON.stringify({ invocations, cycleDiagnostics }));
        const selectorInvocation = invocations.find((entry) => entry.attach === null);
        const mutationInvocation = invocations.find((entry) => entry.attach === tui.url);
        assert.ok(selectorInvocation, 'the selector invocation is missing');
        assert.ok(mutationInvocation, 'no mutation invocation carried --attach');
        assert.equal(
          typeof mutationInvocation.title === 'string' &&
            mutationInvocation.title.includes('selector'),
          false,
          'the attached invocation must be the mutation task, not the selector',
        );
        assert.equal(existsSync(join(fake.eventsDir, 'mutation-without-attach')), false);
        assert.equal(
          fake.readEvents('invoke-').filter((entry) => entry.attach === tui.url).length,
          1,
        );
        assert.equal(
          tui.requests.some((request) => request.url.startsWith('/global/health')),
          true,
          'the visible preflight never reached the TUI-owned server',
        );
        assert.match(exited.stderr, /visible OpenCode TUI/);
        assert.equal((await fetch(`${tui.url}/global/health`)).status, 200);
      } finally {
        writeFileSync(join(fake.eventsDir, 'proceed'), '');
        night?.cleanup();
        fake.remove();
        await tui.close();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// CLI gate and output contract
// ---------------------------------------------------------------------------

test('CLI1 — --max-cycles is required before any BUILD invocation', async () => {
  const harness = createNightHarness({ buildCycle: CYCLE_COMPLETE });
  const result = await runNight(
    { requestText: DEFAULT_REQUEST, repositoryRoot: process.cwd(), remote: 'origin' },
    harness.deps,
  );
  assert.equal(result.status, INVALID_NIGHT_REQUEST);
  assert.equal(harness.buildCalls.length, 0);
  assert.match(result.stopReason, /--max-cycles must be a positive integer/);
});

test('CLI2 — parseArgs keeps a strict explicit flag surface', () => {
  assert.equal(parseArgs([]).ok, true);
  assert.equal(parseArgs([]).options.maxCycles, null);
  assert.equal(parseArgs(['--max-cycles', '0']).ok, false);
  assert.equal(parseArgs(['--max-cycles', '-2']).ok, false);
  assert.equal(parseArgs(['--max-cycles', '2.5']).ok, false);
  assert.equal(parseArgs(['--max-minutes', '0']).ok, false);
  assert.equal(parseArgs(['--nope']).ok, false);
  const parsed = parseArgs(['--max-cycles', '2', '--max-minutes', '0.5', '--repo', '.']);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.options.maxCycles, 2);
  assert.equal(parsed.options.maxMinutes, 0.5);
  assert.equal(parsed.options.repositoryRoot, '.');
});

test('CLI3 — max-minutes stops between cycles without starting another BUILD', async () => {
  let fakeNow = 0;
  const harness = createNightHarness({
    buildCycle: CYCLE_COMPLETE,
    mains: [shaFor(1), shaFor(2), shaFor(2), shaFor(3)],
  });
  harness.deps.now = () => fakeNow;
  harness.deps.invokeBuild = async (input) => {
    harness.buildCalls.push(input);
    fakeNow += 61 * 1000;
    return {
      exitCode: 0,
      signal: null,
      stdout: JSON.stringify(CYCLE_COMPLETE(1)),
      stderrBytes: 0,
      stdoutOverflow: false,
      startErrorCode: null,
      startErrorMessage: null,
    };
  };
  const result = await runHarness(harness, { maxCycles: 5, maxMinutes: 1 });
  assert.equal(result.status, MAX_MINUTES_REACHED);
  assert.equal(harness.buildCalls.length, 1);
  assert.equal(result.bound.maxMinutesReached, true);
  assert.equal(result.cycles.length, 1);
});

test('CLI4 — parseBuildResultOutput fails closed on malformed child output', () => {
  assert.equal(parseBuildResultOutput('').ok, false);
  assert.equal(parseBuildResultOutput('  ').ok, false);
  assert.equal(parseBuildResultOutput('not json').ok, false);
  assert.equal(parseBuildResultOutput('{"status":"FRONTIER_COMPLETE"} trailing').ok, false);
  assert.equal(parseBuildResultOutput('{"status":"SOMETHING"}').ok, false);
  assert.equal(parseBuildResultOutput(JSON.stringify({ status: FRONTIER_COMPLETE })).ok, true);
});

test('CLI5 — Night status vocabulary keeps one reused BUILD vocabulary', () => {
  for (const status of [
    ALREADY_SATISFIED,
    NO_EXECUTABLE_FRONTIER,
    HUMAN_DECISION_REQUIRED,
    BLOCKED_EXTERNAL,
    PROOF_FAILED,
    PUBLICATION_FAILED,
    INVALID_BUILD_REQUEST,
    MAX_CYCLES_REACHED,
    MAX_MINUTES_REACHED,
    NO_PROGRESS,
    USER_STOPPED,
    BUILD_CHILD_FAILED,
    INVALID_NIGHT_REQUEST,
  ]) {
    assert.equal(NIGHT_STATUSES.includes(status), true, status);
  }
});
