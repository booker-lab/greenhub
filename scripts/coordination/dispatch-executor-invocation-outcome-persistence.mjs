// Bounded durable outcome-persistence owner:
// GREENHUB-COORDINATION-DURABLE-EXECUTOR-INVOCATION-OUTCOME-32.
// Surface: scripts/coordination/*dispatch-executor-invocation-outcome-persistence*
// (this module) + the durable executor-invocation-outcome store primitives ONLY
// (readExecutorInvocationOutcome / createExecutorInvocationOutcome over
// <coordination-home>/executor-invocation-outcomes/<dispatchId>.json).
// Task 30 public entry invokeExecutorAndValidateOutcome is composed verbatim;
// the read-only Task 33 receipt authority is consulted durable-first;
// Task 18~31 source/spec semantics are never modified or duplicated.
//
// State transition added here:
//   VALIDATED_EXECUTOR_INVOCATION_OUTCOME(dispatchId)              [Task 30]
//     -> DURABLY_RECORDED_EXECUTOR_INVOCATION_OUTCOME(dispatchId)  [Task 32]
//
// Contract summary:
//   persistExecutorInvocationOutcome() != executeTask() != invokeExecutor()
//     != invokeExecutorAndValidateOutcome() != invokeExecutorInvocationAdapter()
//     != persistExecutorInvocationAttempt() != acknowledgeDispatch()
//     != acceptExecutorDispatchDecision() != task RUNNING != task result
//     != ACK != receipt != disposition != retry authority.
//   DURABLY_RECORDED_EXECUTOR_INVOCATION_OUTCOME != task started != task
//     RUNNING != task completed != task succeeded != executor receipt persisted
//     != semantic task acceptance != result produced != ACK != global delivery
//     success.
//   Entry is EXACTLY one path:
//     (dispatchId, store, adapter)
//       1. store capability gate [readExecutorInvocationOutcome /
//          createExecutorInvocationOutcome / readExecutorResultReceipt ONLY;
//          no other capability is required here]
//       2. dispatchId identity validation [Task 28 executor-invocation-attempt
//          identity family verbatim: invalid identity fails closed]
//       3. store.readExecutorInvocationOutcome(dispatchId)
//          [durable-first: dispatchId is the ONLY lookup key; at most one
//           durable outcome read before any composition]
//       4. existing valid durable outcome: authoritative replay
//          [zero adapter invocations, zero writes, zero byte change, zero
//           mtime change, never retry, never repair]
//       5. outcome absent: store.readExecutorResultReceipt(dispatchId)
//          [durable-first cross-boundary fence: dispatchId is the ONLY lookup
//           key; an existing valid Task 33 receipt means the executor boundary
//           was ALREADY crossed and its evidence captured, so producing an
//           adapter outcome now would require a SECOND executor invocation.
//           This entry fails closed with zero adapter invocations and zero
//           writes and never auto-repairs. This is the exact mirror of the
//           Task 33 fence (recorded outcome without receipt ->
//           EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME): for one
//           dispatchId at most one executor boundary record can ever be
//           produced through either entry]
//       6. receipt absent ONLY: invokeExecutorAndValidateOutcome({ dispatchId,
//          store, adapter }) [Task 30 public entry VERBATIM, EXACTLY ONCE:
//          Task 29 identity/adapter/store/read/record/binding validation, AT
//          MOST ONE adapter invocation, exact Task 30 outcome validation; the
//          adapter return value is never re-validated or duplicated here, and
//          Task 29/30 fail-closed codes propagate UNCHANGED]
//       7. OS exclusive-create of the EXACT canonical Task 30 outcome under
//          <home>/executor-invocation-outcomes/<dispatchId>.json
//       8. exact durable read-back verification of the created record
//       9. exclusive-create race loser: immediate winner re-read; exact same
//          valid outcome = idempotent convergence / different valid outcome =
//          fail-closed conflict / corrupt winner = fail closed. The first
//          durable winner is preserved: never overwrite, merge, repair,
//          delete-and-recreate, or last-writer-wins.
//   LOOKUP KEY = dispatchId ONLY. sourceTaskId / nextTaskId / taskId /
//   workerId / admissionId / emissionSlot / claimToken / claimGeneration are
//   never lookup keys.
//
// Exact durable value (the EXACT Task 30 canonical validated outcome):
//   { schemaVersion: 1, dispatchId, outcome } — EXACTLY these three fields,
//   outcome in ACCEPTED | REJECTED | UNKNOWN. No extra metadata: no acceptedAt
//   / rejectedAt / unknownAt / invokedAt / startedAt / completedAt /
//   attemptedAt / createdAt / updatedAt / pid / hostname / workerId /
//   executorId / retryCount / attemptNumber / invocationGeneration /
//   executorGeneration / executionGeneration / retryGeneration. claimGeneration
//   remains the SOLE fencing generation and no new fencing authority exists.
//
// Outcome semantics (stored exactly as reported at the Task 30 protocol
// boundary only):
//   ACCEPTED = the Task 30/Task 31 protocol boundary accepted the invocation.
//     It does NOT mean task RUNNING, task completed, task succeeded, executor
//     receipt persisted, semantic task acceptance, result produced, ACK, or
//     global delivery success.
//   REJECTED = an explicit protocol-boundary refusal (for the Codex CLI adapter
//     this may be a non-zero process exit). It is NOT task failure and creates
//     no task result.
//   UNKNOWN = the protocol boundary could not determine accept/reject. It is
//     stored as-is and is NOT retry permission.
//
// Throw / process-start failure policy: when Task 30, Task 29, or the adapter
// throws or rejects, the EXACT thrown/rejected value propagates UNCHANGED. It
// is never converted to UNKNOWN or REJECTED, never caught, normalized,
// retried, or replaced, and no durable outcome is created. Task 31 typed
// errors such as CODEX_CLI_EXECUTOR_PROCESS_START_FAILED stay typed.
//
// Concurrency boundary (never overclaimed): this Task does NOT provide global
// exactly-once executor invocation. Two concurrent processes can both observe
// "no durable outcome" and "no durable receipt" and both enter Task 30, so the
// adapter/executor boundary can be crossed more than once. OS exclusive-create
// serializes ONLY the durable outcome winner. What this Task proves: later
// calls after a durable outcome OR a durable Task 33 receipt exists do not
// re-invoke the executor, the first durable winner is immutable authority, and
// no automatic retry exists. Cross-process pre-invocation fencing, executor
// leases, and invocation locks are a separate future boundary and are NOT
// implemented here.
//
// Explicitly NO status / ACK / retry authority: this module never performs
// CLAIMED -> RUNNING, never mutates task.json, claim, admission, emission,
// dispatch attempt, receiver acceptance, receiver decision, executor
// acceptance, executor invocation attempt, or result/disposition state, never
// creates an ACK / receipt / result / disposition, never writes to the Task 33
// receipt namespace (the receipt is read durably-first as a fence ONLY), and
// never implements retry, fallback executor, backoff, retry counter, retry
// permission, executor registry, or executor selection. Durable outcome
// absence is NOT retry permission.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   executor invocation, executeTask, invokeExecutor, OpenCode / Codex / Astra
//   / ChatGPT invocation, child_process / spawn / exec / execFile / fork,
//   shell execution, HTTP / fetch / WebSocket / gRPC / MCP, stdin-stdout
//   transport, executor process lifecycle, ACK protocol, ACK persistence,
//   receipt persistence, result persistence, disposition persistence,
//   CLAIMED -> RUNNING, task status mutation, claim mutation/lease extension/
//   takeover, retry/resend/backoff, retry counter, retry permission,
//   scheduler, queue consumer, worker/executor registry, worker/executor
//   selection, capability matching, environment-based executor selection,
//   endpoint discovery, polling, daemon, cron, any new generation authority,
//   any node:fs access.

import nodePath from 'node:path';
import { assertValidExecutorInvocationAttemptDispatchId } from './dispatch-executor-invocation-attempt.mjs';
import {
  EXECUTOR_INVOCATION_OUTCOME_FIELDS,
  EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
  EXECUTOR_INVOCATION_OUTCOME_VALUES,
  invokeExecutorAndValidateOutcome,
} from './dispatch-executor-invocation-outcome.mjs';
import {
  CORRUPT_EXECUTOR_RESULT_RECEIPT,
  validateExecutorResultReceiptRecord,
} from './executor-result-receipt.mjs';

export const EXECUTOR_INVOCATION_OUTCOMES_DIRNAME = 'executor-invocation-outcomes';

// Outcome-persistence-native meanings ONLY. Missing Task 30 input, corrupt
// Task 28 attempt records, invalid adapter returns, and adapter throw/rejection
// reuse the existing Task 30/29/28/24/20/18/19 codes verbatim; corrupt/invalid
// Task 33 receipt records reuse the Task 33 codes verbatim; there is no
// outcome-persistence-specific ACK, receipt, retry, or generation authority.
export const CORRUPT_EXECUTOR_INVOCATION_OUTCOME = 'CORRUPT_EXECUTOR_INVOCATION_OUTCOME';
export const EXECUTOR_INVOCATION_OUTCOME_CONFLICT = 'EXECUTOR_INVOCATION_OUTCOME_CONFLICT';
export const INVALID_EXECUTOR_INVOCATION_OUTCOME_STORE =
  'INVALID_EXECUTOR_INVOCATION_OUTCOME_STORE';

// The cross-boundary fence meaning: a durable Task 33 executor result receipt
// already exists for this dispatchId, so the executor boundary was already
// crossed and its structured evidence captured. No adapter outcome can be
// produced without a SECOND executor invocation, so the entry fails closed.
// Exact mirror of Task 33's EXECUTOR_RESULT_RECEIPT_ABSENT_FOR_RECORDED_OUTCOME.
export const EXECUTOR_INVOCATION_OUTCOME_ABSENT_FOR_RECORDED_RECEIPT =
  'EXECUTOR_INVOCATION_OUTCOME_ABSENT_FOR_RECORDED_RECEIPT';

// Minimal immutable result shapes. dispatchId is the incoming outcome identity;
// newlyRecorded / exactReplay are persistence-local outcomes only, never
// durable state, never executor invocation, and never a task lifecycle status.
// outcome is the authoritative durable protocol value (created or replayed).
export const EXECUTOR_INVOCATION_OUTCOME_PERSISTENCE_NEW_FIELDS = Object.freeze([
  'dispatchId',
  'newlyRecorded',
  'outcome',
]);
export const EXECUTOR_INVOCATION_OUTCOME_PERSISTENCE_REPLAY_FIELDS = Object.freeze([
  'dispatchId',
  'newlyRecorded',
  'exactReplay',
  'outcome',
]);

export class ExecutorInvocationOutcomePersistenceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ExecutorInvocationOutcomePersistenceError';
    this.code = details.code ?? CORRUPT_EXECUTOR_INVOCATION_OUTCOME;
  }
}

function fail(message, code = CORRUPT_EXECUTOR_INVOCATION_OUTCOME) {
  throw new ExecutorInvocationOutcomePersistenceError(message, { code });
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

export function assertValidExecutorInvocationOutcomeDispatchId(dispatchId) {
  try {
    assertValidExecutorInvocationAttemptDispatchId(dispatchId);
  } catch (error) {
    fail(error.message, CORRUPT_EXECUTOR_INVOCATION_OUTCOME);
  }
  return dispatchId;
}

export function executorInvocationOutcomeFileName(dispatchId) {
  assertValidExecutorInvocationOutcomeDispatchId(dispatchId);
  return `${dispatchId}.json`;
}

/**
 * Durable path for one immutable executor invocation outcome record.
 * `<home>/executor-invocation-outcomes/<dispatchId>.json` (dispatchId-keyed
 * ONLY). `home` is a durable coordination home, never the repository worktree.
 */
export function executorInvocationOutcomeFilePath(home, dispatchId) {
  if (typeof home !== 'string' || !home.trim()) {
    fail(
      'coordination home must be a non-empty directory path.',
      CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
  }
  assertValidExecutorInvocationOutcomeDispatchId(dispatchId);
  return nodePath.join(
    home,
    EXECUTOR_INVOCATION_OUTCOMES_DIRNAME,
    executorInvocationOutcomeFileName(dispatchId),
  );
}

/**
 * Validate one durable executor invocation outcome record. Returns a frozen
 * canonical copy. Fail-closed, no repair:
 * 1. plain object with the EXACT three-field key shape and fixed key order
 *    (schemaVersion, dispatchId, outcome),
 * 2. schemaVersion exactly 1 (number; never a string, timestamp, or
 *    generation),
 * 3. dispatchId is a valid Task 19/22/24/26/28 identity,
 * 4. outcome is exactly ACCEPTED, REJECTED, or UNKNOWN.
 */
export function validateExecutorInvocationOutcomeRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    fail(
      `executor invocation outcome record must be a plain object (received ${describeValue(record)}).`,
      CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
  }
  const keys = Object.keys(record);
  if (keys.length !== EXECUTOR_INVOCATION_OUTCOME_FIELDS.length) {
    fail(
      `executor invocation outcome record must carry exactly ${EXECUTOR_INVOCATION_OUTCOME_FIELDS.length} fields (${EXECUTOR_INVOCATION_OUTCOME_FIELDS.join(', ')}).`,
      CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
  }
  for (let index = 0; index < EXECUTOR_INVOCATION_OUTCOME_FIELDS.length; index += 1) {
    if (keys[index] !== EXECUTOR_INVOCATION_OUTCOME_FIELDS[index]) {
      fail(
        `executor invocation outcome record key order/shape mismatch at position ${index}: expected "${EXECUTOR_INVOCATION_OUTCOME_FIELDS[index]}" got "${keys[index]}".`,
        CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
      );
    }
  }
  if (record.schemaVersion !== EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION) {
    fail(
      `executor invocation outcome schemaVersion must be exactly ${EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION} (number), never a string, timestamp, or generation.`,
      CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
  }
  assertValidExecutorInvocationOutcomeDispatchId(record.dispatchId);
  if (!EXECUTOR_INVOCATION_OUTCOME_VALUES.includes(record.outcome)) {
    fail(
      `executor invocation outcome must be exactly one of ${EXECUTOR_INVOCATION_OUTCOME_VALUES.join(' | ')}; received ${describeValue(record.outcome)} ${String(record.outcome)}.`,
      CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
  }
  return Object.freeze({
    schemaVersion: EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
    dispatchId: record.dispatchId,
    outcome: record.outcome,
  });
}

function assertStoredOutcomeBinding(record, dispatchId) {
  const canonical = validateExecutorInvocationOutcomeRecord(record);
  if (canonical.dispatchId !== dispatchId) {
    fail(
      `executor invocation outcome store key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${canonical.dispatchId}.`,
      CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
  }
  return canonical;
}

/**
 * Durably record ONE executor invocation outcome for one dispatchId: the EXACT
 * canonical Task 30 validated outcome is stored under
 * <coordination-home>/executor-invocation-outcomes/<dispatchId>.json.
 *
 * Contract (durable-first, fail-closed, no repair, no overwrite):
 * 1. `store` must expose readExecutorInvocationOutcome(dispatchId),
 *    createExecutorInvocationOutcome(record), and
 *    readExecutorResultReceipt(dispatchId); otherwise
 *    INVALID_EXECUTOR_INVOCATION_OUTCOME_STORE and nothing is read or written.
 * 2. An already existing valid durable outcome is the authoritative replay:
 *    the executor is NOT re-invoked, no file is written, no byte or mtime
 *    changes, and the call is not treated as retry.
 * 3. When no durable outcome exists but a valid durable Task 33 executor
 *    result receipt exists, the executor boundary was already crossed and its
 *    evidence captured. This entry fails closed with
 *    EXECUTOR_INVOCATION_OUTCOME_ABSENT_FOR_RECORDED_RECEIPT: zero adapter
 *    invocations, zero writes, no receipt mutation, never auto-repaired. This
 *    is the exact mirror of Task 33's recorded-outcome fence; at most one
 *    executor boundary record can ever be produced per dispatchId through
 *    either entry.
 * 4. Only when neither record exists is the Task 30 public entry composed,
 *    EXACTLY ONCE per call: invokeExecutorAndValidateOutcome({ dispatchId,
 *    store, adapter }). Task 30 validation/invocation semantics are never
 *    duplicated here; Task 29/30 fail-closed codes and adapter throw/rejection
 *    propagate UNCHANGED with zero durable writes.
 * 5. The returned Task 30 outcome is exclusive-created; the created record is
 *    verified by an exact durable read-back.
 * 6. Exclusive-create race loser: immediate winner re-read. Exact same valid
 *    outcome = idempotent convergence; different valid outcome = fail-closed
 *    EXECUTOR_INVOCATION_OUTCOME_CONFLICT; corrupt winner = fail closed. The
 *    first durable winner is preserved: never overwrite, merge, repair,
 *    delete-and-recreate, or last-writer-wins.
 *
 * Global exactly-once executor invocation is NOT claimed. Two concurrent
 * processes can both observe an absent durable outcome AND an absent durable
 * receipt and both enter Task 30; exclusive-create serializes only the durable
 * outcome winner. No automatic retry, fallback, backoff, registry, or
 * selection exists here.
 */
export async function persistExecutorInvocationOutcome({ dispatchId, store, adapter } = {}) {
  // 1. Caller-supplied durable store primitives only: no registry, no
  //    auto-detection, no transport.
  if (
    !store ||
    typeof store.readExecutorInvocationOutcome !== 'function' ||
    typeof store.createExecutorInvocationOutcome !== 'function' ||
    typeof store.readExecutorResultReceipt !== 'function'
  ) {
    fail(
      'executor invocation outcome persistence requires a caller-supplied store exposing readExecutorInvocationOutcome / createExecutorInvocationOutcome / readExecutorResultReceipt (composition only; the caller supplies the store explicitly).',
      INVALID_EXECUTOR_INVOCATION_OUTCOME_STORE,
    );
  }

  // 2. dispatchId identity validation before any durable read.
  assertValidExecutorInvocationOutcomeDispatchId(dispatchId);

  // 3. Durable-first: one dispatchId-keyed read; a missing outcome is the ONLY
  //    condition under which the executor path may be entered.
  const observed = store.readExecutorInvocationOutcome(dispatchId);
  if (observed !== null && observed !== undefined) {
    // 4. The existing valid durable outcome is the authoritative replay. No
    //    adapter invocation, no write, no mtime change, no retry semantics.
    const canonical = assertStoredOutcomeBinding(observed, dispatchId);
    return Object.freeze({
      dispatchId,
      newlyRecorded: false,
      exactReplay: true,
      outcome: canonical.outcome,
    });
  }

  // 5. Cross-boundary fence: a durable Task 33 receipt means the executor
  //    boundary was already crossed and its structured evidence captured.
  //    Producing an adapter outcome now would require a SECOND executor
  //    invocation, so this entry fails closed with zero adapter invocations,
  //    zero writes, and no auto-repair. Task 33 enforces the exact mirror
  //    fence for a recorded outcome without a receipt.
  const recordedReceipt = store.readExecutorResultReceipt(dispatchId);
  if (recordedReceipt !== null && recordedReceipt !== undefined) {
    let canonicalReceipt;
    try {
      canonicalReceipt = validateExecutorResultReceiptRecord(recordedReceipt);
    } catch (error) {
      fail(
        `recorded executor result receipt is invalid (fail-closed, no repair): ${error?.message}`,
        typeof error?.code === 'string' && error.code
          ? error.code
          : CORRUPT_EXECUTOR_RESULT_RECEIPT,
      );
    }
    if (canonicalReceipt.dispatchId !== dispatchId) {
      fail(
        `recorded executor result receipt key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${canonicalReceipt.dispatchId}.`,
        CORRUPT_EXECUTOR_RESULT_RECEIPT,
      );
    }
    fail(
      `a durable executor result receipt already exists for ${dispatchId}; the executor boundary was already crossed and its evidence captured, so recording an adapter outcome now would require a second executor invocation and this state is never auto-repaired.`,
      EXECUTOR_INVOCATION_OUTCOME_ABSENT_FOR_RECORDED_RECEIPT,
    );
  }

  // 6. Neither record exists: the Task 30 public entry is composed EXACTLY
  //    ONCE. Its return value is already the exact canonical validated
  //    outcome; Task 30 validation is never duplicated. Throw/rejection
  //    propagates unchanged and performs zero durable writes.
  const validated = await invokeExecutorAndValidateOutcome({ dispatchId, store, adapter });

  // 7. Exclusive-create the EXACT canonical Task 30 outcome (never
  //    exists()->write()).
  const created = store.createExecutorInvocationOutcome(validated);
  if (created && created.created === true) {
    // 8. Durable read-back: the stored value must be the exact record.
    const stored = store.readExecutorInvocationOutcome(dispatchId);
    if (
      stored === null ||
      stored === undefined ||
      JSON.stringify(stored) !== JSON.stringify(validated)
    ) {
      fail(
        `executor invocation outcome failed durable read-back after exclusive create (fail-closed): ${dispatchId}`,
        CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
      );
    }
    return Object.freeze({ dispatchId, newlyRecorded: true, outcome: validated.outcome });
  }

  // 9. Exclusive-create race loser: re-read the first durable winner.
  const winner = store.readExecutorInvocationOutcome(dispatchId);
  if (winner === null || winner === undefined) {
    fail(
      `executor invocation outcome race could not be resolved deterministically (fail-closed): ${dispatchId}`,
      CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
  }
  const canonicalWinner = assertStoredOutcomeBinding(winner, dispatchId);
  if (JSON.stringify(canonicalWinner) !== JSON.stringify(validated)) {
    fail(
      `executor invocation outcome conflict (fail-closed): dispatchId ${dispatchId} already carries a different valid durable outcome; the first durable winner is preserved and the incoming outcome is never preferred.`,
      EXECUTOR_INVOCATION_OUTCOME_CONFLICT,
    );
  }
  return Object.freeze({
    dispatchId,
    newlyRecorded: false,
    exactReplay: true,
    outcome: canonicalWinner.outcome,
  });
}
