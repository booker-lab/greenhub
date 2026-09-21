// Real-execution proof harness for
// GREENHUB-COORDINATION-OPENCODE-READONLY-STRUCTURED-RESULT-EXECUTOR-GF05.
//
// Runs ONE real READ_ONLY OpenCode execution cycle through the EXISTING
// operator composition with a REAL installed OpenCode process and a REAL
// model, in an isolated coordination home OUTSIDE the repository:
//
//   CANONICAL ADMISSION -> CLAIM -> DISPATCH -> PRE-INVOCATION FENCE
//     -> REAL OPENCODE PROCESS -> STRUCTURED EXECUTOR RESULT
//     -> DURABLE EXECUTOR RESULT RECEIPT -> CANONICAL RESULT DELIVERY
//     -> RESULT_DELIVERED -> GF-04 TERMINAL RECONCILIATION -> READ_ONLY_TERMINAL
//
// plus crash/replay semantics:
//   R1 receipt durable, no canonical result -> operator rerun delivers WITHOUT
//      a second OpenCode invocation,
//   R2 canonical result durable -> replay converges without new writes,
//   R3 terminal reconciliation recomputation -> identical verdict, no durable
//      byte change, zero Git publication reads.
//
// Repository worktree bytes, refs, worktrees, stash, and remote main are
// compared before/after the real process to prove the probe mutated nothing.
//
// Usage:
//   node scripts/coordination/real-opencode-readonly-roundtrip.mjs \
//     --opencode <ABSOLUTE_PATH> --model <PROVIDER/MODEL> [--workdir <ABS>]
//
// This harness is NOT a spec: it is never auto-discovered by
// `node --test scripts/coordination/*.spec.mjs` because it requires an
// installed OpenCode CLI, valid credentials, and network access. It always
// prints one JSON report to stdout.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAdmissionBoundClaimToken } from './admission-bound-claim.mjs';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { persistExecutorInvocationAttempt } from './dispatch-executor-invocation-attempt.mjs';
import { invokeExecutorWithInvocationFence } from './dispatch-executor-invocation-fence.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import { validateExecutorResultReceiptRecord } from './executor-result-receipt.mjs';
import {
  DEFAULT_OPERATOR_WORKER_ID,
  resolveTaskAdmission,
  runOperatorCli,
} from './operator-cli.mjs';
import { createOpenCodeCliStructuredResultExecutor } from './opencode-cli-executor-adapter.mjs';
import { CoordinationStore } from './store.mjs';
import {
  reconcileTerminalResult,
  TERMINAL_RECONCILIATION_READ_ONLY_TERMINAL,
} from './terminal-reconciliation.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..');
const OPERATOR_CLI_PATH = join(MODULE_DIRECTORY, 'operator-cli.mjs');

const SOURCE_A = 'GF05-REALPROBE-SRCA';
const CHILD_A = 'GF05-REALPROBE-CHILDA';
const SOURCE_B = 'GF05-REALPROBE-SRCB';
const CHILD_B = 'GF05-REALPROBE-CHILDB';

const NEVER_CALLED = async () => {
  throw new Error('Git publication evidence reader must not be called for a READ_ONLY terminal');
};

class HarnessBlocked extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarnessBlocked';
    this.code = code;
  }
}

function captureStream() {
  const stream = { text: '' };
  stream.write = (chunk) => {
    stream.text += String(chunk);
    return true;
  };
  return stream;
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function captureRepositoryState() {
  return {
    head: git(['rev-parse', 'HEAD']).trim(),
    refs: git(['for-each-ref', '--format=%(refname) %(objectname)']),
    status: git(['status', '--porcelain=v1', '--untracked-files=all']),
    stash: git(['stash', 'list']),
    worktrees: git(['worktree', 'list', '--porcelain']),
    remoteMain: git(['ls-remote', 'origin', 'refs/heads/main']).trim(),
    probeFileHashes: {
      'package.json': sha256File(join(REPOSITORY_ROOT, 'package.json')),
      'scripts/coordination/operator-cli.mjs': sha256File(
        join(REPOSITORY_ROOT, 'scripts/coordination/operator-cli.mjs'),
      ),
      'scripts/coordination/opencode-cli-executor-adapter.mjs': sha256File(
        join(REPOSITORY_ROOT, 'scripts/coordination/opencode-cli-executor-adapter.mjs'),
      ),
    },
  };
}

function snapshotHome(home) {
  const out = {};
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of sorted) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out[full.slice(home.length + 1)] = readFileSync(full, 'utf8');
      }
    }
  };
  walk(home);
  return out;
}

function readOptionalResult(store, taskId) {
  try {
    return store.readResult(taskId);
  } catch (error) {
    if (error?.code === 'RESULT_NOT_FOUND') return null;
    throw error;
  }
}

function controllableClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  return {
    advance(ms) {
      now += ms;
    },
    provider() {
      return now;
    },
  };
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'REPORT_PACKAGE_AND_OPERATOR_CLI_FACTS',
    policyRefs: [
      'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
    ],
    evidenceRefs: ['read:package.json', 'read:scripts/coordination/operator-cli.mjs'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
    proofRequirement: [
      'read:package.json',
      'read:scripts/coordination/operator-cli.mjs',
      'report:exact-six-field-json',
    ],
    ...overrides,
  };
}

function sampleMutationTaskInput(taskId, overrides = {}) {
  return {
    ...sampleTaskInput(taskId),
    taskKind: 'BOUNDED_MUTATION',
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    ...overrides,
  };
}

function sampleSourceResult(claim, overrides = {}) {
  return {
    taskId: claim.taskId,
    resultId: 'result-0001',
    workerId: claim.workerId,
    claimToken: claim.claimToken,
    claimGeneration: claim.generation,
    status: 'SUCCEEDED',
    summary: 'bounded source output',
    proofRefs: ['store:read-back'],
    evidenceRefs: ['harness:temp-home'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function ctParams(overrides = {}) {
  return {
    controlTowerToken: 'ct-token-001',
    controlTowerId: 'control-tower-1',
    policyRefs: ['policy:control-tower-verdict'],
    proofRefs: ['proof:result-readback'],
    evidenceRefs: ['evidence:result-binding'],
    ...overrides,
  };
}

function matParams(overrides = {}) {
  return {
    materializerId: 'control-tower-1',
    policyRefs: ['policy:canonical-adoption'],
    proofRefs: ['proof:adopted-readback'],
    evidenceRefs: ['evidence:disposition-adopted'],
    ...overrides,
  };
}

function driveSourceToAdmittedChild(store, clock, sourceTaskId, childTaskId) {
  store.createTask(sampleMutationTaskInput(sourceTaskId));
  store.markReady(sourceTaskId);
  const sourceClaim = store.claimTask({
    taskId: sourceTaskId,
    workerId: 'worker-source',
    leaseDurationMs: 60_000,
  });
  store.deliverResult(sampleSourceResult(sourceClaim));
  clock.advance(1000);
  store.beginDisposition({ taskId: sourceTaskId, resultId: 'result-0001', ...ctParams() });
  clock.advance(1000);
  store.writeDisposition({
    taskId: sourceTaskId,
    dispositionGeneration: 2,
    resultId: 'result-0001',
    ...ctParams({ controlTowerToken: 'ct-token-002' }),
    state: DISPOSITION_STATE_ADOPTED,
  });
  clock.advance(1000);
  store.materializeAdoption({ taskId: sourceTaskId, ...matParams() });
  clock.advance(1000);
  store.ackAdoption({ taskId: sourceTaskId, acknowledgerId: 'control-tower-1' });
  clock.advance(1000);
  store.markConsumed({ taskId: sourceTaskId, consumerId: 'control-tower-1' });
  clock.advance(1000);
  store.emitNextTask({
    sourceTaskId,
    nextTaskSpec: sampleTaskInput(childTaskId),
    emitterId: 'control-tower-1',
  });
  clock.advance(1000);
  store.admitEmittedTask({ sourceTaskId, admitterId: 'control-tower-1' });
  clock.advance(1000);
}

function runChildProcess(args, env) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [OPERATOR_CLI_PATH, ...args], {
      cwd: REPOSITORY_ROOT,
      env,
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
    child.once('close', (code) => resolveResult({ code, stdout, stderr }));
  });
}

function parseOptions(argv) {
  let opencodePath = process.env.GREENHUB_OPENCODE_CLI_PATH ?? null;
  let model = process.env.GREENHUB_OPENCODE_MODEL ?? null;
  let workdir = REPOSITORY_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };
    if (argument === '--opencode') opencodePath = next();
    else if (argument === '--model') model = next();
    else if (argument === '--workdir') workdir = resolve(next());
    else if (argument === '--help' || argument === '-h') {
      return { help: true };
    } else {
      throw new HarnessBlocked('HARNESS_ARGUMENT_INVALID', `unknown option: ${argument}`);
    }
  }
  if (typeof opencodePath !== 'string' || !opencodePath.trim()) {
    throw new HarnessBlocked(
      'BLOCKED_OPENCODE_NOT_INSTALLED',
      'no OpenCode executable configured: pass --opencode <ABSOLUTE_PATH> or set GREENHUB_OPENCODE_CLI_PATH',
    );
  }
  if (typeof model !== 'string' || !model.trim()) {
    throw new HarnessBlocked(
      'BLOCKED_OPENCODE_NOT_INSTALLED',
      'no model configured: pass --model <PROVIDER/MODEL> or set GREENHUB_OPENCODE_MODEL',
    );
  }
  if (!existsSync(opencodePath)) {
    throw new HarnessBlocked(
      'BLOCKED_OPENCODE_NOT_INSTALLED',
      `OpenCode executable does not exist: ${opencodePath}`,
    );
  }
  return { help: false, opencodePath, model, workdir };
}

function renderUsage() {
  return [
    'usage:',
    '  node scripts/coordination/real-opencode-readonly-roundtrip.mjs',
    '    --opencode <ABSOLUTE_PATH> --model <PROVIDER/MODEL> [--workdir <ABSOLUTE_PATH>]',
    '',
    'requires a real OpenCode installation, valid credentials, and network access.',
    'always prints ONE JSON report to stdout.',
    '',
  ].join('\n');
}

const report = {
  harness: 'real-opencode-readonly-roundtrip',
  status: null,
  opencode: null,
  isolatedCoordinationHome: null,
  isolatedCoordinationHomeRemoved: false,
  repositoryBefore: null,
  repositoryAfter: null,
  repositoryUnchanged: null,
  realProcessInvocations: 0,
  probeInvocations: [],
};

async function main(options) {
  report.opencode = {
    executablePath: options.opencodePath,
    model: options.model,
    workdir: options.workdir,
    version: execFileSync(options.opencodePath, ['--version'], { encoding: 'utf8' }).trim(),
  };

  const home = mkdtempSync(join(tmpdir(), 'greenhub-gf05-real-proof-'));
  report.isolatedCoordinationHome = home;
  const clock = controllableClock();
  const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });

  let processInvocations = 0;
  const adapter = createOpenCodeCliStructuredResultExecutor({
    executablePath: options.opencodePath,
    workdir: options.workdir,
    model: options.model,
  });
  const instrumentedExecutor = async (task28Record) => {
    processInvocations += 1;
    report.probeInvocations.push({
      dispatchId: task28Record.dispatchId,
      taskId: task28Record?.decisionInput?.task?.taskId ?? null,
      fenceAlreadyDurableAtExecutorEntry:
        store.readExecutorInvocationFence(task28Record.dispatchId) !== null,
    });
    return adapter(task28Record);
  };

  report.repositoryBefore = captureRepositoryState();

  driveSourceToAdmittedChild(store, clock, SOURCE_A, CHILD_A);
  driveSourceToAdmittedChild(store, clock, SOURCE_B, CHILD_B);

  // --- Cycle A: the full real path through the operator composition ---------
  const stdoutA = captureStream();
  const stderrA = captureStream();
  const exitA = await runOperatorCli({
    argv: ['run', CHILD_A, '--json'],
    store,
    executor: instrumentedExecutor,
    stdout: stdoutA,
    stderr: stderrA,
  });
  assert.equal(stderrA.text, '', `operator run A stderr must be empty: ${stderrA.text}`);
  assert.equal(exitA, 0, 'operator run A must exit 0');
  const projectionA = JSON.parse(stdoutA.text);
  assert.equal(projectionA.outcome, 'EXECUTED');
  assert.equal(projectionA.executorInvocations, 1);
  assert.equal(processInvocations, 1, 'exactly one real OpenCode process for cycle A');
  assert.equal(
    report.probeInvocations[0].fenceAlreadyDurableAtExecutorEntry,
    true,
    'the durable pre-invocation fence must exist at executor entry',
  );
  const receiptA = validateExecutorResultReceiptRecord(
    store.readExecutorResultReceipt(projectionA.dispatchId),
  );
  assert.equal(receiptA.taskId, CHILD_A);
  assert.equal(receiptA.status, 'SUCCEEDED');
  assert.equal(projectionA.taskStatus, 'RESULT_DELIVERED');
  const resultA = store.readResult(CHILD_A);
  assert.equal(resultA.resultId, `result_${projectionA.dispatchId}`);
  const taskA = store.readTask(CHILD_A);
  assert.equal(taskA.status, 'RESULT_DELIVERED');

  // A. canonical admission identity
  const admissionA = store.readEmissionAdmission({ sourceTaskId: SOURCE_A, emissionSlot: 'next' });
  assert.equal(admissionA.nextTaskId, CHILD_A);
  // B. claim winner matches the admission-bound claim token
  const claimA = store.readClaim(CHILD_A);
  assert.equal(claimA.workerId, DEFAULT_OPERATOR_WORKER_ID);
  assert.equal(
    claimA.claimToken,
    buildAdmissionBoundClaimToken({
      admissionId: admissionA.admissionId,
      nextTaskId: CHILD_A,
      workerId: claimA.workerId,
    }),
  );
  assert.equal(resultA.claimToken, claimA.claimToken);
  assert.equal(resultA.claimGeneration, claimA.generation);

  report.cycleA = {
    taskId: CHILD_A,
    dispatchId: projectionA.dispatchId,
    claimGeneration: claimA.generation,
    admissionId: admissionA.admissionId,
    receiptStatus: receiptA.status,
    receiptSummary: receiptA.summary,
    canonicalResultId: resultA.resultId,
    canonicalResultStatus: resultA.status,
    taskStatus: taskA.status,
    realProcessInvocations: 1,
  };

  // --- R2: canonical result durable; replay converges with zero new writes --
  const resultBytesBeforeReplay = JSON.stringify(resultA);
  const receiptBytesBeforeReplay = JSON.stringify(receiptA);
  const stdoutReplayA = captureStream();
  const stderrReplayA = captureStream();
  const exitReplayA = await runOperatorCli({
    argv: ['run', CHILD_A, '--json'],
    store,
    executor: instrumentedExecutor,
    stdout: stdoutReplayA,
    stderr: stderrReplayA,
  });
  assert.equal(stderrReplayA.text, '');
  assert.equal(exitReplayA, 0);
  const projectionReplayA = JSON.parse(stdoutReplayA.text);
  assert.equal(projectionReplayA.outcome, 'ALREADY_TERMINAL');
  assert.equal(projectionReplayA.executorInvocations, 0);
  assert.equal(processInvocations, 1, 'replay must not invoke OpenCode again');
  assert.equal(
    JSON.stringify(store.readResult(CHILD_A)),
    resultBytesBeforeReplay,
    'canonical result bytes must be stable on replay',
  );
  assert.equal(
    JSON.stringify(store.readExecutorResultReceipt(projectionA.dispatchId)),
    receiptBytesBeforeReplay,
    'durable receipt bytes must be stable on replay',
  );

  // --- Literal `coordination:run` process path: terminal no-op replay -------
  const spawnedReplay = await runChildProcess(
    ['run', CHILD_A, '--json', '--workdir', options.workdir],
    {
      ...process.env,
      GREENHUB_COORDINATION_HOME: home,
      GREENHUB_OPENCODE_CLI_PATH: options.opencodePath,
      GREENHUB_OPENCODE_MODEL: options.model,
    },
  );
  assert.equal(spawnedReplay.code, 0, `spawned replay stderr: ${spawnedReplay.stderr}`);
  const spawnedProjection = JSON.parse(spawnedReplay.stdout);
  assert.equal(spawnedProjection.outcome, 'ALREADY_TERMINAL');
  assert.equal(spawnedProjection.executorInvocations, 0);
  assert.equal(processInvocations, 1, 'spawned replay must not invoke OpenCode');

  report.replayA = {
    inProcessOutcome: projectionReplayA.outcome,
    inProcessExecutorInvocations: projectionReplayA.executorInvocations,
    spawnedCliOutcome: spawnedProjection.outcome,
    spawnedCliExecutorInvocations: spawnedProjection.executorInvocations,
    canonicalResultBytesStable: true,
    receiptBytesStable: true,
    totalRealProcessInvocations: processInvocations,
  };

  // --- R3: GF-04 terminal reconciliation (READ_ONLY, zero Git reads) --------
  const homeBytesBeforeReconcile = snapshotHome(home);
  const verdictA = await reconcileTerminalResult({
    store,
    sourceTaskId: SOURCE_A,
    emissionSlot: 'next',
    readEvidence: NEVER_CALLED,
  });
  assert.equal(verdictA.verdict, TERMINAL_RECONCILIATION_READ_ONLY_TERMINAL);
  assert.equal(verdictA.mutationClaimed, false);
  assert.equal(verdictA.liveMainRef, null);
  assert.equal(verdictA.candidateRef, null);
  const verdictARecomputed = await reconcileTerminalResult({
    store,
    sourceTaskId: SOURCE_A,
    emissionSlot: 'next',
    readEvidence: NEVER_CALLED,
  });
  assert.deepEqual(verdictARecomputed, verdictA);
  assert.deepEqual(
    snapshotHome(home),
    homeBytesBeforeReconcile,
    'terminal reconciliation must not change durable coordination bytes',
  );

  // --- Cycle B (R1): receipt durable without delivery, then operator replay --
  const resolvedB = resolveTaskAdmission({ store, taskId: CHILD_B });
  assert.equal(resolvedB.sourceTaskId, SOURCE_B);
  const claimedB = await store.claimAdmittedTask({
    sourceTaskId: SOURCE_B,
    emissionSlot: 'next',
    workerId: DEFAULT_OPERATOR_WORKER_ID,
    leaseDurationMs: 15 * 60_000,
  });
  assert.notEqual(claimedB.terminal, true);
  const attemptB = store.persistDispatchAttempt({
    sourceTaskId: SOURCE_B,
    emissionSlot: 'next',
    workerId: DEFAULT_OPERATOR_WORKER_ID,
  });
  const requestB = prepareDispatchTransportRequest({
    store,
    sourceTaskId: SOURCE_B,
    dispatchId: attemptB.dispatchId,
  });
  await acceptReceiverDispatch({ request: requestB, store });
  await persistExecutorInvocationAttempt({ dispatchId: attemptB.dispatchId, store });
  const fencedB = await invokeExecutorWithInvocationFence({
    dispatchId: attemptB.dispatchId,
    store,
    executor: instrumentedExecutor,
  });
  assert.equal(fencedB.outcome, 'ACCEPTED');
  assert.notEqual(fencedB.receipt, null);
  assert.equal(processInvocations, 2, 'exactly one real OpenCode process for cycle B');
  const crashStateB = {
    taskStatusBeforeReplay: store.readTask(CHILD_B).status,
    canonicalResultBeforeReplay: readOptionalResult(store, CHILD_B),
    receiptDurable: validateExecutorResultReceiptRecord(
      store.readExecutorResultReceipt(attemptB.dispatchId),
    ).taskId,
  };
  assert.equal(crashStateB.taskStatusBeforeReplay, 'CLAIMED');
  assert.equal(crashStateB.canonicalResultBeforeReplay, null);

  const stdoutReplayB = captureStream();
  const stderrReplayB = captureStream();
  const exitReplayB = await runOperatorCli({
    argv: ['run', CHILD_B, '--json'],
    store,
    executor: instrumentedExecutor,
    stdout: stdoutReplayB,
    stderr: stderrReplayB,
  });
  assert.equal(stderrReplayB.text, '');
  assert.equal(exitReplayB, 0);
  const projectionReplayB = JSON.parse(stdoutReplayB.text);
  assert.equal(projectionReplayB.outcome, 'EXECUTED');
  assert.equal(projectionReplayB.executorInvocations, 0);
  assert.equal(processInvocations, 2, 'receipt replay must not invoke OpenCode again');
  assert.equal(projectionReplayB.taskStatus, 'RESULT_DELIVERED');
  const resultB = store.readResult(CHILD_B);
  assert.equal(resultB.resultId, `result_${attemptB.dispatchId}`);

  const verdictB = await reconcileTerminalResult({
    store,
    sourceTaskId: SOURCE_B,
    emissionSlot: 'next',
    readEvidence: NEVER_CALLED,
  });
  assert.equal(verdictB.verdict, TERMINAL_RECONCILIATION_READ_ONLY_TERMINAL);

  report.cycleB = {
    taskId: CHILD_B,
    dispatchId: attemptB.dispatchId,
    crashState: crashStateB,
    replayOutcome: projectionReplayB.outcome,
    replayExecutorInvocations: projectionReplayB.executorInvocations,
    canonicalResultId: resultB.resultId,
    terminalVerdict: verdictB.verdict,
  };

  report.terminalReconciliation = {
    verdictA: verdictA.verdict,
    verdictARecomputed: verdictARecomputed.verdict,
    verdictB: verdictB.verdict,
    gitPublicationReadPerformed: false,
    durableBytesUnchanged: true,
  };

  report.realProcessInvocations = processInvocations;
  report.repositoryAfter = captureRepositoryState();
  assert.deepEqual(
    {
      head: report.repositoryAfter.head,
      refs: report.repositoryAfter.refs,
      status: report.repositoryAfter.status,
      stash: report.repositoryAfter.stash,
      worktrees: report.repositoryAfter.worktrees,
      remoteMain: report.repositoryAfter.remoteMain,
      probeFileHashes: report.repositoryAfter.probeFileHashes,
    },
    {
      head: report.repositoryBefore.head,
      refs: report.repositoryBefore.refs,
      status: report.repositoryBefore.status,
      stash: report.repositoryBefore.stash,
      worktrees: report.repositoryBefore.worktrees,
      remoteMain: report.repositoryBefore.remoteMain,
      probeFileHashes: report.repositoryBefore.probeFileHashes,
    },
    'the READ_ONLY OpenCode probe must not change repository or remote state',
  );
  report.repositoryUnchanged = true;
  report.status = 'COMPLETE';

  rmSync(home, { recursive: true, force: true });
  report.isolatedCoordinationHomeRemoved = true;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(renderUsage());
    process.exitCode = 0;
  } else {
    process.exitCode = await main(options);
  }
} catch (error) {
  report.status = error instanceof HarnessBlocked ? error.code : 'FAILED';
  report.detail = String(error?.message ?? error);
  if (!(error instanceof HarnessBlocked)) {
    report.cause = { name: error?.name ?? null, code: error?.code ?? null };
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
}
