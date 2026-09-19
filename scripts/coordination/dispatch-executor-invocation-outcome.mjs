// Bounded outcome-contract owner:
// GREENHUB-COORDINATION-EXECUTOR-INVOCATION-OUTCOME-CONTRACT-30.
// Surface: scripts/coordination/*dispatch-executor-invocation-outcome*
// (this module) + composition of the Task 29 public invocation entry ONLY
//   invokeExecutorInvocationAdapter({ dispatchId, store, adapter })
// over the unchanged durable authority
// <coordination-home>/executor-invocation-attempts/<dispatchId>.json.
// No store.mjs mutation. No Task 18~29 source or spec mutation.
//
// State transition added here:
//   DURABLE_EXECUTOR_INVOCATION_ATTEMPT(dispatchId)                [Task 28]
//     -> CALLER_SUPPLIED_EXECUTOR_ADAPTER_INVOCATION(dispatchId)   [Task 29]
//     -> VALIDATED_EXECUTOR_INVOCATION_OUTCOME(dispatchId)         [Task 30]
//
// Contract summary:
//   invokeExecutorAndValidateOutcome() != invokeExecutor() != executeTask()
//     != concrete executor integration != executor receipt != executor started
//     != task started != task RUNNING != task result != ACK != durable receipt
//     != retry permission != global exactly-once execution.
//   VALIDATED_EXECUTOR_INVOCATION_OUTCOME != concrete executor integration
//     != executor receipt proof != executor started != task started
//     != task RUNNING != task result != ACK != durable receipt
//     != retry permission != global exactly-once execution.
//   Entry is EXACTLY one composition path:
//     (dispatchId, store, adapter)
//       1. invokeExecutorInvocationAdapter({ dispatchId, store, adapter })
//          [Task 29 public entry VERBATIM, called EXACTLY ONCE per API call:
//           Task 28 identity validation, adapter capability validation, store
//           capability gate, one dispatchId-keyed durable read, Task 28 record
//           validation via the Task 24 public validator, direct binding
//           re-check, AT MOST ONE adapter invocation, unchanged propagation of
//           adapter return/rejection and predecessor fail-closed codes]
//       2. the adapter's returned value is validated against the EXACT minimal
//          outcome contract below; validation NEVER re-invokes the adapter and
//          NEVER re-reads durable state
//       3. success returns a frozen canonical validated outcome record
//          { schemaVersion: 1, dispatchId, outcome }
//   The canonical Task 28 record is NEVER re-read, reconstructed, or validated
//   here: Task 29 is the only invocation path, and dispatchId remains the ONLY
//   invocation identity.
//   adapter throw/rejection is NEVER converted to UNKNOWN/REJECTED/ACCEPTED
//   and NEVER caught, normalized, retried, or replaced: the exact thrown /
//   rejected value reaches the caller UNCHANGED.
//   UNKNOWN exists ONLY as an explicitly returned protocol outcome. It is NOT
//   a retry permission, NOT a transport failure, NOT a timeout, and this Task
//   has NO automatic retry at all.
//
// Exact successful outcome contract (adapter return value):
//   { schemaVersion: 1, dispatchId, outcome } — EXACTLY these three own
//   properties, no extras, no missing, no symbol keys, no accessors, plain
//   object (Object.prototype or null prototype), with
//     schemaVersion === 1 (number)
//     dispatchId === the requested dispatchId (exact identity)
//     outcome in ACCEPTED | REJECTED | UNKNOWN
//   ACCEPTED = the caller-supplied adapter reported, at ITS OWN protocol
//     boundary, that the invocation was accepted. It does NOT mean executor
//     process started, executor received the task semantically, task started,
//     task RUNNING, task completed, delivery globally succeeded, ACK
//     persisted, receipt persisted, or exactly-once execution.
//   REJECTED = the adapter reported, at its own protocol boundary, an explicit
//     refusal of the invocation. It does NOT mean task failure and does NOT
//     produce a task result.
//   UNKNOWN = the adapter explicitly reported, at its own protocol boundary,
//     that it cannot determine accept/reject. It is NOT a retry permission.
//   Forbidden extra metadata (non-exhaustive): acceptedAt, invokedAt,
//     startedAt, completedAt, attemptedAt, retryCount, attemptNumber, pid,
//     hostname, endpoint, workerId, executorId, executorGeneration,
//     invocationGeneration, executionGeneration, retryGeneration, or any new
//     fencing counter. dispatchId stays the SOLE invocation identity;
//     claimGeneration (inside the Task 28 record inherited from Task 20/18)
//     remains the SOLE fencing generation.
//
// This module performs ZERO durable writes: no ACK, no receipt, no invoked
// marker, no execution status, no task/claim/admission/emission/
// dispatch-attempt/receiver-acceptance/receiver-decision/executor-acceptance/
// executor-invocation-attempt/result/disposition mutation, and no new durable
// namespace or artifact. IN-MEMORY CONTRACT ONLY.
// Exactly-once invocation is NOT claimed: Task 29 guarantees AT MOST ONE
// adapter invocation per API call, and this Task adds only AT MOST ONE
// validation of the returned value per API call. Multiple external calls can
// produce multiple adapter invocations; no retry policy exists here.
// The module is clock-free / process-free: no Date.now / new Date /
// performance.now / pid / hostname / random UUID / mtime / ctime participates.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   concrete executor invocation, executeTask, invokeExecutor, OpenCode /
//   Codex / Astra / ChatGPT invocation, child_process / spawn / exec /
//   execFile / fork, shell invocation, HTTP / fetch / WebSocket / gRPC / MCP /
//   stdin-stdout transport, executor process lifecycle, ACK protocol, ACK
//   persistence, receipt persistence, task result persistence, disposition
//   persistence, CLAIMED -> RUNNING, task status mutation, retry/resend/
//   backoff, retry counter, scheduler, queue consumer, worker/executor
//   registry, worker/executor selection, capability matching, environment-
//   based executor selection, endpoint discovery, polling, daemon, cron, any
//   new generation authority, any node:fs access.

import { invokeExecutorInvocationAdapter } from './dispatch-executor-invocation-contract.mjs';

// The exact outcome schema version: a NUMBER, never a string, timestamp, or
// generation.
export const EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION = 1;

// The complete allowed outcome vocabulary. These are protocol-boundary reports
// from the caller-supplied adapter ONLY; none of them is a task status.
export const EXECUTOR_INVOCATION_OUTCOME_ACCEPTED = 'ACCEPTED';
export const EXECUTOR_INVOCATION_OUTCOME_REJECTED = 'REJECTED';
export const EXECUTOR_INVOCATION_OUTCOME_UNKNOWN = 'UNKNOWN';

export const EXECUTOR_INVOCATION_OUTCOME_VALUES = Object.freeze([
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_REJECTED,
  EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
]);

// Exact canonical key order for the validated outcome record. Key ORDER of the
// adapter's returned value is not semantically enforced (in-memory value); the
// validated record is always rebuilt in this order.
export const EXECUTOR_INVOCATION_OUTCOME_FIELDS = Object.freeze([
  'schemaVersion',
  'dispatchId',
  'outcome',
]);

// Outcome-contract-native meaning ONLY: the adapter returned a value that is
// not the exact minimal outcome contract. Task 29 fail-closed codes and adapter
// throw/rejection values are NEVER remapped to this code.
export const INVALID_EXECUTOR_INVOCATION_OUTCOME = 'INVALID_EXECUTOR_INVOCATION_OUTCOME';

export class ExecutorInvocationOutcomeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ExecutorInvocationOutcomeError';
    this.code = details.code ?? INVALID_EXECUTOR_INVOCATION_OUTCOME;
  }
}

function fail(message, code = INVALID_EXECUTOR_INVOCATION_OUTCOME) {
  throw new ExecutorInvocationOutcomeError(message, { code });
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

// "Plain record" means: non-null object, not an array, with Object.prototype
// or null prototype. Class instances, Maps, Dates, functions, and other exotic
// objects are not a valid outcome.
function assertPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      `executor invocation outcome must be a plain record returned by the caller-supplied adapter (received ${describeValue(value)}).`,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(
      'executor invocation outcome must be a plain record with Object.prototype or null prototype (class instances, Maps, Dates, and other exotic objects are not a valid outcome).',
    );
  }
}

// Exact key-set + data-property extraction. No getter is ever invoked: accessor
// properties, symbol keys, missing keys, and extra keys all fail closed.
function readOutcomeFields(record) {
  if (Object.getOwnPropertySymbols(record).length > 0) {
    fail('executor invocation outcome must not carry symbol keys.');
  }
  const ownKeys = Object.getOwnPropertyNames(record);
  const exactKeySet =
    ownKeys.length === EXECUTOR_INVOCATION_OUTCOME_FIELDS.length &&
    EXECUTOR_INVOCATION_OUTCOME_FIELDS.every((field) => ownKeys.includes(field));
  if (!exactKeySet) {
    fail(
      `executor invocation outcome must carry exactly ${EXECUTOR_INVOCATION_OUTCOME_FIELDS.length} fields (${EXECUTOR_INVOCATION_OUTCOME_FIELDS.join(', ')}) with no extra metadata; received [${ownKeys.join(', ')}].`,
    );
  }
  const fields = {};
  for (const field of EXECUTOR_INVOCATION_OUTCOME_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined) {
      fail(
        `executor invocation outcome field "${field}" must be a plain data property (accessors are not a valid outcome).`,
      );
    }
    fields[field] = descriptor.value;
  }
  return fields;
}

// Validate the adapter's successfully returned value against the EXACT minimal
// outcome contract and return a frozen canonical copy. No repair, no
// normalization beyond the exact-key rebuild, no adapter re-invocation, no
// durable access.
function validateExecutorInvocationOutcome(dispatchId, returned) {
  assertPlainRecord(returned);
  const fields = readOutcomeFields(returned);
  if (fields.schemaVersion !== EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION) {
    fail(
      `executor invocation outcome schemaVersion must be exactly ${EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION} (number), never a string, timestamp, or generation.`,
    );
  }
  if (fields.dispatchId !== dispatchId) {
    fail(
      `executor invocation outcome dispatchId mismatch (fail-closed): requested ${dispatchId} but the adapter reported ${describeValue(fields.dispatchId)} ${String(fields.dispatchId)}.`,
    );
  }
  if (!EXECUTOR_INVOCATION_OUTCOME_VALUES.includes(fields.outcome)) {
    fail(
      `executor invocation outcome must be exactly one of ${EXECUTOR_INVOCATION_OUTCOME_VALUES.join(' | ')}; received ${describeValue(fields.outcome)} ${String(fields.outcome)}.`,
    );
  }
  return Object.freeze({
    schemaVersion: EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
    dispatchId,
    outcome: fields.outcome,
  });
}

/**
 * Invoke the Task 29 caller-supplied executor invocation entry EXACTLY ONCE and
 * validate the adapter's returned value against the EXACT minimal outcome
 * contract.
 *
 * Contract (fail-closed, read-only, at-most-once):
 * 1. The invocation itself is the Task 29 public entry VERBATIM:
 *    invokeExecutorInvocationAdapter({ dispatchId, store, adapter }). No Task
 *    28/27/26/24/20 durable state is re-read, reconstructed, or validated
 *    here; dispatchId remains the ONLY lookup key and the ONLY invocation
 *    identity.
 * 2. Task 29 fail-closed errors (invalid dispatchId, invalid adapter, invalid
 *    store, missing Task 28 attempt, corrupt/invalid record, binding mismatch)
 *    propagate UNCHANGED: this entry never catches, remaps, retries, or
 *    repairs them.
 * 3. The adapter's return value must be a plain record with EXACTLY
 *    { schemaVersion: 1, dispatchId, outcome } where dispatchId equals the
 *    requested dispatchId and outcome is ACCEPTED, REJECTED, or UNKNOWN.
 *    Anything else fails closed with INVALID_EXECUTOR_INVOCATION_OUTCOME.
 * 4. On success, a frozen canonical validated outcome record
 *    { schemaVersion: 1, dispatchId, outcome } is returned. The adapter's
 *    returned object is never mutated, wrapped, or extended.
 * 5. The adapter is NEVER re-invoked because of outcome validation: AT MOST
 *    ONE adapter invocation per API call is inherited from Task 29, and this
 *    entry adds no retry, no fallback, and no second call. Global exactly-once
 *    invocation is NOT claimed.
 * 6. Adapter throw/rejection is propagated to the caller with the EXACT same
 *    thrown/rejected value: never caught, never converted to UNKNOWN/REJECTED,
 *    never normalized.
 * 7. ZERO durable writes. No ACK, receipt, task result, disposition, status,
 *    or new durable namespace is created.
 */
export async function invokeExecutorAndValidateOutcome({ dispatchId, store, adapter } = {}) {
  // 1. Task 29 composition ONLY, exactly once per API call. Task 29 performs
  //    identity/capability/read/record/binding validation and AT MOST ONE
  //    adapter invocation; its return/rejection is never caught or remapped.
  const returned = await invokeExecutorInvocationAdapter({ dispatchId, store, adapter });

  // 2. Validate the successfully returned value against the exact minimal
  //    outcome contract. No re-invocation, no durable access, no repair.
  return validateExecutorInvocationOutcome(dispatchId, returned);
}
