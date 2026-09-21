// Proof for GREENHUB-COORDINATION-DURABLE-EXECUTOR-RESULT-RECEIPT-33.
//
// CODEX_CLI_STRUCTURED_RESULT(dispatchId)
//   -> DURABLY_RECORDED_EXECUTOR_RESULT_RECEIPT(dispatchId)      [this Task].
//
// DURABLY_RECORDED_EXECUTOR_RESULT_RECEIPT != canonical task Result
// != task completion != RESULT_DELIVERED != ACK != disposition
// != retry permission != task succeeded proof != mutation proof
// != global exactly-once executor invocation.
//
// The entry is EXACTLY one composition path:
//   (dispatchId, store, executor)
//     1. store capability gate (readExecutorResultReceipt /
//        createExecutorResultReceipt / readExecutorInvocationOutcome /
//        readExecutorInvocationAttempt ONLY)
//     2. dispatchId identity validation (Task 28 identity family verbatim)
//     3. store.readExecutorResultReceipt(dispatchId) — durable-first
//     4. existing valid durable receipt -> authoritative replay: zero executor
//        process invocations, zero writes, zero byte/mtime change
//     5. recorded Task 32 durable invocation outcome without receipt ->
//        fail-closed readable state; zero process, zero writes
//     6. executor capability validation (caller-supplied function ONLY)
//     7. Task 29 invokeExecutorInvocationAdapter({ dispatchId, store, adapter })
//        EXACTLY ONCE through a guarded wrapper that enforces READ_ONLY task
//        capability BEFORE the caller executor runs and captures the exact
//        expected taskId from the exact validated Task 28 record
//     8. envelope validation: EXACT
//        { schemaVersion: 1, dispatchId, outcome, result }; REJECTED/UNKNOWN
//        return receipt null with zero durable writes
//     9. ACCEPTED ONLY: structured payload validation + exact taskId binding,
//        then OS exclusive-create of the EXACT durable receipt under
//        <home>/executor-result-receipts/<dispatchId>.json
//    10. exact durable read-back verification
//    11. exclusive-create race loser -> winner re-read: same = idempotent
//        convergence, different valid = fail-closed conflict, corrupt = fail
//        closed; the first durable winner is preserved
//
// Codex CLI structured-output mechanism (discovered read-only from the
// installed CLI `codex exec --help`, codex-cli 0.153.3 on this machine):
//   --output-schema <FILE>          JSON Schema for the model final response
//   -o, --output-last-message <FILE> file receiving the last agent message
//   --json                          JSONL event stream (NOT used here)
// The concrete executor uses --output-schema + --output-last-message ONLY and
// keeps stdout/stderr closed; exit 0 alone is never SUCCEEDED evidence.
//
// Proof map:
//   A. valid READ_ONLY structured result -> exact durable receipt, process
//      exactly 1, exact argv/flags, one new durable path.
//   B. SUCCEEDED / FAILED / BLOCKED are validated from the executor payload
//      independently of the process exit code.
//   C. existing receipt replay -> process 0, write 0, bytes/mtime unchanged.
//   D. malformed structured output -> fail closed, receipt 0.
//   E. missing structured output after exit 0 -> fail closed, receipt 0.
//   F. dispatchId mismatch -> fail closed (envelope + durable key binding).
//   G. taskId mismatch -> fail closed (concrete + composition paths).
//   H. extra fields / invalid status / oversized summary or refs / invalid
//      envelope -> fail closed.
//   I. process start failure -> Task 31 typed start-failure meaning preserved,
//      receipt 0.
//   J. process non-zero exit -> Task 30 REJECTED semantics preserved,
//      fabricated receipt 0.
//   K. UNKNOWN process outcome -> Task 30 UNKNOWN semantics preserved, no
//      retry, fabricated receipt 0.
//   L. exclusive-create same-result race -> idempotent convergence.
//   M. exclusive-create different-result race -> conflict, first winner
//      preserved.
//   N. corrupt durable receipt -> fail closed, repair 0, process 0 when
//      corruption is observed before invocation.
//   O. task.json / claim.json / result.json / disposition / ACK bytes and
//      statuses unchanged; only the receipt path is added.
//   P. store.deliverResult is never called; no canonical result / ACK artifact
//      or primitive exists (behavioral + static).
//   Q. no RUNNING status, no new task status, no new generation authority.
//   R. Task 28/29/30/31/32 predecessor public surfaces intact.
//   S. real two-process race: exactly one durable winner, total executor
//      invocation <= 2, global exactly-once NOT claimed.
//   CONCRETE. Codex CLI structured executor configuration/record/runner
//      fail-closed boundary and READ_ONLY-only capability.
//   TASK32-GUARD. recorded Task 32 outcome without receipt stays a distinct
//      fail-closed state (zero process, zero writes, no fabrication).
//   STORE. durable receipt read/create primitives (missing -> null, exact
//      canonical, exclusive-create, binding/corruption fail closed, no repair).
//   STATIC. production module boundary + exact exported surface.
//
// No test in this file spawns a real Codex CLI process: every runner is an
// injected fake. All runtime state lives in isolated temp directories.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CODEX_CLI_EXECUTOR_PROCESS_START_FAILED,
  CodexCliExecutorAdapterError,
  createCodexCliExecutorAdapter,
} from './codex-cli-executor-adapter.mjs';
import {
  EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME,
  persistExecutorInvocationAttempt,
} from './dispatch-executor-invocation-attempt.mjs';
import {
  EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND,
  INVALID_EXECUTOR_INVOCATION_ADAPTER,
  invokeExecutorInvocationAdapter,
} from './dispatch-executor-invocation-contract.mjs';
import {
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_REJECTED,
  EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
  EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
  invokeExecutorAndValidateOutcome,
} from './dispatch-executor-invocation-outcome.mjs';
import {
  EXECUTOR_INVOCATION_OUTCOMES_DIRNAME,
  persistExecutorInvocationOutcome,
} from './dispatch-executor-invocation-outcome-persistence.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import * as receiptModule from './executor-result-receipt.mjs';
import {
  CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_FIELDS,
  CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
  CORRUPT_EXECUTOR_RESULT_RECEIPT,
  createCodexCliStructuredResultExecutor,
  EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME,
  EXECUTOR_RESULT_RECEIPT_CONFLICT,
  EXECUTOR_RESULT_RECEIPT_FIELDS,
  EXECUTOR_RESULT_RECEIPT_PERSISTENCE_NEW_FIELDS,
  EXECUTOR_RESULT_RECEIPT_PERSISTENCE_REPLAY_FIELDS,
  EXECUTOR_RESULT_RECEIPT_REQUIRES_READ_ONLY_TASK,
  EXECUTOR_RESULT_RECEIPT_SCHEMA_VERSION,
  EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED,
  EXECUTOR_RESULT_RECEIPT_STATUS_FAILED,
  EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
  EXECUTOR_RESULT_RECEIPT_STATUS_VALUES,
  EXECUTOR_RESULT_RECEIPT_STRUCTURED_FIELDS,
  EXECUTOR_RESULT_RECEIPTS_DIRNAME,
  EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH,
  ExecutorResultReceiptError,
  executorResultReceiptFilePath,
  INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
  INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
  INVALID_EXECUTOR_RESULT_RECEIPT_STORE,
  INVALID_EXECUTOR_STRUCTURED_RESULT,
  MISSING_EXECUTOR_STRUCTURED_RESULT,
  persistExecutorResultReceipt,
  validateExecutorResultReceiptRecord,
} from './executor-result-receipt.mjs';
import { CoordinationStore } from './store.mjs';
import {
  TASK_STATUS_CLAIMED,
  TASK_STATUS_RESULT_DELIVERED,
  TASK_STATUSES,
} from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(MODULE_DIRECTORY, 'executor-result-receipt.mjs');
const STORE_PATH = join(MODULE_DIRECTORY, 'store.mjs');
const STORE_MODULE_URL = pathToFileURL(STORE_PATH).href;
const MODULE_URL = pathToFileURL(MODULE_PATH).href;

const FAKE_EXECUTABLE = resolve(process.cwd(), 'fake-codex-cli', 'codex.exe');
const FAKE_WORKDIR = resolve(process.cwd(), 'fake-workdir');

const FORBIDDEN_RECEIPT_TOKENS = Object.freeze([
  'workerId',
  'claimToken',
  'claimGeneration',
  'deliveredAt',
  'resultId',
  'usage',
  'pid',
  'hostname',
  'acceptedAt',
  'invokedAt',
  'startedAt',
  'completedAt',
  'attemptedAt',
  'createdAt',
  'updatedAt',
  'retryCount',
  'attemptNumber',
  'invocationGeneration',
  'executorGeneration',
  'executionGeneration',
  'resultGeneration',
  'retryGeneration',
  'generation',
  'disposition',
  'ack',
  'retry',
  'backoff',
  'resend',
]);

function makeHome(prefix = 'greenhub-executor-result-receipt33-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'DURABLE_EXECUTOR_RESULT_RECEIPT_PROVED',
    policyRefs: [
      'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
    ],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['durable-executor-result-receipt-proof'],
    ...overrides,
  };
}

function sampleResult(claim, overrides = {}) {
  return {
    taskId: claim.taskId,
    resultId: 'result-0001',
    workerId: claim.workerId,
    claimToken: claim.claimToken,
    claimGeneration: claim.generation,
    status: 'SUCCEEDED',
    summary: 'bounded executor output',
    proofRefs: ['store:read-back'],
    evidenceRefs: ['test:temp-home'],
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

function driveToDelivered(store, taskId, resultId = 'result-0001') {
  store.createTask(sampleTaskInput(taskId));
  store.markReady(taskId);
  const claim = store.claimTask({ taskId, workerId: 'worker-a', leaseDurationMs: 60_000 });
  store.deliverResult(sampleResult(claim, { resultId }));
  return { claim };
}

function driveToPending(store, taskId, resultId = 'result-0001') {
  driveToDelivered(store, taskId, resultId);
  store.beginDisposition({ taskId, resultId, ...ctParams() });
}

function driveToAdopted(store, clock, taskId, resultId = 'result-0001') {
  driveToPending(store, taskId, resultId);
  clock.advance(1000);
  store.writeDisposition({
    taskId,
    dispositionGeneration: 2,
    resultId,
    ...ctParams({ controlTowerToken: 'ct-token-002' }),
    state: 'ADOPTED',
  });
  clock.advance(1000);
}

function driveToMaterialized(store, clock, taskId, resultId = 'result-0001') {
  driveToAdopted(store, clock, taskId, resultId);
  store.materializeAdoption({ taskId, ...matParams() });
  clock.advance(1000);
}

function driveToAcked(store, clock, taskId, resultId = 'result-0001') {
  driveToMaterialized(store, clock, taskId, resultId);
  store.ackAdoption({ taskId, acknowledgerId: 'control-tower-1' });
  clock.advance(1000);
}

function driveToConsumed(store, clock, taskId, resultId = 'result-0001') {
  driveToAcked(store, clock, taskId, resultId);
  store.markConsumed({ taskId, consumerId: 'control-tower-1' });
  clock.advance(1000);
}

function driveToEmitted(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  childSpec,
) {
  driveToConsumed(store, clock, sourceTaskId, sourceResultId);
  const out = store.emitNextTask({
    sourceTaskId,
    nextTaskSpec: childSpec ?? sampleTaskInput(childTaskId),
    emitterId: 'control-tower-1',
  });
  clock.advance(1000);
  return out;
}

function driveToAdmitted(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  childSpec,
) {
  const emitted = driveToEmitted(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    sourceResultId,
    childSpec,
  );
  const admitted = store.admitEmittedTask({ sourceTaskId, admitterId: 'control-tower-1' });
  clock.advance(1000);
  return { emitted, admitted };
}

function driveToClaimed(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  workerId = 'worker-a',
  childSpec,
) {
  const setup = driveToAdmitted(store, clock, sourceTaskId, childTaskId, sourceResultId, childSpec);
  const claimed = store.claimAdmittedTask({ sourceTaskId, workerId });
  clock.advance(1000);
  return { ...setup, claimed };
}

function driveToAttempt(
  store,
  clock,
  sourceTaskId,
  childTaskId,
  sourceResultId = 'result-0001',
  workerId = 'worker-a',
  childSpec,
) {
  const setup = driveToClaimed(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    sourceResultId,
    workerId,
    childSpec,
  );
  const attempt = store.persistDispatchAttempt({ sourceTaskId, workerId });
  clock.advance(1000);
  return { ...setup, attempt };
}

function controllableClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  return {
    get now() {
      return now;
    },
    advance(ms) {
      now += ms;
    },
    provider() {
      return now;
    },
  };
}

// Task 33 setup: the full Task 18~28 durable chain ends with the durable Task
// 28 executor invocation attempt (the exact record Task 29 hands to the
// structured executor). NO durable Task 32 outcome and NO durable Task 33
// receipt exist yet. The child task is READ_ONLY (the only executor capability
// this Task provides).
async function setupReadOnly(prefix, sourceTaskId, childTaskId) {
  const home = makeHome(prefix);
  const clock = controllableClock();
  const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
  const { attempt } = driveToAttempt(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    `result-${sourceTaskId.toLowerCase()}`,
  );
  const request = prepareDispatchTransportRequest({
    store,
    sourceTaskId,
    dispatchId: attempt.dispatchId,
  });
  const accepted = await acceptReceiverDispatch({ request, store });
  assert.equal(accepted.newlyAccepted, true);
  const persisted = await persistExecutorInvocationAttempt({
    dispatchId: attempt.dispatchId,
    store,
  });
  assert.equal(persisted.newlyPersisted, true);
  return { home, clock, store, attempt, dispatchId: attempt.dispatchId, child: childTaskId };
}

// Setup for the BOUNDED_MUTATION capability proof: the full chain runs with a
// BOUNDED_MUTATION child so the durable Task 28 record really carries
// taskKind BOUNDED_MUTATION.
async function setupBoundedMutation(prefix, sourceTaskId, childTaskId) {
  const home = makeHome(prefix);
  const clock = controllableClock();
  const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
  const { attempt } = driveToAttempt(
    store,
    clock,
    sourceTaskId,
    childTaskId,
    `result-${sourceTaskId.toLowerCase()}`,
    'worker-a',
    sampleTaskInput(childTaskId, {
      taskKind: 'BOUNDED_MUTATION',
      mutationBoundary: { allowsWrite: true, forbiddenPaths: [] },
    }),
  );
  const request = prepareDispatchTransportRequest({
    store,
    sourceTaskId,
    dispatchId: attempt.dispatchId,
  });
  await acceptReceiverDispatch({ request, store });
  await persistExecutorInvocationAttempt({ dispatchId: attempt.dispatchId, store });
  return { home, clock, store, attempt, dispatchId: attempt.dispatchId, child: childTaskId };
}

function snapshotHomeBytes(home) {
  const out = {};
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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

function snapshotHomeStats(home) {
  const out = {};
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of sorted) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const stat = statSync(full);
        out[full.slice(home.length + 1)] = { size: stat.size, mtimeMs: stat.mtimeMs };
      }
    }
  };
  walk(home);
  return out;
}

// Boundary greps inspect functional code only; header/line comments
// legitimately document forbidden names as prohibitions.
function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

function receiptPath(home, dispatchId) {
  return executorResultReceiptFilePath(home, dispatchId);
}

function listReceiptFiles(home) {
  try {
    return [...readdirSync(join(home, EXECUTOR_RESULT_RECEIPTS_DIRNAME))].sort();
  } catch {
    return [];
  }
}

function expectedReceiptBytes(record) {
  return JSON.stringify(record, null, 2);
}

function writeReceiptBytes(home, dispatchId, bytes) {
  const path = receiptPath(home, dispatchId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, 'utf8');
  return path;
}

function validStructuredPayload(taskId, overrides = {}) {
  return {
    taskId,
    status: EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
    summary: 'bounded structured executor output',
    proofRefs: ['proof:structured-result'],
    evidenceRefs: ['evidence:structured-result'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function validReceipt(dispatchId, taskId, overrides = {}) {
  return {
    schemaVersion: EXECUTOR_RESULT_RECEIPT_SCHEMA_VERSION,
    dispatchId,
    taskId,
    status: EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
    summary: 'bounded structured executor output',
    proofRefs: ['proof:structured-result'],
    evidenceRefs: ['evidence:structured-result'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function countingStructuredExecutor(impl) {
  const calls = [];
  const executor = async (record) => {
    calls.push({ record });
    return impl(record, calls.length);
  };
  return { calls, executor };
}

function readFlagValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : (args[index + 1] ?? null);
}

// Fake Codex CLI structured-result runner. Simulates the installed CLI
// documented surface: the last-message file is written by the "process" and
// stdout/stderr stay closed.
function fakeCodexStructuredRunner(observation = {}) {
  const calls = [];
  const runner = async ({ command, args, cwd, env }) => {
    calls.push({ command, args: [...args], cwd, env });
    if (observation.verbatim === true) {
      return observation.result;
    }
    if (observation.kind === 'start-failed') {
      return { kind: 'start-failed', errorCode: observation.errorCode ?? 'ENOENT' };
    }
    if (observation.kind === 'terminated-without-exit-status') {
      return { kind: 'terminated-without-exit-status' };
    }
    if (observation.write !== false) {
      const resultFilePath = readFlagValue(args, '--output-last-message');
      if (resultFilePath) {
        const raw =
          observation.raw !== undefined
            ? observation.raw
            : JSON.stringify(observation.payload ?? {});
        writeFileSync(resultFilePath, raw, 'utf8');
      }
    }
    return { kind: 'exited', code: observation.code ?? 0 };
  };
  return { calls, runner };
}

function makeStructuredExecutor(resultDirectory, runner) {
  return createCodexCliStructuredResultExecutor({
    executablePath: FAKE_EXECUTABLE,
    workdir: FAKE_WORKDIR,
    resultDirectory,
    runner,
  });
}

// Strongest "no alternate primitive consulted" probe: every function-valued
// property invocation is recorded with its arguments.
function proxyCountingStore(target) {
  const calls = [];
  const store = new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value === 'function') {
        return (...args) => {
          calls.push({ op: property, args });
          return value.apply(object, args);
        };
      }
      return value;
    },
  });
  return { calls, store };
}

// Simulates a lost exclusive-create race deterministically: the first durable
// receipt read reports "unseen" even though a real winner already exists on
// disk; then create delegates to the real store and loses; winner reads
// delegate.
function receiptRaceLoserStore(store) {
  const calls = [];
  let receiptReads = 0;
  const wrapper = {
    readExecutorResultReceipt: (dispatchId) => {
      receiptReads += 1;
      calls.push({ op: 'readExecutorResultReceipt', readIndex: receiptReads });
      if (receiptReads === 1) return null;
      return store.readExecutorResultReceipt(dispatchId);
    },
    createExecutorResultReceipt: (record) => {
      calls.push({ op: 'createExecutorResultReceipt' });
      return store.createExecutorResultReceipt(record);
    },
    readExecutorInvocationOutcome: (dispatchId) => {
      calls.push({ op: 'readExecutorInvocationOutcome' });
      return store.readExecutorInvocationOutcome(dispatchId);
    },
    readExecutorInvocationAttempt: (dispatchId) => {
      calls.push({ op: 'readExecutorInvocationAttempt' });
      return store.readExecutorInvocationAttempt(dispatchId);
    },
  };
  return { calls, store: wrapper };
}

function runFreshReceiptWorker({ home, dispatchId, taskId, status }) {
  return new Promise((resolveResult, rejectResult) => {
    const code = [
      'let executorCalls = 0;',
      'try {',
      `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
      `  const { persistExecutorResultReceipt } = await import(${JSON.stringify(MODULE_URL)});`,
      '  const executor = async (record) => {',
      '    executorCalls += 1;',
      `    return { schemaVersion: 1, dispatchId: record.dispatchId, outcome: ${JSON.stringify(EXECUTOR_INVOCATION_OUTCOME_ACCEPTED)}, result: { taskId: ${JSON.stringify(taskId)}, status: ${JSON.stringify(status)}, summary: 'race', proofRefs: ['p'], evidenceRefs: ['e'], frictionObserved: ['NONE'] } };`,
      '  };',
      `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
      `  const result = await persistExecutorResultReceipt({ dispatchId: ${JSON.stringify(dispatchId)}, store, executor });`,
      `  const record = store.readExecutorResultReceipt(${JSON.stringify(dispatchId)});`,
      '  console.log(JSON.stringify({ ok: true, result, record, executorCalls }));',
      '} catch (error) {',
      '  console.log(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error), executorCalls }));',
      '}',
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
      const line = stdout
        .split('\n')
        .reverse()
        .find((entry) => entry.trim().length > 0);
      if (!line) {
        rejectResult(new Error(`receipt worker produced no output (exit=${exitCode}): ${stderr}`));
        return;
      }
      resolveResult(JSON.parse(line));
    });
  });
}

function errorWithCode(code) {
  return (error) => error instanceof Error && error.code === code;
}

async function assertExactCapture(prefix, sourceTaskId, childTaskId, status) {
  const { home, store, dispatchId, child } = await setupReadOnly(prefix, sourceTaskId, childTaskId);
  const resultDirectory = makeHome(`${prefix}result-`);
  try {
    const before = snapshotHomeBytes(home);
    const { calls, runner } = fakeCodexStructuredRunner({
      kind: 'exited',
      code: 0,
      payload: validStructuredPayload(child, { status }),
    });
    const executor = makeStructuredExecutor(resultDirectory, runner);
    const result = await persistExecutorResultReceipt({ dispatchId, store, executor });

    // Exact minimal result shape, frozen.
    assert.deepEqual(result, {
      dispatchId,
      newlyRecorded: true,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      receipt: validReceipt(dispatchId, child, { status }),
    });
    assert.deepEqual(Object.keys(result), [...EXECUTOR_RESULT_RECEIPT_PERSISTENCE_NEW_FIELDS]);
    assert.equal(Object.isFrozen(result), true);

    // Exactly one process invocation.
    assert.equal(calls.length, 1);

    // The durable value is EXACTLY the eight-field receipt with fixed order.
    const path = receiptPath(home, dispatchId);
    const record = validReceipt(dispatchId, child, { status });
    assert.equal(readFileSync(path, 'utf8'), expectedReceiptBytes(record));
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), record);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, 'utf8'))), [
      ...EXECUTOR_RESULT_RECEIPT_FIELDS,
    ]);
    assert.deepEqual(store.readExecutorResultReceipt(dispatchId), record);
    assert.equal(Object.isFrozen(store.readExecutorResultReceipt(dispatchId)), true);
    for (const token of FORBIDDEN_RECEIPT_TOKENS) {
      assert.equal(readFileSync(path, 'utf8').includes(token), false, token);
    }
    assert.equal(/\d{4}-\d{2}-\d{2}T/.test(readFileSync(path, 'utf8')), false);

    // Exactly one new durable path: the receipt record.
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    assert.deepEqual(added, [join(EXECUTOR_RESULT_RECEIPTS_DIRNAME, `${dispatchId}.json`)]);
    assert.deepEqual(listReceiptFiles(home), [`${dispatchId}.json`]);

    // No canonical result / ACK / disposition artifact exists.
    assert.equal(existsSync(join(home, 'tasks', child, 'result.json')), false);
    assert.equal(existsSync(join(home, 'tasks', child, 'ack.json')), false);
    assert.equal(existsSync(join(home, 'tasks', child, 'disposition')), false);
    assert.equal(existsSync(join(home, 'tasks', child, 'results')), false);
    assert.equal(store.readTask(child).status, TASK_STATUS_CLAIMED);
    return { home, store, dispatchId, child, record, result, calls, executor };
  } finally {
    removeHome(resultDirectory);
  }
}

// ---------------------------------------------------------------------------
// A. VALID READ_ONLY STRUCTURED RESULT -> EXACT DURABLE RECEIPT, PROCESS 1.
// ---------------------------------------------------------------------------

test('A. a valid READ_ONLY structured result is durably recorded exactly once with exactly one process invocation', async () => {
  const { home, dispatchId, child, record } = await assertExactCapture(
    'greenhub-executor-result-receipt33-a-',
    'ERR33-A-SRC',
    'ERR33-A-CHILD',
    EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
  );
  try {
    // Durable replay: byte-identical read-back from a fresh store instance.
    const freshStore = new CoordinationStore({ dir: home });
    assert.deepEqual(freshStore.readExecutorResultReceipt(dispatchId), record);
    assert.deepEqual(Object.keys(record), [...EXECUTOR_RESULT_RECEIPT_FIELDS]);
    assert.equal(record.taskId, child);
  } finally {
    removeHome(home);
  }
});

test('A2. exact shell-free argv: configured executable, READ_ONLY sandbox, structured-output flags, ONE payload argv', async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-a2-',
    'ERR33-A2-SRC',
    'ERR33-A2-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-a2-result-');
  try {
    const durable = store.readExecutorInvocationAttempt(dispatchId);
    const { calls, runner } = fakeCodexStructuredRunner({
      kind: 'exited',
      code: 0,
      payload: validStructuredPayload('ERR33-A2-CHILD'),
    });
    const executor = makeStructuredExecutor(resultDirectory, runner);
    await persistExecutorResultReceipt({ dispatchId, store, executor });
    assert.equal(calls.length, 1);
    const { command, args, cwd } = calls[0];
    assert.equal(command, FAKE_EXECUTABLE);
    assert.equal(cwd, FAKE_WORKDIR);
    assert.deepEqual(args.slice(0, 3), ['exec', '--sandbox', 'read-only']);
    assert.equal(args.includes('--ephemeral'), true);
    assert.equal(args.includes('--output-schema'), true);
    assert.equal(args.includes('--output-last-message'), true);
    assert.equal(readFlagValue(args, '--cd'), FAKE_WORKDIR);
    // The Task 28 record is ONE argv element and is never shell-interpreted.
    assert.equal(args[args.length - 1], JSON.stringify(durable));
    assert.equal(args.length, 11);
    // No shell interpolation: no argument is a concatenated command string.
    for (const arg of args) {
      assert.equal(arg.includes(' && '), false);
      assert.equal(arg.includes(' | '), false);
    }
    // The prompt carries the EXACT durable Task 28 record.
    assert.equal(JSON.parse(args[args.length - 1]).dispatchId, dispatchId);
    assert.equal(JSON.parse(args[args.length - 1]).decisionInput.task.taskKind, 'READ_ONLY');
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. STATUS IS TAKEN FROM THE EXECUTOR PAYLOAD, NOT THE PROCESS EXIT CODE.
// ---------------------------------------------------------------------------

test('B. SUCCEEDED / FAILED / BLOCKED are validated from the payload independently of exit code 0', async () => {
  assert.deepEqual(
    [...EXECUTOR_RESULT_RECEIPT_STATUS_VALUES],
    [
      EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
      EXECUTOR_RESULT_RECEIPT_STATUS_FAILED,
      EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED,
    ],
  );
  for (const status of EXECUTOR_RESULT_RECEIPT_STATUS_VALUES) {
    const { home, store, dispatchId } = await setupReadOnly(
      `greenhub-executor-result-receipt33-b-${status.toLowerCase()}-`,
      `ERR33-B-${status}-SRC`,
      `ERR33-B-${status}-CHILD`,
    );
    const resultDirectory = makeHome(`greenhub-executor-result-receipt33-b-${status}-result-`);
    try {
      const { calls, runner } = fakeCodexStructuredRunner({
        kind: 'exited',
        code: 0,
        payload: validStructuredPayload(`ERR33-B-${status}-CHILD`, { status }),
      });
      const executor = makeStructuredExecutor(resultDirectory, runner);
      const result = await persistExecutorResultReceipt({ dispatchId, store, executor });
      assert.equal(calls.length, 1);
      assert.equal(result.outcome, EXECUTOR_INVOCATION_OUTCOME_ACCEPTED);
      assert.equal(result.receipt.status, status);
      // Exit code 0 is never mapped to SUCCEEDED by itself.
      if (status !== EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED) {
        assert.notEqual(result.receipt.status, EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED);
      }
    } finally {
      removeHome(resultDirectory);
      removeHome(home);
    }
  }
});

// ---------------------------------------------------------------------------
// C. REPLAY: PROCESS 0, WRITE 0, BYTES/MTIME UNCHANGED.
// ---------------------------------------------------------------------------

test('C. an existing durable receipt replays with zero executor invocations and byte/mtime-identical state', async () => {
  const { home, store, dispatchId, child } = await setupReadOnly(
    'greenhub-executor-result-receipt33-c-',
    'ERR33-C-SRC',
    'ERR33-C-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-c-result-');
  try {
    const { runner } = fakeCodexStructuredRunner({
      kind: 'exited',
      code: 0,
      payload: validStructuredPayload(child),
    });
    const executor = makeStructuredExecutor(resultDirectory, runner);
    const first = await persistExecutorResultReceipt({ dispatchId, store, executor });
    assert.equal(first.newlyRecorded, true);

    const bytesBefore = snapshotHomeBytes(home);
    const statsBefore = snapshotHomeStats(home);
    const { calls: replayCalls, executor: replayExecutor } = countingStructuredExecutor(() => {
      throw new Error('the executor must never run when a durable receipt exists');
    });
    const replay = await persistExecutorResultReceipt({
      dispatchId,
      store,
      executor: replayExecutor,
    });
    assert.deepEqual(replay, {
      dispatchId,
      newlyRecorded: false,
      exactReplay: true,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      receipt: validReceipt(dispatchId, child),
    });
    assert.deepEqual(Object.keys(replay), [...EXECUTOR_RESULT_RECEIPT_PERSISTENCE_REPLAY_FIELDS]);
    assert.equal(Object.isFrozen(replay), true);
    assert.equal(replayCalls.length, 0);
    assert.deepEqual(snapshotHomeBytes(home), bytesBefore);
    assert.deepEqual(snapshotHomeStats(home), statsBefore);
    assert.deepEqual(listReceiptFiles(home), [`${dispatchId}.json`]);
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. MALFORMED STRUCTURED OUTPUT -> FAIL CLOSED, RECEIPT 0.
// ---------------------------------------------------------------------------

test('D. malformed structured output fails closed with zero receipts', async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-d-',
    'ERR33-D-SRC',
    'ERR33-D-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-d-result-');
  try {
    const malformedRaws = [
      ['empty file', ''],
      ['not JSON', 'not-json'],
      ['array', '[]'],
      ['null', 'null'],
      ['number', '42'],
      ['string', '"payload"'],
      ['empty object', '{}'],
      [
        'missing summary',
        JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { summary: undefined })),
      ],
      ['extra field', JSON.stringify({ ...validStructuredPayload('ERR33-D-CHILD'), extra: 1 })],
      [
        'invalid status',
        JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { status: 'ACCEPTED' })),
      ],
      [
        'empty summary',
        JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { summary: '   ' })),
      ],
      [
        'oversized summary',
        JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { summary: 'x'.repeat(2001) })),
      ],
      [
        'proofRefs not array',
        JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { proofRefs: 'ref' })),
      ],
      [
        'oversized proofRef',
        JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { proofRefs: ['x'.repeat(513)] })),
      ],
      [
        'non-string proofRef',
        JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { proofRefs: [42] })),
      ],
      [
        'evidenceRefs null entry',
        JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { evidenceRefs: [null] })),
      ],
      [
        'frictionObserved not array',
        JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { frictionObserved: 'NONE' })),
      ],
      [
        'oversized frictionObserved',
        JSON.stringify(
          validStructuredPayload('ERR33-D-CHILD', {
            frictionObserved: Array.from({ length: 33 }, (_, index) => `f${index}`),
          }),
        ),
      ],
      [
        'oversized friction entry',
        JSON.stringify(
          validStructuredPayload('ERR33-D-CHILD', { frictionObserved: ['x'.repeat(513)] }),
        ),
      ],
      [
        'invalid taskId format',
        JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { taskId: 'not a task id' })),
      ],
      ['numeric taskId', JSON.stringify(validStructuredPayload('ERR33-D-CHILD', { taskId: 42 }))],
    ];
    for (const [label, raw] of malformedRaws) {
      const { calls, runner } = fakeCodexStructuredRunner({ kind: 'exited', code: 0, raw });
      const executor = makeStructuredExecutor(resultDirectory, runner);
      await assert.rejects(
        persistExecutorResultReceipt({ dispatchId, store, executor }),
        errorWithCode(INVALID_EXECUTOR_STRUCTURED_RESULT),
        label,
      );
      assert.equal(calls.length, 1, label);
    }

    // taskId mismatch (valid format, wrong identity) is its own fail-closed
    // binding meaning.
    const { calls, runner } = fakeCodexStructuredRunner({
      kind: 'exited',
      code: 0,
      payload: validStructuredPayload('ERR33-D-OTHER'),
    });
    const executor = makeStructuredExecutor(resultDirectory, runner);
    await assert.rejects(
      persistExecutorResultReceipt({ dispatchId, store, executor }),
      errorWithCode(EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH),
    );
    assert.equal(calls.length, 1);

    assert.deepEqual(listReceiptFiles(home), []);
    assert.equal(existsSync(join(home, EXECUTOR_RESULT_RECEIPTS_DIRNAME)), false);
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. MISSING STRUCTURED OUTPUT -> FAIL CLOSED, RECEIPT 0.
// ---------------------------------------------------------------------------

test('E. exit 0 without a structured result file fails closed with zero receipts', async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-e-',
    'ERR33-E-SRC',
    'ERR33-E-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-e-result-');
  try {
    const { calls, runner } = fakeCodexStructuredRunner({ kind: 'exited', code: 0, write: false });
    const executor = makeStructuredExecutor(resultDirectory, runner);
    await assert.rejects(
      persistExecutorResultReceipt({ dispatchId, store, executor }),
      errorWithCode(MISSING_EXECUTOR_STRUCTURED_RESULT),
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(listReceiptFiles(home), []);
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. DISPATCHID MISMATCH -> FAIL CLOSED.
// ---------------------------------------------------------------------------

test('F. dispatchId mismatch fails closed in the envelope and in the durable key binding', async () => {
  const { home, store, dispatchId, child } = await setupReadOnly(
    'greenhub-executor-result-receipt33-f-',
    'ERR33-F-SRC',
    'ERR33-F-CHILD',
  );
  try {
    // Envelope-level dispatchId mismatch with an otherwise valid result.
    const { calls, executor } = countingStructuredExecutor(() => ({
      schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
      dispatchId: 'dsp_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      result: validStructuredPayload(child),
    }));
    await assert.rejects(
      persistExecutorResultReceipt({ dispatchId, store, executor }),
      errorWithCode(EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH),
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(listReceiptFiles(home), []);

    // Durable key/binding mismatch: a valid receipt for another dispatchId
    // stored under this key fails closed with zero process invocation.
    const foreign = validReceipt(
      'dsp_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      child,
    );
    writeReceiptBytes(home, dispatchId, expectedReceiptBytes(foreign));
    const before = readFileSync(receiptPath(home, dispatchId), 'utf8');
    const { calls: processCalls, executor: replayExecutor } = countingStructuredExecutor(() => {
      throw new Error('the executor must never run on a corrupt durable receipt');
    });
    await assert.rejects(
      persistExecutorResultReceipt({ dispatchId, store, executor: replayExecutor }),
      errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
    );
    assert.equal(processCalls.length, 0);
    assert.equal(readFileSync(receiptPath(home, dispatchId), 'utf8'), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. TASKID MISMATCH -> FAIL CLOSED.
// ---------------------------------------------------------------------------

test('G. taskId mismatch fails closed on the concrete and composition paths', async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-g-',
    'ERR33-G-SRC',
    'ERR33-G-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-g-result-');
  try {
    // Concrete Codex executor path: the process writes a valid payload for a
    // different task.
    const concrete = fakeCodexStructuredRunner({
      kind: 'exited',
      code: 0,
      payload: validStructuredPayload('ERR33-G-OTHER'),
    });
    await assert.rejects(
      persistExecutorResultReceipt({
        dispatchId,
        store,
        executor: makeStructuredExecutor(resultDirectory, concrete.runner),
      }),
      errorWithCode(EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH),
    );
    assert.equal(concrete.calls.length, 1);

    // Composition path: a caller-supplied executor returns a mismatched
    // payload after receiving the exact Task 28 record.
    const { calls, executor } = countingStructuredExecutor(() => ({
      schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
      dispatchId,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      result: validStructuredPayload('ERR33-G-OTHER'),
    }));
    await assert.rejects(
      persistExecutorResultReceipt({ dispatchId, store, executor }),
      errorWithCode(EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH),
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(listReceiptFiles(home), []);
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. ENVELOPE SHAPE / STATUS / OVERSIZE FAIL-CLOSED MATRIX.
// ---------------------------------------------------------------------------

test('H. envelope extra fields, invalid status, invalid schemaVersion, and contradictory results fail closed', async () => {
  const { home, store, dispatchId, child } = await setupReadOnly(
    'greenhub-executor-result-receipt33-h-',
    'ERR33-H-SRC',
    'ERR33-H-CHILD',
  );
  try {
    const validEnvelope = () => ({
      schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
      dispatchId,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      result: validStructuredPayload(child),
    });
    const cases = [
      ['non-record', null, INVALID_EXECUTOR_STRUCTURED_RESULT],
      ['array envelope', [], INVALID_EXECUTOR_STRUCTURED_RESULT],
      [
        'missing field',
        { schemaVersion: 1, dispatchId, outcome: 'ACCEPTED' },
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      ],
      ['extra field', { ...validEnvelope(), extra: true }, INVALID_EXECUTOR_STRUCTURED_RESULT],
      [
        'invalid schemaVersion',
        { ...validEnvelope(), schemaVersion: '1' },
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      ],
      [
        'invalid outcome',
        { ...validEnvelope(), outcome: 'SUCCEEDED' },
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      ],
      [
        'ACCEPTED without payload',
        { ...validEnvelope(), result: null },
        MISSING_EXECUTOR_STRUCTURED_RESULT,
      ],
      [
        'REJECTED with payload',
        { ...validEnvelope(), outcome: EXECUTOR_INVOCATION_OUTCOME_REJECTED },
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      ],
      [
        'UNKNOWN with payload',
        { ...validEnvelope(), outcome: EXECUTOR_INVOCATION_OUTCOME_UNKNOWN },
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      ],
      [
        'payload extra field',
        { ...validEnvelope(), result: { ...validStructuredPayload(child), extra: 1 } },
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      ],
      [
        'payload invalid status',
        { ...validEnvelope(), result: validStructuredPayload(child, { status: 'DONE' }) },
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      ],
      [
        'payload oversized summary',
        {
          ...validEnvelope(),
          result: validStructuredPayload(child, { summary: 'x'.repeat(2001) }),
        },
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      ],
      [
        'payload oversized proofRef',
        {
          ...validEnvelope(),
          result: validStructuredPayload(child, { proofRefs: ['x'.repeat(513)] }),
        },
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      ],
    ];
    for (const [label, envelope, expectedCode] of cases) {
      const { calls, executor } = countingStructuredExecutor(() => envelope);
      await assert.rejects(
        persistExecutorResultReceipt({ dispatchId, store, executor }),
        errorWithCode(expectedCode),
        label,
      );
      assert.equal(calls.length, 1, label);
    }

    // A module-thrown fail-closed error keeps the receipt error class.
    const { executor: classExecutor } = countingStructuredExecutor(() => null);
    await assert.rejects(
      persistExecutorResultReceipt({ dispatchId, store, executor: classExecutor }),
      (error) =>
        error instanceof ExecutorResultReceiptError &&
        error.code === INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
    assert.deepEqual(listReceiptFiles(home), []);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// GATE. INCOMPLETE STORE / INVALID EXECUTOR / INVALID IDENTITY FAIL CLOSED.
// ---------------------------------------------------------------------------

test('GATE. an incomplete store, invalid executor, or invalid dispatchId fails closed with zero reads, writes, or process', async () => {
  const home = makeHome('greenhub-executor-result-receipt33-gate-');
  const store = new CoordinationStore({ dir: home });
  const dispatchId = `dsp_${'c'.repeat(64)}`;
  try {
    const required = [
      'readExecutorResultReceipt',
      'createExecutorResultReceipt',
      'readExecutorInvocationOutcome',
      'readExecutorInvocationAttempt',
    ];
    const base = {
      readExecutorResultReceipt: () => null,
      createExecutorResultReceipt: () => ({ created: true }),
      readExecutorInvocationOutcome: () => null,
      readExecutorInvocationAttempt: () => {
        throw new Error('an incomplete store must never be read');
      },
    };
    for (const key of required) {
      const incomplete = { ...base };
      delete incomplete[key];
      const { calls, executor } = countingStructuredExecutor(() => {
        throw new Error('the executor must never run with an incomplete store');
      });
      await assert.rejects(
        persistExecutorResultReceipt({ dispatchId, store: incomplete, executor }),
        errorWithCode(INVALID_EXECUTOR_RESULT_RECEIPT_STORE),
        key,
      );
      assert.equal(calls.length, 0, key);
    }
    for (const invalidStore of [undefined, null, {}, 'store']) {
      const { executor } = countingStructuredExecutor(() => {
        throw new Error('the executor must never run with an invalid store');
      });
      await assert.rejects(
        persistExecutorResultReceipt({ dispatchId, store: invalidStore, executor }),
        errorWithCode(INVALID_EXECUTOR_RESULT_RECEIPT_STORE),
        String(invalidStore),
      );
    }
    // Invalid executor identity fails closed before Task 29 composition.
    await assert.rejects(
      persistExecutorResultReceipt({ dispatchId, store, executor: 'not-fn' }),
      errorWithCode(INVALID_EXECUTOR_INVOCATION_ADAPTER),
    );
    // Invalid dispatchId fails closed before any durable read.
    const { store: spyStore, calls: spyCalls } = proxyCountingStore(store);
    await assert.rejects(
      persistExecutorResultReceipt({
        dispatchId: 'not-an-id',
        store: spyStore,
        executor: () => undefined,
      }),
      errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
    );
    assert.equal(spyCalls.length, 0);
    assert.deepEqual(listReceiptFiles(home), []);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I. PROCESS START FAILURE -> TASK 31 TYPED MEANING, RECEIPT 0.
// ---------------------------------------------------------------------------

test('I. process start failure preserves the Task 31 typed meaning and creates zero receipts', async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-i-',
    'ERR33-I-SRC',
    'ERR33-I-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-i-result-');
  try {
    for (const errorCode of ['ENOENT', 'EACCES', 'EPERM', 'EMFILE']) {
      const { calls, runner } = fakeCodexStructuredRunner({ kind: 'start-failed', errorCode });
      const executor = makeStructuredExecutor(resultDirectory, runner);
      await assert.rejects(
        persistExecutorResultReceipt({ dispatchId, store, executor }),
        (error) =>
          error instanceof CodexCliExecutorAdapterError &&
          error.code === CODEX_CLI_EXECUTOR_PROCESS_START_FAILED,
        errorCode,
      );
      assert.equal(calls.length, 1, errorCode);
    }
    assert.deepEqual(listReceiptFiles(home), []);
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// J. NON-ZERO EXIT -> TASK 30 REJECTED SEMANTICS, NO FABRICATED RECEIPT.
// ---------------------------------------------------------------------------

test('J. a non-zero exit preserves Task 30 REJECTED semantics with zero fabricated receipts', async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-j-',
    'ERR33-J-SRC',
    'ERR33-J-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-j-result-');
  try {
    for (const code of [1, 2, 64, 127, 255, 9009]) {
      const { calls, runner } = fakeCodexStructuredRunner({ kind: 'exited', code });
      const executor = makeStructuredExecutor(resultDirectory, runner);
      const result = await persistExecutorResultReceipt({ dispatchId, store, executor });
      assert.deepEqual(result, {
        dispatchId,
        newlyRecorded: false,
        outcome: EXECUTOR_INVOCATION_OUTCOME_REJECTED,
        receipt: null,
      });
      assert.equal(calls.length, 1, `code ${code}`);
    }
    assert.deepEqual(listReceiptFiles(home), []);
    assert.equal(store.readTask('ERR33-J-CHILD').status, TASK_STATUS_CLAIMED);
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. UNKNOWN -> TASK 30 SEMANTICS, NO RETRY, NO FABRICATED RECEIPT.
// ---------------------------------------------------------------------------

test('K. an unobservable exit status preserves Task 30 UNKNOWN semantics with no retry and zero fabricated receipts', async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-k-',
    'ERR33-K-SRC',
    'ERR33-K-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-k-result-');
  try {
    const { calls, runner } = fakeCodexStructuredRunner({
      kind: 'terminated-without-exit-status',
    });
    const executor = makeStructuredExecutor(resultDirectory, runner);
    const result = await persistExecutorResultReceipt({ dispatchId, store, executor });
    assert.deepEqual(result, {
      dispatchId,
      newlyRecorded: false,
      outcome: EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
      receipt: null,
    });
    // Exactly one process attempt: UNKNOWN never triggers an internal retry.
    assert.equal(calls.length, 1);
    assert.deepEqual(listReceiptFiles(home), []);
    // No Task 32 durable outcome was fabricated either.
    assert.equal(existsSync(join(home, EXECUTOR_INVOCATION_OUTCOMES_DIRNAME)), false);
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// L. EXCLUSIVE-CREATE SAME-RESULT RACE -> IDEMPOTENT CONVERGENCE.
// ---------------------------------------------------------------------------

test('L. an exclusive-create race loser with the same valid winner converges idempotently', async () => {
  const { home, store, dispatchId, child } = await setupReadOnly(
    'greenhub-executor-result-receipt33-l-',
    'ERR33-L-SRC',
    'ERR33-L-CHILD',
  );
  try {
    const winner = validReceipt(dispatchId, child);
    assert.deepEqual(store.createExecutorResultReceipt(winner), { created: true });
    const winnerBytes = readFileSync(receiptPath(home, dispatchId), 'utf8');
    const { store: racyStore, calls } = receiptRaceLoserStore(store);
    const { calls: executorCalls, executor } = countingStructuredExecutor(() => ({
      schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
      dispatchId,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      result: validStructuredPayload(child),
    }));
    const result = await persistExecutorResultReceipt({
      dispatchId,
      store: racyStore,
      executor,
    });
    assert.deepEqual(result, {
      dispatchId,
      newlyRecorded: false,
      exactReplay: true,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      receipt: winner,
    });
    assert.equal(executorCalls.length, 1);
    assert.deepEqual(
      calls.map((call) => call.op),
      [
        'readExecutorResultReceipt',
        'readExecutorInvocationOutcome',
        'readExecutorInvocationAttempt',
        'createExecutorResultReceipt',
        'readExecutorResultReceipt',
      ],
    );
    assert.equal(readFileSync(receiptPath(home, dispatchId), 'utf8'), winnerBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. EXCLUSIVE-CREATE DIFFERENT-RESULT RACE -> CONFLICT, WINNER PRESERVED.
// ---------------------------------------------------------------------------

test('M. an exclusive-create race loser with a different valid winner conflicts and the first winner is preserved', async () => {
  const { home, store, dispatchId, child } = await setupReadOnly(
    'greenhub-executor-result-receipt33-m-',
    'ERR33-M-SRC',
    'ERR33-M-CHILD',
  );
  try {
    const winner = validReceipt(dispatchId, child, {
      status: EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
    });
    assert.deepEqual(store.createExecutorResultReceipt(winner), { created: true });
    const winnerBytes = readFileSync(receiptPath(home, dispatchId), 'utf8');
    const { store: racyStore } = receiptRaceLoserStore(store);
    const { calls: executorCalls, executor } = countingStructuredExecutor(() => ({
      schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
      dispatchId,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      result: validStructuredPayload(child, { status: EXECUTOR_RESULT_RECEIPT_STATUS_FAILED }),
    }));
    await assert.rejects(
      persistExecutorResultReceipt({ dispatchId, store: racyStore, executor }),
      errorWithCode(EXECUTOR_RESULT_RECEIPT_CONFLICT),
    );
    assert.equal(executorCalls.length, 1);
    assert.equal(readFileSync(receiptPath(home, dispatchId), 'utf8'), winnerBytes);
    assert.deepEqual(store.readExecutorResultReceipt(dispatchId), winner);

    // A corrupt winner also fails closed with no repair.
    writeReceiptBytes(home, dispatchId, '{ not json');
    const corruptBytes = readFileSync(receiptPath(home, dispatchId), 'utf8');
    const { store: corruptRacyStore } = receiptRaceLoserStore(store);
    const { calls: corruptExecutorCalls, executor: corruptExecutor } = countingStructuredExecutor(
      () => ({
        schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
        dispatchId,
        outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
        result: validStructuredPayload(child),
      }),
    );
    await assert.rejects(
      persistExecutorResultReceipt({
        dispatchId,
        store: corruptRacyStore,
        executor: corruptExecutor,
      }),
      errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
    );
    assert.equal(corruptExecutorCalls.length, 1);
    assert.equal(readFileSync(receiptPath(home, dispatchId), 'utf8'), corruptBytes);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. CORRUPT DURABLE RECEIPT -> FAIL CLOSED, NO REPAIR, PROCESS 0.
// ---------------------------------------------------------------------------

test('N. a corrupt durable receipt fails closed with no repair and zero process when observed before invocation', async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-n-',
    'ERR33-N-SRC',
    'ERR33-N-CHILD',
  );
  try {
    const corruptions = [
      '{ not json',
      JSON.stringify({ ...validReceipt(dispatchId, 'ERR33-N-CHILD'), extra: 1 }),
      JSON.stringify(validReceipt(dispatchId, 'ERR33-N-CHILD', { schemaVersion: 2 })),
      JSON.stringify(validReceipt(dispatchId, 'ERR33-N-CHILD', { status: 'DONE' })),
      JSON.stringify(validReceipt(dispatchId, 'ERR33-N-CHILD', { summary: '' })),
    ];
    for (const bytes of corruptions) {
      writeReceiptBytes(home, dispatchId, bytes);
      const before = readFileSync(receiptPath(home, dispatchId), 'utf8');
      const { calls, executor } = countingStructuredExecutor(() => {
        throw new Error('the executor must never run when the durable receipt is corrupt');
      });
      await assert.rejects(
        persistExecutorResultReceipt({ dispatchId, store, executor }),
        errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
        bytes,
      );
      assert.equal(calls.length, 0, bytes);
      assert.equal(readFileSync(receiptPath(home, dispatchId), 'utf8'), before, bytes);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// O. TASK/CLAIM/RESULT/DISPOSITION/ACK BYTES AND STATUSES UNCHANGED.
// ---------------------------------------------------------------------------

test('O. a full capture mutates no task, claim, result, disposition, or ACK byte', async () => {
  const { home, store, dispatchId, child } = await setupReadOnly(
    'greenhub-executor-result-receipt33-o-',
    'ERR33-O-SRC',
    'ERR33-O-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-o-result-');
  try {
    const before = snapshotHomeBytes(home);
    const { runner } = fakeCodexStructuredRunner({
      kind: 'exited',
      code: 0,
      payload: validStructuredPayload(child),
    });
    const executor = makeStructuredExecutor(resultDirectory, runner);
    await persistExecutorResultReceipt({ dispatchId, store, executor });
    const after = snapshotHomeBytes(home);
    const added = Object.keys(after).filter((name) => !(name in before));
    const removed = Object.keys(before).filter((name) => !(name in after));
    assert.deepEqual(added, [join(EXECUTOR_RESULT_RECEIPTS_DIRNAME, `${dispatchId}.json`)]);
    assert.deepEqual(removed, []);
    for (const name of Object.keys(before)) {
      assert.equal(after[name], before[name], name);
    }
    assert.equal(store.readTask(child).status, TASK_STATUS_CLAIMED);
    assert.equal(store.readTask(child).status === TASK_STATUS_RESULT_DELIVERED, false);
    assert.equal(existsSync(join(home, 'tasks', child, 'result.json')), false);
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// P. NO deliverResult / CANONICAL RESULT / ACK AUTHORITY.
// ---------------------------------------------------------------------------

test('P. store.deliverResult is never called and no canonical result or ACK primitive is consulted', async () => {
  const { home, store, dispatchId, child } = await setupReadOnly(
    'greenhub-executor-result-receipt33-p-',
    'ERR33-P-SRC',
    'ERR33-P-CHILD',
  );
  try {
    const { calls, store: spyStore } = proxyCountingStore(store);
    const { executor } = countingStructuredExecutor(() => ({
      schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
      dispatchId,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      result: validStructuredPayload(child),
    }));
    const result = await persistExecutorResultReceipt({
      dispatchId,
      store: spyStore,
      executor,
    });
    assert.equal(result.newlyRecorded, true);
    assert.deepEqual(
      calls.map((call) => call.op),
      [
        'readExecutorResultReceipt',
        'readExecutorInvocationOutcome',
        'readExecutorInvocationAttempt',
        'createExecutorResultReceipt',
        'readExecutorResultReceipt',
      ],
    );
    for (const call of calls) {
      assert.notEqual(call.op, 'deliverResult');
      assert.notEqual(call.op, 'markReady');
      assert.notEqual(call.op, 'claimTask');
      assert.notEqual(call.op, 'beginDisposition');
      assert.notEqual(call.op, 'writeDisposition');
      assert.notEqual(call.op, 'materializeAdoption');
      assert.notEqual(call.op, 'ackAdoption');
      assert.notEqual(call.op, 'markConsumed');
    }

    // Static: functional code carries no canonical-result/ACK authority.
    const source = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
    for (const token of [
      'deliverResult',
      'RESULT_DELIVERED',
      'TASK_STATUS_RUNNING',
      'beginDisposition',
      'writeDisposition',
      'materializeAdoption',
      'ackAdoption',
      'markConsumed',
      'markReady',
      'claimTask',
      'emitNextTask',
      'admitEmittedTask',
      'claimAdmittedTask',
    ]) {
      assert.equal(source.includes(token), false, token);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// Q. NO RUNNING STATUS / NEW STATUS / NEW GENERATION AUTHORITY.
// ---------------------------------------------------------------------------

test('Q. no RUNNING status, new task status, or new generation authority exists', async () => {
  const source = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
  assert.equal(source.includes("'RUNNING'"), false);
  assert.equal(source.includes('"RUNNING"'), false);
  assert.equal(source.includes('TASK_STATUS_RUNNING'), false);
  assert.deepEqual([...TASK_STATUSES], ['CREATED', 'READY', 'CLAIMED', 'RESULT_DELIVERED']);

  const { home, store, dispatchId, child } = await setupReadOnly(
    'greenhub-executor-result-receipt33-q-',
    'ERR33-Q-SRC',
    'ERR33-Q-CHILD',
  );
  try {
    const claimBefore = store.readClaim(child);
    const { executor } = countingStructuredExecutor(() => ({
      schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
      dispatchId,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      result: validStructuredPayload(child),
    }));
    await persistExecutorResultReceipt({ dispatchId, store, executor });
    const claimAfter = store.readClaim(child);
    assert.equal(claimAfter.generation, claimBefore.generation);
    assert.equal(claimAfter.claimToken, claimBefore.claimToken);
    assert.equal(store.readTask(child).status, TASK_STATUS_CLAIMED);
    // The receipt carries no generation / claim / worker field.
    for (const forbidden of [
      'workerId',
      'claimToken',
      'claimGeneration',
      'generation',
      'deliveredAt',
      'resultId',
      'usage',
    ]) {
      assert.equal(Object.hasOwn(store.readExecutorResultReceipt(dispatchId), forbidden), false);
    }
    assert.deepEqual(Object.keys(store.readExecutorResultReceipt(dispatchId)), [
      ...EXECUTOR_RESULT_RECEIPT_FIELDS,
    ]);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// R. PREDECESSOR PUBLIC SURFACES INTACT.
// ---------------------------------------------------------------------------

test('R. Task 28/29/30/31/32 predecessor public surfaces stay intact', async () => {
  assert.equal(typeof persistExecutorInvocationAttempt, 'function');
  assert.equal(typeof invokeExecutorInvocationAdapter, 'function');
  assert.equal(typeof invokeExecutorAndValidateOutcome, 'function');
  assert.equal(typeof persistExecutorInvocationOutcome, 'function');
  assert.equal(typeof createCodexCliExecutorAdapter, 'function');
  assert.equal(EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION, 1);
  assert.equal(EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND, 'EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND');
  assert.equal(typeof CoordinationStore.prototype.readExecutorInvocationOutcome, 'function');
  assert.equal(typeof CoordinationStore.prototype.createExecutorInvocationOutcome, 'function');
  assert.equal(typeof CoordinationStore.prototype.readExecutorInvocationAttempt, 'function');
  assert.equal(typeof CoordinationStore.prototype.createExecutorInvocationAttempt, 'function');
  assert.equal(typeof CoordinationStore.prototype.readReceiverDispatchAcceptance, 'function');
  assert.equal(typeof CoordinationStore.prototype.createReceiverDispatchAcceptance, 'function');
  assert.equal(typeof CoordinationStore.prototype.readDispatchAttempt, 'function');
  assert.equal(typeof CoordinationStore.prototype.deliverResult, 'function');
  assert.equal(EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME, 'executor-invocation-attempts');
  assert.equal(EXECUTOR_INVOCATION_OUTCOMES_DIRNAME, 'executor-invocation-outcomes');
  assert.equal(receiptModule.EXECUTOR_RESULT_RECEIPTS_DIRNAME, 'executor-result-receipts');
});

// ---------------------------------------------------------------------------
// S. REAL TWO-PROCESS RACE: ONE DURABLE WINNER, NO EXACTLY-ONCE OVERCLAIM.
// ---------------------------------------------------------------------------

test('S. two real processes race one dispatchId: exactly one durable winner, total executor invocation <= 2', {
  timeout: 120_000,
}, async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-s-',
    'ERR33-S-SRC',
    'ERR33-S-CHILD',
  );
  try {
    const [succeeded, failed] = await Promise.all([
      runFreshReceiptWorker({
        home,
        dispatchId,
        taskId: 'ERR33-S-CHILD',
        status: EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
      }),
      runFreshReceiptWorker({
        home,
        dispatchId,
        taskId: 'ERR33-S-CHILD',
        status: EXECUTOR_RESULT_RECEIPT_STATUS_FAILED,
      }),
    ]);
    const workers = [succeeded, failed];
    const okWorkers = workers.filter((worker) => worker.ok);
    const failedWorkers = workers.filter((worker) => !worker.ok);

    // Exactly one durable receipt winner exists and it is byte-preserved.
    assert.deepEqual(listReceiptFiles(home), [`${dispatchId}.json`]);
    const durable = store.readExecutorResultReceipt(dispatchId);
    assert.equal([...EXECUTOR_RESULT_RECEIPT_STATUS_VALUES].includes(durable.status), true);
    assert.equal(
      readFileSync(receiptPath(home, dispatchId), 'utf8'),
      expectedReceiptBytes(durable),
    );

    // At least one process succeeded and at most one reports newlyRecorded.
    assert.equal(okWorkers.length >= 1, true);
    assert.equal(okWorkers.filter((worker) => worker.result.newlyRecorded).length <= 1, true);
    // A loser that entered the create race fails with the conflict meaning.
    for (const worker of failedWorkers) {
      assert.equal(worker.code, EXECUTOR_RESULT_RECEIPT_CONFLICT);
    }
    // Every observed worker read back the same winner.
    for (const worker of okWorkers) {
      assert.deepEqual(worker.record, durable);
    }

    // Global exactly-once executor invocation is NOT claimed: both processes
    // may observe an absent receipt and both may invoke the executor once, so
    // the total invocation count is bounded by 2, never 1.
    const totalExecutorCalls = workers.reduce(
      (sum, worker) => sum + (worker.executorCalls ?? 0),
      0,
    );
    assert.equal(totalExecutorCalls <= 2, true);
    assert.equal(totalExecutorCalls >= 1, true);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// CONCRETE. CONFIG / RECORD / RUNNER FAIL-CLOSED BOUNDARY + READ_ONLY ONLY.
// ---------------------------------------------------------------------------

test('CONCRETE1. configuration validation fails closed before any process boundary exists', () => {
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-config-');
  try {
    const invalid = [
      undefined,
      null,
      42,
      [],
      {},
      { executablePath: 'relative/codex.exe', workdir: FAKE_WORKDIR, resultDirectory },
      { executablePath: FAKE_EXECUTABLE, workdir: 'relative', resultDirectory },
      { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, resultDirectory: 'relative' },
      { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, resultDirectory, runner: 'not-fn' },
      {
        executablePath: FAKE_EXECUTABLE,
        workdir: FAKE_WORKDIR,
        resultDirectory,
        env: 'not-record',
      },
      { executablePath: FAKE_EXECUTABLE, workdir: FAKE_WORKDIR, resultDirectory, unknown: 1 },
    ];
    for (const configuration of invalid) {
      assert.throws(
        () => createCodexCliStructuredResultExecutor(configuration),
        errorWithCode(INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION),
        JSON.stringify(configuration),
      );
    }
  } finally {
    removeHome(resultDirectory);
  }
});

test('CONCRETE2. malformed records and BOUNDED_MUTATION tasks fail closed before process start', async () => {
  const { home, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-concrete2-',
    'ERR33-C2-SRC',
    'ERR33-C2-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-concrete2-result-');
  try {
    const { calls, runner } = fakeCodexStructuredRunner({ kind: 'exited', code: 0 });
    const executor = makeStructuredExecutor(resultDirectory, runner);
    const malformedRecords = [
      undefined,
      null,
      42,
      'record',
      [],
      {},
      { dispatchId: '' },
      { dispatchId: 'x' },
      { dispatchId: 'x', decisionInput: null },
      { dispatchId: 'x', decisionInput: {} },
      { dispatchId: 'x', decisionInput: { task: null } },
      { dispatchId: 'x', decisionInput: { task: [] } },
    ];
    for (const record of malformedRecords) {
      await assert.rejects(
        executor(record),
        errorWithCode(INVALID_EXECUTOR_STRUCTURED_RESULT),
        String(record),
      );
    }
    assert.equal(calls.length, 0);

    // Direct BOUNDED_MUTATION refusal on the concrete executor: no process.
    const boundedRecord = {
      dispatchId,
      decisionInput: {
        task: { taskKind: 'BOUNDED_MUTATION', taskId: 'ERR33-C2-CHILD' },
      },
    };
    await assert.rejects(
      executor(boundedRecord),
      errorWithCode(EXECUTOR_RESULT_RECEIPT_REQUIRES_READ_ONLY_TASK),
    );
    assert.equal(calls.length, 0);

    // Composition-level refusal: the receipt path enforces READ_ONLY before
    // the caller executor runs, using the exact durable Task 28 record.
    const bounded = await setupBoundedMutation(
      'greenhub-executor-result-receipt33-concrete2b-',
      'ERR33-C2B-SRC',
      'ERR33-C2B-CHILD',
    );
    try {
      const { calls: boundedCalls, executor: boundedExecutor } = countingStructuredExecutor(() => {
        throw new Error('BOUNDED_MUTATION must never reach the executor');
      });
      await assert.rejects(
        persistExecutorResultReceipt({
          dispatchId: bounded.dispatchId,
          store: bounded.store,
          executor: boundedExecutor,
        }),
        errorWithCode(EXECUTOR_RESULT_RECEIPT_REQUIRES_READ_ONLY_TASK),
      );
      assert.equal(boundedCalls.length, 0);
      assert.deepEqual(listReceiptFiles(bounded.home), []);
    } finally {
      removeHome(bounded.home);
    }
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

test('CONCRETE3. malformed runner results fail closed and preserve the Task 31 start-failure type', async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-concrete3-',
    'ERR33-C3-SRC',
    'ERR33-C3-CHILD',
  );
  const resultDirectory = makeHome('greenhub-executor-result-receipt33-concrete3-result-');
  try {
    const record = store.readExecutorInvocationAttempt(dispatchId);
    const malformed = [
      undefined,
      null,
      42,
      'exited',
      [],
      new Map(),
      new Date(0),
      {},
      { kind: 'exited' },
      { kind: 'exited', code: '0' },
      { kind: 'exited', code: 1.5 },
      { kind: 'exited', code: 0, signal: null },
      { kind: 'terminated-without-exit-status', signal: 'SIGKILL' },
      { kind: 'start-failed' },
      { kind: 'start-failed', errorCode: '' },
      { kind: 'start-failed', errorCode: 42 },
      { kind: 'accepted' },
    ];
    for (const observation of malformed) {
      const { runner } = fakeCodexStructuredRunner({ verbatim: true, result: observation });
      const executor = makeStructuredExecutor(resultDirectory, runner);
      await assert.rejects(
        executor(record),
        errorWithCode(INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT),
        String(observation),
      );
    }
    const { runner: startFailedRunner } = fakeCodexStructuredRunner({
      kind: 'start-failed',
      errorCode: 'ENOENT',
    });
    const startFailedExecutor = makeStructuredExecutor(resultDirectory, startFailedRunner);
    await assert.rejects(
      startFailedExecutor(record),
      (error) =>
        error instanceof CodexCliExecutorAdapterError &&
        error.code === CODEX_CLI_EXECUTOR_PROCESS_START_FAILED,
    );
  } finally {
    removeHome(resultDirectory);
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// TASK32-GUARD. RECORDED OUTCOME WITHOUT RECEIPT: DISTINCT FAIL-CLOSED STATE.
// ---------------------------------------------------------------------------

test('TASK32-GUARD. a recorded Task 32 outcome without a receipt stays fail-closed with zero process and zero writes', async () => {
  const { home, store, dispatchId } = await setupReadOnly(
    'greenhub-executor-result-receipt33-guard-',
    'ERR33-GUARD-SRC',
    'ERR33-GUARD-CHILD',
  );
  try {
    for (const outcome of [
      EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      EXECUTOR_INVOCATION_OUTCOME_REJECTED,
      EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
    ]) {
      const outcomePath = join(home, EXECUTOR_INVOCATION_OUTCOMES_DIRNAME, `${dispatchId}.json`);
      rmSync(outcomePath, { force: true });
      assert.deepEqual(
        store.createExecutorInvocationOutcome({
          schemaVersion: EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
          dispatchId,
          outcome,
        }),
        { created: true },
      );
      const outcomeBytes = readFileSync(outcomePath, 'utf8');
      const before = snapshotHomeBytes(home);
      const { calls, executor } = countingStructuredExecutor(() => {
        throw new Error('a recorded outcome without receipt must never re-invoke the executor');
      });
      await assert.rejects(
        persistExecutorResultReceipt({ dispatchId, store, executor }),
        errorWithCode(EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME),
        outcome,
      );
      assert.equal(calls.length, 0, outcome);
      assert.deepEqual(listReceiptFiles(home), []);
      assert.deepEqual(snapshotHomeBytes(home), before);
      assert.equal(readFileSync(outcomePath, 'utf8'), outcomeBytes);
    }
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// STORE. DURABLE RECEIPT PRIMITIVES.
// ---------------------------------------------------------------------------

test('STORE. durable receipt primitives: missing -> null, exact canonical, exclusive-create, no repair', () => {
  const home = makeHome('greenhub-executor-result-receipt33-store-');
  const store = new CoordinationStore({ dir: home });
  const dispatchId = `dsp_${'a'.repeat(64)}`;
  const otherDispatchId = `dsp_${'b'.repeat(64)}`;
  try {
    assert.equal(store.readExecutorResultReceipt(dispatchId), null);

    const record = validReceipt(dispatchId, 'ERR33-STORE-CHILD');
    assert.deepEqual(store.createExecutorResultReceipt(record), { created: true });
    assert.deepEqual(store.readExecutorResultReceipt(dispatchId), record);
    assert.equal(Object.isFrozen(store.readExecutorResultReceipt(dispatchId)), true);
    const path = receiptPath(home, dispatchId);
    const bytes = readFileSync(path, 'utf8');
    assert.equal(bytes, expectedReceiptBytes(record));
    assert.equal(bytes.includes('writeJsonExclusive') === false, true);

    // Same record: exclusive-create refuses to overwrite, bytes unchanged.
    assert.deepEqual(store.createExecutorResultReceipt(record), { created: false });
    assert.equal(readFileSync(path, 'utf8'), bytes);
    // Different valid record under the same key: still refused, never
    // last-writer-wins.
    assert.deepEqual(
      store.createExecutorResultReceipt(
        validReceipt(dispatchId, 'ERR33-STORE-CHILD', {
          status: EXECUTOR_RESULT_RECEIPT_STATUS_FAILED,
        }),
      ),
      { created: false },
    );
    assert.equal(readFileSync(path, 'utf8'), bytes);

    // Invalid records fail closed with zero writes.
    const invalidRecords = [
      null,
      [],
      {},
      { ...record, extra: 1 },
      { ...record, schemaVersion: '1' },
      { ...record, status: 'DONE' },
      { ...record, summary: '' },
      { ...record, proofRefs: 'ref' },
      { ...record, taskId: 'not a task id' },
    ];
    for (const invalid of invalidRecords) {
      assert.throws(
        () => store.createExecutorResultReceipt(invalid),
        errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
        JSON.stringify(invalid),
      );
    }
    assert.throws(
      () => store.createExecutorResultReceipt(validReceipt('not-an-id', 'ERR33-STORE-CHILD')),
      errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
    );

    // Corruption and key/binding mismatch fail closed with no repair.
    writeReceiptBytes(home, otherDispatchId, '{ not json');
    assert.throws(
      () => store.readExecutorResultReceipt(otherDispatchId),
      errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
    );
    assert.equal(readFileSync(receiptPath(home, otherDispatchId), 'utf8'), '{ not json');
    writeReceiptBytes(
      home,
      otherDispatchId,
      expectedReceiptBytes(validReceipt(dispatchId, 'ERR33-STORE-CHILD')),
    );
    assert.throws(
      () => store.readExecutorResultReceipt(otherDispatchId),
      errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
    );
    assert.throws(
      () => store.readExecutorResultReceipt('not-an-id'),
      errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
    );
    assert.throws(
      () => store.readExecutorResultReceipt(`dsp_${'A'.repeat(64)}`),
      errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
    );

    // The receipt validator accepts exactly the canonical record shape only.
    assert.deepEqual(validateExecutorResultReceiptRecord(record), record);
    assert.throws(
      () => validateExecutorResultReceiptRecord({ ...record, extra: 1 }),
      errorWithCode(CORRUPT_EXECUTOR_RESULT_RECEIPT),
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// STATIC. PRODUCTION MODULE BOUNDARY + EXACT EXPORTED SURFACE.
// ---------------------------------------------------------------------------

test('STATIC. the production module keeps the process boundary static and exports exactly the receipt surface', () => {
  const source = codeOnly(readFileSync(MODULE_PATH, 'utf8'));
  const forbidden = [
    'execSync',
    'execFileSync',
    'execFile(',
    'fork(',
    'setInterval',
    'setTimeout',
    'fetch(',
    'WebSocket',
    'XMLHttpRequest',
    'node:http',
    'node:https',
    'polling',
    'daemon',
    'cron',
    'backoff',
    'resend',
    'executorRegistry',
    'selectExecutor',
    'fallbackExecutor',
    'invocationLock',
    'executorLease',
    'writeJsonAtomic',
    'existsSync',
  ];
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, token);
  }
  // The only child-process surface is spawn with a fixed allowlisted env and
  // closed stdio.
  assert.equal(source.includes("from 'node:child_process'"), true);
  assert.equal(source.includes('spawn('), true);
  assert.equal(source.includes('shell: false'), true);
  assert.equal(source.includes("stdio: ['ignore', 'ignore', 'ignore']"), true);
  // The durable write authority is the store exclusive-create only.
  assert.equal(source.includes('writeJsonExclusive'), false);

  const expectedExports = [
    'CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_FIELDS',
    'CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION',
    'CORRUPT_EXECUTOR_RESULT_RECEIPT',
    'EXECUTOR_RESULT_RECEIPTS_DIRNAME',
    'EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME',
    'EXECUTOR_RESULT_RECEIPT_CONFLICT',
    'EXECUTOR_RESULT_RECEIPT_FIELDS',
    'EXECUTOR_RESULT_RECEIPT_PERSISTENCE_NEW_FIELDS',
    'EXECUTOR_RESULT_RECEIPT_PERSISTENCE_REPLAY_FIELDS',
    'EXECUTOR_RESULT_RECEIPT_REQUIRES_READ_ONLY_TASK',
    'EXECUTOR_RESULT_RECEIPT_SCHEMA_VERSION',
    'EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED',
    'EXECUTOR_RESULT_RECEIPT_STATUS_FAILED',
    'EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED',
    'EXECUTOR_RESULT_RECEIPT_STATUS_VALUES',
    'EXECUTOR_RESULT_RECEIPT_STRUCTURED_FIELDS',
    'EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH',
    'ExecutorResultReceiptError',
    'INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION',
    'INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT',
    'INVALID_EXECUTOR_RESULT_RECEIPT_STORE',
    'INVALID_EXECUTOR_STRUCTURED_RESULT',
    'MISSING_EXECUTOR_STRUCTURED_RESULT',
    'assertValidExecutorResultReceiptDispatchId',
    'createCodexCliStructuredResultExecutor',
    'executorResultReceiptFileName',
    'executorResultReceiptFilePath',
    'persistExecutorResultReceipt',
    'validateExecutorResultReceiptRecord',
  ];
  assert.deepEqual(Object.keys(receiptModule).sort(), expectedExports.sort());

  // The receipt field authority never includes canonical-result / generation
  // fields.
  assert.deepEqual(
    [...EXECUTOR_RESULT_RECEIPT_FIELDS],
    [
      'schemaVersion',
      'dispatchId',
      'taskId',
      'status',
      'summary',
      'proofRefs',
      'evidenceRefs',
      'frictionObserved',
    ],
  );
  assert.deepEqual(
    [...EXECUTOR_RESULT_RECEIPT_STRUCTURED_FIELDS],
    ['taskId', 'status', 'summary', 'proofRefs', 'evidenceRefs', 'frictionObserved'],
  );
  assert.deepEqual(
    [...CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_FIELDS],
    ['schemaVersion', 'dispatchId', 'outcome', 'result'],
  );
});

test('STATIC-STORE. the store receipt section uses exclusive-create and the exact receipt validator only', () => {
  const source = readFileSync(STORE_PATH, 'utf8');
  const sectionStart = source.indexOf('Durable executor result receipt domain');
  assert.equal(sectionStart > 0, true);
  const section = codeOnly(source.slice(sectionStart, sectionStart + 9000));
  assert.equal(section.includes('readExecutorResultReceipt('), true);
  assert.equal(section.includes('createExecutorResultReceipt('), true);
  assert.equal(section.includes('validateExecutorResultReceiptRecord('), true);
  assert.equal(section.includes('writeJsonExclusive('), true);
  assert.equal(section.includes('writeJsonAtomic('), false);
  assert.equal(section.includes('unlinkSync'), false);
  assert.equal(section.includes('deliverResult'), false);
});
