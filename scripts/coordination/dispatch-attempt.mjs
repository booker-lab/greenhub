// Bounded read+persistence owner: GREENHUB-COORDINATION-DURABLE-DISPATCH-ATTEMPT-19.
// Surface: scripts/coordination/*dispatch-attempt* (this module)
// + the store durable dispatch-attempt domain ONLY (durable
// persistDispatchAttempt / readDispatchAttempt over the exact LIVE canonical
// Task 18 claim-bound dispatch envelope; exclusive-create, no overwrite).
//
// Explicitly OUT OF SCOPE (must NOT be implemented here or in the store domain):
//   sendDispatch, dispatchNextTask, transport adapter, HTTP transport,
//   WebSocket transport, MCP transport, stdin/stdout transport, OpenCode
//   invocation, Codex invocation, Astra invocation, ChatGPT invocation,
//   child_process, spawn, exec, executor process, worker registry, worker
//   selection, capability matching, queue scan, READY scan, scheduler loop,
//   polling loop, daemon, cron, fan-out, load balancing, priority/fairness,
//   retry/backoff policy, ACK protocol, ACK persistence, executor acceptance,
//   DISPATCHED task status, EXECUTOR_ACCEPTED task status, task status mutation,
//   claim creation/takeover/extension, automatic claim, admission mutation,
//   emission mutation, result watcher, deliverResult changes, result authority
//   changes, publication automation framework.
//
// Contract summary:
//   persistDispatchAttempt() != sendDispatch() != dispatchNextTask()
//     != scheduleNextTask() != decideNextTask() != emitNextTask()
//     != admitEmittedTask() != claimAdmittedTask().
//   The caller explicitly supplies (sourceTaskId, emissionSlot, workerId).
//   This primitive never READY-scans, never infers workers, never creates/
//   increments/resets dispatch generations, never takes over claims, never
//   extends leases, never mutates task/claim/admission/emission, never
//   transports, never invokes executors, never ACKs, never sets task status.
//   Ordering is CURRENT LIVE CLAIM -> TASK 18 ENVELOPE -> IMMUTABLE DURABLE
//   ATTEMPT (never ATTEMPT -> CLAIM, never SEND -> PERSIST): the store read
//   re-verifies the live Task 18 envelope from the CURRENT claim.json, then
//   exclusive-creates exactly one immutable file per dispatchId.
//   Dispatch identity authority stays exactly (admissionId, nextTaskId,
//   workerId, claimGeneration): sourceTaskId / emissionSlot are
//   provenance/binding only and never enter dispatchId computation.
//   claimGeneration is the SOLE generation/fencing authority: no
//   dispatchGeneration, attemptGeneration, retryGeneration, retryCount
//   authority, scheduler-owned attempt number, incrementing dispatch sequence,
//   backoff state, retry policy, or resend count exists here.
//   The persisted record itself is deterministic: wall clock, mtime, pid,
//   hostname, random UUIDs, process identity, retry counters, transport names,
//   endpoints, adapters, sentAt, ackAt never participate. No timestamp field
//   is persisted: the same semantic attempt always serializes identically no
//   matter when, in which process, or under what clock skew it is replayed.
//   Corruption/drift fails closed with no auto-repair, no overwrite, no
//   delete-and-recreate, no last-writer-wins.

import nodePath from 'node:path';
import { TASK_ID_PATTERN } from './task-envelope.mjs';
import { EMISSION_SLOT_PATTERN } from './next-task-emission.mjs';
import {
  buildClaimBoundDispatchId,
  validateClaimBoundDispatchEnvelope,
} from './claim-bound-dispatch-envelope.mjs';

export const DISPATCH_ATTEMPT_SCHEMA_VERSION = '1';

export const DISPATCH_ATTEMPTS_DIRNAME = 'dispatch-attempts';

export const DISPATCH_ATTEMPT_ID_PATTERN = /^dsp_[0-9a-f]{64}$/;

// Fixed canonical key order for the durable record. sourceTaskId /
// emissionSlot are provenance/binding only; dispatchId identity is still
// (admissionId, nextTaskId, workerId, claimGeneration) ONLY.
export const DISPATCH_ATTEMPT_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'sourceTaskId',
  'emissionSlot',
  'dispatchId',
  'admissionId',
  'nextTaskId',
  'workerId',
  'claimGeneration',
]);

// Fields that must never appear in a durable dispatch-attempt record input
// or record. They indicate generation/retry/transport/scheduler/executor/
// clock/process smuggling: identity is the Task 18 four-tuple ONLY plus the
// provenance binding (sourceTaskId, emissionSlot). In particular no new
// generation counter, no retry authority, no timestamps, no transport
// metadata, no claimToken/specBinding duplication.
export const BLOCKED_DISPATCH_ATTEMPT_FIELDS = Object.freeze([
  'emissionId',
  'nextTaskSpecBinding',
  'claimToken',
  'dispatchGeneration',
  'attemptGeneration',
  'retryGeneration',
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
  'dispatch',
  'dispatcher',
  'dispatchAttempt',
  'sendDispatch',
  'dispatchNextTask',
  'decideNextTask',
  'claim',
  'claimTask',
  'executor',
  'worker',
  'workerRegistry',
  'selectWorker',
  'inferWorker',
  'lease',
]);

export class DispatchAttemptValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DispatchAttemptValidationError';
    this.code = details.code ?? 'CORRUPT_DISPATCH_ATTEMPT';
  }
}

function fail(message, code = 'CORRUPT_DISPATCH_ATTEMPT') {
  throw new DispatchAttemptValidationError(message, { code });
}

function assertValidSourceTaskId(sourceTaskId) {
  if (typeof sourceTaskId !== 'string' || !TASK_ID_PATTERN.test(sourceTaskId)) {
    fail(`sourceTaskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(sourceTaskId)}).`, 'CORRUPT_DISPATCH_ATTEMPT');
  }
}

function assertValidEmissionSlotValue(emissionSlot) {
  if (typeof emissionSlot !== 'string' || !EMISSION_SLOT_PATTERN.test(emissionSlot)) {
    fail(
      `emissionSlot must match ${String(EMISSION_SLOT_PATTERN)} (got ${JSON.stringify(emissionSlot)}).`,
      'CORRUPT_DISPATCH_ATTEMPT',
    );
  }
}

export function assertValidDispatchAttemptId(dispatchId) {
  if (typeof dispatchId !== 'string' || !DISPATCH_ATTEMPT_ID_PATTERN.test(dispatchId)) {
    fail(
      'dispatchId must be `dsp_<64 lowercase hex>` (Task 18 dispatch identity family).',
      'CORRUPT_DISPATCH_ATTEMPT',
    );
  }
  return dispatchId;
}

function assertNoBlockedAttemptFields(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const field of BLOCKED_DISPATCH_ATTEMPT_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not contain "${field}": durable attempt carries (schemaVersion, sourceTaskId, emissionSlot, dispatchId, admissionId, nextTaskId, workerId, claimGeneration) ONLY; ` +
          'no new generation/retry/scheduler/transport/clock/process authority is created here.',
        'CORRUPT_DISPATCH_ATTEMPT',
      );
    }
  }
}

export function dispatchAttemptRef(sourceTaskId, dispatchId) {
  assertValidSourceTaskId(sourceTaskId);
  assertValidDispatchAttemptId(dispatchId);
  return `${sourceTaskId}@dispatch-attempt:${dispatchId}`;
}

export function dispatchAttemptFileName(dispatchId) {
  assertValidDispatchAttemptId(dispatchId);
  return `${dispatchId}.json`;
}

/**
 * Durable path for one immutable dispatch attempt.
 * `<home>/tasks/<sourceTaskId>/dispatch-attempts/<dispatchId>.json`.
 * Never inside the repository worktree: `home` must be a coordination home.
 */
export function dispatchAttemptFilePath(home, sourceTaskId, dispatchId) {
  if (typeof home !== 'string' || !home.trim()) {
    fail('coordination home must be a non-empty directory path.', 'CORRUPT_DISPATCH_ATTEMPT');
  }
  assertValidSourceTaskId(sourceTaskId);
  assertValidDispatchAttemptId(dispatchId);
  return nodePath.join(home, 'tasks', sourceTaskId, DISPATCH_ATTEMPTS_DIRNAME, dispatchAttemptFileName(dispatchId));
}

/**
 * Build a canonical durable dispatch-attempt record from the LIVE Task 18
 * envelope plus provenance binding (sourceTaskId, emissionSlot).
 * Deterministic, frozen, timestamp-free: the same semantic attempt always
 * serializes identically. dispatchId is re-verified (never recomputed with
 * provenance fields): sourceTaskId / emissionSlot never enter identity.
 */
export function buildDispatchAttemptRecord({ sourceTaskId, emissionSlot = 'next', envelope } = {}) {
  if (arguments.length === 0 || envelope === undefined) {
    fail('dispatch attempt input must supply { sourceTaskId, emissionSlot, envelope }.', 'CORRUPT_DISPATCH_ATTEMPT');
  }
  assertValidSourceTaskId(sourceTaskId);
  assertValidEmissionSlotValue(emissionSlot);
  assertNoBlockedAttemptFields({ sourceTaskId, emissionSlot }, 'dispatch attempt provenance');
  let current;
  try {
    current = validateClaimBoundDispatchEnvelope(envelope);
  } catch (error) {
    fail(
      `dispatch attempt envelope invalid (fail-closed): ${error?.message}`,
      typeof error?.code === 'string' && error.code ? error.code : 'CORRUPT_DISPATCH_ATTEMPT',
    );
  }
  const record = {
    schemaVersion: DISPATCH_ATTEMPT_SCHEMA_VERSION,
    sourceTaskId,
    emissionSlot,
    dispatchId: current.dispatchId,
    admissionId: current.admissionId,
    nextTaskId: current.nextTaskId,
    workerId: current.workerId,
    claimGeneration: current.claimGeneration,
  };
  return validateDispatchAttemptRecord(record);
}

/**
 * Validate a durable dispatch-attempt record. Returns a frozen copy.
 * Fail-closed, no repair:
 * 1. exact key shape (no extra, no missing, fixed order checked by equality),
 * 2. provenance/binding field validity,
 * 3. dispatchId recomputation from the Task 18 four-tuple ONLY
 *    (DISPATCH_BINDING_MISMATCH on tamper, reusing the Task 18 meaning),
 * 4. no blocked smuggling fields.
 */
export function validateDispatchAttemptRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('dispatch attempt record must be an object.', 'CORRUPT_DISPATCH_ATTEMPT');
  }
  assertNoBlockedAttemptFields(record, 'dispatch attempt record');
  const keys = Object.keys(record);
  if (keys.length !== DISPATCH_ATTEMPT_RECORD_FIELDS.length) {
    fail(
      `dispatch attempt record must carry exactly ${DISPATCH_ATTEMPT_RECORD_FIELDS.length} fields (${DISPATCH_ATTEMPT_RECORD_FIELDS.join(', ')}).`,
      'CORRUPT_DISPATCH_ATTEMPT',
    );
  }
  for (let index = 0; index < DISPATCH_ATTEMPT_RECORD_FIELDS.length; index += 1) {
    if (keys[index] !== DISPATCH_ATTEMPT_RECORD_FIELDS[index]) {
      fail(
        `dispatch attempt record key order/shape mismatch at position ${index}: expected "${DISPATCH_ATTEMPT_RECORD_FIELDS[index]}" got "${keys[index]}".`,
        'CORRUPT_DISPATCH_ATTEMPT',
      );
    }
  }
  if (record.schemaVersion !== DISPATCH_ATTEMPT_SCHEMA_VERSION) {
    fail(
      `dispatch attempt schemaVersion must be ${JSON.stringify(DISPATCH_ATTEMPT_SCHEMA_VERSION)}.`,
      'CORRUPT_DISPATCH_ATTEMPT',
    );
  }
  assertValidSourceTaskId(record.sourceTaskId);
  assertValidEmissionSlotValue(record.emissionSlot);
  assertValidDispatchAttemptId(record.dispatchId);
  if (typeof record.admissionId !== 'string' || !record.admissionId.trim() || record.admissionId.length > 128) {
    fail('dispatch attempt admissionId must be a non-empty string within 128 chars.', 'CORRUPT_DISPATCH_ATTEMPT');
  }
  if (typeof record.nextTaskId !== 'string' || !TASK_ID_PATTERN.test(record.nextTaskId)) {
    fail(`dispatch attempt nextTaskId must match ${String(TASK_ID_PATTERN)}.`, 'CORRUPT_DISPATCH_ATTEMPT');
  }
  if (typeof record.workerId !== 'string' || !record.workerId.trim() || record.workerId.length > 128) {
    fail('dispatch attempt workerId must be a non-empty string within 128 chars.', 'CORRUPT_DISPATCH_ATTEMPT');
  }
  if (!Number.isInteger(record.claimGeneration) || record.claimGeneration < 1) {
    fail('dispatch attempt claimGeneration must be an integer >= 1 (SOLE generation fencing authority).', 'CORRUPT_DISPATCH_ATTEMPT');
  }
  let recomputed;
  try {
    recomputed = buildClaimBoundDispatchId({
      admissionId: record.admissionId,
      nextTaskId: record.nextTaskId,
      workerId: record.workerId,
      claimGeneration: record.claimGeneration,
    });
  } catch (error) {
    fail(
      `dispatch attempt binding invalid (fail-closed): ${error?.message}`,
      typeof error?.code === 'string' && error.code ? error.code : 'CORRUPT_DISPATCH_ATTEMPT',
    );
  }
  if (record.dispatchId !== recomputed) {
    fail(
      `dispatch attempt dispatchId mismatch (fail-closed): expected ${recomputed}.`,
      'DISPATCH_BINDING_MISMATCH',
    );
  }
  return Object.freeze({ ...record });
}

/**
 * Pure restore helper for future transport: recover the Task 18 envelope
 * bound inside a persisted attempt. No I/O, no clock, no transport.
 * Returns the frozen Task 18 envelope
 * { dispatchId, admissionId, nextTaskId, workerId, claimGeneration }.
 */
export function envelopeFromDispatchAttemptRecord(record) {
  const validated = validateDispatchAttemptRecord(record);
  return validateClaimBoundDispatchEnvelope({
    dispatchId: validated.dispatchId,
    admissionId: validated.admissionId,
    nextTaskId: validated.nextTaskId,
    workerId: validated.workerId,
    claimGeneration: validated.claimGeneration,
  });
}
