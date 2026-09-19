// Bounded read-only owner: GREENHUB-COORDINATION-RECEIVER-EXECUTOR-ACCEPTANCE-INPUT-25.
// Surface: scripts/coordination/*dispatch-receiver-executor-acceptance-input*
// (this module) + composition of the existing public Task 24 primitives ONLY
//   store.readReceiverDispatchDecision(dispatchId)
//   validateReceiverDecisionRecord(record)
//   assertValidReceiverDecisionDispatchId(dispatchId)
// over the unchanged durable authority <coordination-home>/receiver-decisions/<dispatchId>.json.
// No store.mjs mutation. No Task 18~24 source or spec mutation.
//
// Contract summary:
//   readReceiverExecutorAcceptanceInput() != acknowledgeDispatch() != executeTask()
//     != dispatchNextTask() != acceptReceiverDispatch() != persistReceiverDecision()
//     != decideNextTask() != selectWorker() != scheduleNextTask().
//   READABLE_EXECUTOR_ACCEPTANCE_INPUT != executor acceptance != ACK != receipt
//     != executor invocation != execution start != task status transition
//     != scheduler decision != worker selection != retry/resend authority
//     != delivery success.
//   read != accept != ACK != execute. This module makes NO executor-acceptance
//   decision: it only exposes the canonical durable receiver decision a future
//   executor-acceptance stage could consume, without reconstructing Task 22/23/24
//   history.
//   Entry is EXACTLY one path:
//     (dispatchId, store)
//       -> dispatchId identity validation      [Task 24 receiver-decision family]
//       -> require store.readReceiverDispatchDecision ONLY
//       -> store.readReceiverDispatchDecision(dispatchId)
//          [dispatchId is the ONLY lookup key; at most one reader invocation;
//           no polling, no re-read loop, no fallback lookup, no scan]
//       -> null/undefined: RECEIVER_DISPATCH_DECISION_NOT_FOUND
//          [read failure ONLY: never READY/RETRY/REJECT, never executor or
//           worker availability, never ACK timeout, never delivery failure]
//       -> validateReceiverDecisionRecord(record)  [Task 24 public validator
//          verbatim: exact key shape/order, fixed decision value, Task 20
//          decisionInput validation with predecessor codes propagated
//          UNCHANGED; no duplicated validator]
//       -> validated.dispatchId === dispatchId     [direct binding re-check]
//       -> the EXACT frozen validated Task 24 durable decision record
//          (no wrapper metadata).
//   Missing input causes ZERO writes and ZERO task/claim/admission/emission/
//   dispatch-attempt/receiver-acceptance/receiver-decision/result mutation:
//   no Task 24 decision is auto-created and persistReceiverDecision() is never
//   called here.
//   Corrupt / wrong-shape / wrong-order / wrong-value / tampered-decisionInput
//   / mismatched-binding records fail closed with the existing Task 24/20/18/19
//   codes propagated UNCHANGED; nothing is repaired, normalized, overwritten,
//   deleted, recreated, or merged, and the exact durable bytes stay untouched.
//   No new durable artifact, directory, or JSON domain is created: the durable
//   authority remains the Task 24 record under
//   <coordination-home>/receiver-decisions/<dispatchId>.json.
//   The returned value is frozen, deterministic, and timestamp-free: no
//   Date.now / new Date / performance.now / pid / hostname / random UUID /
//   mtime / ctime participates. claimGeneration remains the SOLE fencing
//   generation, inherited verbatim inside decisionInput.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   executor acceptance persistence, executor ACK, receiver ACK, sender ACK,
//   receipt, executor registration/selection, worker registry, capability
//   matching, executor invocation, child_process / spawn / exec, OpenCode /
//   Codex / Astra / ChatGPT invocation, HTTP / WebSocket / MCP / stdin-stdout
//   transport, scheduler, queue, READY scan, polling, daemon, cron, retry,
//   resend, backoff, retry counter, delivery counter, task status mutation,
//   claim mutation/lease extension/takeover, admission mutation, emission
//   mutation, dispatch-attempt mutation, receiver-acceptance mutation,
//   receiver-decision mutation, result/disposition mutation, any new
//   generation authority (executorGeneration / executionGeneration /
//   receiverGeneration / acceptanceGeneration / decisionGeneration /
//   deliveryGeneration / retryGeneration), executionAllowed /
//   acceptedByExecutor / executorAccepted / executionStarted flags, any
//   node:fs access.

import {
  assertValidReceiverDecisionDispatchId,
  CORRUPT_RECEIVER_DISPATCH_DECISION,
  validateReceiverDecisionRecord,
} from './dispatch-receiver-decision.mjs';

// Executor-acceptance-input-native meanings ONLY. Missing durable receiver
// decision gets its own read-failure code; corruption / invalid record /
// binding failures reuse the existing Task 24/20/18/19 codes verbatim.
export const RECEIVER_DISPATCH_DECISION_NOT_FOUND = 'RECEIVER_DISPATCH_DECISION_NOT_FOUND';
export const INVALID_RECEIVER_EXECUTOR_ACCEPTANCE_INPUT_STORE =
  'INVALID_RECEIVER_EXECUTOR_ACCEPTANCE_INPUT_STORE';

export class ReceiverExecutorAcceptanceInputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ReceiverExecutorAcceptanceInputError';
    this.code = details.code ?? RECEIVER_DISPATCH_DECISION_NOT_FOUND;
  }
}

function fail(message, code = RECEIVER_DISPATCH_DECISION_NOT_FOUND) {
  throw new ReceiverExecutorAcceptanceInputError(message, { code });
}

/**
 * Read the canonical executor-acceptance input for ONE dispatchId: the EXACT
 * validated frozen Task 24 durable receiver decision stored at
 * <coordination-home>/receiver-decisions/<dispatchId>.json.
 *
 * Contract (fail-closed, no repair, no mutation):
 * 1. `dispatchId` must be a valid Task 19/22/24 identity (`dsp_<64 lowercase
 *    hex>`); otherwise the call fails closed BEFORE any store access or reader
 *    invocation (the Task 24 identity-family code propagates).
 * 2. `store` must expose readReceiverDispatchDecision(dispatchId); no other
 *    capability is required, consulted, or read (no task store, claim store,
 *    admission store, emission store, dispatch attempt store, receiver
 *    acceptance store, result store, ACK store, worker registry, or scheduler
 *    state).
 * 3. The reader receives dispatchId ONLY (one argument) and is invoked AT MOST
 *    ONCE per call: no polling, no retry, no re-read loop, no fallback lookup,
 *    no second read after success, no directory scan, no newest-record scan.
 * 4. null / undefined from the reader means no durable receiver decision
 *    exists for this dispatchId: fail closed with
 *    RECEIVER_DISPATCH_DECISION_NOT_FOUND (a read failure only, never a task
 *    status, acceptance, ACK, executor availability, retry, or delivery
 *    decision; no write is performed and no decision is auto-created).
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
export async function readReceiverExecutorAcceptanceInput({ dispatchId, store } = {}) {
  // 1. dispatchId is validated first: invalid identities never touch the
  //    store and never invoke the reader (existing Task 24 code propagates).
  assertValidReceiverDecisionDispatchId(dispatchId);

  // 2. Caller-supplied durable store primitive only: exactly one required
  //    capability, no registry, no auto-detection, no transport.
  if (!store || typeof store.readReceiverDispatchDecision !== 'function') {
    fail(
      'this read entry requires a store exposing readReceiverDispatchDecision(dispatchId) (read-only composition; no other capability is required or consulted).',
      INVALID_RECEIVER_EXECUTOR_ACCEPTANCE_INPUT_STORE,
    );
  }

  // 3. dispatchId is the SOLE lookup key; exactly one invocation per call.
  const stored = await store.readReceiverDispatchDecision(dispatchId);

  // 4. Missing durable decision: read-failure meaning ONLY. No write, no
  //    auto-create, no persistReceiverDecision(), no task mutation.
  if (stored === null || stored === undefined) {
    fail(
      `no durable receiver dispatch decision exists for ${dispatchId}; this is a read failure only, never a task status, acceptance, or delivery meaning.`,
      RECEIVER_DISPATCH_DECISION_NOT_FOUND,
    );
  }

  // 5. Task 24 validation is reused verbatim: existing Task 24/20/18/19 codes
  //    propagate UNCHANGED; nothing is repaired or rewritten.
  const validated = validateReceiverDecisionRecord(stored);

  // 6. Direct key/binding re-check against the requested dispatchId.
  if (validated.dispatchId !== dispatchId) {
    fail(
      `receiver decision record key/binding mismatch (fail-closed): looked up ${dispatchId} but the durable record carries ${validated.dispatchId}.`,
      CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
  }

  // Exact validated Task 24 durable decision representation: frozen, no
  // wrapper metadata, no new generation, no ACK, no executor/scheduler state.
  return validated;
}
