// Bounded durable-acceptance owner: GREENHUB-COORDINATION-DURABLE-EXECUTOR-ACCEPTANCE-26.
// Surface: scripts/coordination/*dispatch-executor-acceptance* (this module)
// + the durable executor-acceptance store primitives ONLY
// (readExecutorDispatchAcceptance / createExecutorDispatchAcceptance over
// <coordination-home>/executor-acceptances/<dispatchId>.json).
// Task 25 readReceiverExecutorAcceptanceInput is composed verbatim; Task 24
// validateReceiverDecisionRecord / assertValidReceiverDecisionDispatchId are
// reused verbatim; Task 18~25 source/spec semantics are never modified or
// duplicated.
//
// Contract summary:
//   acceptExecutorDispatchDecision() != acknowledgeDispatch() != executeTask()
//     != acceptReceiverDispatch() != persistReceiverDecision()
//     != dispatchNextTask() != scheduleNextTask() != decideNextTask()
//     != selectWorker() != invokeExecutor().
//   DURABLE_EXECUTOR_ACCEPTANCE != ACK != receipt != sender acknowledgment
//     != receiver acknowledgment != delivery confirmation != executor
//     invocation != execution start != task status transition != scheduler
//     decision != worker/executor selection != retry/resend authority
//     != new generation/fencing authority != delivery success.
//   read != accept != ACK != execute. accepted != invoked != started
//     != completed.
//   Acceptance entry is EXACTLY one path:
//     (dispatchId, store)
//       -> store capability gate (readReceiverDispatchDecision /
//          readExecutorDispatchAcceptance / createExecutorDispatchAcceptance)
//       -> readReceiverExecutorAcceptanceInput({ dispatchId, store })
//          [Task 25 verbatim: dispatchId identity validation, durable
//           receiver-decision read via readReceiverDispatchDecision, Task 24
//           validation; missing/corrupt input fails closed with predecessor
//           codes propagated UNCHANGED, zero writes, zero auto-repair]
//       -> existing executor acceptance: exact serialized replay or
//          fail-closed conflict (first winner preserved; never overwrite/
//          merge/repair)
//       -> unseen: OS exclusive-create of the EXACT Task 24 record under
//          <home>/executor-acceptances/<dispatchId>.json
//       -> durable read-back verification of the exact record
//       -> exclusive-create race loser: immediate winner re-read, then
//          same record = idempotent replay / different valid record =
//          conflict / corrupt winner = fail closed (never overwrite).
//   LOOKUP KEY = dispatchId ONLY. sourceTaskId / nextTaskId / taskId /
//   workerId / admissionId / emissionSlot / claimToken / claimGeneration are
//   never lookup keys.
//   The durable value is the EXACT Task 24 record
//     { schemaVersion, dispatchId, decision, decisionInput } with no wrapper
//   metadata: the executor-acceptance fact is expressed by the namespace/path
//   authority <home>/executor-acceptances/<dispatchId>.json ONLY. No
//   timestamps (acceptedAt / executorAcceptedAt / receivedAt / createdAt /
//   updatedAt), no pid/hostname/random UUID, no ACK/receipt, no executor or
//   scheduler state, no concrete transport, no new generation/fencing
//   counter: claimGeneration stays the SOLE fencing generation, inherited
//   verbatim inside decisionInput.
//   Missing input causes ZERO writes and ZERO task/claim/admission/emission/
//   dispatch-attempt/receiver-acceptance/receiver-decision/result mutation:
//   no Task 24 decision is auto-created and no Task 26 acceptance is
//   auto-created on corruption.
//   Corrupt / wrong-shape / wrong-order / wrong-value / tampered-decisionInput
//   / mismatched-binding inputs fail closed with the existing Task 25/24/20/
//   18/19 codes propagated UNCHANGED; nothing is repaired, normalized,
//   overwritten, deleted, recreated, or merged, and the exact durable bytes
//   stay untouched.
//   The returned value is frozen, deterministic, and timestamp-free: no
//   Date.now / new Date / performance.now / pid / hostname / random UUID /
//   mtime / ctime participates. The same durable bytes and the same durable
//   state always serialize identically in any process under any clock skew.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   ACK protocol, ACK persistence, receipt persistence, sender
//   acknowledgment, receiver acknowledgment, delivery confirmation, executor
//   invocation, executeTask, child_process / spawn / exec / fork, OpenCode /
//   Codex / Astra / ChatGPT invocation, HTTP / fetch / WebSocket / MCP /
//   stdin-stdout transport, executor registry, worker registry, worker
//   selection, executor selection, capability matching, scheduler, READY
//   scan, queue scan, polling, daemon, cron, retry, resend, backoff, retry
//   counter, delivery counter, task status mutation (CLAIMED -> RUNNING),
//   executionStarted, executionAllowed, claim mutation/lease
//   extension/takeover, admission mutation, emission mutation,
//   dispatch-attempt mutation, receiver-acceptance mutation,
//   receiver-decision mutation, result/disposition mutation, any new
//   generation authority (executorGeneration / executionGeneration /
//   acceptanceGeneration / deliveryGeneration / retryGeneration), any
//   node:fs access.

import nodePath from 'node:path';
import { assertValidReceiverDecisionDispatchId } from './dispatch-receiver-decision.mjs';
import { readReceiverExecutorAcceptanceInput } from './dispatch-receiver-executor-acceptance-input.mjs';

export const EXECUTOR_ACCEPTANCES_DIRNAME = 'executor-acceptances';

// Minimal immutable result shapes. dispatchId is the incoming acceptance
// identity; newlyAccepted / exactReplay are executor-acceptance-local
// outcomes only, never durable state and never a task lifecycle status.
export const EXECUTOR_ACCEPTANCE_NEW_FIELDS = Object.freeze(['dispatchId', 'newlyAccepted']);
export const EXECUTOR_ACCEPTANCE_REPLAY_FIELDS = Object.freeze([
  'dispatchId',
  'newlyAccepted',
  'exactReplay',
]);

// Executor-acceptance-native meanings ONLY. Missing/corrupt Task 25 input
// reuses the existing Task 25/24/20/18/19 codes verbatim; there is no
// executor-acceptance-specific ACK, persistence fallback, retry, or
// generation authority.
export const CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE = 'CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE';
export const EXECUTOR_DISPATCH_ACCEPTANCE_CONFLICT = 'EXECUTOR_DISPATCH_ACCEPTANCE_CONFLICT';
export const INVALID_EXECUTOR_ACCEPTANCE_STORE = 'INVALID_EXECUTOR_ACCEPTANCE_STORE';

export class ExecutorAcceptanceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ExecutorAcceptanceError';
    this.code = details.code ?? CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE;
  }
}

function fail(message, code = CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE) {
  throw new ExecutorAcceptanceError(message, { code });
}

export function assertValidExecutorAcceptanceDispatchId(dispatchId) {
  try {
    assertValidReceiverDecisionDispatchId(dispatchId);
  } catch (error) {
    fail(error.message, CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE);
  }
  return dispatchId;
}

export function executorAcceptanceFileName(dispatchId) {
  assertValidExecutorAcceptanceDispatchId(dispatchId);
  return `${dispatchId}.json`;
}

/**
 * Durable path for one immutable executor acceptance record.
 * `<home>/executor-acceptances/<dispatchId>.json` (dispatchId-keyed ONLY).
 * `home` is a durable coordination home, never the repository worktree.
 */
export function executorDispatchAcceptanceFilePath(home, dispatchId) {
  if (typeof home !== 'string' || !home.trim()) {
    fail(
      'coordination home must be a non-empty directory path.',
      CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
    );
  }
  assertValidExecutorAcceptanceDispatchId(dispatchId);
  return nodePath.join(home, EXECUTOR_ACCEPTANCES_DIRNAME, executorAcceptanceFileName(dispatchId));
}

function assertStoredAcceptanceBinding(record, dispatchId) {
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    record.dispatchId !== dispatchId
  ) {
    fail(
      `executor acceptance store key/binding mismatch (fail-closed): looked up ${dispatchId} but the store returned a different record.`,
      CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
    );
  }
}

/**
 * Durably accept ONE executor dispatch decision for one dispatchId: the EXACT
 * validated Task 24 record is stored under
 * <coordination-home>/executor-acceptances/<dispatchId>.json.
 *
 * Contract (fail-closed, no repair, no overwrite):
 * 1. `store` must expose readReceiverDispatchDecision(dispatchId) (Task 25
 *    requirement), readExecutorDispatchAcceptance(dispatchId), and
 *    createExecutorDispatchAcceptance(record); otherwise
 *    INVALID_EXECUTOR_ACCEPTANCE_STORE and nothing is read or persisted.
 * 2. The acceptance input is the EXACT Task 25
 *    readReceiverExecutorAcceptanceInput result: missing durable receiver
 *    decision -> RECEIVER_DISPATCH_DECISION_NOT_FOUND; corrupt/invalid input
 *    -> predecessor codes propagate UNCHANGED; no write, no auto-decision, no
 *    task mutation, no retry.
 * 3. The durable value is that EXACT validated Task 24 record; no wrapper
 *    metadata, no caller-supplied acceptance payload, no new generation.
 * 4. An already existing exact record is an idempotent replay (no file
 *    rewrite, no byte change, no mtime change, no timestamp, no generation
 *    increment, no ACK, no task mutation).
 * 5. An existing record with a different valid binding fails closed with
 *    EXECUTOR_DISPATCH_ACCEPTANCE_CONFLICT; the first winner is preserved and
 *    the incoming binding is never preferred.
 * 6. Unseen: OS exclusive-create, then durable read-back verification.
 * 7. Exclusive-create race loser: immediate winner re-read; exact same record
 *    -> replay success; different valid record -> conflict; corrupt winner ->
 *    fail closed. The winner is never overwritten.
 *
 * The result is frozen, deterministic, and timestamp-free: the same durable
 * input and the same durable state always serialize identically in any
 * process under any clock skew. It is NOT an ACK, NOT a receipt, NOT executor
 * invocation, NOT execution start, and NOT a task status transition.
 */
export async function acceptExecutorDispatchDecision({ dispatchId, store } = {}) {
  // 1. Caller-supplied durable store primitives only: no registry, no
  //    auto-detection, no transport.
  if (
    !store ||
    typeof store.readReceiverDispatchDecision !== 'function' ||
    typeof store.readExecutorDispatchAcceptance !== 'function' ||
    typeof store.createExecutorDispatchAcceptance !== 'function'
  ) {
    fail(
      'executor acceptance requires a store exposing readReceiverDispatchDecision / readExecutorDispatchAcceptance / createExecutorDispatchAcceptance (composition only; no registry, no auto-detection).',
      INVALID_EXECUTOR_ACCEPTANCE_STORE,
    );
  }

  // 2. Task 25 verbatim: dispatchId identity validation (first, before any
  //    store access), durable receiver-decision read via
  //    readReceiverDispatchDecision, Task 24 validation. Predecessor codes
  //    propagate UNCHANGED; missing input performs no write at all.
  const input = await readReceiverExecutorAcceptanceInput({ dispatchId, store });

  // 3. The EXACT validated Task 24 record is the durable value: no wrapper
  //    metadata, no derived fields, no new generation authority.
  const candidate = input;

  // 4. Existing durable executor acceptance: exact replay or fail-closed
  //    conflict (first winner preserved).
  const observed = store.readExecutorDispatchAcceptance(dispatchId);
  if (observed !== null && observed !== undefined) {
    assertStoredAcceptanceBinding(observed, dispatchId);
    if (JSON.stringify(observed) !== JSON.stringify(candidate)) {
      fail(
        `executor acceptance conflict (fail-closed): dispatchId ${dispatchId} already carries a different durable acceptance; never overwrite, merge, repair, or prefer the incoming record.`,
        EXECUTOR_DISPATCH_ACCEPTANCE_CONFLICT,
      );
    }
    return Object.freeze({ dispatchId, newlyAccepted: false, exactReplay: true });
  }

  // 5. Unseen: exclusive-create the EXACT record (never exists()->write()).
  const outcome = store.createExecutorDispatchAcceptance(candidate);
  if (outcome && outcome.created === true) {
    // 6. Durable read-back: the stored value must be the exact record.
    const stored = store.readExecutorDispatchAcceptance(dispatchId);
    if (
      stored === null ||
      stored === undefined ||
      JSON.stringify(stored) !== JSON.stringify(candidate)
    ) {
      fail(
        `executor acceptance failed durable read-back after exclusive create (fail-closed): ${dispatchId}`,
        CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
      );
    }
    return Object.freeze({ dispatchId, newlyAccepted: true });
  }

  // 7. Exclusive-create race loser: re-read the winner immediately.
  const winner = store.readExecutorDispatchAcceptance(dispatchId);
  if (winner === null || winner === undefined) {
    fail(
      `executor acceptance race could not be resolved deterministically (fail-closed): ${dispatchId}`,
      CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
    );
  }
  assertStoredAcceptanceBinding(winner, dispatchId);
  if (JSON.stringify(winner) !== JSON.stringify(candidate)) {
    fail(
      `executor acceptance conflict (fail-closed): dispatchId ${dispatchId} was already durably accepted with a different record; never overwrite or prefer the incoming record.`,
      EXECUTOR_DISPATCH_ACCEPTANCE_CONFLICT,
    );
  }
  return Object.freeze({ dispatchId, newlyAccepted: false, exactReplay: true });
}
