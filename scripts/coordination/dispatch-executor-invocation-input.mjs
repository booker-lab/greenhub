// Bounded read-only owner: GREENHUB-COORDINATION-EXECUTOR-INVOCATION-INPUT-27.
// Surface: scripts/coordination/*dispatch-executor-invocation-input*
// (this module) + composition of the existing public Task 26/24 primitives ONLY
//   store.readExecutorDispatchAcceptance(dispatchId)
//   assertValidExecutorAcceptanceDispatchId(dispatchId)
//   validateReceiverDecisionRecord(record)
// over the unchanged durable authority
// <coordination-home>/executor-acceptances/<dispatchId>.json.
// No store.mjs mutation. No Task 18~26 source or spec mutation.
//
// Contract summary:
//   readExecutorInvocationInput() != acknowledgeDispatch() != executeTask()
//     != acceptExecutorDispatchDecision() != persistReceiverDecision()
//     != dispatchNextTask() != scheduleNextTask() != decideNextTask()
//     != selectWorker() != invokeExecutor().
//   READABLE_EXECUTOR_INVOCATION_INPUT != executor invocation != executor
//     acceptance != ACK != receipt != execution start != task status
//     transition != scheduler decision != worker/executor selection
//     != retry/resend authority != delivery success.
//   read != invoke != ACK != execute. This module makes NO executor-invocation
//   decision: it only exposes the canonical durable executor acceptance a
//   future executor-invocation stage could consume, without reconstructing
//   Task 25/24/20 history and without re-deriving the Task 26 acceptance.
//   Entry is EXACTLY one path:
//     (dispatchId, store)
//       -> dispatchId identity validation   [Task 26 executor-acceptance family]
//       -> require store.readExecutorDispatchAcceptance ONLY
//       -> store.readExecutorDispatchAcceptance(dispatchId)
//          [dispatchId is the ONLY lookup key; at most one reader invocation;
//           no polling, no re-read loop, no fallback lookup, no scan]
//       -> null/undefined: EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND
//          [read failure ONLY: never NOT_READY / RETRY / REJECT, never worker
//           or executor availability, never ACK timeout, never transport or
//           delivery failure, never execution failure]
//       -> validateReceiverDecisionRecord(record)  [Task 24 public validator
//          verbatim: exact key shape/order, fixed decision value, Task 20
//          decisionInput validation with predecessor codes propagated
//          UNCHANGED; no duplicated validator]
//       -> validated.dispatchId === dispatchId     [direct binding re-check]
//       -> the EXACT frozen validated Task 26 durable acceptance record
//          (no wrapper metadata).
//   Missing acceptance causes ZERO writes and ZERO task/claim/admission/
//   emission/dispatch-attempt/receiver-acceptance/receiver-decision/
//   executor-acceptance/result/disposition mutation: no Task 24 receiver
//   decision is reconstructed, no Task 25 input is re-derived, and no Task 26
//   acceptance is auto-created on missing or corrupt input.
//   Corrupt / wrong-shape / wrong-order / wrong-value / tampered-decisionInput
//   / mismatched-binding records fail closed with the existing Task 26/24/20/
//   18/19 codes propagated UNCHANGED; nothing is repaired, normalized,
//   overwritten, deleted, recreated, or merged, and the exact durable bytes
//   stay untouched.
//   No new durable artifact, directory, or JSON domain is created: the durable
//   authority remains the Task 26 executor acceptance under
//   <coordination-home>/executor-acceptances/<dispatchId>.json.
//   The returned value is frozen, deterministic, and timestamp-free: no
//   Date.now / new Date / performance.now / pid / hostname / random UUID /
//   mtime / ctime participates. claimGeneration remains the SOLE fencing
//   generation, inherited verbatim inside decisionInput.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   executor invocation, executeTask, ACK protocol, receipt, sender ACK,
//   receiver ACK, executor ACK, delivery confirmation, child_process / spawn /
//   exec / execFile / fork, OpenCode / Codex / Astra / ChatGPT invocation,
//   HTTP / fetch / WebSocket / MCP / stdin-stdout transport, executor
//   registry, worker registry, worker selection, executor selection,
//   capability matching, scheduler, queue consumer, READY scan, polling,
//   daemon, cron, retry, resend, backoff, retry counter, delivery counter,
//   task status mutation (CLAIMED -> RUNNING), claim mutation/lease
//   extension/takeover, admission mutation, emission mutation,
//   dispatch-attempt mutation, receiver-acceptance mutation,
//   receiver-decision mutation, executor-acceptance mutation,
//   result/disposition mutation, any new generation authority
//   (executorGeneration / invocationGeneration / executionGeneration /
//   acceptanceGeneration / deliveryGeneration / retryGeneration),
//   executionAllowed / executionStarted / acceptedByExecutor /
//   executorInvoked / workerSelected flags, any node:fs access.

import {
  assertValidExecutorAcceptanceDispatchId,
  CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
} from './dispatch-executor-acceptance.mjs';
import { validateReceiverDecisionRecord } from './dispatch-receiver-decision.mjs';

// Invocation-input-native meanings ONLY. Missing durable executor acceptance
// gets its own read-failure code; corruption / invalid record / binding
// failures reuse the existing Task 26/24/20/18/19 codes verbatim.
export const EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND = 'EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND';
export const INVALID_EXECUTOR_INVOCATION_INPUT_STORE = 'INVALID_EXECUTOR_INVOCATION_INPUT_STORE';

export class ExecutorInvocationInputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ExecutorInvocationInputError';
    this.code = details.code ?? EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND;
  }
}

function fail(message, code = EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND) {
  throw new ExecutorInvocationInputError(message, { code });
}

/**
 * Read the canonical executor-invocation input for ONE dispatchId: the EXACT
 * validated frozen Task 26 durable executor acceptance stored at
 * <coordination-home>/executor-acceptances/<dispatchId>.json.
 *
 * Contract (fail-closed, no repair, no mutation):
 * 1. `dispatchId` must be a valid Task 19/22/24/26 identity (`dsp_<64 lowercase
 *    hex>`); otherwise the call fails closed BEFORE any store access or reader
 *    invocation (the Task 26 identity-family code propagates).
 * 2. `store` must expose readExecutorDispatchAcceptance(dispatchId); no other
 *    capability is required, consulted, or read (no task store, claim store,
 *    admission store, emission store, dispatch attempt store, receiver
 *    acceptance store, receiver decision store, result store, ACK store,
 *    worker/executor registry, or scheduler state).
 * 3. The reader receives dispatchId ONLY (one argument) and is invoked AT MOST
 *    ONCE per call: no polling, no retry, no re-read loop, no fallback lookup,
 *    no second read after success, no directory scan, no newest-record scan.
 * 4. null / undefined from the reader means no durable executor acceptance
 *    exists for this dispatchId: fail closed with
 *    EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND (a read failure only, never a task
 *    status, invocation readiness, ACK, worker/executor availability, retry,
 *    transport, or delivery decision; no write is performed, no acceptance is
 *    auto-created, and no receiver decision is reconstructed).
 * 5. A returned record is re-validated with the Task 24 public validator
 *    validateReceiverDecisionRecord() VERBATIM: exact key shape and order,
 *    schemaVersion, fixed decision value, blocked-field absence, and Task 20
 *    decisionInput validation. Malformed / tampered / binding-drift records
 *    fail closed with their existing codes propagating UNCHANGED. The record
 *    is never repaired, overwritten, truncated, deleted, rewritten, or
 *    normalized.
 * 6. The validated record's dispatchId must equal the requested dispatchId
 *    (direct binding re-check, defense in depth for caller-supplied stores);
 *    mismatch fails closed.
 *
 * The returned value is frozen, deterministic, and timestamp-free: the same
 * durable bytes + the same dispatchId always serialize identically in any
 * process under any clock skew. It remains semantically equivalent to
 * { schemaVersion, dispatchId, decision, decisionInput } with decisionInput
 * the EXACT Task 20 transport request inherited from Task 24.
 */
export async function readExecutorInvocationInput({ dispatchId, store } = {}) {
  // 1. dispatchId is validated first: invalid identities never touch the
  //    store and never invoke the reader (existing Task 26 code propagates).
  assertValidExecutorAcceptanceDispatchId(dispatchId);

  // 2. Caller-supplied durable store primitive only: exactly one required
  //    capability, no registry, no auto-detection, no transport.
  if (!store || typeof store.readExecutorDispatchAcceptance !== 'function') {
    fail(
      'this read entry requires a store exposing readExecutorDispatchAcceptance(dispatchId) (read-only composition; no other capability is required or consulted).',
      INVALID_EXECUTOR_INVOCATION_INPUT_STORE,
    );
  }

  // 3. dispatchId is the SOLE lookup key; exactly one invocation per call.
  const stored = await store.readExecutorDispatchAcceptance(dispatchId);

  // 4. Missing durable acceptance: read-failure meaning ONLY. No write, no
  //    auto-create, no acceptExecutorDispatchDecision(), no receiver-decision
  //    fallback, no task mutation.
  if (stored === null || stored === undefined) {
    fail(
      `no durable executor dispatch acceptance exists for ${dispatchId}; this is a read failure only, never a task status, invocation, transport, or delivery meaning.`,
      EXECUTOR_DISPATCH_ACCEPTANCE_NOT_FOUND,
    );
  }

  // 5. Task 24 validation is reused verbatim: existing Task 26/24/20/18/19
  //    codes propagate UNCHANGED; nothing is repaired or rewritten.
  const validated = validateReceiverDecisionRecord(stored);

  // 6. Direct key/binding re-check against the requested dispatchId.
  if (validated.dispatchId !== dispatchId) {
    fail(
      `executor acceptance record key/binding mismatch (fail-closed): looked up ${dispatchId} but the durable record carries ${validated.dispatchId}.`,
      CORRUPT_EXECUTOR_DISPATCH_ACCEPTANCE,
    );
  }

  // Exact validated Task 26 durable acceptance representation: frozen, no
  // wrapper metadata, no new generation, no ACK, no executor/scheduler state.
  return validated;
}
