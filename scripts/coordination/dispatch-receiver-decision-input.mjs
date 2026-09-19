// Bounded read-only owner: GREENHUB-COORDINATION-RECEIVER-DECISION-INPUT-23.
// Surface: scripts/coordination/*dispatch-receiver-decision-input* (this module)
// + composition of the existing public Task 22 primitive ONLY
//   store.readReceiverDispatchAcceptance(dispatchId)
//   and the existing public Task 20 validator validateTransportRequest(request).
// No store.mjs mutation. No Task 18/19/20/21/22 source or spec mutation.
//
// Contract summary:
//   readReceiverDecisionInput() != acknowledgeDispatch() != executeTask()
//     != dispatchNextTask() != acceptReceiverDispatch() != decideNextTask()
//     != selectWorker() != scheduleNextTask().
//   READABLE_RECEIVER_DECISION_INPUT != ACK != receipt != executor acceptance
//     != execution start != task status transition != scheduler decision
//     != worker selection != retry authority != delivery success.
//   read != accept != ACK != execute. This module makes NO execution decision:
//   it only exposes the canonical input a future receiver-side decision could
//   consume.
//   Entry is EXACTLY one path:
//     (dispatchId, store)
//       -> dispatchId identity validation        [Task 22 receiver-acceptance family]
//       -> store.readReceiverDispatchAcceptance(dispatchId)
//          [dispatchId is the ONLY lookup key; at most one reader invocation;
//           no polling, no re-read loop, no fallback lookup, no scan]
//       -> null/undefined: RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND
//          [receiver-read-native read failure ONLY]
//       -> validateTransportRequest(stored)      [Task 20 validated representation
//          is reused verbatim; no duplicated validator]
//       -> validated.dispatchId === dispatchId   [direct binding re-check]
//       -> frozen EXACT validated Task 20 request (no wrapper metadata).
//   The returned value is the durable record itself re-validated. No separate
//   wrapper is created and no receiver metadata is added: no acceptedAt/
//   receivedAt/decidedAt timestamp, no pid/hostname/random UUID, no ACK/
//   receipt, no executor/worker/scheduler state, no receiverGeneration/
//   acceptanceGeneration/decisionGeneration/executionGeneration, no
//   executionAllowed/decision flags. The Task 20 request shape
//   (schemaVersion, dispatchId, sourceTaskId, emissionSlot, admissionId,
//   nextTaskId, workerId, claimGeneration, task) is preserved byte-for-byte
//   in key order; claimGeneration stays the SOLE fencing generation, inherited
//   from the Task 20 request verbatim.
//   Missing acceptance is NOT a task status. It does not mean READY,
//   DISPATCHED, RETRY, resend required, worker unavailable, or ACK timeout.
//   It means exactly one read fact: no durable receiver acceptance exists for
//   this dispatchId. On a missing record this module performs no write, no
//   auto-accept, no Task 22 acceptance call, no retry scheduling, no ACK
//   creation, and no task mutation.
//   Corrupt / invalid / wrong-key durable records fail closed with no repair:
//   the module never overwrites, truncates, deletes, rewrites, or normalizes
//   a durable record in place.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   ACK protocol, ACK persistence, receipt persistence, sender notification,
//   executor selection, executor invocation, child_process / spawn / exec,
//   OpenCode invocation, Codex invocation, Astra invocation, ChatGPT
//   invocation, scheduler, queue scan, READY scan, polling, daemon, cron,
//   worker registry, capability matching, retry, resend, backoff, retry
//   counter, delivery counter, new generation authority (receiverGeneration /
//   acceptanceGeneration / decisionGeneration / executionGeneration), task
//   status mutation, claim mutation, claim extension/takeover, admission
//   mutation, emission mutation, dispatch-attempt mutation, result mutation,
//   concrete HTTP/WebSocket/MCP/stdin transport, any node:fs access.

import {
  assertValidReceiverAcceptanceDispatchId,
  CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
} from './dispatch-receiver-acceptance.mjs';
import { validateTransportRequest } from './dispatch-transport-contract.mjs';

// Receiver-read-native meanings ONLY. Missing durable acceptance gets its own
// read-failure code; corruption / invalid request / binding / fencing failures
// reuse the existing Task 22/20/18/19 codes verbatim.
export const RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND = 'RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND';
export const INVALID_RECEIVER_DECISION_INPUT_STORE = 'INVALID_RECEIVER_DECISION_INPUT_STORE';

export class ReceiverDecisionInputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ReceiverDecisionInputError';
    this.code = details.code ?? RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND;
  }
}

function fail(message, code = RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND) {
  throw new ReceiverDecisionInputError(message, { code });
}

/**
 * Read the canonical receiver decision input for ONE dispatchId from durable
 * receiver acceptance state. Read-only; the returned value is the EXACT
 * validated Task 20 transport request stored at
 * <coordination-home>/receiver-acceptances/<dispatchId>.json.
 *
 * Contract (fail-closed, no repair, no mutation):
 * 1. `dispatchId` must be a valid Task 19/22 identity (`dsp_<64 lowercase
 *    hex>`); otherwise the call fails closed BEFORE any store access or
 *    reader invocation (the Task 22 identity-family code propagates).
 * 2. `store` must expose readReceiverDispatchAcceptance(dispatchId); no other
 *    capability is required, consulted, or read (no task store, claim store,
 *    admission store, emission store, dispatch attempt store, result store,
 *    ACK store, worker registry, or scheduler state).
 * 3. The reader receives dispatchId ONLY (one argument) and is invoked AT MOST
 *    ONCE per call: no polling, no retry, no re-read loop, no fallback lookup,
 *    no directory scan, no newest-record scan.
 * 4. null / undefined from the reader means no durable receiver acceptance
 *    exists for this dispatchId: fail closed with
 *    RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND (a read failure only, never a task
 *    status, acceptance, ACK, or execution decision; no write is performed).
 * 5. A returned record is re-validated with Task 20 validateTransportRequest();
 *    malformed / terminal / not-claimed / binding-drift records fail closed
 *    with their existing codes propagating UNCHANGED. The record is never
 *    repaired, overwritten, truncated, deleted, rewritten, or normalized.
 * 6. The validated record's dispatchId must equal the requested dispatchId
 *    (direct binding re-check, defense in depth for caller-supplied stores);
 *    mismatch fails closed.
 *
 * The returned value is frozen, deterministic, and timestamp-free: the same
 * durable bytes + the same dispatchId always serialize identically in any
 * process under any clock skew.
 */
export async function readReceiverDecisionInput({ dispatchId, store } = {}) {
  // 1. dispatchId is validated first: invalid identities never touch the
  //    store and never invoke the reader (existing Task 22 code propagates).
  assertValidReceiverAcceptanceDispatchId(dispatchId);

  // 2. Caller-supplied durable store primitive only: exactly one required
  //    capability, no registry, no auto-detection, no transport.
  if (!store || typeof store.readReceiverDispatchAcceptance !== 'function') {
    fail(
      'receiver decision input requires a store exposing readReceiverDispatchAcceptance(dispatchId) (read-only composition; no other capability is required or consulted).',
      INVALID_RECEIVER_DECISION_INPUT_STORE,
    );
  }

  // 3. dispatchId is the SOLE lookup key; exactly one invocation per call.
  const stored = await store.readReceiverDispatchAcceptance(dispatchId);

  // 4. Missing durable acceptance: receiver-read-native read failure ONLY.
  if (stored === null || stored === undefined) {
    fail(
      `no durable receiver dispatch acceptance exists for ${dispatchId}; receiver-read-native failure only, not a task status and not a decision.`,
      RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND,
    );
  }

  // 5. Task 20 validation is reused verbatim: existing Task 20/18/19 codes
  //    propagate UNCHANGED; nothing is repaired or rewritten.
  const validated = validateTransportRequest(stored);

  // 6. Direct key/binding re-check against the requested dispatchId.
  if (validated.dispatchId !== dispatchId) {
    fail(
      `receiver decision input key/binding mismatch (fail-closed): looked up ${dispatchId} but the durable record carries ${validated.dispatchId}.`,
      CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
    );
  }

  // Exact validated Task 20 representation: frozen, no wrapper metadata, no
  // new generation, no ACK, no executor/scheduler state.
  return validated;
}
