// Bounded read+invoke owner: GREENHUB-COORDINATION-DURABLE-ATTEMPT-BOUND-TRANSPORT-CONTRACT-20.
// Surface: scripts/coordination/*dispatch-transport-contract* (this module)
// + composition of existing public store primitives ONLY
// (readDispatchAttempt / verifyClaimBoundDispatchEnvelope / readTask).
// No store.mjs mutation.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   concrete HTTP adapter, WebSocket adapter, MCP adapter, stdin/stdout
//   adapter, OpenCode invocation, Codex invocation, Astra invocation, ChatGPT
//   invocation, child_process / spawn / exec, executor invocation, scheduler,
//   READY scan, queue scan, polling loop, daemon, cron, worker selection,
//   worker registry, capability matching, automatic claiming, lease extension,
//   retry, backoff, resend policy, delivery retry counter, ACK protocol, ACK
//   persistence, sent/dispatched persistence, DISPATCHED status,
//   EXECUTOR_ACCEPTED status, new task status, result watcher, deliverResult
//   changes, result authority changes, claim/admission/emission mutation,
//   dispatchGeneration / sendGeneration / attemptGeneration / retryGeneration /
//   deliveryGeneration (any new generation authority).
//
// Contract summary:
//   prepareDispatchTransportRequest() != sendDispatch()
//     != dispatchNextTask() != scheduleNextTask() != decideNextTask()
//     != emitNextTask() != admitEmittedTask() != claimAdmittedTask().
//   Transport entry is EXACTLY one path:
//     (sourceTaskId, dispatchId)
//       -> store.readDispatchAttempt()            [EXISTING Task 19 durable]
//       -> envelopeFromDispatchAttemptRecord()    [Task 19 helper]
//       -> store.verifyClaimBoundDispatchEnvelope [Task 18 live revalidation]
//       -> store.readTask(record.nextTaskId)      [exact child binding]
//       -> deterministic immutable request.
//   There is NO claim->send, envelope->send, or task->send entry: any API that
//   builds a transport request from a claim, workerId, taskId, admissionId,
//   or dispatch envelope alone does not exist here.
//   Dispatch identity stays exactly Task 19 dispatchId; claimGeneration stays
//   the SOLE fencing generation. The request is deterministic, frozen,
//   timestamp-free: the same durable attempt + the same exact task always
//   serializes identically in any process under any clock skew.
//   invokeDispatchTransportAdapter() takes a caller-supplied adapter ONLY:
//   no registry, no auto-detection, no environment selection, no endpoint
//   discovery, no worker selection, no capability matching. It invokes the
//   adapter at most once, performs no internal retry, creates/records no ACK,
//   and mutates no task/claim/attempt state. Exactly-once is NOT claimed:
//   dispatchId is the stable delivery/idempotency key for a future receiver.

import { TASK_ID_PATTERN, TASK_STATUS_CLAIMED, TASK_STATUS_CREATED, TASK_STATUS_READY, TASK_STATUS_RESULT_DELIVERED, validateTaskEnvelope } from './task-envelope.mjs';
import { EMISSION_SLOT_PATTERN } from './next-task-emission.mjs';
import {
  buildClaimBoundDispatchId,
  validateClaimBoundDispatchEnvelope,
} from './claim-bound-dispatch-envelope.mjs';
import {
  DISPATCH_ATTEMPT_ID_PATTERN,
  envelopeFromDispatchAttemptRecord,
  validateDispatchAttemptRecord,
} from './dispatch-attempt.mjs';

export const TRANSPORT_REQUEST_SCHEMA_VERSION = '1';

// Fixed canonical key order for the transport request. dispatchId is the
// Task 19 identity verbatim; sourceTaskId / emissionSlot are provenance /
// binding only. task is the exact CLAIMED Task Envelope.
export const TRANSPORT_REQUEST_FIELDS = Object.freeze([
  'schemaVersion',
  'dispatchId',
  'sourceTaskId',
  'emissionSlot',
  'admissionId',
  'nextTaskId',
  'workerId',
  'claimGeneration',
  'task',
]);

// Fields that must never appear at the top level of a transport request.
// They indicate new-generation / retry / transport / scheduler / executor /
// clock / process smuggling. claimGeneration is the SOLE generation; no
// transportGeneration / sendGeneration / attemptGeneration / retryGeneration /
// deliveryGeneration exists. Timestamps / wall clock / pid / hostname /
// random UUIDs / endpoints / adapters / ACK / scheduler / executor state
// never participate in request identity.
export const BLOCKED_TRANSPORT_REQUEST_FIELDS = Object.freeze([
  'emissionId',
  'nextTaskSpecBinding',
  'claimToken',
  'transportGeneration',
  'sendGeneration',
  'attemptGeneration',
  'retryGeneration',
  'deliveryGeneration',
  'dispatchGeneration',
  'generation',
  'retry',
  'retryCount',
  'attemptNumber',
  'attemptSequence',
  'dispatchSequence',
  'sequence',
  'sequenceNumber',
  'backoff',
  'resend',
  'resendCount',
  'dispatchedAt',
  'sentAt',
  'ackedAt',
  'acknowledgedAt',
  'deliveredAt',
  'createdAt',
  'updatedAt',
  'emittedAt',
  'admittedAt',
  'claimedAt',
  'persistedAt',
  'preparedAt',
  'transportedAt',
  'timestamp',
  'wallClock',
  'clock',
  'mtime',
  'ctime',
  'pid',
  'hostname',
  'random',
  'uuid',
  'transport',
  'endpoint',
  'adapter',
  'adapters',
  'sent',
  'dispatched',
  'ack',
  'accepted',
  'executing',
  'scheduler',
  'schedule',
  'queue',
  'cron',
  'daemon',
  'fanOut',
  'fanout',
  'priority',
  'fairness',
  'executor',
  'workerRegistry',
  'selectWorker',
  'inferWorker',
  'lease',
]);

// New codes ONLY for transport-contract-native meanings. All durable/
// binding / fencing failures reuse the existing Task 18/19 + core meanings
// verbatim (DISPATCH_ATTEMPT_NOT_FOUND, CORRUPT_DISPATCH_ATTEMPT,
// DISPATCH_ATTEMPT_BINDING_MISMATCH, DISPATCH_BINDING_MISMATCH,
// STALE_DISPATCH, TASK_NOT_CLAIMED, TASK_TERMINAL, CLAIM_NOT_FOUND,
// CORRUPT_CLAIM, CLAIM_ADMISSION_BYPASS_DETECTED, ADMISSION_BINDING_MISMATCH).
export const CORRUPT_TRANSPORT_REQUEST = 'CORRUPT_TRANSPORT_REQUEST';
export const INVALID_TRANSPORT_ADAPTER = 'INVALID_TRANSPORT_ADAPTER';

export class DispatchTransportValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DispatchTransportValidationError';
    this.code = details.code ?? CORRUPT_TRANSPORT_REQUEST;
  }
}

function fail(message, code = CORRUPT_TRANSPORT_REQUEST) {
  throw new DispatchTransportValidationError(message, { code });
}

function assertValidSourceTaskId(sourceTaskId) {
  if (typeof sourceTaskId !== 'string' || !TASK_ID_PATTERN.test(sourceTaskId)) {
    fail(`sourceTaskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(sourceTaskId)}).`, CORRUPT_TRANSPORT_REQUEST);
  }
}

function assertValidEmissionSlotValue(emissionSlot) {
  if (typeof emissionSlot !== 'string' || !EMISSION_SLOT_PATTERN.test(emissionSlot)) {
    fail(`emissionSlot must match ${String(EMISSION_SLOT_PATTERN)} (got ${JSON.stringify(emissionSlot)}).`, CORRUPT_TRANSPORT_REQUEST);
  }
}

function assertValidDispatchIdValue(dispatchId) {
  if (typeof dispatchId !== 'string' || !DISPATCH_ATTEMPT_ID_PATTERN.test(dispatchId)) {
    fail('dispatchId must be `dsp_<64 lowercase hex>` (Task 19 dispatch identity family).', CORRUPT_TRANSPORT_REQUEST);
  }
}

function assertNoBlockedTransportFields(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const field of BLOCKED_TRANSPORT_REQUEST_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not contain "${field}": transport request carries (schemaVersion, dispatchId, sourceTaskId, emissionSlot, admissionId, nextTaskId, workerId, claimGeneration, task) ONLY; ` +
          'claimGeneration is the sole fencing generation; no new generation/retry/transport/scheduler/executor/clock/process authority is created here.',
        CORRUPT_TRANSPORT_REQUEST,
      );
    }
  }
}

/**
 * Validate a dispatch transport request. Returns a frozen copy.
 * Fail-closed, no repair:
 * 1. exact key shape (no extra, no missing, fixed order),
 * 2. provenance/binding field validity,
 * 3. dispatchId recomputation from the Task 18 four-tuple ONLY
 *    (DISPATCH_BINDING_MISMATCH on tamper, reusing the Task 18 meaning),
 * 4. exact Task Envelope validity + taskId binding
 *    (DISPATCH_ATTEMPT_BINDING_MISMATCH on drift),
 * 5. child CLAIMED gate (TASK_TERMINAL for RESULT_DELIVERED,
 *    TASK_NOT_CLAIMED for READY/CREATED/other non-CLAIMED),
 * 6. no blocked smuggling fields.
 */
export function validateTransportRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    fail('transport request must be an object.', CORRUPT_TRANSPORT_REQUEST);
  }
  assertNoBlockedTransportFields(request, 'transport request');
  const keys = Object.keys(request);
  if (keys.length !== TRANSPORT_REQUEST_FIELDS.length) {
    fail(
      `transport request must carry exactly ${TRANSPORT_REQUEST_FIELDS.length} fields (${TRANSPORT_REQUEST_FIELDS.join(', ')}).`,
      CORRUPT_TRANSPORT_REQUEST,
    );
  }
  for (let index = 0; index < TRANSPORT_REQUEST_FIELDS.length; index += 1) {
    if (keys[index] !== TRANSPORT_REQUEST_FIELDS[index]) {
      fail(
        `transport request key order/shape mismatch at position ${index}: expected "${TRANSPORT_REQUEST_FIELDS[index]}" got "${keys[index]}".`,
        CORRUPT_TRANSPORT_REQUEST,
      );
    }
  }
  if (request.schemaVersion !== TRANSPORT_REQUEST_SCHEMA_VERSION) {
    fail(`transport request schemaVersion must be ${JSON.stringify(TRANSPORT_REQUEST_SCHEMA_VERSION)}.`, CORRUPT_TRANSPORT_REQUEST);
  }
  assertValidDispatchIdValue(request.dispatchId);
  assertValidSourceTaskId(request.sourceTaskId);
  assertValidEmissionSlotValue(request.emissionSlot);
  if (typeof request.admissionId !== 'string' || !request.admissionId.trim() || request.admissionId.length > 128) {
    fail('transport request admissionId must be a non-empty string within 128 chars.', CORRUPT_TRANSPORT_REQUEST);
  }
  if (typeof request.nextTaskId !== 'string' || !TASK_ID_PATTERN.test(request.nextTaskId)) {
    fail(`transport request nextTaskId must match ${String(TASK_ID_PATTERN)}.`, CORRUPT_TRANSPORT_REQUEST);
  }
  if (typeof request.workerId !== 'string' || !request.workerId.trim() || request.workerId.length > 128) {
    fail('transport request workerId must be a non-empty string within 128 chars.', CORRUPT_TRANSPORT_REQUEST);
  }
  if (!Number.isInteger(request.claimGeneration) || request.claimGeneration < 1) {
    fail('transport request claimGeneration must be an integer >= 1 (SOLE generation fencing authority).', CORRUPT_TRANSPORT_REQUEST);
  }
  // Dispatch identity re-verification from the Task 18 four-tuple ONLY.
  let recomputed;
  try {
    recomputed = buildClaimBoundDispatchId({
      admissionId: request.admissionId,
      nextTaskId: request.nextTaskId,
      workerId: request.workerId,
      claimGeneration: request.claimGeneration,
    });
  } catch (error) {
    fail(
      `transport request binding invalid (fail-closed): ${error?.message}`,
      typeof error?.code === 'string' && error.code ? error.code : CORRUPT_TRANSPORT_REQUEST,
    );
  }
  if (request.dispatchId !== recomputed) {
    fail(`transport request dispatchId mismatch (fail-closed): expected ${recomputed}.`, 'DISPATCH_BINDING_MISMATCH');
  }
  // Exact Task Envelope binding: must validate and match nextTaskId.
  let task;
  try {
    task = validateTaskEnvelope(request.task);
  } catch (error) {
    // Preserve terminal / not-claimed semantics when the envelope itself
    // carries that meaning; otherwise fail as a corrupt request. Never
    // remap CORRUPT_* / *_MISMATCH / *_CONFLICT drift codes.
    const code = typeof error?.code === 'string' && error.code ? error.code : CORRUPT_TRANSPORT_REQUEST;
    fail(`transport request task envelope invalid (fail-closed): ${error?.message}`, code);
  }
  if (task.taskId !== request.nextTaskId) {
    fail(
      `transport request task binding mismatch (fail-closed): nextTaskId=${request.nextTaskId} task.taskId=${task.taskId}.`,
      'DISPATCH_ATTEMPT_BINDING_MISMATCH',
    );
  }
  if (task.status === TASK_STATUS_RESULT_DELIVERED) {
    fail(`transport request child is terminal (RESULT_DELIVERED); no transport: ${task.taskId}.`, 'TASK_TERMINAL');
  }
  if (task.status !== TASK_STATUS_CLAIMED) {
    const observed = task.status === TASK_STATUS_READY || task.status === TASK_STATUS_CREATED ? task.status : task.status;
    fail(
      `transport request child is not CLAIMED (task=${task.taskId} status=${observed}; never transport READY/CREATED).`,
      'TASK_NOT_CLAIMED',
    );
  }
  return Object.freeze({ ...request, task });
}

/**
 * Prepare the deterministic immutable transport request for one EXISTING
 * durable dispatch attempt. The ONLY transport entry point.
 *
 * Required order (fail-closed, zero adapter involvement):
 * 1. store.readDispatchAttempt({ sourceTaskId, dispatchId })
 * 2. strict Task 19 record validation
 * 3. envelopeFromDispatchAttemptRecord(record)
 * 4. store.verifyClaimBoundDispatchEnvelope({ sourceTaskId,
 *      emissionSlot: record.emissionSlot, envelope })
 * 5. CURRENT live envelope exact binding re-check against the durable
 *    record (admissionId / nextTaskId / workerId / claimGeneration /
 *    dispatchId)
 * 6. store.readTask(record.nextTaskId)
 * 7. exact taskId binding check
 * 8. child CLAIMED gate (RESULT_DELIVERED -> TASK_TERMINAL;
 *    READY/CREATED/other -> TASK_NOT_CLAIMED)
 * 9. deterministic frozen request build + validation.
 *
 * Existing store error codes propagate UNCHANGED (never remapped):
 * DISPATCH_ATTEMPT_NOT_FOUND, CORRUPT_DISPATCH_ATTEMPT,
 * DISPATCH_ATTEMPT_BINDING_MISMATCH, DISPATCH_BINDING_MISMATCH,
 * STALE_DISPATCH, TASK_NOT_CLAIMED, TASK_TERMINAL, CLAIM_NOT_FOUND,
 * CORRUPT_CLAIM, CLAIM_ADMISSION_BYPASS_DETECTED, ADMISSION_BINDING_MISMATCH.
 */
export function prepareDispatchTransportRequest({ store, sourceTaskId, dispatchId } = {}) {
  if (!store || typeof store.readDispatchAttempt !== 'function' || typeof store.verifyClaimBoundDispatchEnvelope !== 'function' || typeof store.readTask !== 'function') {
    fail('transport preparation requires a store exposing readDispatchAttempt / verifyClaimBoundDispatchEnvelope / readTask (composition only).', CORRUPT_TRANSPORT_REQUEST);
  }
  // 1. EXISTING durable attempt is mandatory: the only entry point.
  //    Missing / corrupt / binding-mismatch codes propagate unchanged.
  const record = store.readDispatchAttempt({ sourceTaskId, dispatchId });

  // 2. Strict Task 19 validation (fail-closed, no repair). Codes propagate
  //    unchanged: CORRUPT_DISPATCH_ATTEMPT / DISPATCH_BINDING_MISMATCH.
  let validatedRecord;
  try {
    validatedRecord = validateDispatchAttemptRecord(record);
  } catch (error) {
    // Re-throw unchanged: preserve the exact Task 19 meaning.
    throw error;
  }
  if (validatedRecord.sourceTaskId !== sourceTaskId || validatedRecord.dispatchId !== dispatchId) {
    fail(
      `transport preparation path/record binding mismatch (fail-closed): ${sourceTaskId}@${dispatchId}.`,
      'DISPATCH_ATTEMPT_BINDING_MISMATCH',
    );
  }

  // 3. Task 19 envelope restore (pure, no I/O).
  let envelope;
  try {
    envelope = envelopeFromDispatchAttemptRecord(validatedRecord);
  } catch (error) {
    throw error;
  }
  try {
    validateClaimBoundDispatchEnvelope(envelope);
  } catch (error) {
    throw error;
  }

  // 4. CURRENT live envelope revalidation against the Task 18 authority.
  //    Stale / drift / missing / foreign-claim codes propagate unchanged.
  const live = store.verifyClaimBoundDispatchEnvelope({
    sourceTaskId,
    emissionSlot: validatedRecord.emissionSlot,
    envelope,
  });

  // 5. Exact durable-vs-live binding re-check (defense in depth; verify
  //    already enforces this, but the transport layer states it explicitly).
  if (
    live.dispatchId !== validatedRecord.dispatchId ||
    live.admissionId !== validatedRecord.admissionId ||
    live.nextTaskId !== validatedRecord.nextTaskId ||
    live.workerId !== validatedRecord.workerId ||
    live.claimGeneration !== validatedRecord.claimGeneration
  ) {
    fail(
      'transport preparation live binding drift vs durable attempt (fail-closed): CURRENT live envelope differs from the durable record.',
      'DISPATCH_BINDING_MISMATCH',
    );
  }

  // 6. Exact child Task Envelope read.
  const child = store.readTask(validatedRecord.nextTaskId);

  // 7. Exact taskId binding.
  if (child.taskId !== validatedRecord.nextTaskId) {
    fail(
      `transport preparation task binding mismatch (fail-closed): attempt nextTaskId=${validatedRecord.nextTaskId} read taskId=${child.taskId}.`,
      'DISPATCH_ATTEMPT_BINDING_MISMATCH',
    );
  }

  // 8. Child CLAIMED gate. RESULT_DELIVERED never transports;
  //    READY/CREATED (or any other non-CLAIMED) never transports.
  //    Codes reuse the existing claim lifecycle meanings.
  if (child.status === TASK_STATUS_RESULT_DELIVERED) {
    fail(`transport preparation child is terminal (RESULT_DELIVERED); no transport: ${child.taskId}.`, 'TASK_TERMINAL');
  }
  if (child.status !== TASK_STATUS_CLAIMED) {
    fail(
      `transport preparation child is not CLAIMED (task=${child.taskId} status=${child.status}; never transport READY/CREATED).`,
      'TASK_NOT_CLAIMED',
    );
  }

  // 9. Deterministic immutable request: fixed key order, frozen,
  //    timestamp-free. Identity is the Task 19 dispatchId verbatim.
  let validatedChild;
  try {
    validatedChild = validateTaskEnvelope(child);
  } catch (error) {
    throw error;
  }
  const request = {
    schemaVersion: TRANSPORT_REQUEST_SCHEMA_VERSION,
    dispatchId: validatedRecord.dispatchId,
    sourceTaskId: validatedRecord.sourceTaskId,
    emissionSlot: validatedRecord.emissionSlot,
    admissionId: validatedRecord.admissionId,
    nextTaskId: validatedRecord.nextTaskId,
    workerId: validatedRecord.workerId,
    claimGeneration: validatedRecord.claimGeneration,
    task: validatedChild,
  };
  return validateTransportRequest(request);
}

/**
 * Invoke a caller-supplied dispatch transport adapter with a validated
 * transport request. Explicit adapter contract, exactly-once NOT claimed.
 *
 * Guarantees:
 * - request is validated first (malformed -> CORRUPT_TRANSPORT_REQUEST /
 *   binding codes; adapter is NEVER called),
 * - adapter must be a function (otherwise INVALID_TRANSPORT_ADAPTER; never
 *   called),
 * - request.dispatchId is the stable delivery/idempotency key carried
 *   inside the frozen request passed to the adapter,
 * - the adapter is invoked AT MOST ONCE per call (no loop, no internal
 *   retry),
 * - no ACK is created or recorded,
 * - no task / claim / durable-attempt state is read or written here
 *   (no store parameter exists),
 * - adapter throw/reject propagates unchanged with zero retry and zero
 *   durable side effect (this layer performs no mutation at all).
 *
 * The adapter itself MUST NOT retry internally, MUST NOT create/record an
 * ACK, and MUST NOT mutate task / claim / durable-attempt state. Tests use
 * an in-memory fake adapter ONLY.
 */
export async function invokeDispatchTransportAdapter({ request, adapter } = {}) {
  const validated = validateTransportRequest(request);
  if (typeof adapter !== 'function') {
    fail('transport adapter must be a caller-supplied function (no registry, no auto-detection, no environment selection).', INVALID_TRANSPORT_ADAPTER);
  }
  // Exactly one invocation. No loop, no retry, no fallback adapter.
  return await adapter(validated);
}
