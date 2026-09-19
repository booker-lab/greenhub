// Bounded read+durable-decision owner: GREENHUB-COORDINATION-DURABLE-RECEIVER-DECISION-24.
// Surface: scripts/coordination/*dispatch-receiver-decision* (this module)
// + the durable receiver-decision store primitive ONLY
// (readReceiverDispatchDecision / createReceiverDispatchDecision over
// <coordination-home>/receiver-decisions/<dispatchId>.json).
// Task 23 readReceiverDecisionInput is composed verbatim; Task 18~23
// source/spec semantics are never modified or duplicated.
//
// Contract summary:
//   persistReceiverDecision() != acknowledgeDispatch() != executeTask()
//     != acceptReceiverDispatch() != dispatchNextTask() != scheduleNextTask()
//     != decideNextTask() != selectWorker().
//   DURABLE_RECEIVER_DECISION != ACK != receipt != sender acknowledgment
//     != executor acceptance != execution start != task status transition
//     != scheduler decision != worker selection != retry authority
//     != delivery success.
//   Decision entry is EXACTLY one path:
//     (dispatchId, store)
//       -> store capability gate (exactly three durable primitives)
//       -> readReceiverDecisionInput({ dispatchId, store })  [Task 23 verbatim:
//          dispatchId identity validation, durable receiver-acceptance read,
//          Task 20 validateTransportRequest, direct dispatchId binding
//          re-check; missing/corrupt input fails closed with predecessor
//          codes propagated UNCHANGED, zero writes, zero auto-repair]
//       -> buildReceiverDecisionRecord(input)  [deterministic, timestamp-free,
//          derived from the EXACT validated input ONLY; callers cannot inject
//          an arbitrary decision]
//       -> existing durable decision: exact serialized replay or fail-closed
//          conflict (first winner preserved; never overwrite/merge/repair)
//       -> unseen: OS exclusive-create of the EXACT record under
//          <home>/receiver-decisions/<dispatchId>.json
//       -> durable read-back verification of the exact record
//       -> exclusive-create race loser: immediate winner re-read, then
//          same record = idempotent replay / different valid record =
//          conflict / corrupt winner = fail closed (never overwrite).
//   LOOKUP KEY = dispatchId ONLY. sourceTaskId / taskId / workerId /
//   admissionId / emissionSlot / claimToken / claimGeneration are never
//   lookup keys.
//   The durable record is
//     { schemaVersion, dispatchId, decision, decisionInput } where
//   decisionInput is the EXACT frozen validated Task 20 transport request
//   returned by Task 23. No timestamps (decidedAt/createdAt/updatedAt/
//   acceptedAt/receivedAt), no pid/hostname/random UUID, no ACK/receipt/
//   sender or executor acknowledgment, no scheduler/worker-selection state,
//   no transport metadata, no new generation/fencing counter: claimGeneration
//   stays the SOLE fencing generation, inherited verbatim inside decisionInput.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   ACK protocol, ACK persistence, receipt persistence, sender notification,
//   sender acknowledgment, executor acceptance, executor selection, executor
//   invocation, OpenCode/Codex/Astra/ChatGPT invocation, child_process /
//   spawn / exec, fetch, WebSocket, MCP concrete transport, stdin/stdout
//   transport, scheduler, scheduleNextTask, queue scan, READY scan, polling,
//   daemon, cron, worker registry, worker selection, capability matching,
//   retry, resend, backoff, retry counter, delivery counter, any new
//   generation authority (receiverGeneration / receiverDecisionGeneration /
//   decisionGeneration / acceptanceGeneration / executionGeneration),
//   executionAllowed flags, task status mutation, claim mutation/extension/
//   takeover, admission mutation, emission mutation, dispatch-attempt
//   mutation, receiver-acceptance mutation, result mutation, any node:fs
//   access.

import nodePath from 'node:path';
import { assertValidReceiverAcceptanceDispatchId } from './dispatch-receiver-acceptance.mjs';
import { readReceiverDecisionInput } from './dispatch-receiver-decision-input.mjs';
import { validateTransportRequest } from './dispatch-transport-contract.mjs';

export const RECEIVER_DECISION_SCHEMA_VERSION = '1';

export const RECEIVER_DECISIONS_DIRNAME = 'receiver-decisions';

// The single explicit decision meaning: this receiver passed its decision
// boundary for the exact durable accepted transport request. It is NOT an
// ACK, NOT a receipt, NOT executor acceptance, NOT execution authorization.
export const RECEIVER_DECISION_VALUE = 'RECEIVER_DECISION_BOUNDARY_PASSED';

// Fixed canonical key order for the durable record. decisionInput is the
// EXACT frozen validated Task 20 transport request returned by Task 23.
export const RECEIVER_DECISION_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'dispatchId',
  'decision',
  'decisionInput',
]);

// Fields that must never appear in a durable receiver-decision record input
// or record. They indicate generation/retry/ACK/executor/scheduler/clock/
// process smuggling. claimGeneration is inside decisionInput and stays the
// SOLE fencing generation.
export const BLOCKED_RECEIVER_DECISION_FIELDS = Object.freeze([
  'decidedAt',
  'decisionAt',
  'decisionTimestamp',
  'decisionGeneration',
  'receiverDecisionGeneration',
  'receiverGeneration',
  'acceptanceGeneration',
  'executionGeneration',
  'deliveryGeneration',
  'dispatchGeneration',
  'transportGeneration',
  'sendGeneration',
  'attemptGeneration',
  'retryGeneration',
  'generation',
  'createdAt',
  'updatedAt',
  'acceptedAt',
  'receivedAt',
  'persistedAt',
  'timestamp',
  'wallClock',
  'clock',
  'mtime',
  'ctime',
  'pid',
  'hostname',
  'random',
  'uuid',
  'retry',
  'retryCount',
  'backoff',
  'resend',
  'resendCount',
  'attemptNumber',
  'attemptSequence',
  'ack',
  'ackId',
  'ackedAt',
  'acknowledgedAt',
  'receipt',
  'receiptId',
  'senderAcknowledgment',
  'executor',
  'executorId',
  'executorAcceptance',
  'executionAllowed',
  'executionStarted',
  'scheduler',
  'schedule',
  'scheduleNextTask',
  'queue',
  'polling',
  'daemon',
  'cron',
  'workerRegistry',
  'selectWorker',
  'workerSelection',
  'capabilityMatch',
  'transport',
  'endpoint',
  'adapter',
  'adapters',
  'sent',
  'dispatched',
  'status',
  'taskStatus',
]);

// Minimal immutable result shapes. dispatchId is the incoming decision
// identity; newlyDecided / exactReplay are receiver-local outcomes only,
// never durable state and never a task lifecycle status.
export const RECEIVER_DECISION_NEW_FIELDS = Object.freeze(['dispatchId', 'newlyDecided']);
export const RECEIVER_DECISION_REPLAY_FIELDS = Object.freeze([
  'dispatchId',
  'newlyDecided',
  'exactReplay',
]);

// Receiver-decision-native meanings ONLY. Missing/corrupt Task 23 input reuses
// the existing Task 23/22/20/18/19 codes verbatim; there is no receiver-
// decision-specific ACK, persistence fallback, retry, or generation authority.
export const CORRUPT_RECEIVER_DISPATCH_DECISION = 'CORRUPT_RECEIVER_DISPATCH_DECISION';
export const RECEIVER_DECISION_CONFLICT = 'RECEIVER_DECISION_CONFLICT';
export const INVALID_RECEIVER_DECISION_STORE = 'INVALID_RECEIVER_DECISION_STORE';

export class ReceiverDecisionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ReceiverDecisionError';
    this.code = details.code ?? CORRUPT_RECEIVER_DISPATCH_DECISION;
  }
}

function fail(message, code = CORRUPT_RECEIVER_DISPATCH_DECISION) {
  throw new ReceiverDecisionError(message, { code });
}

export function assertValidReceiverDecisionDispatchId(dispatchId) {
  try {
    assertValidReceiverAcceptanceDispatchId(dispatchId);
  } catch (error) {
    fail(error.message, CORRUPT_RECEIVER_DISPATCH_DECISION);
  }
  return dispatchId;
}

export function receiverDecisionFileName(dispatchId) {
  assertValidReceiverDecisionDispatchId(dispatchId);
  return `${dispatchId}.json`;
}

/**
 * Durable path for one immutable receiver decision record.
 * `<home>/receiver-decisions/<dispatchId>.json` (dispatchId-keyed ONLY).
 * `home` is a durable coordination home, never the repository worktree.
 */
export function receiverDispatchDecisionFilePath(home, dispatchId) {
  if (typeof home !== 'string' || !home.trim()) {
    fail(
      'coordination home must be a non-empty directory path.',
      CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
  }
  assertValidReceiverDecisionDispatchId(dispatchId);
  return nodePath.join(home, RECEIVER_DECISIONS_DIRNAME, receiverDecisionFileName(dispatchId));
}

function assertNoBlockedDecisionFields(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const field of BLOCKED_RECEIVER_DECISION_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not contain "${field}": the durable receiver decision carries (schemaVersion, dispatchId, decision, decisionInput) ONLY; no additional durable authority is created here.`,
        CORRUPT_RECEIVER_DISPATCH_DECISION,
      );
    }
  }
}

/**
 * Build the canonical durable receiver decision record from the EXACT
 * validated Task 23 decision input. Deterministic, frozen, timestamp-free:
 * the same validated input always serializes identically in any process under
 * any clock skew. The decision value is fixed; no caller-supplied decision
 * payload participates.
 */
export function buildReceiverDecisionRecord(input) {
  // Task 20/18/19 codes propagate UNCHANGED: the builder never remaps a
  // predecessor validation meaning.
  const decisionInput = validateTransportRequest(input);
  const record = {
    schemaVersion: RECEIVER_DECISION_SCHEMA_VERSION,
    dispatchId: decisionInput.dispatchId,
    decision: RECEIVER_DECISION_VALUE,
    decisionInput,
  };
  return validateReceiverDecisionRecord(record);
}

/**
 * Validate a durable receiver decision record. Returns a frozen canonical
 * copy. Fail-closed, no repair:
 * 1. exact key shape (no extra, no missing, fixed order),
 * 2. schemaVersion / dispatchId identity / fixed decision value,
 * 3. decisionInput must pass Task 20 validateTransportRequest and carry the
 *    same dispatchId as the record (direct binding re-check),
 * 4. no blocked smuggling fields.
 */
export function validateReceiverDecisionRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('receiver decision record must be an object.', CORRUPT_RECEIVER_DISPATCH_DECISION);
  }
  assertNoBlockedDecisionFields(record, 'receiver decision record');
  const keys = Object.keys(record);
  if (keys.length !== RECEIVER_DECISION_RECORD_FIELDS.length) {
    fail(
      `receiver decision record must carry exactly ${RECEIVER_DECISION_RECORD_FIELDS.length} fields (${RECEIVER_DECISION_RECORD_FIELDS.join(', ')}).`,
      CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
  }
  for (let index = 0; index < RECEIVER_DECISION_RECORD_FIELDS.length; index += 1) {
    if (keys[index] !== RECEIVER_DECISION_RECORD_FIELDS[index]) {
      fail(
        `receiver decision record key order/shape mismatch at position ${index}: expected "${RECEIVER_DECISION_RECORD_FIELDS[index]}" got "${keys[index]}".`,
        CORRUPT_RECEIVER_DISPATCH_DECISION,
      );
    }
  }
  if (record.schemaVersion !== RECEIVER_DECISION_SCHEMA_VERSION) {
    fail(
      `receiver decision schemaVersion must be ${JSON.stringify(RECEIVER_DECISION_SCHEMA_VERSION)}.`,
      CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
  }
  assertValidReceiverDecisionDispatchId(record.dispatchId);
  if (record.decision !== RECEIVER_DECISION_VALUE) {
    fail(
      `receiver decision value must be exactly ${JSON.stringify(RECEIVER_DECISION_VALUE)}.`,
      CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
  }
  // Task 20/18/19 validation codes propagate UNCHANGED (same fail-closed
  // family as the durable receiver-acceptance read).
  const decisionInput = validateTransportRequest(record.decisionInput);
  if (decisionInput.dispatchId !== record.dispatchId) {
    fail(
      `receiver decision record binding mismatch (fail-closed): dispatchId ${record.dispatchId} carries decisionInput bound to ${decisionInput.dispatchId}.`,
      CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
  }
  return Object.freeze({
    schemaVersion: RECEIVER_DECISION_SCHEMA_VERSION,
    dispatchId: record.dispatchId,
    decision: RECEIVER_DECISION_VALUE,
    decisionInput,
  });
}

function assertStoredDecisionBinding(record, dispatchId) {
  if (record.dispatchId !== dispatchId) {
    fail(
      `receiver decision store key/binding mismatch (fail-closed): looked up ${dispatchId} but the store returned ${record.dispatchId}.`,
      CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
  }
}

/**
 * Persist ONE immutable durable receiver decision for one dispatchId.
 *
 * Contract (fail-closed, no repair, no overwrite):
 * 1. `store` must expose readReceiverDispatchAcceptance(dispatchId) (Task 23
 *    requirement), readReceiverDispatchDecision(dispatchId), and
 *    createReceiverDispatchDecision(record); otherwise
 *    INVALID_RECEIVER_DECISION_STORE and nothing is read or persisted.
 * 2. The decision input is the EXACT Task 23 readReceiverDecisionInput result:
 *    missing durable acceptance -> RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND;
 *    corrupt/invalid input -> predecessor codes propagate UNCHANGED; no write,
 *    no auto-acceptance, no task mutation, no retry.
 * 3. The record is derived from that validated input ONLY; no arbitrary
 *    caller-supplied decision payload is accepted.
 * 4. An already existing exact record is an idempotent replay (no file
 *    rewrite, no byte change, no timestamp, no generation increment, no ACK).
 * 5. An existing record with a different binding fails closed with
 *    RECEIVER_DECISION_CONFLICT; the first winner is preserved and the
 *    incoming binding is never preferred.
 * 6. Unseen: OS exclusive-create, then durable read-back verification.
 * 7. Exclusive-create race loser: immediate winner re-read; exact same record
 *    -> replay success; different valid record -> conflict; corrupt winner ->
 *    fail closed. The winner is never overwritten.
 *
 * The result is frozen, deterministic, and timestamp-free: the same durable
 * input and the same durable state always serialize identically in any
 * process under any clock skew.
 */
export async function persistReceiverDecision({ dispatchId, store } = {}) {
  // 1. Caller-supplied durable store primitives only: no registry, no
  //    auto-detection, no transport.
  if (
    !store ||
    typeof store.readReceiverDispatchAcceptance !== 'function' ||
    typeof store.readReceiverDispatchDecision !== 'function' ||
    typeof store.createReceiverDispatchDecision !== 'function'
  ) {
    fail(
      'receiver decision persistence requires a store exposing readReceiverDispatchAcceptance / readReceiverDispatchDecision / createReceiverDispatchDecision (composition only; no registry, no auto-detection).',
      INVALID_RECEIVER_DECISION_STORE,
    );
  }

  // 2. Task 23 verbatim: dispatchId identity validation (first, before any
  //    reader invocation), durable acceptance read, Task 20 validation, and
  //    the direct dispatchId binding re-check. All predecessor codes
  //    propagate UNCHANGED; missing input performs no write at all.
  const input = await readReceiverDecisionInput({ dispatchId, store });

  // 3. Deterministic record derived from the EXACT validated input.
  const candidate = buildReceiverDecisionRecord(input);

  // 4. Existing durable decision: exact replay or fail-closed conflict.
  const observed = store.readReceiverDispatchDecision(dispatchId);
  if (observed !== null && observed !== undefined) {
    assertStoredDecisionBinding(observed, dispatchId);
    if (JSON.stringify(observed) !== JSON.stringify(candidate)) {
      fail(
        `receiver decision conflict (fail-closed): dispatchId ${dispatchId} already carries a different durable decision; never overwrite, merge, repair, or prefer the incoming input.`,
        RECEIVER_DECISION_CONFLICT,
      );
    }
    return Object.freeze({ dispatchId, newlyDecided: false, exactReplay: true });
  }

  // 5. Unseen: exclusive-create the EXACT record (never exists()->write()).
  const outcome = store.createReceiverDispatchDecision(candidate);
  if (outcome && outcome.created === true) {
    // 6. Durable read-back: the stored value must be the exact record.
    const stored = store.readReceiverDispatchDecision(dispatchId);
    if (
      stored === null ||
      stored === undefined ||
      JSON.stringify(stored) !== JSON.stringify(candidate)
    ) {
      fail(
        `receiver decision failed durable read-back after exclusive create (fail-closed): ${dispatchId}`,
        CORRUPT_RECEIVER_DISPATCH_DECISION,
      );
    }
    return Object.freeze({ dispatchId, newlyDecided: true });
  }

  // 7. Exclusive-create race loser: re-read the winner immediately.
  const winner = store.readReceiverDispatchDecision(dispatchId);
  if (winner === null || winner === undefined) {
    fail(
      `receiver decision race could not be resolved deterministically (fail-closed): ${dispatchId}`,
      CORRUPT_RECEIVER_DISPATCH_DECISION,
    );
  }
  assertStoredDecisionBinding(winner, dispatchId);
  if (JSON.stringify(winner) !== JSON.stringify(candidate)) {
    fail(
      `receiver decision conflict (fail-closed): dispatchId ${dispatchId} was already durably decided with a different binding; never overwrite or prefer the incoming input.`,
      RECEIVER_DECISION_CONFLICT,
    );
  }
  return Object.freeze({ dispatchId, newlyDecided: false, exactReplay: true });
}
