// Bounded read+durable-acceptance owner: GREENHUB-COORDINATION-DURABLE-RECEIVER-ACCEPTANCE-22.
// Surface: scripts/coordination/*dispatch-receiver-acceptance* (this module)
// + the durable receiver-acceptance store primitive ONLY
// (readReceiverDispatchAcceptance / createReceiverDispatchAcceptance over
// <coordination-home>/receiver-acceptances/<dispatchId>.json).
// Task 20 validateTransportRequest and Task 21 readReceiverDispatchAcceptance
// are composed verbatim; their semantic contracts/sources are never modified.
//
// Contract summary:
//   acceptReceiverDispatch() != acknowledgeDispatch() != executeTask()
//     != dispatchNextTask() != deliverResult() != recordDelivery().
//   RECEIVER ACCEPTANCE != ACK != sender acknowledgment != executor acceptance
//     != execution start != task status transition != retry authority
//     != delivery success. read != accept != ACK != execute.
//   accept entry is EXACTLY one path:
//     EXACT validated Task 20 transport request
//       -> Task 21 readReceiverDispatchAcceptance with a dispatchId-only reader
//       -> already observed exact request: idempotent replay, no write
//       -> unseen: OS exclusive-create of the EXACT request under
//          <home>/receiver-acceptances/<dispatchId>.json
//       -> durable read-back verification of the stored request
//       -> exclusive-create race loser: immediate winner re-read, then
//          same request = replay / different valid request = conflict /
//          corrupt winner = fail closed (never overwrite).
//   LOOKUP KEY = dispatchId ONLY. sourceTaskId / workerId / taskId /
//   admissionId / claim are never lookup keys on the receiver side.
//   The durable value is the EXACT validated Task 20 request itself: no
//   wrapper metadata, no acceptedAt/receivedAt/createdAt/updatedAt/timestamp,
//   no pid/hostname/random UUID, no endpoint/adapter, no ACK metadata, no
//   receiverGeneration/acceptanceGeneration/deliveryGeneration/retryGeneration.
//   claimGeneration stays the SOLE fencing generation (inherited from the
//   Task 20 request verbatim).
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   ACK protocol, ACK persistence, receiver ACK file, dispatch receipt sent
//   back to sender, executor selection, executor invocation, OpenCode/Codex/
//   Astra/ChatGPT invocation, child_process, spawn, exec, scheduler, READY
//   scan, queue scan, polling, daemon, cron, worker registry, worker
//   selection, capability matching, retry, backoff, resend, retry counter,
//   delivery counter, new generation authority (receiverGeneration /
//   acceptanceGeneration / deliveryGeneration), task status mutation,
//   claim mutation/extension/takeover, admission mutation, emission mutation,
//   dispatch-attempt mutation, result mutation, concrete HTTP/WebSocket/MCP/
//   stdin transport.

import nodePath from 'node:path';
import { DISPATCH_ATTEMPT_ID_PATTERN } from './dispatch-attempt.mjs';
import {
  readReceiverDispatchAcceptance as observeReceiverDispatchAcceptance,
  RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
} from './dispatch-receiver-idempotency-read.mjs';
import { validateTransportRequest } from './dispatch-transport-contract.mjs';

export const RECEIVER_ACCEPTANCES_DIRNAME = 'receiver-acceptances';

// Minimal immutable result shapes. dispatchId is the validated incoming
// transport identity; newlyAccepted / exactReplay are receiver-local outcomes
// only, never durable state and never a task lifecycle status.
export const RECEIVER_ACCEPTANCE_NEW_FIELDS = Object.freeze(['dispatchId', 'newlyAccepted']);
export const RECEIVER_ACCEPTANCE_REPLAY_FIELDS = Object.freeze([
  'dispatchId',
  'newlyAccepted',
  'exactReplay',
]);

// Receiver-acceptance-native meanings ONLY. Incoming request corruption /
// binding / fencing failures reuse the existing Task 20/18/19 codes verbatim;
// the same-key different-request meaning reuses the Task 21 conflict code
// verbatim; there is no receiver-specific status, ACK, persistence, retry, or
// generation authority.
export const CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE = 'CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE';
export const INVALID_RECEIVER_ACCEPTANCE_STORE = 'INVALID_RECEIVER_ACCEPTANCE_STORE';

export class DispatchReceiverAcceptanceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DispatchReceiverAcceptanceError';
    this.code = details.code ?? CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE;
  }
}

function fail(message, code = CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE) {
  throw new DispatchReceiverAcceptanceError(message, { code });
}

export function assertValidReceiverAcceptanceDispatchId(dispatchId) {
  if (typeof dispatchId !== 'string' || !DISPATCH_ATTEMPT_ID_PATTERN.test(dispatchId)) {
    fail(
      'dispatchId must be `dsp_<64 lowercase hex>` (Task 19 dispatch identity family).',
      CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
    );
  }
  return dispatchId;
}

export function receiverDispatchAcceptanceRef(dispatchId) {
  assertValidReceiverAcceptanceDispatchId(dispatchId);
  return `receiver-acceptance:${dispatchId}`;
}

export function receiverDispatchAcceptanceFileName(dispatchId) {
  assertValidReceiverAcceptanceDispatchId(dispatchId);
  return `${dispatchId}.json`;
}

/**
 * Durable path for one immutable receiver acceptance record.
 * `<home>/receiver-acceptances/<dispatchId>.json` (dispatchId-keyed ONLY).
 * `home` is a durable coordination home, never the repository worktree.
 */
export function receiverDispatchAcceptanceFilePath(home, dispatchId) {
  if (typeof home !== 'string' || !home.trim()) {
    fail(
      'coordination home must be a non-empty directory path.',
      CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
    );
  }
  assertValidReceiverAcceptanceDispatchId(dispatchId);
  return nodePath.join(
    home,
    RECEIVER_ACCEPTANCES_DIRNAME,
    receiverDispatchAcceptanceFileName(dispatchId),
  );
}

/**
 * Accept ONE EXACT validated Task 20 transport request into durable
 * dispatchId-keyed receiver state.
 *
 * Contract (fail-closed, no repair, no overwrite):
 * 1. `request` must pass Task 20 validateTransportRequest(); malformed /
 *    terminal / not-claimed / binding-mismatch inputs fail before any
 *    durable read, write, or reader invocation (their existing codes
 *    propagate UNCHANGED).
 * 2. `store` must expose the durable receiver-acceptance primitives
 *    readReceiverDispatchAcceptance(dispatchId) and
 *    createReceiverDispatchAcceptance(request); otherwise
 *    INVALID_RECEIVER_ACCEPTANCE_STORE and nothing is persisted.
 * 3. The Task 21 read semantics are used verbatim with a dispatchId-only
 *    reader: an already observed exact request is an idempotent replay
 *    (no file rewrite, no byte change, no new generation, no ACK, no
 *    executor call), and same-key different request fails closed with
 *    RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT.
 * 4. Unseen: the exact validated request is exclusive-created under its
 *    dispatchId. The OS-level exclusive-create primitive (never
 *    exists()->write()) serializes concurrent accepters: exactly one wins.
 * 5. Exclusive-create race loser: the winner is re-read immediately.
 *    Exact same request -> idempotent replay success; same dispatchId +
 *    different valid request -> RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT;
 *    malformed/corrupt winner -> fail closed. The winner is never
 *    overwritten.
 * 6. After the first create, a durable read-back verifies that the stored
 *    value is the exact validated request.
 *
 * The result is frozen, deterministic, and timestamp-free: the same request
 * and the same durable state always serialize identically in any process
 * under any clock skew.
 */
export async function acceptReceiverDispatch({ request, store } = {}) {
  // 1. Incoming request is mandatory and must be an EXACT valid Task 20
  //    request. All existing Task 20/18/19 codes propagate unchanged.
  const incoming = validateTransportRequest(request);

  // 2. Caller-supplied durable store primitives only: no registry, no
  //    auto-detection, no transport.
  if (
    !store ||
    typeof store.readReceiverDispatchAcceptance !== 'function' ||
    typeof store.createReceiverDispatchAcceptance !== 'function'
  ) {
    fail(
      'receiver acceptance requires a store exposing readReceiverDispatchAcceptance / createReceiverDispatchAcceptance (composition only; no registry, no auto-detection).',
      INVALID_RECEIVER_ACCEPTANCE_STORE,
    );
  }

  const dispatchId = incoming.dispatchId;

  // 3. Task 21 read semantics verbatim. The reader receives dispatchId ONLY;
  //    the whole request is never handed to the store reader.
  const observation = await observeReceiverDispatchAcceptance({
    request: incoming,
    reader: (key) => store.readReceiverDispatchAcceptance(key),
  });
  if (observation.previouslyObserved) {
    // Exact replay: the durable record is left byte-identical.
    return Object.freeze({ dispatchId, newlyAccepted: false, exactReplay: true });
  }

  // 4. Unseen: exclusive-create the EXACT validated request.
  const outcome = store.createReceiverDispatchAcceptance(incoming);
  if (outcome && outcome.created === true) {
    // 6. Durable read-back: the stored value must be the exact request.
    const stored = store.readReceiverDispatchAcceptance(dispatchId);
    if (
      stored === null ||
      stored === undefined ||
      JSON.stringify(stored) !== JSON.stringify(incoming)
    ) {
      fail(
        `receiver acceptance failed durable read-back after exclusive create (fail-closed): ${dispatchId}`,
        CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
      );
    }
    return Object.freeze({ dispatchId, newlyAccepted: true });
  }

  // 5. Exclusive-create race loser: re-read the winner immediately.
  const winner = store.readReceiverDispatchAcceptance(dispatchId);
  if (winner === null || winner === undefined) {
    fail(
      `receiver acceptance race could not be resolved deterministically (fail-closed): ${dispatchId}`,
      CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
    );
  }
  if (JSON.stringify(winner) !== JSON.stringify(incoming)) {
    fail(
      `receiver acceptance conflict (fail-closed): dispatchId ${dispatchId} was already durably accepted with a different transport request; never overwrite or prefer the incoming request.`,
      RECEIVER_DISPATCH_IDEMPOTENCY_CONFLICT,
    );
  }
  return Object.freeze({ dispatchId, newlyAccepted: false, exactReplay: true });
}
