// Bounded durable result-receipt owner:
// GREENHUB-COORDINATION-DURABLE-EXECUTOR-RESULT-RECEIPT-33.
// Surface: scripts/coordination/*executor-result-receipt* (this module) + the
// durable executor-result-receipt store primitives ONLY
// (readExecutorResultReceipt / createExecutorResultReceipt over
// <coordination-home>/executor-result-receipts/<dispatchId>.json).
// Task 29 public entry invokeExecutorInvocationAdapter is composed verbatim;
// the Task 30 outcome vocabulary and the Task 31 typed process-start failure
// meaning are reused verbatim; Task 32 durable outcome records are composed
// read-only and are never written, changed, or overwritten here.
//
// State transition added here:
//   CODEX_CLI_STRUCTURED_RESULT(dispatchId)
//     -> DURABLY_RECORDED_EXECUTOR_RESULT_RECEIPT(dispatchId)
//
// Contract summary:
//   persistExecutorResultReceipt() != executeTask() != invokeExecutor()
//     != persistExecutorInvocationOutcome() != invokeExecutorAndValidateOutcome()
//     != invokeExecutorInvocationAdapter() != store.deliverResult()
//     != acknowledgeDispatch() != acceptExecutorDispatchDecision().
//   DURABLY_RECORDED_EXECUTOR_RESULT_RECEIPT != canonical task Result
//     != task completion != RESULT_DELIVERED != ACK != disposition
//     != retry permission != task succeeded proof != mutation proof
//     != global exactly-once executor invocation.
//   Entry is EXACTLY one path:
//     (dispatchId, store, executor)
//       1. store capability gate [readExecutorResultReceipt /
//          createExecutorResultReceipt / readExecutorInvocationOutcome /
//          readExecutorInvocationAttempt ONLY; no other capability is
//          required here]
//       2. dispatchId identity validation [Task 28 executor-invocation-attempt
//          identity family verbatim: invalid identity fails closed]
//       3. store.readExecutorResultReceipt(dispatchId) [durable-first:
//          dispatchId is the ONLY lookup key; at most one durable receipt read
//          before any composition]
//       4. existing valid durable receipt: authoritative replay [zero executor
//          process invocations, zero writes, zero byte change, zero mtime
//          change, never repair]
//       5. recorded Task 32 durable invocation outcome without receipt: an
//          explicit fail-closed readable state. The executor is never
//          re-invoked from this entry and no receipt is fabricated.
//       6. executor capability validation [caller-supplied function only; no
//          registry, no selection, no fallback]
//       7. invokeExecutorInvocationAdapter({ dispatchId, store, adapter }) with
//          a guarded adapter wrapper [Task 29 VERBATIM, EXACTLY ONCE: Task 28
//          identity validation, store capability gate, one dispatchId-keyed
//          durable read, Task 24 record validation, direct binding re-check,
//          AT MOST ONE adapter invocation; the guarded wrapper enforces the
//          READ_ONLY task capability BEFORE the caller executor runs and
//          captures the exact expected taskId from the exact validated record]
//       8. executor envelope validation: EXACT
//          { schemaVersion: 1, dispatchId, outcome, result } with outcome in
//          ACCEPTED | REJECTED | UNKNOWN. REJECTED/UNKNOWN return with
//          receipt null and perform ZERO durable writes. Process exit code is
//          never mapped to the receipt status.
//       9. ACCEPTED ONLY: the structured result payload is validated (exact
//          key shape, status SUCCEEDED | FAILED | BLOCKED, bounded summary /
//          refs / friction, taskId exact binding against the durable Task 28
//          record) and the EXACT durable receipt is exclusive-created under
//          <home>/executor-result-receipts/<dispatchId>.json
//      10. exact durable read-back verification of the created record
//      11. exclusive-create race loser: immediate winner re-read; exact same
//          valid receipt = idempotent convergence / different valid receipt =
//          fail-closed conflict / corrupt winner = fail closed. The first
//          durable winner is preserved: never overwrite, merge, repair,
//          delete-and-recreate, or last-writer-wins.
//   LOOKUP KEY = dispatchId ONLY. taskId / sourceTaskId / nextTaskId /
//   workerId / claimToken / claimGeneration / admissionId / emissionSlot are
//   never lookup keys.
//
// Exact durable value (the EXACT structured executor evidence):
//   { schemaVersion: 1, dispatchId, taskId, status, summary, proofRefs,
//     evidenceRefs, frictionObserved } — EXACTLY these eight fields, status in
//   SUCCEEDED | FAILED | BLOCKED. No wrapper metadata: no workerId /
//   claimToken / claimGeneration / deliveredAt / canonical resultId /
//   acceptedAt / invokedAt / startedAt / completedAt / createdAt / updatedAt /
//   pid / hostname / usage / retryCount / attemptNumber / any new generation.
//   The canonical Result delivery layer must later take workerId / claimToken /
//   claimGeneration / deliveredAt / resultId from the existing durable
//   authority; the executor never authors them. claimGeneration remains the
//   SOLE fencing generation and no new fencing authority exists.
//
// Concrete Codex CLI structured-result executor
// (createCodexCliStructuredResultExecutor):
//   - EXACTLY ONE Codex CLI non-interactive process per adapter call, argv-only
//     and shell-free: `exec --sandbox read-only --ephemeral --output-schema
//     <schemaFile> --output-last-message <resultFile> --cd <workdir>
//     <canonical Task 28 record as ONE prompt argv>`;
//   - the structured-output mechanism is the installed Codex CLI documented
//     surface ONLY (`--output-schema` JSON Schema + `--output-last-message`
//     file), verified against `codex exec --help` at implementation time;
//     stdout/stderr are never parsed and never promoted to evidence;
//   - executor capability is READ_ONLY ONLY: taskKind !== READ_ONLY fails
//     closed BEFORE process start (zero process invocations). A read-only
//     sandbox never proves that a mutation task was performed;
//   - process start failure keeps the Task 31 typed error meaning
//     (CODEX_CLI_EXECUTOR_PROCESS_START_FAILED), never UNKNOWN;
//   - exit 0 + missing result file -> fail closed (MISSING_EXECUTOR_STRUCTURED_RESULT);
//   - exit 0 + malformed result -> fail closed (INVALID_EXECUTOR_STRUCTURED_RESULT);
//   - exit 0 + taskId binding mismatch -> fail closed
//     (EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH);
//   - exit 0 NEVER becomes SUCCEEDED by itself: the status is taken from the
//     executor-authored structured result payload ONLY.
//
// Concurrency boundary (never overclaimed): this Task does NOT provide global
// exactly-once executor invocation. Two concurrent processes can both observe
// "no durable receipt" and both enter Task 29, so the executor process
// boundary can be crossed more than once. OS exclusive-create serializes ONLY
// the durable receipt winner. What this Task proves: later calls after a
// durable receipt exists do not re-invoke the executor, the first durable
// winner is immutable authority, and no automatic retry exists. Cross-process
// pre-invocation fencing, executor leases, and invocation locks are a separate
// future boundary and are NOT implemented here.
//
// Crash boundary: the durable receipt exists to preserve executor output
// before any canonical Result mutation. A receipt is NEVER task completion,
// never RESULT_DELIVERED, never an ACK, and never a disposition. This module
// never calls store.deliverResult(), never creates a canonical result, never
// mutates task.json / claim.json / result.json / disposition / ACK bytes,
// never introduces a RUNNING status or a new task status, and never creates a
// new generation/fencing authority. A Task 32 durable outcome without a
// receipt stays readable as a distinct fail-closed state and is never
// auto-repaired.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   canonical task Result persistence, store.deliverResult, RESULT_DELIVERED,
//   CLAIMED -> RUNNING, RUNNING status, ACK protocol, sender/receiver receipt,
//   result disposition, result materialization, consumption cursor, scheduler,
//   READY scan, daemon/polling, executor registry, executor selection,
//   fallback executor, retry/backoff/resend, pre-invocation executor lock,
//   executor lease, global exactly-once claim, mutation-capable sandbox,
//   repository source mutation by the executor, OpenCode / Astra / ChatGPT
//   adapters, new generation/fencing authority, production deploy.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import nodeFs from 'node:fs';
import nodePath from 'node:path';
import {
  CODEX_CLI_EXECUTOR_ENV_ALLOWLIST,
  CODEX_CLI_EXECUTOR_PROCESS_START_FAILED,
  CodexCliExecutorAdapterError,
} from './codex-cli-executor-adapter.mjs';
import {
  INVALID_EXECUTOR_INVOCATION_ADAPTER,
  invokeExecutorInvocationAdapter,
} from './dispatch-executor-invocation-contract.mjs';
import {
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_REJECTED,
  EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
  EXECUTOR_INVOCATION_OUTCOME_VALUES,
} from './dispatch-executor-invocation-outcome.mjs';
import {
  assertValidExecutorInvocationOutcomeDispatchId,
  validateExecutorInvocationOutcomeRecord,
} from './dispatch-executor-invocation-outcome-persistence.mjs';
import { validateExecutorInvocationInputRecord } from './dispatch-executor-invocation-input.mjs';
import {
  MAX_FRICTION_ENTRIES,
  MAX_FRICTION_ENTRY_LENGTH,
  MAX_REF_STRING_LENGTH,
  MAX_SUMMARY_LENGTH,
  TASK_ID_PATTERN,
  TASK_KIND_READ_ONLY,
} from './task-envelope.mjs';

export const EXECUTOR_RESULT_RECEIPTS_DIRNAME = 'executor-result-receipts';

// The exact receipt schema version: a NUMBER, never a string, timestamp, or
// generation.
export const EXECUTOR_RESULT_RECEIPT_SCHEMA_VERSION = 1;

// The complete allowed receipt status vocabulary. These describe the executor
// structured result payload ONLY; none of them is a task status.
export const EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED = 'SUCCEEDED';
export const EXECUTOR_RESULT_RECEIPT_STATUS_FAILED = 'FAILED';
export const EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED = 'BLOCKED';

export const EXECUTOR_RESULT_RECEIPT_STATUS_VALUES = Object.freeze([
  EXECUTOR_RESULT_RECEIPT_STATUS_SUCCEEDED,
  EXECUTOR_RESULT_RECEIPT_STATUS_FAILED,
  EXECUTOR_RESULT_RECEIPT_STATUS_BLOCKED,
]);

// Exact canonical key order for the durable receipt record.
export const EXECUTOR_RESULT_RECEIPT_FIELDS = Object.freeze([
  'schemaVersion',
  'dispatchId',
  'taskId',
  'status',
  'summary',
  'proofRefs',
  'evidenceRefs',
  'frictionObserved',
]);

// The executor-authored structured result payload: the exact six fields a
// concrete or caller-supplied executor may author. dispatchId and
// schemaVersion are NEVER executor-authored: the receipt layer takes them from
// the durable invocation authority.
export const EXECUTOR_RESULT_RECEIPT_STRUCTURED_FIELDS = Object.freeze([
  'taskId',
  'status',
  'summary',
  'proofRefs',
  'evidenceRefs',
  'frictionObserved',
]);

// The exact in-memory structured executor envelope contract. result is the
// executor-authored payload for ACCEPTED and exactly null for REJECTED /
// UNKNOWN.
export const CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION = 1;
export const CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_FIELDS = Object.freeze([
  'schemaVersion',
  'dispatchId',
  'outcome',
  'result',
]);

// Receipt-native meanings ONLY. Missing Task 29 input, corrupt Task 28
// records, Task 24 validation failures, and predecessor store codes propagate
// verbatim; there is no receipt-specific ACK, disposition, retry, or
// generation authority.
export const CORRUPT_EXECUTOR_RESULT_RECEIPT = 'CORRUPT_EXECUTOR_RESULT_RECEIPT';
export const EXECUTOR_RESULT_RECEIPT_CONFLICT = 'EXECUTOR_RESULT_RECEIPT_CONFLICT';
export const INVALID_EXECUTOR_RESULT_RECEIPT_STORE = 'INVALID_EXECUTOR_RESULT_RECEIPT_STORE';
export const INVALID_EXECUTOR_STRUCTURED_RESULT = 'INVALID_EXECUTOR_STRUCTURED_RESULT';
export const MISSING_EXECUTOR_STRUCTURED_RESULT = 'MISSING_EXECUTOR_STRUCTURED_RESULT';
export const EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH =
  'EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH';
export const EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME =
  'EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME';
export const EXECUTOR_RESULT_RECEIPT_REQUIRES_READ_ONLY_TASK =
  'EXECUTOR_RESULT_RECEIPT_REQUIRES_READ_ONLY_TASK';

// Concrete Codex CLI structured-result executor-native meanings ONLY.
export const INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION =
  'INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION';
export const INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT =
  'INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT';

// Minimal immutable result shapes. newlyRecorded / exactReplay are
// persistence-local outcomes only, never durable state and never a task
// lifecycle status. receipt is the authoritative durable record (created or
// replayed) or exactly null when no structured result was captured.
export const EXECUTOR_RESULT_RECEIPT_PERSISTENCE_NEW_FIELDS = Object.freeze([
  'dispatchId',
  'newlyRecorded',
  'outcome',
  'receipt',
]);
export const EXECUTOR_RESULT_RECEIPT_PERSISTENCE_REPLAY_FIELDS = Object.freeze([
  'dispatchId',
  'newlyRecorded',
  'exactReplay',
  'outcome',
  'receipt',
]);

export class ExecutorResultReceiptError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ExecutorResultReceiptError';
    this.code = details.code ?? CORRUPT_EXECUTOR_RESULT_RECEIPT;
  }
}

function fail(message, code = CORRUPT_EXECUTOR_RESULT_RECEIPT) {
  throw new ExecutorResultReceiptError(message, { code });
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function assertPlainRecord(value, code, what) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${what} must be a plain record (received ${describeValue(value)}).`, code);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(
      `${what} must be a plain record with Object.prototype or null prototype (class instances, Maps, Dates, and other exotic objects are not valid).`,
      code,
    );
  }
}

function readExactOwnDataFields(record, expectedFields, code, what) {
  if (Object.getOwnPropertySymbols(record).length > 0) {
    fail(`${what} must not carry symbol keys.`, code);
  }
  const ownKeys = Object.getOwnPropertyNames(record);
  const exactKeySet =
    ownKeys.length === expectedFields.length &&
    expectedFields.every((field) => ownKeys.includes(field));
  if (!exactKeySet) {
    fail(
      `${what} must carry exactly ${expectedFields.length} fields (${expectedFields.join(', ')}) with no extra metadata; received [${ownKeys.join(', ')}].`,
      code,
    );
  }
  const fields = {};
  for (const field of expectedFields) {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined) {
      fail(
        `${what} field "${field}" must be a plain data property (accessors are not valid).`,
        code,
      );
    }
    fields[field] = descriptor.value;
  }
  return fields;
}

function assertNonEmptyBoundedString(value, fieldName, maxLength, code) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${fieldName} must be a non-empty string.`, code);
  }
  if (value.length > maxLength) {
    fail(`${fieldName} exceeds ${maxLength} chars (reference-first, no embedded dumps).`, code);
  }
}

function assertStructuredRefArray(value, fieldName, code) {
  if (!Array.isArray(value)) {
    fail(`${fieldName} must be an array of reference strings.`, code);
  }
  for (const entry of value) {
    assertNonEmptyBoundedString(entry, `${fieldName}[]`, MAX_REF_STRING_LENGTH, code);
    if (entry.includes('\n\n\n')) {
      fail(`${fieldName} entry looks like an embedded dump, not a reference.`, code);
    }
  }
}

function assertStructuredFrictionArray(value, code) {
  if (!Array.isArray(value)) {
    fail('frictionObserved must be an array of strings.', code);
  }
  if (value.length > MAX_FRICTION_ENTRIES) {
    fail(`frictionObserved exceeds ${MAX_FRICTION_ENTRIES} entries.`, code);
  }
  for (const entry of value) {
    assertNonEmptyBoundedString(entry, 'frictionObserved[]', MAX_FRICTION_ENTRY_LENGTH, code);
  }
}

function assertValidReceiptTaskId(taskId, code = CORRUPT_EXECUTOR_RESULT_RECEIPT) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, code);
  }
}

export function assertValidExecutorResultReceiptDispatchId(dispatchId) {
  try {
    assertValidExecutorInvocationOutcomeDispatchId(dispatchId);
  } catch (error) {
    fail(error.message, CORRUPT_EXECUTOR_RESULT_RECEIPT);
  }
  return dispatchId;
}

export function executorResultReceiptFileName(dispatchId) {
  assertValidExecutorResultReceiptDispatchId(dispatchId);
  return `${dispatchId}.json`;
}

/**
 * Durable path for one immutable executor result receipt.
 * `<home>/executor-result-receipts/<dispatchId>.json` (dispatchId-keyed ONLY).
 * `home` is a durable coordination home, never the repository worktree.
 */
export function executorResultReceiptFilePath(home, dispatchId) {
  if (typeof home !== 'string' || !home.trim()) {
    fail('coordination home must be a non-empty directory path.', CORRUPT_EXECUTOR_RESULT_RECEIPT);
  }
  assertValidExecutorResultReceiptDispatchId(dispatchId);
  return nodePath.join(
    home,
    EXECUTOR_RESULT_RECEIPTS_DIRNAME,
    executorResultReceiptFileName(dispatchId),
  );
}

// Shared pure field validation for the six executor-authored structured result
// fields. The caller supplies the fail-closed code so the same exact checks
// guard both the in-memory executor payload (INVALID_EXECUTOR_STRUCTURED_RESULT)
// and the durable receipt record (CORRUPT_EXECUTOR_RESULT_RECEIPT). The
// Result Envelope v1 bounds are reused verbatim; canonical Result authority is
// NOT duplicated here (no resultId / workerId / claimToken / claimGeneration /
// deliveredAt / usage exists in a receipt).
function validateStructuredResultFields(fields, expectedTaskId, code) {
  assertValidReceiptTaskId(fields.taskId, code);
  if (expectedTaskId !== undefined && fields.taskId !== expectedTaskId) {
    fail(
      `executor structured result taskId mismatch (fail-closed): expected ${expectedTaskId} but the structured result carries ${String(fields.taskId)}.`,
      EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH,
    );
  }
  if (!EXECUTOR_RESULT_RECEIPT_STATUS_VALUES.includes(fields.status)) {
    fail(
      `executor structured result status must be exactly one of ${EXECUTOR_RESULT_RECEIPT_STATUS_VALUES.join(' | ')}; received ${describeValue(fields.status)} ${String(fields.status)}.`,
      code,
    );
  }
  assertNonEmptyBoundedString(
    fields.summary,
    'executor structured result summary',
    MAX_SUMMARY_LENGTH,
    code,
  );
  assertStructuredRefArray(fields.proofRefs, 'proofRefs', code);
  assertStructuredRefArray(fields.evidenceRefs, 'evidenceRefs', code);
  assertStructuredFrictionArray(fields.frictionObserved, code);
}

/**
 * Validate one durable executor result receipt record. Returns a frozen
 * canonical copy. Fail-closed, no repair:
 * 1. plain object with the EXACT eight-field key shape and fixed key order,
 * 2. schemaVersion exactly 1 (number),
 * 3. dispatchId is a valid Task 19/22/24/26/28 identity,
 * 4. taskId is a valid Task Envelope task id,
 * 5. status is exactly SUCCEEDED, FAILED, or BLOCKED,
 * 6. bounded summary / proofRefs / evidenceRefs / frictionObserved.
 */
export function validateExecutorResultReceiptRecord(record) {
  assertPlainRecord(record, CORRUPT_EXECUTOR_RESULT_RECEIPT, 'executor result receipt record');
  const keys = Object.keys(record);
  if (keys.length !== EXECUTOR_RESULT_RECEIPT_FIELDS.length) {
    fail(
      `executor result receipt record must carry exactly ${EXECUTOR_RESULT_RECEIPT_FIELDS.length} fields (${EXECUTOR_RESULT_RECEIPT_FIELDS.join(', ')}).`,
      CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  for (let index = 0; index < EXECUTOR_RESULT_RECEIPT_FIELDS.length; index += 1) {
    if (keys[index] !== EXECUTOR_RESULT_RECEIPT_FIELDS[index]) {
      fail(
        `executor result receipt record key order/shape mismatch at position ${index}: expected "${EXECUTOR_RESULT_RECEIPT_FIELDS[index]}" got "${keys[index]}".`,
        CORRUPT_EXECUTOR_RESULT_RECEIPT,
      );
    }
  }
  const fields = readExactOwnDataFields(
    record,
    EXECUTOR_RESULT_RECEIPT_FIELDS,
    CORRUPT_EXECUTOR_RESULT_RECEIPT,
    'executor result receipt record',
  );
  if (fields.schemaVersion !== EXECUTOR_RESULT_RECEIPT_SCHEMA_VERSION) {
    fail(
      `executor result receipt schemaVersion must be exactly ${EXECUTOR_RESULT_RECEIPT_SCHEMA_VERSION} (number), never a string, timestamp, or generation.`,
      CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  assertValidExecutorResultReceiptDispatchId(fields.dispatchId);
  validateStructuredResultFields(fields, undefined, CORRUPT_EXECUTOR_RESULT_RECEIPT);
  return Object.freeze({
    schemaVersion: EXECUTOR_RESULT_RECEIPT_SCHEMA_VERSION,
    dispatchId: fields.dispatchId,
    taskId: fields.taskId,
    status: fields.status,
    summary: fields.summary,
    proofRefs: Object.freeze([...fields.proofRefs]),
    evidenceRefs: Object.freeze([...fields.evidenceRefs]),
    frictionObserved: Object.freeze([...fields.frictionObserved]),
  });
}

// Validate the executor-authored structured result payload (the six fields the
// executor may author) and return a frozen canonical copy. taskId is bound
// against the exact expected taskId taken from the durable Task 28 record.
function validateStructuredResultPayload(payload, expectedTaskId) {
  assertPlainRecord(
    payload,
    INVALID_EXECUTOR_STRUCTURED_RESULT,
    'executor structured result payload',
  );
  const fields = readExactOwnDataFields(
    payload,
    EXECUTOR_RESULT_RECEIPT_STRUCTURED_FIELDS,
    INVALID_EXECUTOR_STRUCTURED_RESULT,
    'executor structured result payload',
  );
  validateStructuredResultFields(fields, expectedTaskId, INVALID_EXECUTOR_STRUCTURED_RESULT);
  return Object.freeze({
    taskId: fields.taskId,
    status: fields.status,
    summary: fields.summary,
    proofRefs: Object.freeze([...fields.proofRefs]),
    evidenceRefs: Object.freeze([...fields.evidenceRefs]),
    frictionObserved: Object.freeze([...fields.frictionObserved]),
  });
}

// Validate the exact in-memory structured executor envelope returned by the
// concrete or caller-supplied executor. No normalization, no repair.
function validateStructuredResultEnvelope(dispatchId, returned) {
  assertPlainRecord(
    returned,
    INVALID_EXECUTOR_STRUCTURED_RESULT,
    'executor structured result envelope',
  );
  const fields = readExactOwnDataFields(
    returned,
    CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_FIELDS,
    INVALID_EXECUTOR_STRUCTURED_RESULT,
    'executor structured result envelope',
  );
  if (fields.schemaVersion !== CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION) {
    fail(
      `executor structured result envelope schemaVersion must be exactly ${CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION} (number).`,
      INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  if (fields.dispatchId !== dispatchId) {
    fail(
      `executor structured result envelope dispatchId mismatch (fail-closed): requested ${dispatchId} but the executor reported ${describeValue(fields.dispatchId)} ${String(fields.dispatchId)}.`,
      EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH,
    );
  }
  if (!EXECUTOR_INVOCATION_OUTCOME_VALUES.includes(fields.outcome)) {
    fail(
      `executor structured result envelope outcome must be exactly one of ${EXECUTOR_INVOCATION_OUTCOME_VALUES.join(' | ')}; received ${describeValue(fields.outcome)} ${String(fields.outcome)}.`,
      INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  if (fields.outcome === EXECUTOR_INVOCATION_OUTCOME_ACCEPTED) {
    if (fields.result === null || fields.result === undefined) {
      fail(
        'executor structured result envelope outcome ACCEPTED requires the executor-authored structured result payload; process success alone is never evidence.',
        MISSING_EXECUTOR_STRUCTURED_RESULT,
      );
    }
  } else if (fields.result !== null) {
    fail(
      `executor structured result envelope outcome ${fields.outcome} must carry result null (received ${describeValue(fields.result)}).`,
      INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  return Object.freeze({
    schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
    dispatchId,
    outcome: fields.outcome,
    result: fields.result,
  });
}

function assertStoredReceiptBinding(record, dispatchId) {
  const canonical = validateExecutorResultReceiptRecord(record);
  if (canonical.dispatchId !== dispatchId) {
    fail(
      `executor result receipt store key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${canonical.dispatchId}.`,
      CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  return canonical;
}

/**
 * Durably record ONE executor result receipt for one dispatchId: the EXACT
 * validated structured result evidence is stored under
 * <coordination-home>/executor-result-receipts/<dispatchId>.json.
 *
 * Contract (durable-first, fail-closed, no repair, no overwrite):
 * 1. `store` must expose readExecutorResultReceipt(dispatchId) /
 *    createExecutorResultReceipt(record) / readExecutorInvocationOutcome(
 *    dispatchId) / readExecutorInvocationAttempt(dispatchId); otherwise
 *    INVALID_EXECUTOR_RESULT_RECEIPT_STORE and nothing is read or written.
 * 2. An already existing valid durable receipt is the authoritative replay:
 *    the executor is NOT invoked, no file is written, no byte or mtime
 *    changes, and the call is not treated as retry permission.
 * 3. A recorded Task 32 durable invocation outcome without a receipt fails
 *    closed (EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME): the state
 *    stays readable, no receipt is fabricated, and the executor is never
 *    re-invoked to backfill it.
 * 4. Only when no durable receipt and no durable outcome exist is Task 29
 *    composed, EXACTLY ONCE per call, through a guarded adapter wrapper that
 *    enforces the READ_ONLY task capability before the caller executor runs
 *    and captures the exact expected taskId from the exact validated Task 28
 *    record. Task 29 semantics are never duplicated; its fail-closed codes
 *    propagate UNCHANGED with zero durable writes.
 * 5. REJECTED / UNKNOWN outcomes return with receipt null and ZERO durable
 *    writes: the Task 30 semantics are preserved and no receipt is fabricated.
 * 6. ACCEPTED ONLY: the structured payload is validated and bound to the
 *    durable taskId, the exact receipt is exclusive-created, and the created
 *    record is verified by an exact durable read-back.
 * 7. Exclusive-create race loser: immediate winner re-read. Exact same valid
 *    receipt = idempotent convergence; different valid receipt = fail-closed
 *    EXECUTOR_RESULT_RECEIPT_CONFLICT; corrupt winner = fail closed. The first
 *    durable winner is preserved: never overwrite, merge, repair,
 *    delete-and-recreate, or last-writer-wins.
 *
 * Global exactly-once executor invocation is NOT claimed. Two concurrent
 * processes can both observe an absent durable receipt and both enter Task 29;
 * exclusive-create serializes only the durable receipt winner. No automatic
 * retry, fallback, backoff, registry, or selection exists here.
 */
export async function persistExecutorResultReceipt({ dispatchId, store, executor } = {}) {
  // 1. Caller-supplied durable store primitives only: no registry, no
  //    auto-detection, no transport.
  if (
    !store ||
    typeof store.readExecutorResultReceipt !== 'function' ||
    typeof store.createExecutorResultReceipt !== 'function' ||
    typeof store.readExecutorInvocationOutcome !== 'function' ||
    typeof store.readExecutorInvocationAttempt !== 'function'
  ) {
    fail(
      'executor result receipt persistence requires a caller-supplied store exposing readExecutorResultReceipt / createExecutorResultReceipt / readExecutorInvocationOutcome / readExecutorInvocationAttempt (composition only; the caller supplies the store explicitly).',
      INVALID_EXECUTOR_RESULT_RECEIPT_STORE,
    );
  }

  // 2. dispatchId identity validation before any durable read.
  assertValidExecutorResultReceiptDispatchId(dispatchId);

  // 3. Durable-first: one dispatchId-keyed receipt read; a missing receipt is
  //    the ONLY condition under which the executor path is entered.
  const observed = store.readExecutorResultReceipt(dispatchId);
  if (observed !== null && observed !== undefined) {
    // 4. The existing valid durable receipt is the authoritative replay. No
    //    executor invocation, no write, no mtime change, no repair.
    const canonical = assertStoredReceiptBinding(observed, dispatchId);
    return Object.freeze({
      dispatchId,
      newlyRecorded: false,
      exactReplay: true,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      receipt: canonical,
    });
  }

  // 5. Recorded Task 32 durable invocation outcome without a receipt: a
  //    distinct fail-closed readable state. The process already crossed the
  //    executor boundary without capture; re-invoking it here would be a
  //    second execution, not evidence recovery, so the entry fails closed
  //    with zero process invocations and zero writes.
  const recordedOutcome = store.readExecutorInvocationOutcome(dispatchId);
  if (recordedOutcome !== null && recordedOutcome !== undefined) {
    let canonicalOutcome;
    try {
      canonicalOutcome = validateExecutorInvocationOutcomeRecord(recordedOutcome);
    } catch (error) {
      fail(
        `recorded executor invocation outcome is invalid (fail-closed, no repair): ${error?.message}`,
        typeof error?.code === 'string' && error.code
          ? error.code
          : CORRUPT_EXECUTOR_RESULT_RECEIPT,
      );
    }
    if (canonicalOutcome.dispatchId !== dispatchId) {
      fail(
        `recorded executor invocation outcome key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${canonicalOutcome.dispatchId}.`,
        CORRUPT_EXECUTOR_RESULT_RECEIPT,
      );
    }
    fail(
      `a durable executor invocation outcome (${canonicalOutcome.outcome}) already exists for ${dispatchId} without a result receipt; this state is never auto-repaired and the executor is never re-invoked from this entry.`,
      EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME,
    );
  }

  // 6. Caller-supplied executor capability validation before any store
  //    composition: no registry, no auto-selection, no fallback executor.
  if (typeof executor !== 'function') {
    throw new ExecutorResultReceiptError(
      'executor result receipt persistence requires a caller-supplied structured-result executor function (no registry, no auto-selection, no fallback).',
      { code: INVALID_EXECUTOR_INVOCATION_ADAPTER },
    );
  }

  // 7. Task 29 composition EXACTLY ONCE through the guarded wrapper. The
  //    wrapper receives the EXACT validated Task 28 record from Task 29,
  //    enforces the READ_ONLY capability before the caller executor runs, and
  //    captures the exact expected taskId for the payload binding check. The
  //    wrapper never retries, never catches, and never remaps.
  let expectedTaskId = null;
  const guardedExecutor = async (task28Record) => {
    const validatedRecord = validateExecutorInvocationInputRecord(task28Record);
    const task = validatedRecord.decisionInput.task;
    if (task.taskKind !== TASK_KIND_READ_ONLY) {
      fail(
        `executor result receipt path provides READ_ONLY executor capability only: taskKind ${String(task.taskKind)} fails closed BEFORE any process start (a read-only executor never proves a mutation task was performed).`,
        EXECUTOR_RESULT_RECEIPT_REQUIRES_READ_ONLY_TASK,
      );
    }
    expectedTaskId = task.taskId;
    return await executor(validatedRecord);
  };

  const returned = await invokeExecutorInvocationAdapter({
    dispatchId,
    store,
    adapter: guardedExecutor,
  });

  // 8. The executor envelope is validated against the exact minimal contract.
  const envelope = validateStructuredResultEnvelope(dispatchId, returned);

  if (envelope.outcome !== EXECUTOR_INVOCATION_OUTCOME_ACCEPTED) {
    // REJECTED / UNKNOWN: Task 30 semantics preserved, no receipt, no write.
    return Object.freeze({
      dispatchId,
      newlyRecorded: false,
      outcome: envelope.outcome,
      receipt: null,
    });
  }

  // 9. ACCEPTED ONLY: the executor-authored payload is validated and bound to
  //    the exact taskId of the durable Task 28 record captured by the wrapper.
  if (typeof expectedTaskId !== 'string') {
    fail(
      'executor structured result payload cannot be bound: no exact Task 28 taskId was observed for this invocation.',
      CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  const payload = validateStructuredResultPayload(envelope.result, expectedTaskId);
  const receipt = Object.freeze({
    schemaVersion: EXECUTOR_RESULT_RECEIPT_SCHEMA_VERSION,
    dispatchId,
    taskId: payload.taskId,
    status: payload.status,
    summary: payload.summary,
    proofRefs: payload.proofRefs,
    evidenceRefs: payload.evidenceRefs,
    frictionObserved: payload.frictionObserved,
  });

  // 10. Exclusive-create the EXACT receipt (never exists()->write()).
  const created = store.createExecutorResultReceipt(receipt);
  if (created && created.created === true) {
    // 11. Durable read-back: the stored value must be the exact record.
    const stored = store.readExecutorResultReceipt(dispatchId);
    if (
      stored === null ||
      stored === undefined ||
      JSON.stringify(stored) !== JSON.stringify(receipt)
    ) {
      fail(
        `executor result receipt failed durable read-back after exclusive create (fail-closed): ${dispatchId}`,
        CORRUPT_EXECUTOR_RESULT_RECEIPT,
      );
    }
    return Object.freeze({
      dispatchId,
      newlyRecorded: true,
      outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
      receipt: stored,
    });
  }

  // 12. Exclusive-create race loser: re-read the first durable winner.
  const winner = store.readExecutorResultReceipt(dispatchId);
  if (winner === null || winner === undefined) {
    fail(
      `executor result receipt race could not be resolved deterministically (fail-closed): ${dispatchId}`,
      CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  const canonicalWinner = assertStoredReceiptBinding(winner, dispatchId);
  if (JSON.stringify(canonicalWinner) !== JSON.stringify(receipt)) {
    fail(
      `executor result receipt conflict (fail-closed): dispatchId ${dispatchId} already carries a different valid durable receipt; the first durable winner is preserved and the incoming receipt is never preferred.`,
      EXECUTOR_RESULT_RECEIPT_CONFLICT,
    );
  }
  return Object.freeze({
    dispatchId,
    newlyRecorded: false,
    exactReplay: true,
    outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
    receipt: canonicalWinner,
  });
}

// ---------------------------------------------------------------------------
// Concrete Codex CLI structured-result executor
// (READ_ONLY capability only; structured output via the installed Codex CLI
// documented surface `--output-schema` + `--output-last-message`).
// ---------------------------------------------------------------------------

const STRUCTURED_EXECUTOR_CONFIGURATION_FIELDS = Object.freeze([
  'executablePath',
  'workdir',
  'resultDirectory',
  'runner',
  'env',
]);

function assertValidConfigurationPath(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(
      `Codex CLI structured-result executor configuration requires a non-empty absolute ${fieldName} (the task payload never selects the executable, the working directory, or the result directory).`,
      INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
    );
  }
  if (value.includes('\0')) {
    fail(
      `Codex CLI structured-result executor configuration ${fieldName} must not contain NUL bytes.`,
      INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
    );
  }
  if (!nodePath.isAbsolute(value)) {
    fail(
      `Codex CLI structured-result executor configuration ${fieldName} must be an absolute path.`,
      INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
    );
  }
  return value;
}

function assertNoUnknownStructuredExecutorConfigurationFields(configuration) {
  if (Object.getOwnPropertySymbols(configuration).length > 0) {
    fail(
      'Codex CLI structured-result executor configuration must not carry symbol keys.',
      INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
    );
  }
  for (const key of Object.getOwnPropertyNames(configuration)) {
    if (!STRUCTURED_EXECUTOR_CONFIGURATION_FIELDS.includes(key)) {
      fail(
        `Codex CLI structured-result executor configuration accepts exactly (${STRUCTURED_EXECUTOR_CONFIGURATION_FIELDS.join(', ')}); received unknown field "${key}".`,
        INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
      );
    }
  }
}

function buildStructuredExecutorChildEnvironment(explicitEnv) {
  const childEnvironment = Object.create(null);
  if (explicitEnv === undefined) {
    for (const name of CODEX_CLI_EXECUTOR_ENV_ALLOWLIST) {
      const value = process.env[name];
      if (typeof value === 'string' && !value.includes('\0')) {
        childEnvironment[name] = value;
      }
    }
    return Object.freeze(childEnvironment);
  }
  if (explicitEnv === null || typeof explicitEnv !== 'object' || Array.isArray(explicitEnv)) {
    fail(
      'Codex CLI structured-result executor configuration env must be an explicit plain record of string values when provided.',
      INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
    );
  }
  for (const [name, value] of Object.entries(explicitEnv)) {
    if (name.length === 0 || name.includes('=') || name.includes('\0')) {
      fail(
        'Codex CLI structured-result executor configuration env names must be non-empty and must not contain "=" or NUL bytes.',
        INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
      );
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      fail(
        `Codex CLI structured-result executor configuration env value for ${JSON.stringify(name)} must be a string without NUL bytes.`,
        INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
      );
    }
    childEnvironment[name] = value;
  }
  return Object.freeze(childEnvironment);
}

// The ONLY process boundary in this module. Same normalized, settle-once
// process observation contract as the Task 31 concrete adapter: stdout/stderr
// stay closed and are never parsed; the structured result travels ONLY through
// the Codex CLI `--output-last-message` file.
function defaultCodexCliStructuredResultRunner({ command, args, cwd, env }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    child.once('error', (error) => {
      const errorCode =
        typeof error?.code === 'string' && error.code.length > 0
          ? error.code
          : 'UNKNOWN_PROCESS_START_ERROR';
      settle({ kind: 'start-failed', errorCode });
    });
    child.once('close', (code) => {
      if (Number.isInteger(code)) {
        settle({ kind: 'exited', code });
      } else {
        settle({ kind: 'terminated-without-exit-status' });
      }
    });
  });
}

function assertExactRunnerResultKeys(result, expectedKeys) {
  if (Object.getOwnPropertySymbols(result).length > 0) {
    fail(
      'Codex CLI structured-result runner result must not carry symbol keys.',
      INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
  const ownKeys = Object.getOwnPropertyNames(result);
  const exact =
    ownKeys.length === expectedKeys.length && expectedKeys.every((key) => ownKeys.includes(key));
  if (!exact) {
    fail(
      `Codex CLI structured-result runner result shape must be exactly (${expectedKeys.join(', ')}); received (${ownKeys.join(', ')}).`,
      INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
}

function readStructuredResultFile(resultFilePath, expectedTaskId) {
  let raw;
  try {
    raw = nodeFs.readFileSync(resultFilePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(
        `the Codex CLI process exited 0 but produced no structured result file (fail-closed): ${resultFilePath}`,
        MISSING_EXECUTOR_STRUCTURED_RESULT,
      );
    }
    fail(
      `the Codex CLI structured result file could not be read (fail-closed): ${error?.message}`,
      INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    fail(
      `the Codex CLI structured result is not valid JSON (fail-closed): ${error?.message}`,
      INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  return validateStructuredResultPayload(document, expectedTaskId);
}

function buildStructuredResultJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...EXECUTOR_RESULT_RECEIPT_STRUCTURED_FIELDS],
    properties: {
      taskId: { type: 'string' },
      status: { type: 'string', enum: [...EXECUTOR_RESULT_RECEIPT_STATUS_VALUES] },
      summary: { type: 'string', minLength: 1, maxLength: MAX_SUMMARY_LENGTH },
      proofRefs: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: MAX_REF_STRING_LENGTH },
      },
      evidenceRefs: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: MAX_REF_STRING_LENGTH },
      },
      frictionObserved: {
        type: 'array',
        maxItems: MAX_FRICTION_ENTRIES,
        items: { type: 'string', minLength: 1, maxLength: MAX_FRICTION_ENTRY_LENGTH },
      },
    },
  };
}

/**
 * Create the ONE concrete Codex CLI structured-result executor. Executor
 * capability is READ_ONLY ONLY: a taskKind !== READ_ONLY task fails closed
 * BEFORE any process start. The returned function is the exact Task 33
 * structured executor contract:
 *   async function executor(task28Record) ->
 *     { schemaVersion: 1, dispatchId, outcome, result }
 * with outcome in ACCEPTED | REJECTED | UNKNOWN (Task 30 vocabulary) and
 * result the exact six-field structured payload for ACCEPTED / null otherwise.
 * Process exit 0 is NEVER mapped to SUCCEEDED by itself: the status comes from
 * the executor-authored structured result payload ONLY.
 */
export function createCodexCliStructuredResultExecutor(configuration = {}) {
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)) {
    fail(
      'Codex CLI structured-result executor configuration must be an object.',
      INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
    );
  }
  assertNoUnknownStructuredExecutorConfigurationFields(configuration);
  const command = assertValidConfigurationPath(configuration.executablePath, 'executablePath');
  const childWorkdir = assertValidConfigurationPath(configuration.workdir, 'workdir');
  const resultDirectory = assertValidConfigurationPath(
    configuration.resultDirectory,
    'resultDirectory',
  );
  if (configuration.runner !== undefined && typeof configuration.runner !== 'function') {
    fail(
      'Codex CLI structured-result executor configuration runner must be a function when provided.',
      INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
    );
  }
  const processRunner =
    configuration.runner === undefined
      ? defaultCodexCliStructuredResultRunner
      : configuration.runner;
  const childEnvironment = buildStructuredExecutorChildEnvironment(configuration.env);

  return async function codexCliStructuredResultExecutor(task28Record) {
    if (task28Record === null || typeof task28Record !== 'object' || Array.isArray(task28Record)) {
      fail(
        'Codex CLI structured-result executor invocation requires the EXACT validated Task 28 record handed over by Task 29 (received a non-record).',
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      );
    }
    if (
      typeof task28Record.dispatchId !== 'string' ||
      task28Record.dispatchId.trim().length === 0
    ) {
      fail(
        'Codex CLI structured-result executor invocation requires the exact Task 28 record dispatchId.',
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      );
    }
    const dispatchId = task28Record.dispatchId;
    const task = task28Record?.decisionInput?.task;
    if (task === null || typeof task !== 'object' || Array.isArray(task)) {
      fail(
        'Codex CLI structured-result executor invocation requires the Task 20 transport request task envelope.',
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      );
    }
    // READ_ONLY capability gate BEFORE any process start: a read-only sandbox
    // never proves that a mutation task was performed.
    if (task.taskKind !== TASK_KIND_READ_ONLY) {
      fail(
        `Codex CLI structured-result executor provides READ_ONLY capability only: taskKind ${String(task.taskKind)} fails closed BEFORE process start.`,
        EXECUTOR_RESULT_RECEIPT_REQUIRES_READ_ONLY_TASK,
      );
    }
    const expectedTaskId = task.taskId;

    // Operational temp artifacts ONLY (never the durable coordination home):
    // one JSON Schema file for `--output-schema` and one last-message file for
    // `--output-last-message`. Unique per invocation so concurrent invocations
    // never share a result path.
    const invocationToken = `${process.pid}-${randomUUID().replace(/-/g, '')}`;
    const schemaPath = nodePath.join(
      resultDirectory,
      `greenhub-codex-structured-result-${invocationToken}.schema.json`,
    );
    const resultPath = nodePath.join(
      resultDirectory,
      `greenhub-codex-structured-result-${invocationToken}.last-message.json`,
    );
    nodeFs.mkdirSync(resultDirectory, { recursive: true });
    nodeFs.writeFileSync(schemaPath, JSON.stringify(buildStructuredResultJsonSchema(), null, 2), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });

    // The EXACT validated Task 28 record is the prompt payload: canonical
    // compact JSON as ONE argv element, never shell-interpreted. AT MOST ONE
    // process invocation: runner throw/rejection propagates unchanged, there
    // is no catch, no retry, and no second invocation.
    const prompt = JSON.stringify(task28Record);
    const runnerResult = await processRunner({
      command,
      args: [
        'exec',
        '--sandbox',
        'read-only',
        '--ephemeral',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        resultPath,
        '--cd',
        childWorkdir,
        prompt,
      ],
      cwd: childWorkdir,
      env: childEnvironment,
    });

    if (runnerResult === null || typeof runnerResult !== 'object' || Array.isArray(runnerResult)) {
      fail(
        'Codex CLI structured-result runner result must be a plain record describing ONE process-boundary observation.',
        INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
      );
    }
    if (runnerResult.kind === 'exited') {
      assertExactRunnerResultKeys(runnerResult, ['kind', 'code']);
      if (!Number.isInteger(runnerResult.code)) {
        fail(
          'Codex CLI structured-result runner result kind "exited" requires an integer exit code.',
          INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
        );
      }
      if (runnerResult.code !== 0) {
        return Object.freeze({
          schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
          dispatchId,
          outcome: EXECUTOR_INVOCATION_OUTCOME_REJECTED,
          result: null,
        });
      }
      // Exit 0 is NOT success evidence: the structured result file is the
      // ONLY result authority. Missing / malformed / mismatched -> fail closed.
      const payload = readStructuredResultFile(resultPath, expectedTaskId);
      return Object.freeze({
        schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
        dispatchId,
        outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
        result: payload,
      });
    }
    if (runnerResult.kind === 'terminated-without-exit-status') {
      assertExactRunnerResultKeys(runnerResult, ['kind']);
      return Object.freeze({
        schemaVersion: CODEX_CLI_STRUCTURED_RESULT_ENVELOPE_SCHEMA_VERSION,
        dispatchId,
        outcome: EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
        result: null,
      });
    }
    if (runnerResult.kind === 'start-failed') {
      assertExactRunnerResultKeys(runnerResult, ['kind', 'errorCode']);
      if (typeof runnerResult.errorCode !== 'string' || runnerResult.errorCode.length === 0) {
        fail(
          'Codex CLI structured-result runner result kind "start-failed" requires a non-empty errorCode.',
          INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
        );
      }
      // Preserve the Task 31 typed process-start failure meaning verbatim:
      // never UNKNOWN, never a fabricated receipt.
      throw new CodexCliExecutorAdapterError(
        `Codex CLI structured-result process could not be started (errorCode ${runnerResult.errorCode}): configuration / process-start failure only, never a protocol outcome.`,
        { code: CODEX_CLI_EXECUTOR_PROCESS_START_FAILED },
      );
    }
    fail(
      `unsupported Codex CLI structured-result runner result kind ${JSON.stringify(runnerResult.kind)}: no fourth outcome and no automatic re-invocation exists.`,
      INVALID_CODEX_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  };
}
