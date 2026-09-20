// Bounded mutation owner: GREENHUB-COORDINATION-OPERATOR-CLI-35.
// Surface: scripts/coordination/operator-cli.mjs ONLY (+ the three
// package.json operator commands coordination:run / coordination:status /
// coordination:inspect).
//
// Thin operator-facing composition over the EXISTING durable coordination
// authorities. This module owns NO durable semantics and creates NO durable
// state, namespace, database, or index:
//   status  = read-only projection over existing task lifecycle truth
//             (<home>/tasks/** + the append-stable sequence);
//   inspect = read-only projection over ONE task's existing durable records
//             (task/claim/result/disposition/materialization/ACK/consumed and
//             the relevant durable executor result receipt);
//   run     = ONE explicit operator-named task through the EXISTING chain:
//             admission -> claim -> dispatch attempt -> transport request ->
//             receiver acceptance -> receiver decision -> executor acceptance
//             -> invocation attempt -> durable executor result receipt ->
//             canonical result delivery.
//
// Explicitly NOT implemented here (and asserted absent by the proof spec):
//   scheduler, READY scan for work selection, queue polling, daemon, cron,
//   watchdog, timer, background loop, retry, backoff, resend, fallback
//   executor, executor/worker registry, executor selection, fan-out,
//   recursive successor execution, automatic DROP/WATCH/CHANGE invention,
//   mutation-capable executor, production deploy.
//
// run requires an operator-named task id. It never scans READY tasks, never
// picks oldest/newest, and never executes more than one task boundary. When
// --source is omitted, the requested task's canonical admission is resolved by
// a bounded identity lookup (exact nextTaskId match over existing admission
// records); that is authority resolution for the named task, not work
// selection. If no canonical admission binds the named task, run fails closed.
//
// Executor capability is READ_ONLY ONLY: a task whose canonical envelope is
// not taskKind=READ_ONLY / mutationBoundary.allowsWrite=false is refused with
// an explicit unsupported-capability error BEFORE any claim or durable
// mutation. The default executor is the existing concrete Codex CLI
// structured-result executor (read-only sandbox); no fallback exists.
//
// coordination home resolution is the existing coordination-home contract
// (GREENHUB_COORDINATION_HOME env, then the OS user-home path): durable runtime
// state never lives inside the repository worktree.
//
// Machine output: `--json` prints a read-only projection of the same durable
// state. JSON is never durable authority (status and inspect write nothing at
// all; run writes only the same durable records the composed engine owns).

import nodeFs from 'node:fs';
import nodeOs from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClaimBoundDispatchId } from './claim-bound-dispatch-envelope.mjs';
import { acceptExecutorDispatchDecision } from './dispatch-executor-acceptance.mjs';
import { persistExecutorInvocationAttempt } from './dispatch-executor-invocation-attempt.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import { persistReceiverDecision } from './dispatch-receiver-decision.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import { validateAdmissionRecord } from './emission-admission.mjs';
import { deliverExecutorResultReceipt } from './executor-result-delivery.mjs';
import {
  createCodexCliStructuredResultExecutor,
  EXECUTOR_RESULT_RECEIPTS_DIRNAME,
  persistExecutorResultReceipt,
} from './executor-result-receipt.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_ID_PATTERN, TASK_KIND_READ_ONLY } from './task-envelope.mjs';

export const OPERATOR_PROJECTION_SCHEMA_VERSION = '1';
export const OPERATOR_STATUS_PROJECTION = 'operator-status';
export const OPERATOR_INSPECTION_PROJECTION = 'operator-inspection';
export const OPERATOR_RUN_PROJECTION = 'operator-run';

export const OPERATOR_ARGUMENT_INVALID = 'OPERATOR_ARGUMENT_INVALID';
export const OPERATOR_TASK_ADMISSION_NOT_FOUND = 'OPERATOR_TASK_ADMISSION_NOT_FOUND';
export const OPERATOR_TASK_ADMISSION_AMBIGUOUS = 'OPERATOR_TASK_ADMISSION_AMBIGUOUS';
export const OPERATOR_EXECUTOR_NOT_CONFIGURED = 'OPERATOR_EXECUTOR_NOT_CONFIGURED';
export const OPERATOR_RECEIPT_AMBIGUOUS = 'OPERATOR_RECEIPT_AMBIGUOUS';
export const OPERATOR_STAGE_FAILED = 'OPERATOR_STAGE_FAILED';
export const UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY =
  'UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY';

export const RUN_OUTCOME_EXECUTED = 'EXECUTED';
export const RUN_OUTCOME_EXECUTOR_REJECTED = 'EXECUTOR_REJECTED';
export const RUN_OUTCOME_EXECUTOR_UNKNOWN = 'EXECUTOR_UNKNOWN';
export const RUN_OUTCOME_ALREADY_TERMINAL = 'ALREADY_TERMINAL';

export const DEFAULT_OPERATOR_WORKER_ID = 'operator-cli';
export const DEFAULT_OPERATOR_LEASE_MS = 15 * 60_000;
export const CODEX_CLI_PATH_ENV_KEY = 'GREENHUB_CODEX_CLI_PATH';

// Mirrors the durable store layout (store.mjs taskFilePaths /
// emission-admission paths): used only to RESOLVE the operator-named task's
// canonical admission; the authoritative read is the store primitive.
const TASK_EMISSION_ADMISSIONS_DIRNAME = 'emission-admissions';

const COMMANDS = Object.freeze(['status', 'inspect', 'run']);

const MAX_ERROR_MESSAGE_LENGTH = 512;

export class OperatorCliError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OperatorCliError';
    this.code = details.code ?? OPERATOR_STAGE_FAILED;
    this.taskId = details.taskId ?? null;
    this.stage = details.stage ?? null;
    this.nextAction = details.nextAction ?? null;
  }
}

function fail(message, details = {}) {
  throw new OperatorCliError(message, details);
}

function assertOperatorTaskId(taskId, stage = 'arguments') {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`task id must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, {
      code: OPERATOR_ARGUMENT_INVALID,
      stage,
      nextAction: 'pass the exact task id shown by `pnpm coordination:status`',
    });
  }
  return taskId;
}

function readJsonDocument(filePath) {
  let raw;
  try {
    raw = nodeFs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing' };
    throw error;
  }
  try {
    return { state: 'present', document: JSON.parse(raw) };
  } catch {
    return { state: 'corrupt' };
  }
}

function listDirectoryNames(directory) {
  try {
    return nodeFs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function listDurableTaskIds(home) {
  return listDirectoryNames(nodePath.join(home, 'tasks'))
    .filter((entry) => entry.isDirectory() && TASK_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

// Read one optional later-stage record. Only the record's own NOT_FOUND code is
// treated as absent: corruption/drift always fails closed with its exact code.
function optionalRead(readFn, notFoundCode) {
  try {
    return readFn();
  } catch (error) {
    if (error?.code === notFoundCode) return null;
    throw error;
  }
}

function deriveNextAction(code) {
  if (code === 'TASK_NOT_FOUND') {
    return 'verify the task id from `pnpm coordination:status`';
  }
  if (code === 'LEASE_ACTIVE') {
    return 'the task is claimed with an active lease; wait for lease expiry or use the current owner worker id';
  }
  if (code === 'TASK_TERMINAL') {
    return 'the task is already terminal; no execution is possible through this command';
  }
  if (code === 'TASK_NOT_READY') {
    return 'the emitted child is not READY/CLAIMED yet; admit it first (store.admitEmittedTask) and rerun';
  }
  if (code === 'TASK_NOT_CLAIMED') {
    return 'the dispatch envelope requires a CLAIMED child; rerun and let claimAdmittedTask converge it';
  }
  if (code === UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY) {
    return 'this task requires mutation capability; the operator CLI executes READ_ONLY tasks only — route it to a mutation-capable executor';
  }
  if (code === OPERATOR_TASK_ADMISSION_NOT_FOUND) {
    return 'only emission-admitted tasks can run; emit and admit the task first, or pass --source/--slot explicitly';
  }
  if (code === OPERATOR_TASK_ADMISSION_AMBIGUOUS) {
    return 'multiple canonical admissions bind this task; pass --source and --slot explicitly';
  }
  if (code === OPERATOR_EXECUTOR_NOT_CONFIGURED) {
    return `set ${CODEX_CLI_PATH_ENV_KEY} or pass --codex <absolute path> (READ_ONLY executor only)`;
  }
  if (code === OPERATOR_RECEIPT_AMBIGUOUS) {
    return 'multiple durable receipts bind this task; stop and inspect the durable state manually';
  }
  if (
    typeof code === 'string' &&
    (code.startsWith('CORRUPT_') || code.endsWith('_MISMATCH') || code.endsWith('_CONFLICT'))
  ) {
    return 'durable authority is corrupt or drifted; stop and inspect — never repair by rewriting durable bytes';
  }
  return 'run `pnpm coordination:inspect <TASK_ID>` and decide the next manual action';
}

async function atStage(stage, taskId, action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof OperatorCliError) throw error;
    const code = typeof error?.code === 'string' && error.code ? error.code : OPERATOR_STAGE_FAILED;
    throw new OperatorCliError(error?.message ?? String(error), {
      code,
      taskId: error?.taskId ?? taskId,
      stage,
      nextAction: deriveNextAction(code),
    });
  }
}

function atSyncStage(stage, taskId, action) {
  try {
    return action();
  } catch (error) {
    if (error instanceof OperatorCliError) throw error;
    const code = typeof error?.code === 'string' && error.code ? error.code : OPERATOR_STAGE_FAILED;
    throw new OperatorCliError(error?.message ?? String(error), {
      code,
      taskId: error?.taskId ?? taskId,
      stage,
      nextAction: deriveNextAction(code),
    });
  }
}

function canonicalTaskOrder(left, right) {
  const leftPosition = left.sequencePosition ?? Number.MAX_SAFE_INTEGER;
  const rightPosition = right.sequencePosition ?? Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0;
}

/**
 * Read-only status overview. Durable-state read ONLY: no write, no repair, no
 * reconciliation, no cursor migration, no new status database.
 */
export function collectStatusOverview({ store } = {}) {
  if (
    !store ||
    typeof store.readTask !== 'function' ||
    typeof store.readSequenceEntries !== 'function'
  ) {
    fail('status requires a durable coordination store (read-only composition).', {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'status',
      nextAction: 'use the package.json coordination:status command',
    });
  }
  const home = store.home;
  return atSyncStage('status', null, () => {
    const sequenceEntries = store.readSequenceEntries();
    const sequencePosition = new Map(
      sequenceEntries.map((entry) => [entry.taskId, entry.sequenceNumber]),
    );
    const tasks = listDurableTaskIds(home)
      .map((taskId) => {
        const task = store.readTask(taskId);
        const claim = optionalRead(() => store.readClaim(taskId), 'CLAIM_NOT_FOUND');
        const result = optionalRead(() => store.readResult(taskId), 'RESULT_NOT_FOUND');
        const disposition = optionalRead(
          () => store.readCurrentDisposition(taskId),
          'DISPOSITION_NOT_FOUND',
        );
        return {
          sequencePosition: sequencePosition.get(taskId) ?? null,
          taskId,
          taskKind: task.taskKind,
          status: task.status,
          updatedAt: task.updatedAt ?? task.createdAt,
          claim: claim !== null,
          canonicalResult: result !== null,
          disposition: disposition?.state ?? null,
          consumed: store.isConsumed(taskId),
        };
      })
      .sort(canonicalTaskOrder);
    const statusCounts = { CREATED: 0, READY: 0, CLAIMED: 0, RESULT_DELIVERED: 0 };
    for (const task of tasks) {
      if (Object.hasOwn(statusCounts, task.status)) statusCounts[task.status] += 1;
    }
    return Object.freeze({
      schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
      projection: OPERATOR_STATUS_PROJECTION,
      home,
      taskCount: tasks.length,
      statusCounts,
      tasks,
    });
  });
}

function findExecutorResultReceiptForTask({ home, taskId }) {
  const directory = nodePath.join(home, EXECUTOR_RESULT_RECEIPTS_DIRNAME);
  const matches = [];
  for (const entry of listDirectoryNames(directory).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const found = readJsonDocument(nodePath.join(directory, entry.name));
    if (found.state === 'missing') continue;
    if (found.state === 'corrupt') {
      fail(`executor result receipt is corrupt (fail-closed, no auto-repair): ${entry.name}`, {
        code: 'CORRUPT_EXECUTOR_RESULT_RECEIPT',
        taskId,
        stage: 'inspect',
        nextAction: deriveNextAction('CORRUPT_EXECUTOR_RESULT_RECEIPT'),
      });
    }
    const document = found.document;
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      fail(`executor result receipt has an invalid shape (fail-closed): ${entry.name}`, {
        code: 'CORRUPT_EXECUTOR_RESULT_RECEIPT',
        taskId,
        stage: 'inspect',
        nextAction: deriveNextAction('CORRUPT_EXECUTOR_RESULT_RECEIPT'),
      });
    }
    if (document.taskId === taskId) matches.push(document);
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    fail(`multiple durable executor result receipts bind task ${taskId} (fail-closed).`, {
      code: OPERATOR_RECEIPT_AMBIGUOUS,
      taskId,
      stage: 'inspect',
      nextAction: deriveNextAction(OPERATOR_RECEIPT_AMBIGUOUS),
    });
  }
  return matches[0];
}

/**
 * Read-only inspection of one task's existing durable records. Missing optional
 * later-stage records are reported as null (rendered as absent); present
 * records are returned exactly as durable authority stores them; corrupt
 * authority fails closed with its canonical code.
 */
export function collectTaskInspection({ store, taskId } = {}) {
  if (!store || typeof store.readTask !== 'function') {
    fail('inspect requires a durable coordination store (read-only composition).', {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'inspect',
      nextAction: 'use the package.json coordination:inspect command',
    });
  }
  assertOperatorTaskId(taskId, 'inspect');
  return atSyncStage('inspect', taskId, () => {
    const task = store.readTask(taskId);
    const claim = optionalRead(() => store.readClaim(taskId), 'CLAIM_NOT_FOUND');
    const canonicalResult = optionalRead(() => store.readResult(taskId), 'RESULT_NOT_FOUND');
    const disposition = optionalRead(
      () => store.readCurrentDisposition(taskId),
      'DISPOSITION_NOT_FOUND',
    );
    const materialization = optionalRead(
      () => store.readMaterialization(taskId),
      'MATERIALIZATION_NOT_FOUND',
    );
    const ack = optionalRead(() => store.readAck(taskId), 'ACK_NOT_FOUND');
    const consumed = optionalRead(() => store.readConsumed(taskId), 'CONSUMED_NOT_FOUND');
    const executorResultReceipt = findExecutorResultReceiptForTask({ home: store.home, taskId });
    return Object.freeze({
      schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
      projection: OPERATOR_INSPECTION_PROJECTION,
      home: store.home,
      taskId,
      task,
      claim,
      canonicalResult,
      disposition,
      materialization,
      ack,
      consumed,
      executorResultReceipt,
    });
  });
}

/**
 * Bounded identity resolution of the operator-named task's canonical admission:
 *   - explicit (sourceTaskId, emissionSlot) -> authoritative store read;
 *   - otherwise exact nextTaskId match over EXISTING admission records
 *     (identity resolution only: never a READY scan, never oldest/newest,
 *     never priority/fairness).
 * Absent -> null; ambiguous -> fail closed; corruption -> fail closed.
 */
export function resolveTaskAdmission({ store, taskId, sourceTaskId, emissionSlot = 'next' } = {}) {
  assertOperatorTaskId(taskId, 'resolve-admission');
  if (typeof sourceTaskId === 'string' && sourceTaskId.trim()) {
    assertOperatorTaskId(sourceTaskId, 'resolve-admission');
    const admission = store.readEmissionAdmission({ sourceTaskId, emissionSlot });
    if (admission.nextTaskId !== taskId) {
      fail(
        `canonical admission ${sourceTaskId}@${emissionSlot} binds task ${admission.nextTaskId}, not the requested ${taskId} (fail-closed).`,
        {
          code: OPERATOR_TASK_ADMISSION_NOT_FOUND,
          taskId,
          stage: 'resolve-admission',
          nextAction: deriveNextAction(OPERATOR_TASK_ADMISSION_NOT_FOUND),
        },
      );
    }
    return { sourceTaskId, emissionSlot, admission };
  }
  const tasksDirectory = nodePath.join(store.home, 'tasks');
  const matches = [];
  for (const taskEntry of listDirectoryNames(tasksDirectory)) {
    if (!taskEntry.isDirectory() || !TASK_ID_PATTERN.test(taskEntry.name)) continue;
    const admissionsDirectory = nodePath.join(
      tasksDirectory,
      taskEntry.name,
      TASK_EMISSION_ADMISSIONS_DIRNAME,
    );
    for (const admissionEntry of listDirectoryNames(admissionsDirectory).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      if (!admissionEntry.isFile() || !admissionEntry.name.endsWith('.json')) continue;
      const slot = admissionEntry.name.slice(0, -'.json'.length);
      const found = readJsonDocument(nodePath.join(admissionsDirectory, admissionEntry.name));
      if (found.state === 'missing') continue;
      if (found.state === 'corrupt') {
        fail(
          `admission record is corrupt (fail-closed, no auto-repair): ${taskEntry.name}@${slot}`,
          {
            code: 'CORRUPT_ADMISSION',
            taskId,
            stage: 'resolve-admission',
            nextAction: deriveNextAction('CORRUPT_ADMISSION'),
          },
        );
      }
      const document = found.document;
      if (document === null || typeof document !== 'object' || Array.isArray(document)) {
        fail(`admission record is invalid (fail-closed): ${taskEntry.name}@${slot}`, {
          code: 'CORRUPT_ADMISSION',
          taskId,
          stage: 'resolve-admission',
          nextAction: deriveNextAction('CORRUPT_ADMISSION'),
        });
      }
      if (document.nextTaskId !== taskId) continue;
      let record;
      try {
        record = validateAdmissionRecord(document);
      } catch (error) {
        fail(
          `admission record is invalid (fail-closed): ${taskEntry.name}@${slot}: ${error?.message}`,
          {
            code: typeof error?.code === 'string' && error.code ? error.code : 'CORRUPT_ADMISSION',
            taskId,
            stage: 'resolve-admission',
            nextAction: deriveNextAction('CORRUPT_ADMISSION'),
          },
        );
      }
      if (record.sourceTaskId !== taskEntry.name || record.emissionSlot !== slot) {
        fail(`admission identity/path mismatch (fail-closed): ${taskEntry.name}@${slot}`, {
          code: 'CORRUPT_ADMISSION',
          taskId,
          stage: 'resolve-admission',
          nextAction: deriveNextAction('CORRUPT_ADMISSION'),
        });
      }
      matches.push({ sourceTaskId: taskEntry.name, emissionSlot: slot, admission: record });
    }
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    fail(`multiple canonical admissions bind task ${taskId} (fail-closed, no selection).`, {
      code: OPERATOR_TASK_ADMISSION_AMBIGUOUS,
      taskId,
      stage: 'resolve-admission',
      nextAction: deriveNextAction(OPERATOR_TASK_ADMISSION_AMBIGUOUS),
    });
  }
  const match = matches[0];
  // Re-read through the authoritative store primitive (full binding check).
  const admission = store.readEmissionAdmission({
    sourceTaskId: match.sourceTaskId,
    emissionSlot: match.emissionSlot,
  });
  return { sourceTaskId: match.sourceTaskId, emissionSlot: match.emissionSlot, admission };
}

/**
 * Execute exactly ONE explicit operator-named READ_ONLY task boundary through
 * the existing chain. No scheduler, no READY scan, no retry, no fallback, no
 * successor execution, no automatic disposition.
 *
 * The executor boundary is crossed at most once per call (existing Task 33
 * semantics); an existing durable receipt/invocation record is replayed without
 * re-invoking the executor.
 */
export async function executeOperatorTask({
  store,
  taskId,
  sourceTaskId,
  emissionSlot = 'next',
  workerId = DEFAULT_OPERATOR_WORKER_ID,
  leaseDurationMs = DEFAULT_OPERATOR_LEASE_MS,
  executor,
} = {}) {
  if (!store || typeof store.readTask !== 'function') {
    fail('run requires a durable coordination store (composition only).', {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'run',
      nextAction: 'use the package.json coordination:run command',
    });
  }
  assertOperatorTaskId(taskId, 'run');
  if (typeof executor !== 'function') {
    fail(
      'a READ_ONLY structured-result executor must be supplied (no registry, no auto-selection, no fallback executor).',
      {
        code: OPERATOR_EXECUTOR_NOT_CONFIGURED,
        taskId,
        stage: 'executor-config',
        nextAction: deriveNextAction(OPERATOR_EXECUTOR_NOT_CONFIGURED),
      },
    );
  }
  if (typeof workerId !== 'string' || !workerId.trim()) {
    fail('worker id must be a non-empty string.', {
      code: OPERATOR_ARGUMENT_INVALID,
      taskId,
      stage: 'arguments',
      nextAction: 'pass --worker <WORKER_ID>',
    });
  }

  const task = await atStage('capability-gate', taskId, async () => store.readTask(taskId));
  if (task.taskKind !== TASK_KIND_READ_ONLY || task.mutationBoundary?.allowsWrite !== false) {
    fail(
      `the requested task requires mutation capability (taskKind=${task.taskKind} allowsWrite=${task.mutationBoundary?.allowsWrite}); the current executor capability is READ_ONLY and no mutation-capable or fallback executor exists.`,
      {
        code: UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY,
        taskId,
        stage: 'capability-gate',
        nextAction: deriveNextAction(UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY),
      },
    );
  }
  if (task.status === 'CREATED') {
    fail(
      `task ${taskId} is CREATED, not READY; the operator CLI never admits implicitly (ADMISSION_AUTHORITY -> READY is owned by admitEmittedTask).`,
      {
        code: 'TASK_NOT_READY',
        taskId,
        stage: 'capability-gate',
        nextAction: deriveNextAction('TASK_NOT_READY'),
      },
    );
  }

  const resolved = await atStage('resolve-admission', taskId, async () => {
    const found = resolveTaskAdmission({ store, taskId, sourceTaskId, emissionSlot });
    if (found === null) {
      fail(
        `no canonical emission admission binds task ${taskId} (fail-closed): the operator CLI runs only emission-admitted tasks.`,
        {
          code: OPERATOR_TASK_ADMISSION_NOT_FOUND,
          taskId,
          stage: 'resolve-admission',
          nextAction: deriveNextAction(OPERATOR_TASK_ADMISSION_NOT_FOUND),
        },
      );
    }
    return found;
  });
  const boundSourceTaskId = resolved.sourceTaskId;
  const boundEmissionSlot = resolved.emissionSlot;

  const claimed = await atStage('claim', taskId, async () =>
    store.claimAdmittedTask({
      sourceTaskId: boundSourceTaskId,
      emissionSlot: boundEmissionSlot,
      workerId,
      leaseDurationMs,
    }),
  );
  const claim = claimed.claim;

  if (claimed.terminal === true) {
    const dispatchId = buildClaimBoundDispatchId({
      admissionId: claimed.record.admissionId,
      nextTaskId: taskId,
      workerId: claim.workerId,
      claimGeneration: claim.generation,
    });
    const receipt = await atStage('terminal-read-back', taskId, async () =>
      store.readExecutorResultReceipt(dispatchId),
    );
    const canonicalResult = optionalRead(() => store.readResult(taskId), 'RESULT_NOT_FOUND');
    return Object.freeze({
      schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
      projection: OPERATOR_RUN_PROJECTION,
      outcome: RUN_OUTCOME_ALREADY_TERMINAL,
      terminal: true,
      executorInvocations: 0,
      taskId,
      sourceTaskId: boundSourceTaskId,
      emissionSlot: boundEmissionSlot,
      workerId: claim.workerId,
      claimGeneration: claim.generation,
      dispatchId,
      executorOutcome: null,
      receipt,
      delivery: null,
      resultId: canonicalResult?.resultId ?? null,
      taskStatus: claimed.child.status,
    });
  }

  const attempt = await atStage('dispatch-attempt', taskId, async () =>
    store.persistDispatchAttempt({
      sourceTaskId: boundSourceTaskId,
      emissionSlot: boundEmissionSlot,
      workerId,
    }),
  );
  const dispatchId = attempt.dispatchId;

  const request = await atStage('transport-request', taskId, async () =>
    prepareDispatchTransportRequest({ store, sourceTaskId: boundSourceTaskId, dispatchId }),
  );
  await atStage('receiver-acceptance', taskId, async () =>
    acceptReceiverDispatch({ request, store }),
  );
  await atStage('receiver-decision', taskId, async () =>
    persistReceiverDecision({ dispatchId, store }),
  );
  await atStage('executor-acceptance', taskId, async () =>
    acceptExecutorDispatchDecision({ dispatchId, store }),
  );
  await atStage('invocation-attempt', taskId, async () =>
    persistExecutorInvocationAttempt({ dispatchId, store }),
  );
  const receiptOutcome = await atStage('executor-result-receipt', taskId, async () =>
    persistExecutorResultReceipt({ dispatchId, store, executor }),
  );

  let delivery = null;
  if (receiptOutcome.receipt !== null) {
    delivery = await atStage('result-delivery', taskId, async () =>
      deliverExecutorResultReceipt({ dispatchId, store }),
    );
  }
  const finalTask = store.readTask(taskId);
  const outcome =
    receiptOutcome.outcome === 'ACCEPTED'
      ? RUN_OUTCOME_EXECUTED
      : receiptOutcome.outcome === 'REJECTED'
        ? RUN_OUTCOME_EXECUTOR_REJECTED
        : RUN_OUTCOME_EXECUTOR_UNKNOWN;
  return Object.freeze({
    schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
    projection: OPERATOR_RUN_PROJECTION,
    outcome,
    terminal: false,
    executorInvocations: 1,
    taskId,
    sourceTaskId: boundSourceTaskId,
    emissionSlot: boundEmissionSlot,
    workerId: claim.workerId,
    claimGeneration: claim.generation,
    dispatchId,
    executorOutcome: receiptOutcome.outcome,
    receipt: receiptOutcome.receipt,
    delivery:
      delivery === null
        ? null
        : {
            resultId: delivery.resultId,
            newlyDelivered: delivery.newlyDelivered,
            exactReplay: delivery.exactReplay === true,
          },
    resultId: delivery?.resultId ?? null,
    taskStatus: finalTask.status,
  });
}

export function parseOperatorArgv(argv = []) {
  const options = {
    command: null,
    taskId: null,
    json: false,
    help: false,
    sourceTaskId: null,
    emissionSlot: 'next',
    workerId: DEFAULT_OPERATOR_WORKER_ID,
    leaseDurationMs: DEFAULT_OPERATOR_LEASE_MS,
    codexPath: null,
    workdir: null,
    resultDirectory: null,
  };
  const positionals = [];
  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`option ${flag} requires a value.`, {
        code: OPERATOR_ARGUMENT_INVALID,
        stage: 'arguments',
        nextAction: 'run `node scripts/coordination/operator-cli.mjs --help`',
      });
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (!argument.startsWith('-')) {
      positionals.push(argument);
      continue;
    }
    switch (argument) {
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--source':
        options.sourceTaskId = readValue(argument, index);
        index += 1;
        break;
      case '--slot':
        options.emissionSlot = readValue(argument, index);
        index += 1;
        break;
      case '--worker':
        options.workerId = readValue(argument, index);
        index += 1;
        break;
      case '--lease-ms': {
        const value = readValue(argument, index);
        index += 1;
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          fail(`--lease-ms must be a positive integer (got ${JSON.stringify(value)}).`, {
            code: OPERATOR_ARGUMENT_INVALID,
            stage: 'arguments',
            nextAction: 'pass --lease-ms <MILLISECONDS>',
          });
        }
        options.leaseDurationMs = parsed;
        break;
      }
      case '--codex':
        options.codexPath = readValue(argument, index);
        index += 1;
        break;
      case '--workdir':
        options.workdir = readValue(argument, index);
        index += 1;
        break;
      case '--results-dir':
        options.resultDirectory = readValue(argument, index);
        index += 1;
        break;
      default:
        fail(`unknown option: ${argument}`, {
          code: OPERATOR_ARGUMENT_INVALID,
          stage: 'arguments',
          nextAction: 'run `node scripts/coordination/operator-cli.mjs --help`',
        });
    }
  }
  const command = positionals[0] ?? null;
  if (command !== null && !COMMANDS.includes(command)) {
    fail(`unknown command: ${command}`, {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'arguments',
      nextAction: `choose one of ${COMMANDS.join(', ')}`,
    });
  }
  options.command = command;
  if (command === 'inspect' || command === 'run') {
    if (positionals.length < 2) {
      fail(`${command} requires an explicit <TASK_ID>.`, {
        code: OPERATOR_ARGUMENT_INVALID,
        stage: 'arguments',
        nextAction: `run \`pnpm coordination:${command} <TASK_ID>\``,
      });
    }
    options.taskId = positionals[1];
    assertOperatorTaskId(options.taskId, 'arguments');
    if (positionals.length > 2) {
      fail(`unexpected argument(s): ${positionals.slice(2).join(' ')}`, {
        code: OPERATOR_ARGUMENT_INVALID,
        stage: 'arguments',
        nextAction: 'run `node scripts/coordination/operator-cli.mjs --help`',
      });
    }
  } else if (positionals.length > (command === null ? 0 : 1)) {
    fail(`unexpected argument(s): ${positionals.slice(1).join(' ')}`, {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'arguments',
      nextAction: 'run `node scripts/coordination/operator-cli.mjs --help`',
    });
  }
  return Object.freeze(options);
}

export function renderUsage() {
  return [
    'usage:',
    '  pnpm coordination:status  [--json]',
    '  pnpm coordination:inspect <TASK_ID> [--json]',
    '  pnpm coordination:run <TASK_ID> [--source <SOURCE_TASK_ID>] [--slot <EMISSION_SLOT>]',
    '      [--worker <WORKER_ID>] [--lease-ms <MILLISECONDS>] [--codex <ABSOLUTE_PATH>]',
    '      [--workdir <ABSOLUTE_PATH>] [--results-dir <ABSOLUTE_PATH>] [--json]',
    '',
    'notes:',
    '  run executes exactly one operator-named READ_ONLY task boundary.',
    `  the executor is the read-only Codex CLI structured-result executor; ${CODEX_CLI_PATH_ENV_KEY} or --codex is required.`,
    '  status/inspect never write. JSON output is a read-only projection, never durable authority.',
    '',
  ].join('\n');
}

export function renderOperatorError(error) {
  const code = typeof error?.code === 'string' && error.code ? error.code : OPERATOR_STAGE_FAILED;
  const taskId = error?.taskId ?? '(none)';
  const stage = error?.stage ?? '(unknown)';
  const nextAction = error?.nextAction ?? deriveNextAction(code);
  const message = String(error?.message ?? error)
    .split('\n')[0]
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
  return [
    'ERROR',
    `  code:   ${code}`,
    `  task:   ${taskId}`,
    `  stage:  ${stage}`,
    `  detail: ${message}`,
    `  next:   ${nextAction}`,
    '',
  ].join('\n');
}

function renderRow(columns, widths) {
  return columns
    .map((value, index) => String(value ?? '').padEnd(widths[index]))
    .join('  ')
    .trimEnd();
}

export function renderStatus(projection) {
  const widths = [4, 40, 18, 20, 9, 6, 7, 14, 24];
  const lines = [
    'greenhub coordination status',
    `home:  ${projection.home}`,
    `tasks: ${projection.taskCount} (CREATED ${projection.statusCounts.CREATED}, READY ${projection.statusCounts.READY}, CLAIMED ${projection.statusCounts.CLAIMED}, RESULT_DELIVERED ${projection.statusCounts.RESULT_DELIVERED})`,
    '',
    renderRow(
      ['seq', 'task', 'kind', 'status', 'consumed', 'claim', 'result', 'disposition', 'updated'],
      widths,
    ),
    renderRow(
      widths.map((width) => '-'.repeat(width)),
      widths,
    ),
  ];
  if (projection.tasks.length === 0) {
    lines.push('(no durable tasks)');
  }
  for (const task of projection.tasks) {
    lines.push(
      renderRow(
        [
          task.sequencePosition ?? '-',
          task.taskId,
          task.taskKind,
          task.status,
          task.consumed ? 'yes' : 'no',
          task.claim ? 'yes' : 'no',
          task.canonicalResult ? 'yes' : 'no',
          task.disposition ?? '-',
          task.updatedAt,
        ],
        widths,
      ),
    );
  }
  lines.push('');
  return lines.join('\n');
}

function describePresence(record, fields) {
  if (record === null) return '(absent)';
  const parts = fields
    .filter(([key]) => record[key] !== undefined)
    .map(([key]) => `${key}=${String(record[key])}`);
  return `present  ${parts.join(' ')}`;
}

export function renderInspection(projection) {
  const lines = [
    `greenhub coordination inspect ${projection.taskId}`,
    `home: ${projection.home}`,
    '',
    `task:           ${describePresence(projection.task, [
      ['taskKind', 'taskKind'],
      ['status', 'status'],
      ['updatedAt', 'updatedAt'],
      ['desiredExitState', 'desiredExitState'],
    ])}`,
    `claim:          ${describePresence(projection.claim, [
      ['workerId', 'workerId'],
      ['generation', 'generation'],
      ['claimedAt', 'claimedAt'],
      ['leaseExpiresAt', 'leaseExpiresAt'],
    ])}`,
    `canonical:      ${describePresence(projection.canonicalResult, [
      ['resultId', 'resultId'],
      ['status', 'status'],
      ['summary', 'summary'],
      ['deliveredAt', 'deliveredAt'],
    ])}`,
    `disposition:    ${describePresence(projection.disposition, [
      ['dispositionGeneration', 'generation'],
      ['state', 'state'],
      ['decidedAt', 'decidedAt'],
    ])}`,
    `materialization:${describePresence(projection.materialization, [
      ['materializationId', 'materializationId'],
      ['dispositionGeneration', 'dispositionGeneration'],
      ['materializedAt', 'materializedAt'],
    ])}`,
    `ack:            ${describePresence(projection.ack, [
      ['ackId', 'ackId'],
      ['ackedAt', 'ackedAt'],
    ])}`,
    `consumed:       ${describePresence(projection.consumed, [
      ['consumedId', 'consumedId'],
      ['consumedAt', 'consumedAt'],
    ])}`,
    `receipt:        ${describePresence(projection.executorResultReceipt, [
      ['dispatchId', 'dispatchId'],
      ['status', 'status'],
      ['summary', 'summary'],
    ])}`,
    '',
  ];
  return lines.join('\n');
}

export function renderRunResult(projection) {
  const lines = [
    `greenhub coordination run ${projection.taskId}`,
    `outcome:  ${projection.outcome}`,
    `source:   ${projection.sourceTaskId} (slot=${projection.emissionSlot})`,
    `worker:   ${projection.workerId} generation=${projection.claimGeneration}`,
    `dispatch: ${projection.dispatchId}`,
  ];
  if (projection.terminal === true) {
    lines.push('executed: no (task already RESULT_DELIVERED; no new executor invocation)');
  } else {
    lines.push(
      `receipt:  ${projection.receipt === null ? '(none)' : `status=${projection.receipt.status} summary=${JSON.stringify(projection.receipt.summary)}`}`,
    );
    lines.push(
      `result:   ${projection.delivery === null ? '(none)' : `${projection.delivery.resultId} (${projection.delivery.newlyDelivered ? 'newly delivered' : 'exact replay'})`}`,
    );
  }
  lines.push(`task:     ${projection.taskStatus}`);
  if (projection.outcome === RUN_OUTCOME_EXECUTOR_REJECTED) {
    lines.push(
      'next:     executor boundary exited non-zero; no retry exists — inspect the task and decide manually',
    );
  } else if (projection.outcome === RUN_OUTCOME_EXECUTOR_UNKNOWN) {
    lines.push(
      'next:     executor exit status was unobservable; UNKNOWN is not a retry permission — inspect the task',
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function buildConfiguredExecutor(
  { codexPath, workdir, resultDirectory, taskId = null },
  env = process.env,
) {
  const envPath =
    typeof env?.[CODEX_CLI_PATH_ENV_KEY] === 'string' ? env[CODEX_CLI_PATH_ENV_KEY].trim() : '';
  const executablePath = codexPath ?? (envPath.length > 0 ? envPath : null);
  if (executablePath === null) {
    fail(
      `no READ_ONLY executor is configured: ${CODEX_CLI_PATH_ENV_KEY} is unset and --codex was not provided (no registry, no auto-selection, no fallback executor).`,
      {
        code: OPERATOR_EXECUTOR_NOT_CONFIGURED,
        taskId,
        stage: 'executor-config',
        nextAction: deriveNextAction(OPERATOR_EXECUTOR_NOT_CONFIGURED),
      },
    );
  }
  const resolvedWorkdir = workdir ?? process.cwd();
  const resolvedResultDirectory =
    resultDirectory ?? nodePath.join(nodeOs.tmpdir(), 'greenhub-codex-structured-results');
  try {
    return createCodexCliStructuredResultExecutor({
      executablePath,
      workdir: resolvedWorkdir,
      resultDirectory: resolvedResultDirectory,
    });
  } catch (error) {
    fail(error?.message ?? String(error), {
      code:
        typeof error?.code === 'string' && error.code
          ? error.code
          : OPERATOR_EXECUTOR_NOT_CONFIGURED,
      taskId,
      stage: 'executor-config',
      nextAction: deriveNextAction(OPERATOR_EXECUTOR_NOT_CONFIGURED),
    });
  }
  return null;
}

export async function runOperatorCli({
  argv = [],
  env = process.env,
  platform = process.platform,
  stdout = process.stdout,
  stderr = process.stderr,
  store,
  executor,
} = {}) {
  let options;
  try {
    options = parseOperatorArgv(argv);
  } catch (error) {
    stderr.write(renderOperatorError(error));
    return error?.code === OPERATOR_ARGUMENT_INVALID ? 2 : 1;
  }
  if (options.help || options.command === null) {
    stdout.write(renderUsage());
    return 0;
  }
  const activeStore = store ?? new CoordinationStore({ env, platform });
  try {
    if (options.command === 'status') {
      const projection = collectStatusOverview({ store: activeStore });
      stdout.write(
        options.json ? `${JSON.stringify(projection, null, 2)}\n` : renderStatus(projection),
      );
      return 0;
    }
    if (options.command === 'inspect') {
      const projection = collectTaskInspection({ store: activeStore, taskId: options.taskId });
      stdout.write(
        options.json ? `${JSON.stringify(projection, null, 2)}\n` : renderInspection(projection),
      );
      return 0;
    }
    const activeExecutor = executor ?? buildConfiguredExecutor(options, env);
    const projection = await executeOperatorTask({
      store: activeStore,
      taskId: options.taskId,
      sourceTaskId: options.sourceTaskId ?? undefined,
      emissionSlot: options.emissionSlot,
      workerId: options.workerId,
      leaseDurationMs: options.leaseDurationMs,
      executor: activeExecutor,
    });
    stdout.write(
      options.json ? `${JSON.stringify(projection, null, 2)}\n` : renderRunResult(projection),
    );
    return projection.outcome === RUN_OUTCOME_EXECUTED ||
      projection.outcome === RUN_OUTCOME_ALREADY_TERMINAL
      ? 0
      : 1;
  } catch (error) {
    stderr.write(renderOperatorError(error));
    return 1;
  }
}

const invokedAsMainScript =
  process.argv[1] != null && nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMainScript) {
  process.exitCode = await runOperatorCli({ argv: process.argv.slice(2) });
}
