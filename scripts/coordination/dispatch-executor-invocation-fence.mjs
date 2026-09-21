// Bounded pre-boundary invocation-fence owner:
// GREENHUB-COORDINATION-EXECUTOR-INVOCATION-FENCE (COORD-AUDIT-C03).
// Surface: scripts/coordination/*dispatch-executor-invocation-fence* (this
// module) + the durable executor-invocation-fence store primitives ONLY
// (readExecutorInvocationFence / createExecutorInvocationFence over
// <coordination-home>/executor-invocation-fences/<dispatchId>.json).
// The Task 33 public entry persistExecutorResultReceipt is composed verbatim;
// the Task 32 durable outcome record is composed for post-invocation
// publication ONLY (read for replay, exclusive-create for publication). No
// Task 18~34 source or spec semantics are modified.
//
// State transition added here:
//   UNSEEN_INVOCATION_BOUNDARY(dispatchId)
//     -> DURABLY_FENCED_INVOCATION_BOUNDARY(dispatchId)   [this module]
//         -> DURABLY_RECORDED_EXECUTOR_INVOCATION_OUTCOME(dispatchId) [Task 32]
//
// Contract summary:
//   invokeExecutorWithInvocationFence() != executeTask() != invokeExecutor()
//     != persistExecutorInvocationOutcome() != persistExecutorResultReceipt()
//     != invokeExecutorAndValidateOutcome() != invokeExecutorInvocationAdapter()
//     != deliverExecutorResultReceipt() != acknowledgeDispatch()
//     != acceptExecutorDispatchDecision() != task RUNNING != task result
//     != ACK != receipt != disposition != retry authority.
//   Entry is EXACTLY one path:
//     (dispatchId, store, executor)
//       1. store capability gate [readExecutorResultReceipt /
//          readExecutorInvocationOutcome / createExecutorInvocationOutcome /
//          readExecutorInvocationFence / createExecutorInvocationFence ONLY;
//          Task 33 gates its own additional capabilities when composed]
//       2. dispatchId identity validation [Task 28 executor-invocation-attempt
//          identity family verbatim: invalid identity fails closed]
//       3. store.readExecutorResultReceipt(dispatchId): an existing valid
//          durable receipt is the authoritative replay; zero executor
//          invocations, zero writes, zero byte/mtime change, never repair
//       4. store.readExecutorInvocationOutcome(dispatchId): an existing valid
//          durable outcome (ACCEPTED | REJECTED | UNKNOWN) is the authoritative
//          replay; zero executor invocations, zero writes, never retry. UNKNOWN
//          is terminal here and is NEVER retry permission.
//       5. executor capability validation BEFORE any fence publication: an
//          invalid/missing executor fails closed with the existing Task 29
//          INVALID_EXECUTOR_INVOCATION_ADAPTER meaning and NEVER poisons the
//          fence namespace (zero writes, zero adapter calls)
//       6. Task 33 persistExecutorResultReceipt({ dispatchId, store, executor:
//          fencedAdapterWrapper }) EXACTLY ONCE. The wrapper is invoked by
//          Task 29/33 only AFTER all Task 28/29/33 identity, store, record,
//          and READ_ONLY capability validation, and it performs the OS
//          exclusive-create of the durable pre-invocation fence
//          <home>/executor-invocation-fences/<dispatchId>.json in the SAME
//          synchronous step immediately before the caller-supplied external
//          executor call. This publication is the linearization point of
//          exactly-one invocation accounting: the external executor can never
//          run before the fence exists, so EXTERNAL_ENTRY => FENCE_EXISTS
//          holds for every process, and pre-invocation validation failures
//          never consume the one-way fence.
//          - fence created: this process owns the invocation boundary and the
//            external executor is called exactly once
//          - fence already exists (OS exclusive-create loser): the wrapper
//            fails closed with EXECUTOR_INVOCATION_FENCE_UNCERTAIN and ZERO
//            external executor calls. A concurrent contender NEVER executes
//            the external executor.
//          Task 29/33 fail-closed codes and adapter throw/rejection propagate
//          UNCHANGED; the returned value is never re-validated or duplicated
//          here.
//       7. durable post-invocation outcome publication: the EXACT Task 30
//          outcome vocabulary returned by Task 33 (ACCEPTED | REJECTED |
//          UNKNOWN) is exclusive-created through
//          store.createExecutorInvocationOutcome under
//          <home>/executor-invocation-outcomes/<dispatchId>.json with exact
//          read-back and first-winner conflict semantics (never overwrite,
//          merge, repair, delete-and-recreate, or last-writer-wins)
//       8. REJECTED / UNKNOWN return with receipt null; ACCEPTED returns the
//          exact durable Task 33 receipt. receipt != ACK != result delivery.
//   LOOKUP KEY = dispatchId ONLY. sourceTaskId / nextTaskId / taskId /
//   workerId / admissionId / emissionSlot / claimToken / claimGeneration are
//   never lookup keys.
//
// Exact durable fence value: { schemaVersion: 1, dispatchId } — EXACTLY these
// two fields. No owner pid / hostname / workerId / claimToken / timestamps /
// lease / attemptNumber / retryCount / any new generation. The fence is an
// immutable one-way fact for one dispatchId; claimGeneration remains the SOLE
// fencing generation.
//
// Crash contract (explicit; no time/expiry inference anywhere):
//   FENCE_ABSENT + no durable outcome + no durable receipt
//     = the executor boundary DEFINITELY was not crossed (no code path enters
//       the adapter without first publishing the fence). A later process MAY
//       acquire the fence and invoke: this is the recoverable PRE_INVOKE_CRASH
//       state. Recovery is serialized by the same OS exclusive-create, so
//       concurrent recovery contenders still elect exactly one invocation.
//   FENCE_PRESENT + no durable outcome + no durable receipt
//     = POST_OR_UNCERTAIN_INVOKE_CRASH or a concurrent in-flight invocation.
//       The executor boundary MAY have been crossed and the disposition cannot
//       be proven from durable evidence, so NO process may automatically
//       re-invoke. The entry fails closed with EXECUTOR_INVOCATION_FENCE_
//       UNCERTAIN until durable evidence (outcome or receipt) exists. A dead
//       process is NEVER treated as proof that the external executor was not
//       invoked; the fence has no lease and never expires.
//   FENCE_PRESENT + durable outcome OR durable receipt
//     = authoritative replay with zero executor invocations.
//
// Concurrency boundary (never overclaimed): global exactly-once execution is
// NOT claimed. This module guarantees AT MOST ONE crossing of the
// adapter/executor boundary per dispatchId for all callers that go through
// this entry. The underlying Task 29/33 entries remain read-only composition
// primitives with their own documented at-most-once-per-call semantics; a
// caller that bypasses this entry and composes Task 33 directly does not
// obtain this fence. No registry, queue, daemon, scheduler, worker/executor
// selection, lease, retry/backoff, fallback executor, or second task
// authority exists here.
//
// Explicitly NO status / ACK / retry authority: this module never performs
// CLAIMED -> RUNNING, never mutates task.json, claim, admission, emission,
// dispatch attempt, receiver acceptance, receiver decision, executor
// acceptance, executor invocation attempt, or result/disposition state, never
// creates an ACK / result / disposition, never implements retry, fallback,
// backoff, polling, or executor registry/selection, and never holds a long-
// lived lock. Durable evidence absence is NOT retry permission.

import nodePath from 'node:path';
import { assertValidExecutorInvocationAttemptDispatchId } from './dispatch-executor-invocation-attempt.mjs';
import { INVALID_EXECUTOR_INVOCATION_ADAPTER } from './dispatch-executor-invocation-contract.mjs';
import {
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
  EXECUTOR_INVOCATION_OUTCOME_VALUES,
} from './dispatch-executor-invocation-outcome.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
  EXECUTOR_INVOCATION_OUTCOME_CONFLICT,
  validateExecutorInvocationOutcomeRecord,
} from './dispatch-executor-invocation-outcome-persistence.mjs';
import {
  CORRUPT_EXECUTOR_RESULT_RECEIPT,
  persistExecutorResultReceipt,
  validateExecutorResultReceiptRecord,
} from './executor-result-receipt.mjs';

export const EXECUTOR_INVOCATION_FENCES_DIRNAME = 'executor-invocation-fences';

// Exact fence schema version: a NUMBER, never a string, timestamp, or
// generation.
export const EXECUTOR_INVOCATION_FENCE_SCHEMA_VERSION = 1;

// Exact canonical key order for the durable fence record.
export const EXECUTOR_INVOCATION_FENCE_FIELDS = Object.freeze(['schemaVersion', 'dispatchId']);

// Fence-native meanings ONLY. Corrupt/invalid durable fence records fail closed
// with CORRUPT_EXECUTOR_INVOCATION_FENCE; the executor capability meaning is
// the existing Task 29 INVALID_EXECUTOR_INVOCATION_ADAPTER; outcome
// conflict/read-back reuse the existing Task 32 codes verbatim.
export const CORRUPT_EXECUTOR_INVOCATION_FENCE = 'CORRUPT_EXECUTOR_INVOCATION_FENCE';
export const INVALID_EXECUTOR_INVOCATION_FENCE_STORE = 'INVALID_EXECUTOR_INVOCATION_FENCE_STORE';

// The fenced-boundary fail-closed meaning: a durable invocation fence already
// exists for this dispatchId without a durable outcome or a durable result
// receipt. The executor boundary may already have been crossed; the
// disposition cannot be proven from durable evidence, so automatic
// re-invocation is refused (concurrent in-flight invocation or
// POST_OR_UNCERTAIN_INVOKE_CRASH). This state is readable and is never
// auto-repaired; durable evidence absence is never retry permission.
export const EXECUTOR_INVOCATION_FENCE_UNCERTAIN = 'EXECUTOR_INVOCATION_FENCE_UNCERTAIN';

// Minimal immutable result shape: executorInvoked / exactReplay are
// composition-local outcomes only, never durable state, never executor
// invocation, and never a task lifecycle status.
export const EXECUTOR_INVOCATION_FENCE_RUN_FIELDS = Object.freeze([
  'dispatchId',
  'outcome',
  'receipt',
  'executorInvoked',
  'exactReplay',
]);

export class ExecutorInvocationFenceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ExecutorInvocationFenceError';
    this.code = details.code ?? CORRUPT_EXECUTOR_INVOCATION_FENCE;
  }
}

function fail(message, code = CORRUPT_EXECUTOR_INVOCATION_FENCE) {
  throw new ExecutorInvocationFenceError(message, { code });
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

export function assertValidExecutorInvocationFenceDispatchId(dispatchId) {
  try {
    assertValidExecutorInvocationAttemptDispatchId(dispatchId);
  } catch (error) {
    fail(error.message, CORRUPT_EXECUTOR_INVOCATION_FENCE);
  }
  return dispatchId;
}

export function executorInvocationFenceFileName(dispatchId) {
  assertValidExecutorInvocationFenceDispatchId(dispatchId);
  return `${dispatchId}.json`;
}

/**
 * Durable path for one immutable executor invocation fence record.
 * `<home>/executor-invocation-fences/<dispatchId>.json` (dispatchId-keyed
 * ONLY). `home` is a durable coordination home, never the repository worktree.
 */
export function executorInvocationFenceFilePath(home, dispatchId) {
  if (typeof home !== 'string' || !home.trim()) {
    fail(
      'coordination home must be a non-empty directory path.',
      CORRUPT_EXECUTOR_INVOCATION_FENCE,
    );
  }
  assertValidExecutorInvocationFenceDispatchId(dispatchId);
  return nodePath.join(
    home,
    EXECUTOR_INVOCATION_FENCES_DIRNAME,
    executorInvocationFenceFileName(dispatchId),
  );
}

/**
 * Validate one durable executor invocation fence record. Returns a frozen
 * canonical copy. Fail-closed, no repair:
 * 1. plain object with the EXACT two-field key shape and fixed key order
 *    (schemaVersion, dispatchId),
 * 2. schemaVersion exactly 1 (number; never a string, timestamp, or
 *    generation),
 * 3. dispatchId is a valid Task 19/22/24/26/28 identity.
 */
export function validateExecutorInvocationFenceRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    fail(
      `executor invocation fence record must be a plain object (received ${describeValue(record)}).`,
      CORRUPT_EXECUTOR_INVOCATION_FENCE,
    );
  }
  const keys = Object.keys(record);
  if (keys.length !== EXECUTOR_INVOCATION_FENCE_FIELDS.length) {
    fail(
      `executor invocation fence record must carry exactly ${EXECUTOR_INVOCATION_FENCE_FIELDS.length} fields (${EXECUTOR_INVOCATION_FENCE_FIELDS.join(', ')}).`,
      CORRUPT_EXECUTOR_INVOCATION_FENCE,
    );
  }
  for (let index = 0; index < EXECUTOR_INVOCATION_FENCE_FIELDS.length; index += 1) {
    if (keys[index] !== EXECUTOR_INVOCATION_FENCE_FIELDS[index]) {
      fail(
        `executor invocation fence record key order/shape mismatch at position ${index}: expected "${EXECUTOR_INVOCATION_FENCE_FIELDS[index]}" got "${keys[index]}".`,
        CORRUPT_EXECUTOR_INVOCATION_FENCE,
      );
    }
  }
  if (record.schemaVersion !== EXECUTOR_INVOCATION_FENCE_SCHEMA_VERSION) {
    fail(
      `executor invocation fence schemaVersion must be exactly ${EXECUTOR_INVOCATION_FENCE_SCHEMA_VERSION} (number), never a string, timestamp, or generation.`,
      CORRUPT_EXECUTOR_INVOCATION_FENCE,
    );
  }
  assertValidExecutorInvocationFenceDispatchId(record.dispatchId);
  return Object.freeze({
    schemaVersion: EXECUTOR_INVOCATION_FENCE_SCHEMA_VERSION,
    dispatchId: record.dispatchId,
  });
}

function assertStoredFenceBinding(record, dispatchId) {
  const canonical = validateExecutorInvocationFenceRecord(record);
  if (canonical.dispatchId !== dispatchId) {
    fail(
      `executor invocation fence store key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${canonical.dispatchId}.`,
      CORRUPT_EXECUTOR_INVOCATION_FENCE,
    );
  }
  return canonical;
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

function replayFenceOutcome({ dispatchId, store }) {
  const observed = store.readExecutorInvocationOutcome(dispatchId);
  if (observed === null || observed === undefined) return null;
  const canonical = assertStoredOutcomeBinding(observed, dispatchId);
  return Object.freeze({
    dispatchId,
    outcome: canonical.outcome,
    receipt: null,
    executorInvoked: false,
    exactReplay: true,
  });
}

function replayFenceReceipt({ dispatchId, store }) {
  const observed = store.readExecutorResultReceipt(dispatchId);
  if (observed === null || observed === undefined) return null;
  const canonical = assertStoredReceiptBinding(observed, dispatchId);
  return Object.freeze({
    dispatchId,
    outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
    receipt: canonical,
    executorInvoked: false,
    exactReplay: true,
  });
}

/**
 * Durably publish the EXACT Task 30 outcome already returned by Task 33.
 * Exclusive-create + exact read-back + first-winner convergence/conflict,
 * mirroring the Task 32 publication contract without ever invoking an adapter.
 */
function publishExecutorInvocationOutcome({ dispatchId, store, outcome }) {
  if (!EXECUTOR_INVOCATION_OUTCOME_VALUES.includes(outcome)) {
    fail(
      `executor invocation fence cannot publish outcome ${describeValue(outcome)} ${String(outcome)}; expected exactly ${EXECUTOR_INVOCATION_OUTCOME_VALUES.join(' | ')}.`,
      CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
  }
  const record = Object.freeze({
    schemaVersion: EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
    dispatchId,
    outcome,
  });
  const created = store.createExecutorInvocationOutcome(record);
  if (created && created.created === true) {
    const stored = store.readExecutorInvocationOutcome(dispatchId);
    if (
      stored === null ||
      stored === undefined ||
      JSON.stringify(stored) !== JSON.stringify(record)
    ) {
      fail(
        `executor invocation outcome failed durable read-back after exclusive create (fail-closed): ${dispatchId}`,
        CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
      );
    }
    return;
  }
  const winner = store.readExecutorInvocationOutcome(dispatchId);
  if (winner === null || winner === undefined) {
    fail(
      `executor invocation outcome race could not be resolved deterministically (fail-closed): ${dispatchId}`,
      CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
    );
  }
  const canonicalWinner = assertStoredOutcomeBinding(winner, dispatchId);
  if (canonicalWinner.outcome !== outcome) {
    fail(
      `executor invocation outcome conflict (fail-closed): dispatchId ${dispatchId} already carries a different valid durable outcome; the first durable winner is preserved and the incoming outcome is never preferred.`,
      EXECUTOR_INVOCATION_OUTCOME_CONFLICT,
    );
  }
}

/**
 * Execute the fenced invocation boundary for one dispatchId.
 *
 * Contract (durable-first, fail-closed, no repair, no overwrite, at most one
 * adapter invocation per dispatchId for every caller of this entry):
 * 1. `store` must expose readExecutorResultReceipt(dispatchId),
 *    readExecutorInvocationOutcome(dispatchId),
 *    createExecutorInvocationOutcome(record),
 *    readExecutorInvocationFence(dispatchId), and
 *    createExecutorInvocationFence(record); otherwise
 *    INVALID_EXECUTOR_INVOCATION_FENCE_STORE and nothing is read or written.
 * 2. An already existing valid durable receipt replays (zero executor
 *    invocations, zero writes). An already existing valid durable outcome
 *    (ACCEPTED | REJECTED | UNKNOWN) replays (zero executor invocations, zero
 *    writes). UNKNOWN never means retry.
 * 3. `executor` must be a caller-supplied function; otherwise the call fails
 *    closed with the Task 29 INVALID_EXECUTOR_INVOCATION_ADAPTER meaning
 *    BEFORE the fence is published (an invalid executor never poisons the
 *    fence namespace).
 * 4. Task 33 persistExecutorResultReceipt is composed EXACTLY ONCE with a
 *    fenced adapter wrapper. Task 29/33 validate identity, store, record, and
 *    READ_ONLY capability first; only then does the wrapper exclusive-create
 *    the durable fence in the same synchronous step immediately before the
 *    external executor call. Pre-invocation validation failures never consume
 *    the one-way fence and remain recoverable.
 * 5. The fence winner calls the external executor exactly once. Every fence
 *    loser fails closed (EXECUTOR_INVOCATION_FENCE_UNCERTAIN) with zero
 *    external executor calls.
 * 6. The Task 33 outcome is durably published (exclusive-create + read-back +
 *    first-winner conflict semantics).
 * 7. Adapter throw/rejection propagates UNCHANGED with the fence published:
 *    later calls fail closed as FENCE_UNCERTAIN until durable evidence exists.
 */
export async function invokeExecutorWithInvocationFence({ dispatchId, store, executor } = {}) {
  // 1. Caller-supplied durable store primitives only: no registry, no
  //    auto-detection, no transport.
  if (
    !store ||
    typeof store.readExecutorResultReceipt !== 'function' ||
    typeof store.readExecutorInvocationOutcome !== 'function' ||
    typeof store.createExecutorInvocationOutcome !== 'function' ||
    typeof store.readExecutorInvocationFence !== 'function' ||
    typeof store.createExecutorInvocationFence !== 'function'
  ) {
    fail(
      'executor invocation fence requires a caller-supplied store exposing readExecutorResultReceipt / readExecutorInvocationOutcome / createExecutorInvocationOutcome / readExecutorInvocationFence / createExecutorInvocationFence (composition only; the caller supplies the store explicitly).',
      INVALID_EXECUTOR_INVOCATION_FENCE_STORE,
    );
  }

  // 2. dispatchId identity validation before any durable read.
  assertValidExecutorInvocationFenceDispatchId(dispatchId);

  // 3. Durable-first receipt replay: an existing valid receipt is terminal with
  //    respect to automatic executor re-invocation.
  const receiptReplay = replayFenceReceipt({ dispatchId, store });
  if (receiptReplay !== null) return receiptReplay;

  // 4. Durable-first outcome replay: ACCEPTED | REJECTED | UNKNOWN are all
  //    terminal with respect to automatic executor re-invocation.
  const outcomeReplay = replayFenceOutcome({ dispatchId, store });
  if (outcomeReplay !== null) return outcomeReplay;

  // 5. Executor capability validation BEFORE fence publication: an invalid
  //    executor must not consume the one-way fence for this dispatchId.
  if (typeof executor !== 'function') {
    fail(
      'executor invocation fence requires a caller-supplied structured-result executor function (no registry, no auto-selection, no fallback).',
      INVALID_EXECUTOR_INVOCATION_ADAPTER,
    );
  }

  // 6. Fenced adapter wrapper: the durable fence is published in the SAME
  //    synchronous step that immediately precedes the external executor call.
  //    The wrapper is invoked by Task 29/33 only AFTER all Task 28/29/33
  //    identity, store, record, and READ_ONLY capability validation, so
  //    pre-invocation validation failures never consume the one-way fence and
  //    remain recoverable. The wrapper is invoked AT MOST ONCE per call.
  const fencedExecutor = async (task28Record) => {
    const fenced = store.createExecutorInvocationFence(
      Object.freeze({
        schemaVersion: EXECUTOR_INVOCATION_FENCE_SCHEMA_VERSION,
        dispatchId,
      }),
    );
    if (!fenced || fenced.created !== true) {
      fail(
        `a durable executor invocation fence already exists for ${dispatchId}: the executor boundary may already have been crossed by this or another process, the disposition cannot be proven from durable evidence here, and automatic re-invocation is refused (fail-closed). A later call replays the durable outcome/receipt once it exists.`,
        EXECUTOR_INVOCATION_FENCE_UNCERTAIN,
      );
    }
    return await executor(task28Record);
  };

  // 7. Invocation: the Task 33 public entry is composed EXACTLY ONCE with the
  //    fenced adapter wrapper. Task 29/33 fail-closed codes and adapter
  //    throw/rejection propagate UNCHANGED; a published fence keeps every
  //    later call fail-closed.
  const returned = await persistExecutorResultReceipt({
    dispatchId,
    store,
    executor: fencedExecutor,
  });

  // 8. Durable post-invocation outcome publication: ACCEPTED | REJECTED |
  //    UNKNOWN are recorded exactly as reported at the protocol boundary and
  //    become terminal for automatic re-invocation.
  publishExecutorInvocationOutcome({ dispatchId, store, outcome: returned.outcome });

  return Object.freeze({
    dispatchId,
    outcome: returned.outcome,
    receipt: returned.receipt ?? null,
    executorInvoked: true,
    exactReplay: false,
  });
}
