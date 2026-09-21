// Bounded invocation-contract owner:
// GREENHUB-COORDINATION-EXECUTOR-INVOCATION-ADAPTER-CONTRACT-29
// (GF-02 record-contract owner revision).
// Surface: scripts/coordination/*dispatch-executor-invocation-contract*
// (this module) + composition of the existing public Task 28/27 primitives ONLY
//   assertValidExecutorInvocationAttemptDispatchId(dispatchId)
//   store.readExecutorInvocationAttempt(dispatchId)
//   validateExecutorInvocationInputRecord(record)
// over the unchanged durable authority
// <coordination-home>/executor-invocation-attempts/<dispatchId>.json.
// No store.mjs mutation. No Task 18~28 source or spec mutation.
//
// Contract summary:
//   invokeExecutorInvocationAdapter() != executeTask() != invokeExecutor()
//     != acknowledgeDispatch() != acceptExecutorDispatchDecision()
//     != persistExecutorInvocationAttempt() != persistReceiverDecision()
//     != dispatchNextTask() != scheduleNextTask() != decideNextTask()
//     != selectWorker() != selectExecutor().
//   CALLER_SUPPLIED_EXECUTOR_ADAPTER_INVOCATION != global exactly-once
//     invocation != delivery success != executor received != executor accepted
//     != executor started != task started != task completed != ACK received
//     != receipt persisted != execution start != task status transition
//     != scheduler decision != worker/executor selection != retry/resend
//     authority != new generation/fencing authority.
//   read != invoke != ACK != execute. This module makes NO executor-invocation
//   decision of its own: it reads the EXACT canonical Task 28 durable
//   invocation attempt for one dispatchId and hands that exact record to ONE
//   caller-supplied adapter function at most once per API call.
//   Entry is EXACTLY one path, in this validation order:
//     (dispatchId, store, adapter)
//       1. dispatchId identity validation [Task 28 executor-invocation-attempt
//          family verbatim: invalid identity fails closed BEFORE any store
//          access or adapter call]
//       2. adapter capability validation [invalid/missing adapter fails closed
//          BEFORE any store read: zero store reads, zero adapter calls]
//       3. store capability gate [readExecutorInvocationAttempt(dispatchId)
//          ONLY; no other capability is required or consulted]
//       4. store.readExecutorInvocationAttempt(dispatchId)
//          [dispatchId is the ONLY lookup key; at most one reader invocation;
//           no polling, no re-read loop, no fallback lookup, no scan]
//       5. null/undefined: EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND
//          [Task 29-native read failure ONLY: never retry / executor
//           unavailable / ACK timeout / task failure / scheduler failure;
//           zero writes, zero auto-create, zero repair]
//       6. Task 28 durable record validation/binding check [Task 27 public
//          validator validateExecutorInvocationInputRecord(): exact key
//          shape/order, schemaVersion, fixed decision value, Task 20
//          decisionInput validation with predecessor codes propagated
//          UNCHANGED; no duplicated validator; corrupt/tampered records fail
//          closed, never repaired/normalized/overwritten]
//       7. validated.dispatchId === dispatchId [direct binding re-check;
//          mismatch fails closed]
//       8. caller-supplied adapter(EXACT validated Task 28 record) [AT MOST
//          ONCE per API call: no loop, no internal retry, no fallback adapter,
//          no registry, no auto-selection, no environment-based selection,
//          no endpoint discovery, no scheduler, no queue scan, no polling,
//          no daemon, no cron]
//       9. adapter return/rejection is propagated to the caller UNCHANGED
//          [no normalization, no wrapper metadata, no catch-and-retry]
//   LOOKUP KEY = dispatchId ONLY. sourceTaskId / nextTaskId / taskId /
//   workerId / admissionId / emissionSlot / claimToken / claimGeneration are
//   never lookup keys.
//   The adapter receives the EXACT canonical durable record
//     { schemaVersion, dispatchId, decision, decisionInput } with no wrapper
//   metadata: no invokedAt / attemptedAt / pid / hostname / random UUID /
//   executorGeneration / invocationGeneration / retryGeneration /
//   attemptNumber. claimGeneration (inherited verbatim inside decisionInput)
//   remains the SOLE fencing generation.
//   This module performs ZERO durable writes: no ACK, no receipt, no invoked
//   marker, no execution status, no task/claim/admission/emission/
//   dispatch-attempt/receiver-acceptance/receiver-decision/executor-
//   acceptance/executor-invocation-attempt/result/disposition mutation, and
//   no new durable namespace or artifact.
//   Exactly-once invocation is NOT claimed: this API guarantees only AT MOST
//   ONE adapter invocation per API call. An external caller that invokes this
//   API multiple times can produce multiple adapter invocations; no retry
//   policy exists here. dispatchId is a stable identity a future concrete
//   executor/receiver MAY use as an idempotency key.
//   The module is clock-free / process-free: no Date.now / new Date /
//   performance.now / pid / hostname / random UUID / mtime / ctime
//   participates.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   concrete executor invocation, executeTask, invokeExecutor, OpenCode /
//   Codex / Astra / ChatGPT invocation, child_process / spawn / exec /
//   execFile / fork, shell invocation, HTTP / fetch / WebSocket / gRPC / MCP /
//   stdin-stdout transport, executor process lifecycle, ACK protocol, ACK
//   persistence, receipt persistence, sender acknowledgment, receiver
//   acknowledgment, delivery confirmation, executorStarted, executionStarted,
//   executionAllowed, acceptedByExecutor, CLAIMED -> RUNNING, task status
//   mutation, claim mutation/lease extension/takeover, admission mutation,
//   emission mutation, dispatch-attempt mutation, receiver-acceptance
//   mutation, receiver-decision mutation, executor-acceptance mutation,
//   executor-invocation-attempt mutation, result/disposition mutation,
//   retry/resend/backoff, retry counter, invocation counter, scheduler, queue
//   consumer, worker/executor registry, worker/executor selection, capability
//   matching, environment-based executor selection, endpoint discovery,
//   polling, daemon, cron, any new generation authority (executorGeneration /
//   invocationGeneration / executionGeneration / attemptGeneration /
//   retryGeneration), any node:fs access.

import {
  assertValidExecutorInvocationAttemptDispatchId,
  CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
} from './dispatch-executor-invocation-attempt.mjs';
import { validateExecutorInvocationInputRecord } from './dispatch-executor-invocation-input.mjs';

// Invocation-contract-native meanings ONLY. Missing durable Task 28 invocation
// attempt gets its own read-failure code; store corruption / invalid records /
// binding failures reuse the existing Task 28/27/26/24/20/18/19 codes verbatim.
export const EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND = 'EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND';
export const INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE =
  'INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE';
export const INVALID_EXECUTOR_INVOCATION_ADAPTER = 'INVALID_EXECUTOR_INVOCATION_ADAPTER';

export class ExecutorInvocationContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ExecutorInvocationContractError';
    this.code = details.code ?? EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND;
  }
}

function fail(message, code = EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND) {
  throw new ExecutorInvocationContractError(message, { code });
}

/**
 * Invoke ONE caller-supplied executor adapter with the EXACT canonical Task 28
 * durable executor invocation attempt for one dispatchId.
 *
 * Contract (fail-closed, read-only, at-most-once):
 * 1. `dispatchId` must be a valid Task 19/22/24/26/28 identity
 *    (`dsp_<64 lowercase hex>`); otherwise the call fails closed BEFORE any
 *    store access or adapter call (the Task 28 identity-family code
 *    propagates).
 * 2. `adapter` must be a caller-supplied function; otherwise the call fails
 *    closed BEFORE any store access (INVALID_EXECUTOR_INVOCATION_ADAPTER,
 *    zero store reads, zero adapter calls). There is no registry, no
 *    auto-selection, no environment-based selection, and no fallback adapter.
 * 3. `store` must expose readExecutorInvocationAttempt(dispatchId); no other
 *    capability is required, consulted, or read (no task store, claim store,
 *    admission store, emission store, dispatch attempt store,
 *    receiver-acceptance store, result store, ACK store, worker/executor
 *    registry, or scheduler state).
 * 4. The reader receives dispatchId ONLY (one argument) and is invoked AT MOST
 *    ONCE per call: no polling, no retry, no re-read loop, no fallback lookup,
 *    no second read after success, no directory scan, no newest-record scan.
 * 5. null / undefined from the reader means no durable Task 28 invocation
 *    attempt exists for this dispatchId: fail closed with
 *    EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND (a read failure only, never a task
 *    status, invocation readiness, executor availability, ACK timeout,
 *    retry, transport, or delivery decision; no write is performed, no
 *    attempt is auto-created, and no predecessor input is reconstructed).
 * 6. A returned record is re-validated with the Task 27 public validator
 *    validateExecutorInvocationInputRecord(): exact key shape and order,
 *    schemaVersion, fixed decision value, blocked-field absence, and Task 20
 *    decisionInput validation. Malformed / tampered / binding-drift records
 *    fail closed with their existing codes propagating UNCHANGED. The record
 *    is never repaired, overwritten, truncated, deleted, rewritten, or
 *    normalized.
 * 7. The validated record's dispatchId must equal the requested dispatchId
 *    (direct binding re-check, defense in depth for caller-supplied stores);
 *    mismatch fails closed.
 * 8. The adapter is invoked with that EXACT validated record AT MOST ONCE per
 *    API call. No internal retry, no fallback adapter, no loop, no queue scan,
 *    no scheduler.
 * 9. The adapter's return value or thrown/rejected error is propagated to the
 *    caller UNCHANGED: no normalization, no wrapper metadata, no
 *    catch-and-retry, no durable side effect.
 *
 * AT MOST ONE adapter invocation per API call is guaranteed. Global
 * exactly-once invocation, delivery success, executor receipt/acceptance/
 * start, task start/completion, and ACK receipt are NOT claimed: multiple
 * external calls of this API may produce multiple adapter invocations, and no
 * retry policy exists here.
 */
export async function invokeExecutorInvocationAdapter({ dispatchId, store, adapter } = {}) {
  // 1. dispatchId is validated first: invalid identities never touch the
  //    store and never reach the adapter (existing Task 28 code propagates).
  assertValidExecutorInvocationAttemptDispatchId(dispatchId);

  // 2. Adapter capability is validated before any store access: an invalid
  //    adapter performs zero store reads and zero adapter calls.
  if (typeof adapter !== 'function') {
    fail(
      'executor invocation adapter must be a caller-supplied function (no registry, no auto-selection, no environment-based selection, no endpoint discovery).',
      INVALID_EXECUTOR_INVOCATION_ADAPTER,
    );
  }

  // 3. Caller-supplied durable store primitive only: exactly one required
  //    capability, no registry, no auto-detection, no transport.
  if (!store || typeof store.readExecutorInvocationAttempt !== 'function') {
    fail(
      'this invocation entry requires a store exposing readExecutorInvocationAttempt(dispatchId) (read-only composition; no other capability is required or consulted).',
      INVALID_EXECUTOR_INVOCATION_CONTRACT_STORE,
    );
  }

  // 4. dispatchId is the SOLE lookup key; exactly one invocation per call.
  //    Store corruption/binding errors (Task 28/27/26/24/20 codes) propagate
  //    UNCHANGED and are never repaired or remapped.
  const stored = await store.readExecutorInvocationAttempt(dispatchId);

  // 5. Missing durable Task 28 invocation attempt: read-failure meaning ONLY.
  //    No write, no auto-create, no predecessor reconstruction, no retry.
  if (stored === null || stored === undefined) {
    fail(
      `no durable executor invocation attempt exists for ${dispatchId}; this is a read failure only, never a task status, executor availability, ACK, transport, or delivery meaning.`,
      EXECUTOR_INVOCATION_ATTEMPT_NOT_FOUND,
    );
  }

  // 6. Task 27 record validation is reused verbatim: existing Task 28/27/23/
  //    22/20/18/19 codes propagate UNCHANGED; nothing is repaired or rewritten.
  const validated = validateExecutorInvocationInputRecord(stored);

  // 7. Direct key/binding re-check against the requested dispatchId.
  if (validated.dispatchId !== dispatchId) {
    fail(
      `executor invocation attempt record key/binding mismatch (fail-closed): looked up ${dispatchId} but the durable record carries ${validated.dispatchId}.`,
      CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
    );
  }

  // 8. Exactly one adapter invocation with the EXACT validated Task 28
  //    record: no loop, no internal retry, no fallback adapter, and no
  //    wrapper metadata. The adapter's return/rejection is propagated
  //    unchanged (9); this module performs no durable write at all.
  return await adapter(validated);
}
