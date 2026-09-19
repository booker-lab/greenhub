// Bounded durable invocation-attempt owner:
// GREENHUB-COORDINATION-DURABLE-EXECUTOR-INVOCATION-ATTEMPT-28.
// Surface: scripts/coordination/*dispatch-executor-invocation-attempt* (this
// module) + the durable executor-invocation-attempt store primitives ONLY
// (readExecutorInvocationAttempt / createExecutorInvocationAttempt over
// <coordination-home>/executor-invocation-attempts/<dispatchId>.json).
// Task 27 readExecutorInvocationInput is composed verbatim; Task 26
// assertValidExecutorAcceptanceDispatchId is reused verbatim; Task 18~27
// source/spec semantics are never modified or duplicated.
//
// Contract summary:
//   persistExecutorInvocationAttempt() != acknowledgeDispatch() != executeTask()
//     != invokeExecutor() != acceptExecutorDispatchDecision()
//     != persistReceiverDecision() != dispatchNextTask() != scheduleNextTask()
//     != decideNextTask() != selectWorker() != selectExecutor().
//   DURABLE_EXECUTOR_INVOCATION_ATTEMPT != executor invocation != ACK
//     != receipt != delivery confirmation != execution start != task status
//     transition != scheduler decision != worker/executor selection
//     != retry/resend authority != new generation/fencing authority
//     != executor availability != delivery success.
//   read != persist != invoke != ACK != execute. persisted != invoked
//     != started != completed. The durable record is evidence that the caller
//     reached this durable persistence boundary ONLY; it is NEVER evidence
//     that any executor was actually invoked, notified, or started.
//   Entry is EXACTLY one path:
//     (dispatchId, store)
//       -> store capability gate (readExecutorDispatchAcceptance /
//          readExecutorInvocationAttempt / createExecutorInvocationAttempt)
//       -> readExecutorInvocationInput({ dispatchId, store })
//          [Task 27 verbatim: dispatchId identity validation, durable
//           executor-acceptance read, Task 24 validation, direct binding
//           re-check; missing/corrupt input fails closed with predecessor
//           codes propagated UNCHANGED, zero writes, zero auto-repair]
//       -> existing invocation attempt: exact serialized replay or
//          fail-closed conflict (first winner preserved; never overwrite/
//          merge/repair)
//       -> unseen: OS exclusive-create of the EXACT Task 27 invocation input
//          under <home>/executor-invocation-attempts/<dispatchId>.json
//       -> durable read-back verification of the exact record
//       -> exclusive-create race loser: immediate winner re-read, then
//          same record = idempotent replay / different valid record =
//          conflict / corrupt winner = fail closed (never overwrite).
//   LOOKUP KEY = dispatchId ONLY. sourceTaskId / nextTaskId / taskId /
//   workerId / admissionId / emissionSlot / claimToken / claimGeneration are
//   never lookup keys.
//   The durable value is the EXACT frozen Task 27 invocation input
//     { schemaVersion, dispatchId, decision, decisionInput } with no wrapper
//   metadata: the executor-invocation-attempt fact is expressed by the
//   namespace/path authority
//   <home>/executor-invocation-attempts/<dispatchId>.json ONLY. No
//   timestamps (attemptedAt / invocationAttemptedAt / receivedAt / createdAt /
//   updatedAt), no pid/hostname/random UUID, no ACK/receipt, no executor or
//   scheduler state, no concrete transport, no retry/resend metadata, no new
//   generation/fencing counter: claimGeneration stays the SOLE fencing
//   generation, inherited verbatim inside decisionInput.
//   Missing input causes ZERO writes and ZERO task/claim/admission/emission/
//   dispatch-attempt/receiver-acceptance/receiver-decision/executor-
//   acceptance/result mutation: no Task 26 acceptance is auto-created and no
//   Task 28 invocation attempt is auto-created on corruption.
//   Corrupt / wrong-shape / wrong-order / wrong-value / tampered-decisionInput
//   / mismatched-binding inputs fail closed with the existing Task 27/26/24/
//   20/18/19 codes propagated UNCHANGED; nothing is repaired, normalized,
//   overwritten, deleted, recreated, or merged, and the exact durable bytes
//   stay untouched.
//   The returned value is frozen, deterministic, and timestamp-free: no
//   Date.now / new Date / performance.now / pid / hostname / random UUID /
//   mtime / ctime participates. The same durable bytes and the same durable
//   state always serialize identically in any process under any clock skew.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   executor invocation, executeTask, invokeExecutor, OpenCode / Codex /
//   Astra / ChatGPT invocation, child_process / spawn / exec / execFile /
//   fork, shell execution, HTTP / fetch / WebSocket / gRPC / MCP /
//   stdin-stdout transport, ACK protocol, ACK persistence, receipt
//   persistence, sender acknowledgment, receiver acknowledgment, delivery
//   confirmation, executorStarted, executionStarted, executionAllowed,
//   acceptedByExecutor, CLAIMED -> RUNNING, task status mutation, claim
//   mutation/lease extension/takeover, admission mutation, emission mutation,
//   dispatch-attempt mutation, receiver-acceptance mutation,
//   receiver-decision mutation, executor-acceptance mutation,
//   result/disposition mutation, scheduler, worker/executor registry,
//   worker/executor selection, capability matching, READY scan, queue scan,
//   polling, daemon, cron, retry, resend, backoff, retry counter, invocation
//   counter, any new generation authority (invocationGeneration /
//   executorGeneration / executionGeneration / attemptGeneration /
//   retryGeneration), any node:fs access.

import nodePath from 'node:path';
import { assertValidExecutorAcceptanceDispatchId } from './dispatch-executor-acceptance.mjs';
import { readExecutorInvocationInput } from './dispatch-executor-invocation-input.mjs';

export const EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME = 'executor-invocation-attempts';

// Minimal immutable result shapes. dispatchId is the incoming invocation-
// attempt identity; newlyPersisted / exactReplay are invocation-attempt-local
// outcomes only, never durable state, never executor invocation, and never a
// task lifecycle status.
export const EXECUTOR_INVOCATION_ATTEMPT_NEW_FIELDS = Object.freeze([
  'dispatchId',
  'newlyPersisted',
]);
export const EXECUTOR_INVOCATION_ATTEMPT_REPLAY_FIELDS = Object.freeze([
  'dispatchId',
  'newlyPersisted',
  'exactReplay',
]);

// Invocation-attempt-native meanings ONLY. Missing/corrupt Task 27 input
// reuses the existing Task 27/26/24/20/18/19 codes verbatim; there is no
// invocation-attempt-specific ACK, persistence fallback, retry, executor
// availability, or generation authority.
export const CORRUPT_EXECUTOR_INVOCATION_ATTEMPT = 'CORRUPT_EXECUTOR_INVOCATION_ATTEMPT';
export const EXECUTOR_INVOCATION_ATTEMPT_CONFLICT = 'EXECUTOR_INVOCATION_ATTEMPT_CONFLICT';
export const INVALID_EXECUTOR_INVOCATION_ATTEMPT_STORE =
  'INVALID_EXECUTOR_INVOCATION_ATTEMPT_STORE';

export class ExecutorInvocationAttemptError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ExecutorInvocationAttemptError';
    this.code = details.code ?? CORRUPT_EXECUTOR_INVOCATION_ATTEMPT;
  }
}

function fail(message, code = CORRUPT_EXECUTOR_INVOCATION_ATTEMPT) {
  throw new ExecutorInvocationAttemptError(message, { code });
}

export function assertValidExecutorInvocationAttemptDispatchId(dispatchId) {
  try {
    assertValidExecutorAcceptanceDispatchId(dispatchId);
  } catch (error) {
    fail(error.message, CORRUPT_EXECUTOR_INVOCATION_ATTEMPT);
  }
  return dispatchId;
}

export function executorInvocationAttemptFileName(dispatchId) {
  assertValidExecutorInvocationAttemptDispatchId(dispatchId);
  return `${dispatchId}.json`;
}

/**
 * Durable path for one immutable executor invocation-attempt record.
 * `<home>/executor-invocation-attempts/<dispatchId>.json` (dispatchId-keyed
 * ONLY). `home` is a durable coordination home, never the repository worktree.
 */
export function executorInvocationAttemptFilePath(home, dispatchId) {
  if (typeof home !== 'string' || !home.trim()) {
    fail(
      'coordination home must be a non-empty directory path.',
      CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
    );
  }
  assertValidExecutorInvocationAttemptDispatchId(dispatchId);
  return nodePath.join(
    home,
    EXECUTOR_INVOCATION_ATTEMPTS_DIRNAME,
    executorInvocationAttemptFileName(dispatchId),
  );
}

function assertStoredAttemptBinding(record, dispatchId) {
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    record.dispatchId !== dispatchId
  ) {
    fail(
      `executor invocation attempt store key/binding mismatch (fail-closed): looked up ${dispatchId} but the store returned a different record.`,
      CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
    );
  }
}

/**
 * Durably record ONE executor invocation attempt for one dispatchId: the EXACT
 * Task 27 invocation input is stored under
 * <coordination-home>/executor-invocation-attempts/<dispatchId>.json.
 *
 * The persisted record is NOT an executor invocation, NOT an ACK, NOT a
 * receipt, NOT execution start, and NOT a task status transition: it only
 * makes the already-readable Task 26 durable executor acceptance reachable
 * through this durable invocation-attempt namespace/path authority.
 *
 * Contract (fail-closed, no repair, no overwrite):
 * 1. `store` must expose readExecutorDispatchAcceptance(dispatchId) (Task 27
 *    requirement), readExecutorInvocationAttempt(dispatchId), and
 *    createExecutorInvocationAttempt(record); otherwise
 *    INVALID_EXECUTOR_INVOCATION_ATTEMPT_STORE and nothing is read or
 *    persisted.
 * 2. The invocation input is the EXACT Task 27 readExecutorInvocationInput
 *    result: missing durable executor acceptance ->
 *    EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND; corrupt/invalid input ->
 *    predecessor codes propagate UNCHANGED; no write, no auto-acceptance, no
 *    receiver-decision reconstruction, no task mutation, no retry.
 * 3. The durable value is that EXACT validated Task 27 input; no wrapper
 *    metadata, no caller-supplied payload, no new generation.
 * 4. An already existing exact record is an idempotent replay (no file
 *    rewrite, no byte change, no mtime change, no timestamp, no generation
 *    increment, no ACK, no task mutation).
 * 5. An existing record with a different valid binding fails closed with
 *    EXECUTOR_INVOCATION_ATTEMPT_CONFLICT; the first winner is preserved and
 *    the incoming binding is never preferred.
 * 6. Unseen: OS exclusive-create, then durable read-back verification.
 * 7. Exclusive-create race loser: immediate winner re-read; exact same record
 *    -> replay success; different valid record -> conflict; corrupt winner ->
 *    fail closed. The winner is never overwritten.
 *
 * The result is frozen, deterministic, and timestamp-free: the same durable
 * input and the same durable state always serialize identically in any
 * process under any clock skew.
 */
export async function persistExecutorInvocationAttempt({ dispatchId, store } = {}) {
  // 1. Caller-supplied durable store primitives only: no registry, no
  //    auto-detection, no transport.
  if (
    !store ||
    typeof store.readExecutorDispatchAcceptance !== 'function' ||
    typeof store.readExecutorInvocationAttempt !== 'function' ||
    typeof store.createExecutorInvocationAttempt !== 'function'
  ) {
    fail(
      'executor invocation attempt persistence requires a store exposing readExecutorDispatchAcceptance / readExecutorInvocationAttempt / createExecutorInvocationAttempt (composition only; no registry, no auto-detection).',
      INVALID_EXECUTOR_INVOCATION_ATTEMPT_STORE,
    );
  }

  // 2. Task 27 verbatim: dispatchId identity validation, durable
  //    executor-acceptance read, Task 24 validation, and the direct dispatchId
  //    binding re-check. All predecessor codes propagate UNCHANGED; missing
  //    input performs no write at all.
  const input = await readExecutorInvocationInput({ dispatchId, store });

  // 3. The EXACT validated Task 27 invocation input is the durable value: no
  //    wrapper metadata, no derived fields, no new generation authority.
  const candidate = input;

  // 4. Existing durable invocation attempt: exact replay or fail-closed
  //    conflict (first winner preserved).
  const observed = store.readExecutorInvocationAttempt(dispatchId);
  if (observed !== null && observed !== undefined) {
    assertStoredAttemptBinding(observed, dispatchId);
    if (JSON.stringify(observed) !== JSON.stringify(candidate)) {
      fail(
        `executor invocation attempt conflict (fail-closed): dispatchId ${dispatchId} already carries a different durable invocation attempt; never overwrite, merge, repair, or prefer the incoming record.`,
        EXECUTOR_INVOCATION_ATTEMPT_CONFLICT,
      );
    }
    return Object.freeze({ dispatchId, newlyPersisted: false, exactReplay: true });
  }

  // 5. Unseen: exclusive-create the EXACT record (never exists()->write()).
  const outcome = store.createExecutorInvocationAttempt(candidate);
  if (outcome && outcome.created === true) {
    // 6. Durable read-back: the stored value must be the exact record.
    const stored = store.readExecutorInvocationAttempt(dispatchId);
    if (
      stored === null ||
      stored === undefined ||
      JSON.stringify(stored) !== JSON.stringify(candidate)
    ) {
      fail(
        `executor invocation attempt failed durable read-back after exclusive create (fail-closed): ${dispatchId}`,
        CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
      );
    }
    return Object.freeze({ dispatchId, newlyPersisted: true });
  }

  // 7. Exclusive-create race loser: re-read the winner immediately.
  const winner = store.readExecutorInvocationAttempt(dispatchId);
  if (winner === null || winner === undefined) {
    fail(
      `executor invocation attempt race could not be resolved deterministically (fail-closed): ${dispatchId}`,
      CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
    );
  }
  assertStoredAttemptBinding(winner, dispatchId);
  if (JSON.stringify(winner) !== JSON.stringify(candidate)) {
    fail(
      `executor invocation attempt conflict (fail-closed): dispatchId ${dispatchId} was already durably persisted with a different record; never overwrite or prefer the incoming record.`,
      EXECUTOR_INVOCATION_ATTEMPT_CONFLICT,
    );
  }
  return Object.freeze({ dispatchId, newlyPersisted: false, exactReplay: true });
}
