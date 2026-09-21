// Bounded read+derive owner: GREENHUB-COORDINATION-EXECUTOR-INVOCATION-INPUT-27
// (GF-02 direct composition revision).
// Surface: scripts/coordination/*dispatch-executor-invocation-input*
// (this module) + composition of the existing public Task 23/22/20 primitives ONLY
//   readReceiverDecisionInput({ dispatchId, store })
//   assertValidReceiverAcceptanceDispatchId(dispatchId)
//   validateTransportRequest(request)
// over the unchanged durable authority
// <coordination-home>/receiver-acceptances/<dispatchId>.json.
// No store.mjs mutation. No Task 18~22 source or spec mutation.
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
//   decision: it reads the EXACT durable receiver acceptance (the direct
//   receiver-acceptance derivation composed via Task 23) and deterministically
//   constructs the canonical executor invocation input record a later durable
//   invocation-attempt stage persists.
//   Entry is EXACTLY one path:
//     (dispatchId, store)
//       -> dispatchId identity validation   [Task 22 receiver-acceptance family]
//       -> require store.readReceiverDispatchAcceptance ONLY
//       -> readReceiverDecisionInput({ dispatchId, store })  [Task 23 verbatim:
//          durable receiver-acceptance read, Task 20 validateTransportRequest,
//          direct dispatchId binding re-check; missing/corrupt input fails
//          closed with predecessor codes propagated UNCHANGED, zero writes]
//       -> buildExecutorInvocationInputRecord(request)  [deterministic,
//          timestamp-free, derived from the EXACT validated Task 20 request
//          ONLY; callers cannot inject an arbitrary record]
//       -> the EXACT frozen canonical invocation input record
//          { schemaVersion, dispatchId, decision, decisionInput }
//          with no wrapper metadata.
//   Missing durable receiver acceptance causes ZERO writes and ZERO task/claim/
//   admission/emission/dispatch-attempt/receiver-acceptance/executor-
//   invocation-attempt/result/disposition mutation: no acceptance is
//   auto-created, no invocation attempt is auto-created, and no retry policy
//   exists here.
//   Corrupt / wrong-shape / wrong-order / wrong-value / tampered-decisionInput
//   / mismatched-binding predecessor records fail closed with the existing
//   Task 23/22/20/18/19 codes propagated UNCHANGED; nothing is repaired,
//   normalized, overwritten, deleted, recreated, or merged, and the exact
//   durable bytes stay untouched. The constructed record itself is re-validated
//   with validateExecutorInvocationInputRecord() before it is returned.
//   No new durable artifact, directory, or JSON domain is created: the durable
//   authority remains the Task 22 receiver acceptance under
//   <coordination-home>/receiver-acceptances/<dispatchId>.json.
//   The returned value is frozen, deterministic, and timestamp-free: no
//   Date.now / new Date / performance.now / pid / hostname / random UUID /
//   mtime / ctime participates. claimGeneration remains the SOLE fencing
//   generation, inherited verbatim inside decisionInput.
//   The durable invocation-input record contract retains the exact wire shape
//   of the retired Task 24 receiver-decision record family
//   ({ schemaVersion, dispatchId, decision, decisionInput }) because the
//   retained durable executor-invocation-attempt family persists it verbatim;
//   the fixed decision value is a constant schema marker with no independent
//   verdict semantics and no authority of any kind. No receiver-decision
//   durable namespace, writer, reader, or replacement artifact exists here.
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
//   executor-invocation-attempt mutation, result/disposition mutation, any new
//   generation authority (executorGeneration / invocationGeneration /
//   executionGeneration / acceptanceGeneration / deliveryGeneration /
//   retryGeneration), executionAllowed / executionStarted / acceptedByExecutor /
//   executorInvoked / workerSelected flags, any node:fs access.

import { readReceiverDecisionInput } from './dispatch-receiver-decision-input.mjs';
import { assertValidReceiverAcceptanceDispatchId } from './dispatch-receiver-acceptance.mjs';
import { validateTransportRequest } from './dispatch-transport-contract.mjs';

export const EXECUTOR_INVOCATION_INPUT_SCHEMA_VERSION = '1';

// Fixed canonical key order for the durable invocation input record.
// decisionInput is the EXACT frozen validated Task 20 transport request
// derived from the durable receiver acceptance.
export const EXECUTOR_INVOCATION_INPUT_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'dispatchId',
  'decision',
  'decisionInput',
]);

// The single explicit record meaning, retained byte-verbatim from the retired
// Task 24 durable record contract so the retained durable
// executor-invocation-attempt family keeps its exact wire shape. It is a
// constant schema marker: NOT an ACK, NOT a receipt, NOT executor acceptance,
// NOT execution authorization, NOT an independent verdict.
export const EXECUTOR_INVOCATION_INPUT_DECISION_VALUE = 'RECEIVER_DECISION_BOUNDARY_PASSED';

// Fields that must never appear in a durable invocation-input record input or
// record. They indicate generation/retry/ACK/executor/scheduler/clock/process
// smuggling. claimGeneration is inside decisionInput and stays the SOLE
// fencing generation.
export const BLOCKED_EXECUTOR_INVOCATION_INPUT_FIELDS = Object.freeze([
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

// Invocation-input-native meanings ONLY. Missing/corrupt Task 23/22 input
// reuses the existing Task 23/22/20/18/19 codes verbatim; there is no
// invocation-input-specific ACK, persistence fallback, retry, or generation
// authority.
export const CORRUPT_EXECUTOR_INVOCATION_INPUT = 'CORRUPT_EXECUTOR_INVOCATION_INPUT';
export const INVALID_EXECUTOR_INVOCATION_INPUT_STORE =
  'INVALID_EXECUTOR_INVOCATION_INPUT_STORE';

export class ExecutorInvocationInputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ExecutorInvocationInputError';
    this.code = details.code ?? CORRUPT_EXECUTOR_INVOCATION_INPUT;
  }
}

function fail(message, code = CORRUPT_EXECUTOR_INVOCATION_INPUT) {
  throw new ExecutorInvocationInputError(message, { code });
}

export function assertValidExecutorInvocationInputDispatchId(dispatchId) {
  try {
    assertValidReceiverAcceptanceDispatchId(dispatchId);
  } catch (error) {
    fail(error.message, CORRUPT_EXECUTOR_INVOCATION_INPUT);
  }
  return dispatchId;
}

function assertNoBlockedInvocationInputFields(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const field of BLOCKED_EXECUTOR_INVOCATION_INPUT_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not contain "${field}": the durable invocation input carries (schemaVersion, dispatchId, decision, decisionInput) ONLY; no additional durable authority is created here.`,
        CORRUPT_EXECUTOR_INVOCATION_INPUT,
      );
    }
  }
}

/**
 * Build the canonical durable executor invocation input record from the EXACT
 * validated Task 20 transport request derived from the durable receiver
 * acceptance. Deterministic, frozen, timestamp-free: the same validated input
 * always serializes identically in any process under any clock skew. The
 * decision value is fixed; no caller-supplied decision payload participates.
 */
export function buildExecutorInvocationInputRecord(request) {
  // Task 20/18/19 codes propagate UNCHANGED: the builder never remaps a
  // predecessor validation meaning.
  const decisionInput = validateTransportRequest(request);
  const record = {
    schemaVersion: EXECUTOR_INVOCATION_INPUT_SCHEMA_VERSION,
    dispatchId: decisionInput.dispatchId,
    decision: EXECUTOR_INVOCATION_INPUT_DECISION_VALUE,
    decisionInput,
  };
  return validateExecutorInvocationInputRecord(record);
}

/**
 * Validate a durable executor invocation input record. Returns a frozen
 * canonical copy. Fail-closed, no repair:
 * 1. exact key shape (no extra, no missing, fixed order),
 * 2. schemaVersion / dispatchId identity / fixed decision value,
 * 3. decisionInput must pass Task 20 validateTransportRequest and carry the
 *    same dispatchId as the record (direct binding re-check),
 * 4. no blocked smuggling fields.
 */
export function validateExecutorInvocationInputRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('executor invocation input record must be an object.', CORRUPT_EXECUTOR_INVOCATION_INPUT);
  }
  assertNoBlockedInvocationInputFields(record, 'executor invocation input record');
  const keys = Object.keys(record);
  if (keys.length !== EXECUTOR_INVOCATION_INPUT_RECORD_FIELDS.length) {
    fail(
      `executor invocation input record must carry exactly ${EXECUTOR_INVOCATION_INPUT_RECORD_FIELDS.length} fields (${EXECUTOR_INVOCATION_INPUT_RECORD_FIELDS.join(', ')}).`,
      CORRUPT_EXECUTOR_INVOCATION_INPUT,
    );
  }
  for (let index = 0; index < EXECUTOR_INVOCATION_INPUT_RECORD_FIELDS.length; index += 1) {
    if (keys[index] !== EXECUTOR_INVOCATION_INPUT_RECORD_FIELDS[index]) {
      fail(
        `executor invocation input record key order/shape mismatch at position ${index}: expected "${EXECUTOR_INVOCATION_INPUT_RECORD_FIELDS[index]}" got "${keys[index]}".`,
        CORRUPT_EXECUTOR_INVOCATION_INPUT,
      );
    }
  }
  if (record.schemaVersion !== EXECUTOR_INVOCATION_INPUT_SCHEMA_VERSION) {
    fail(
      `executor invocation input schemaVersion must be ${JSON.stringify(EXECUTOR_INVOCATION_INPUT_SCHEMA_VERSION)}.`,
      CORRUPT_EXECUTOR_INVOCATION_INPUT,
    );
  }
  assertValidExecutorInvocationInputDispatchId(record.dispatchId);
  if (record.decision !== EXECUTOR_INVOCATION_INPUT_DECISION_VALUE) {
    fail(
      `executor invocation input decision value must be exactly ${JSON.stringify(EXECUTOR_INVOCATION_INPUT_DECISION_VALUE)}.`,
      CORRUPT_EXECUTOR_INVOCATION_INPUT,
    );
  }
  // Task 20/18/19 validation codes propagate UNCHANGED (same fail-closed
  // family as the durable receiver-acceptance read).
  const decisionInput = validateTransportRequest(record.decisionInput);
  if (decisionInput.dispatchId !== record.dispatchId) {
    fail(
      `executor invocation input record binding mismatch (fail-closed): dispatchId ${record.dispatchId} carries decisionInput bound to ${decisionInput.dispatchId}.`,
      CORRUPT_EXECUTOR_INVOCATION_INPUT,
    );
  }
  return Object.freeze({
    schemaVersion: EXECUTOR_INVOCATION_INPUT_SCHEMA_VERSION,
    dispatchId: record.dispatchId,
    decision: EXECUTOR_INVOCATION_INPUT_DECISION_VALUE,
    decisionInput,
  });
}

/**
 * Read the canonical executor-invocation input for ONE dispatchId: the EXACT
 * durable receiver acceptance is read through the Task 23 direct derivation and
 * the canonical invocation input record is constructed from it.
 *
 * Contract (fail-closed, no repair, no mutation):
 * 1. `dispatchId` must be a valid Task 19/22 identity (`dsp_<64 lowercase
 *    hex>`); otherwise the call fails closed BEFORE any store access or reader
 *    invocation.
 * 2. `store` must expose readReceiverDispatchAcceptance(dispatchId); no other
 *    capability is required, consulted, or read (no task store, claim store,
 *    admission store, emission store, dispatch attempt store, receiver
 *    decision store, executor acceptance store, invocation attempt store,
 *    result store, ACK store, worker/executor registry, or scheduler state).
 * 3. The reader receives dispatchId ONLY (one argument) and the durable
 *    receiver acceptance is read AT MOST ONCE per call: no polling, no retry,
 *    no re-read loop, no fallback lookup, no second read after success, no
 *    directory scan, no newest-record scan.
 * 4. null / undefined from the reader means no durable receiver acceptance
 *    exists for this dispatchId: fail closed with
 *    RECEIVER_DISPATCH_ACCEPTANCE_NOT_FOUND (a read failure only, never a task
 *    status, invocation readiness, ACK, worker/executor availability, retry,
 *    transport, or delivery decision; no write is performed, no acceptance or
 *    invocation attempt is auto-created, and no receiver-decision or
 *    executor-acceptance record is reconstructed).
 * 5. The returned record is validated with the exported record validator:
 *    exact key shape and order, schemaVersion, fixed decision value,
 *    blocked-field absence, and Task 20 decisionInput validation. Malformed /
 *    tampered / binding-drift records fail closed with their existing codes
 *    propagating UNCHANGED. Nothing is repaired, overwritten, truncated,
 *    deleted, rewritten, or normalized.
 *
 * The returned value is frozen, deterministic, and timestamp-free: the same
 * durable bytes + the same dispatchId always serialize identically in any
 * process under any clock skew. It remains semantically equivalent to
 * { schemaVersion, dispatchId, decision, decisionInput } with decisionInput
 * the EXACT Task 20 transport request inherited from the durable receiver
 * acceptance.
 */
export async function readExecutorInvocationInput({ dispatchId, store } = {}) {
  // 1. dispatchId is validated first: invalid identities never touch the
  //    store and never invoke the reader.
  assertValidExecutorInvocationInputDispatchId(dispatchId);

  // 2. Caller-supplied durable store primitive only: exactly one required
  //    capability, no registry, no auto-detection, no transport.
  if (!store || typeof store.readReceiverDispatchAcceptance !== 'function') {
    fail(
      'this read entry requires a store exposing readReceiverDispatchAcceptance(dispatchId) (read-only composition; no other capability is required or consulted).',
      INVALID_EXECUTOR_INVOCATION_INPUT_STORE,
    );
  }

  // 3./4./5. Task 23 verbatim: dispatchId-only durable receiver-acceptance
  //    read, Task 20 validation, and the direct dispatchId binding re-check.
  //    Missing input performs zero writes; predecessor codes propagate
  //    UNCHANGED.
  const request = await readReceiverDecisionInput({ dispatchId, store });

  // Deterministic canonical invocation input record derived from the EXACT
  // validated Task 20 request. No wrapper metadata, no new generation, no ACK,
  // no executor/scheduler state.
  return buildExecutorInvocationInputRecord(request);
}
