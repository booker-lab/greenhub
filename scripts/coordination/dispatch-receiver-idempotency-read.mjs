// Bounded read-only owner: GREENHUB-COORDINATION-RECEIVER-IDEMPOTENCY-ACCEPTANCE-READ-CONTRACT-21.
// Surface: scripts/coordination/*dispatch-receiver-idempotency-read* (this module)
// + composition of the existing Task 20 public validateTransportRequest ONLY.
// No store.mjs mutation. No Task 18/19/20 source mutation.
//
// Contract summary:
//   readReceiverDispatchAcceptance() != acceptDispatch() != acknowledgeDispatch()
//     != persistAcceptedDispatch() != dispatchNextTask() != executeTask().
//   read != accept != ACK != persist != dispatch != execute.
//   A receiver that holds a valid Task 20 transport request asks exactly one
//   question: "for this dispatchId, have we already observed an accepted request,
//   is it the exact same request, or is a different request bound to the same
//   dispatchId?"
//   The receiver supplies a caller-supplied reader function. The ONLY lookup key
//   is the validated transport request's dispatchId: the whole request is never
//   handed to the reader. The reader is invoked at most once per call. There is
//   no registry, no auto-detection, no endpoint discovery, no adapter selection.
//   The read result is a minimal immutable observation
//     { dispatchId, previouslyObserved: false }
//   or
//     { dispatchId, previouslyObserved: true, exactReplay: true }
//   and is NEVER a task status (no DISPATCHED/ACCEPTED/EXECUTING machine). A
//   validated Task 20 request is mandatory: there is no entry that decides from
//   a claim, taskId, workerId, admissionId, or dispatch envelope alone.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   receiver persistence (receiver-attempt.json, receiver-ack.json,
//   acceptance.json, dispatch-receipt.json), ACK protocol, ACK persistence,
//   acknowledgeDispatch, ackDispatch, accepted persistence, receiver acceptance
//   writer, writeAcceptedDispatch, persistAcceptedDispatch, DISPATCHED status,
//   EXECUTOR_ACCEPTED status, ACCEPTED/RECEIVED/EXECUTING status, any new task
//   status, retry, resend, backoff, retry counter, retry policy,
//   transportGeneration, sendGeneration, attemptGeneration, retryGeneration,
//   deliveryGeneration, receiverGeneration, acceptanceGeneration, any new
//   fencing generation, scheduler, READY scan, queue scan, polling, daemon,
//   cron, worker selection, worker registry, capability matching, adapter
//   selection, HTTP, WebSocket, MCP, stdin/stdout concrete protocol, fetch,
//   grpc, mqtt, child_process, spawn, exec, OpenCode/Codex/Astra/ChatGPT
//   invocation, executor invocation, task/claim/admission/emission/result
//   mutation.

import { validateTransportRequest } from './dispatch-transport-contract.mjs';

// Minimal immutable read-result shapes. dispatchId is the validated incoming
// transport identity; previouslyObserved / exactReplay are read observations
// only, never durable state and never a task lifecycle status.
export const RECEIVER_READ_UNSEEN_FIELDS = Object.freeze(['dispatchId', 'previouslyObserved']);
export const RECEIVER_READ_REPLAY_FIELDS = Object.freeze([
  'dispatchId',
  'previouslyObserved',
  'exactReplay',
]);

// Receiver-read-native meanings ONLY. Task 20 request corruption/binding/
// fencing failures reuse the existing Task 20/18/19 codes verbatim; there is no
// receiver-specific status, ACK, persistence, retry, or generation authority.
export const INVALID_RECEIVER_ACCEPTANCE_READER = 'INVALID_RECEIVER_ACCEPTANCE_READER';
export const RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT = 'RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT';

export class DispatchReceiverIdempotencyReadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DispatchReceiverIdempotencyReadError';
    this.code = details.code ?? INVALID_RECEIVER_ACCEPTANCE_READER;
  }
}

function fail(message, code = INVALID_RECEIVER_ACCEPTANCE_READER) {
  throw new DispatchReceiverIdempotencyReadError(message, { code });
}

/**
 * Read-only receiver idempotency-acceptance observation for ONE validated
 * Task 20 transport request.
 *
 * Contract (fail-closed, no repair, no mutation):
 * 1. `request` must pass Task 20 validateTransportRequest(); malformed/terminal/
 *    not-claimed inputs fail before any reader call (their existing codes
 *    propagate UNCHANGED).
 * 2. `reader` must be a caller-supplied function; otherwise
 *    INVALID_RECEIVER_ACCEPTANCE_READER and the reader is never called.
 * 3. The reader receives ONLY request.dispatchId as the lookup identity.
 * 4. The reader is invoked AT MOST ONCE per call (no loop, no internal retry).
 * 5. null / undefined means the receiver has not observed a previous accepted
 *    request for this dispatchId. That is a READ observation only: it does NOT
 *    auto-approve, accept, ACK, persist, dispatch, or execute anything.
 * 6. A returned request is re-validated with Task 20 validation; its
 *    dispatchId must equal the lookup key, and it must be byte/semantic
 *    equivalent to the incoming request.
 * 7. same dispatchId + exact same request -> frozen idempotent exact-replay
 *    observation (no ACK, no accepted state, no task status, no executor call).
 * 8. same dispatchId + different valid request -> fail closed with
 *    RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT (never overwrite, never prefer the
 *    incoming request).
 * 9. reader throw/reject propagates unchanged with zero retry and zero durable
 *    side effect.
 *
 * The same request + the same reader result always serializes identically in
 * any process under any clock skew: no timestamp, pid, hostname, random UUID,
 * endpoint, ACK metadata, or new generation participates.
 */
export async function readReceiverDispatchAcceptance({ request, reader } = {}) {
  // 1. Incoming request is mandatory and must be a valid Task 20 request.
  const incoming = validateTransportRequest(request);

  // 2. Caller-supplied reader only: no registry, no auto-detection.
  if (typeof reader !== 'function') {
    fail(
      'receiver acceptance reader must be a caller-supplied function (no registry, no auto-detection, no adapter selection).',
      INVALID_RECEIVER_ACCEPTANCE_READER,
    );
  }

  // 3-4. dispatchId is the SOLE lookup key; exactly one invocation.
  const dispatchId = incoming.dispatchId;
  const observed = await reader(dispatchId);

  // 5. Unseen key: a read observation only, never an acceptance decision.
  if (observed === null || observed === undefined) {
    return Object.freeze({ dispatchId, previouslyObserved: false });
  }

  // 6. The observed value must itself be a valid Task 20 request bound to the
  //    same lookup key. Corruption/binding codes propagate UNCHANGED.
  const observedRequest = validateTransportRequest(observed);
  if (observedRequest.dispatchId !== dispatchId) {
    fail(
      `receiver idempotency read key mismatch (fail-closed): looked up ${dispatchId} but reader returned ${observedRequest.dispatchId}.`,
      RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
  }

  // 7-8. Exact deterministic equivalence is byte-level over the validated
  //      canonical serialization. A different valid request under the same
  //      dispatchId fails closed; the incoming request is never preferred.
  if (JSON.stringify(observedRequest) !== JSON.stringify(incoming)) {
    fail(
      `receiver idempotency conflict (fail-closed): dispatchId ${dispatchId} was already observed with a different transport request; never overwrite or prefer the incoming request.`,
      RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
  }
  return Object.freeze({ dispatchId, previouslyObserved: true, exactReplay: true });
}
