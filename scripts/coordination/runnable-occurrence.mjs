// Bounded read+derive owner: GREENHUB-COORDINATION-RUNNABLE-OCCURRENCE-GF03.
// Surface: scripts/coordination/*runnable-occurrence* (this module) + the store
// pure-read domain ONLY (readRunnableOccurrence over the exact canonical
// admission authority + current claim.json; no mutation, no repair).
//
// Concept boundary (this module owns the contract, the store owns the read):
//   APPROVED TASK  = the canonical emission-bound admission authority
//                    (admitEmittedTask) for one (sourceTaskId, emissionSlot):
//                    what may execute now.
//   RUNNABLE OCCURRENCE
//                  = the deterministic execution unit derived from that exact
//                    admission + canonical child + current durable claim bytes;
//                    identity is a timestamp-free projection, never a durable
//                    record and never a scheduler/queue/branch/PR/publication
//                    state. Exactly one approved admission projects to exactly
//                    one occurrence identity.
//   ATOMIC CLAIM   = the existing claimTask()/claimAdmittedTask()
//                    exclusive-create + claimGeneration fencing contract,
//                    reused unchanged: exactly one process wins; the
//                    occurrence projection reports the durable winner.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here or in the store read):
//   scheduler, queue, queue scan, READY scan (oldest/newest/next), priority,
//   fairness, worker registry, worker/executor/capability selection, automatic
//   workerId inference, dispatch, transport, executor invocation, process
//   spawn, OpenCode/Codex/Astra invocation, daemon, cron, polling, watcher,
//   retry/backoff/resend, fan-out, autonomous loop, automatic successor
//   generation, DROP/WATCH/CHANGE judgement, durable occurrence records,
//   executionGeneration / runnableGeneration / schedulerGeneration / any new
//   generation authority, Git branch/ref lifecycle state, publication state.
//
// Contract summary:
//   readRunnableOccurrence() != claimTask() != claimAdmittedTask()
//     != admitEmittedTask() != emitNextTask() != scheduleNextTask()
//     != dispatchNextTask() != decideNextTask() != invokeExecutor().
//   The caller explicitly supplies (sourceTaskId, emissionSlot); this read
//   never scans tasks/ or emissions, never polls, never picks oldest/newest,
//   never selects or infers workers/executors, and never mutates.
//   Ordering is CANONICAL ADMISSION AUTHORITY -> OCCURRENCE PROJECTION (never
//   READY-scan -> selection): every binding is re-verified live against the
//   durable authority (source, canonical emission, canonical admission, child
//   spec binding, single append-stable sequence membership, admission-bound
//   claim token) and drift fails closed with no auto-repair and no rewind.
//   The projection is derived from durable bytes ONLY: no clock, no lease
//   activity, no pid, no random, no mtime participates, so the same logical
//   admission + durable claim state always projects identically in any process
//   under any clock skew.
//   occurrenceId = occ_<sha256(admissionId, nextTaskId, nextTaskSpecBinding)>:
//   derived, constant, and never re-generated; exact replay of the same
//   approval converges to the same occurrence without durable byte churn and
//   without a generation increase. Semantic conflict (same slot, different
//   authoritative payload) fails closed upstream in the existing emission /
//   admission primitives with the first winner preserved.
//   claimGeneration (existing claim record generation) remains the SOLE
//   fencing generation; this projection never invents another one and never
//   exposes the claimToken capability.
//   Corruption fails closed with no auto-repair and no silent overwrite.

import { createHash } from 'node:crypto';
import { EMISSION_SLOT_PATTERN } from './next-task-emission.mjs';
import { TASK_ID_PATTERN } from './task-envelope.mjs';

export const RUNNABLE_OCCURRENCE_SCHEMA_VERSION = '1';

export const RUNNABLE_OCCURRENCE_ID_PREFIX = 'occ_';

export const MAX_RUNNABLE_OCCURRENCE_JSON_BYTES = 16 * 1024;
export const MAX_RUNNABLE_OCCURRENCE_ID_FIELD_LENGTH = 128;

// Occurrence execution states. Derived ONLY from the canonical child status and
// the current durable claim bytes:
//   RUNNABLE = READY with no claim authority yet (claimable now).
//   CLAIMED  = a valid admission-bound claim authority exists (durable winner);
//              this includes the crash window where claim.json was published
//              but the child never reached CLAIMED.
//   TERMINAL = the child is RESULT_DELIVERED; no new claim is possible.
export const RUNNABLE_OCCURRENCE_STATE_RUNNABLE = 'RUNNABLE';
export const RUNNABLE_OCCURRENCE_STATE_CLAIMED = 'CLAIMED';
export const RUNNABLE_OCCURRENCE_STATE_TERMINAL = 'TERMINAL';
export const RUNNABLE_OCCURRENCE_STATES = Object.freeze([
  RUNNABLE_OCCURRENCE_STATE_RUNNABLE,
  RUNNABLE_OCCURRENCE_STATE_CLAIMED,
  RUNNABLE_OCCURRENCE_STATE_TERMINAL,
]);

// Canonical projection fields, in fixed order. The projection carries the
// exact semantic identity and the current durable claim binding only: no
// timestamps, no lease activity, no claimToken capability, no scheduling or
// dispatch metadata.
export const RUNNABLE_OCCURRENCE_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'occurrenceId',
  'sourceTaskId',
  'emissionSlot',
  'emissionId',
  'admissionId',
  'nextTaskId',
  'nextTaskSpecBinding',
  'occurrenceState',
  'claim',
]);

// The claim binding projection: worker identity + the SOLE fencing generation.
// The claimToken stays private to the claim winner and is never projected.
export const RUNNABLE_OCCURRENCE_CLAIM_FIELDS = Object.freeze(['workerId', 'claimGeneration']);

// Fields that must never appear in an occurrence projection. They indicate
// capability leakage, a second generation authority, clock/process entropy,
// scheduler/queue/dispatch/executor smuggling, or embedded bodies.
export const BLOCKED_RUNNABLE_OCCURRENCE_FIELDS = Object.freeze([
  'claimToken',
  'claimedAt',
  'leaseExpiresAt',
  'lease',
  'expiresAt',
  'generation',
  'executionGeneration',
  'runnableGeneration',
  'schedulerGeneration',
  'dispatchGeneration',
  'invocationGeneration',
  'retryGeneration',
  'scheduler',
  'schedule',
  'scheduleNextTask',
  'dispatch',
  'dispatcher',
  'dispatchNextTask',
  'decideNextTask',
  'queue',
  'polling',
  'daemon',
  'cron',
  'watchdog',
  'priority',
  'fairness',
  'fanOut',
  'fanout',
  'nextTasks',
  'parallelChildren',
  'executor',
  'executorId',
  'adapter',
  'adapters',
  'astra',
  'openCode',
  'opencode',
  'autonomousLoop',
  'controlLoop',
  'workerRegistry',
  'executorRegistry',
  'registerWorker',
  'selectWorker',
  'workerSelection',
  'capabilityMatch',
  'chatHistory',
  'transcript',
  'chatTranscript',
  'messages',
  'docsDump',
  'docsBody',
  'pastResults',
  'resultsDump',
  'fullSsot',
  'ssot',
  'ssotBody',
  'projectState',
  'projectDump',
  'unrelatedState',
  'promptDump',
  'resultBody',
  'resultDump',
  'taskBody',
  'nextTaskSpec',
  'nextTaskSpecBody',
  'emissionBody',
  'admissionBody',
  'createdAt',
  'updatedAt',
  'readAt',
  'timestamp',
  'wallClock',
  'clock',
  'mtime',
  'ctime',
  'pid',
  'hostname',
  'random',
  'uuid',
]);

export class RunnableOccurrenceValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RunnableOccurrenceValidationError';
    this.code = details.code ?? 'INVALID_RUNNABLE_OCCURRENCE';
  }
}

function fail(message, code = 'INVALID_RUNNABLE_OCCURRENCE') {
  throw new RunnableOccurrenceValidationError(message, { code });
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(
      `taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`,
      'INVALID_TASK_ID',
    );
  }
}

export function assertValidRunnableOccurrenceSlot(slot) {
  if (typeof slot !== 'string' || !EMISSION_SLOT_PATTERN.test(slot)) {
    fail(
      `emissionSlot must match ${String(EMISSION_SLOT_PATTERN)} (got ${JSON.stringify(slot)}).`,
      'INVALID_RUNNABLE_OCCURRENCE_SLOT',
    );
  }
  return slot;
}

function assertNonEmptyString(value, fieldName, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${fieldName} must be a non-empty string.`);
  }
  if (maxLength > 0 && value.length > maxLength) {
    fail(`${fieldName} exceeds ${maxLength} chars.`, 'CONTEXT_BUDGET_EXCEEDED');
  }
}

function assertSpecBinding(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail('nextTaskSpecBinding must be a stable content hash of form "sha256:<64 hex>".');
  }
}

function assertNoBlockedOccurrenceFields(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const field of BLOCKED_RUNNABLE_OCCURRENCE_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not contain "${field}": the occurrence projection carries ` +
          '(schemaVersion, occurrenceId, sourceTaskId, emissionSlot, emissionId, admissionId, ' +
          'nextTaskId, nextTaskSpecBinding, occurrenceState, claim) ONLY; no capability, ' +
          'generation, clock, scheduler, queue, dispatch, or executor domain may be added.',
        'CONTEXT_BUDGET_EXCEEDED',
      );
    }
  }
}

/**
 * Deterministic runnable-occurrence identity for one canonical admission
 * binding. Computed ONLY over (admissionId, nextTaskId, nextTaskSpecBinding)
 * in fixed order, NUL-separated, SHA-256, encoded as `occ_<64 hex>`.
 * Timestamps/clock/pid/hostname/random/UUID/leases never participate: the same
 * approved admission always projects identically no matter when, in which
 * process, or under what clock skew it is replayed. No occurrence generation
 * exists: identity is constant for the whole occurrence lifetime.
 */
export function buildRunnableOccurrenceId({ admissionId, nextTaskId, nextTaskSpecBinding }) {
  assertNonEmptyString(admissionId, 'admissionId', MAX_RUNNABLE_OCCURRENCE_ID_FIELD_LENGTH);
  assertValidTaskId(nextTaskId);
  assertSpecBinding(nextTaskSpecBinding);
  const digest = createHash('sha256')
    .update(admissionId, 'utf8')
    .update('\0', 'utf8')
    .update(nextTaskId, 'utf8')
    .update('\0', 'utf8')
    .update(nextTaskSpecBinding, 'utf8')
    .digest('hex');
  return `${RUNNABLE_OCCURRENCE_ID_PREFIX}${digest}`;
}

function validateClaimProjection(claim) {
  if (claim === null || claim === undefined) return null;
  if (typeof claim !== 'object' || Array.isArray(claim)) {
    fail('occurrence claim must be null or an object with workerId/claimGeneration.');
  }
  assertNoBlockedOccurrenceFields(claim, 'occurrence claim');
  const keys = Object.keys(claim);
  if (keys.length !== RUNNABLE_OCCURRENCE_CLAIM_FIELDS.length) {
    fail(
      `occurrence claim must carry exactly ${RUNNABLE_OCCURRENCE_CLAIM_FIELDS.length} fields (${RUNNABLE_OCCURRENCE_CLAIM_FIELDS.join(', ')}).`,
    );
  }
  for (let index = 0; index < RUNNABLE_OCCURRENCE_CLAIM_FIELDS.length; index += 1) {
    if (keys[index] !== RUNNABLE_OCCURRENCE_CLAIM_FIELDS[index]) {
      fail(
        `occurrence claim key order/shape mismatch at position ${index}: expected "${RUNNABLE_OCCURRENCE_CLAIM_FIELDS[index]}" got "${keys[index]}".`,
      );
    }
  }
  assertNonEmptyString(
    claim.workerId,
    'occurrence claim workerId',
    MAX_RUNNABLE_OCCURRENCE_ID_FIELD_LENGTH,
  );
  if (!Number.isInteger(claim.claimGeneration) || claim.claimGeneration < 1) {
    fail(
      'occurrence claim claimGeneration must be an integer >= 1 (the existing claim fencing generation).',
    );
  }
  return Object.freeze({ workerId: claim.workerId, claimGeneration: claim.claimGeneration });
}

/**
 * Validate a canonical runnable-occurrence projection. Returns a frozen copy.
 * Fail-closed, no repair:
 * 1. blocked-field absence,
 * 2. exact field shape and order,
 * 3. schemaVersion / identity recomputation from the embedded binding,
 * 4. occurrenceState <-> claim consistency (RUNNABLE has no claim authority,
 *    CLAIMED/TERMINAL must carry the exact worker + claimGeneration binding).
 */
export function validateRunnableOccurrenceRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('runnable occurrence record must be an object.');
  }
  assertNoBlockedOccurrenceFields(record, 'runnable occurrence record');
  const keys = Object.keys(record);
  if (keys.length !== RUNNABLE_OCCURRENCE_RECORD_FIELDS.length) {
    fail(
      `runnable occurrence record must carry exactly ${RUNNABLE_OCCURRENCE_RECORD_FIELDS.length} fields (${RUNNABLE_OCCURRENCE_RECORD_FIELDS.join(', ')}).`,
    );
  }
  for (let index = 0; index < RUNNABLE_OCCURRENCE_RECORD_FIELDS.length; index += 1) {
    if (keys[index] !== RUNNABLE_OCCURRENCE_RECORD_FIELDS[index]) {
      fail(
        `runnable occurrence record key order/shape mismatch at position ${index}: expected "${RUNNABLE_OCCURRENCE_RECORD_FIELDS[index]}" got "${keys[index]}".`,
      );
    }
  }
  if (record.schemaVersion !== RUNNABLE_OCCURRENCE_SCHEMA_VERSION) {
    fail(
      `runnable occurrence schemaVersion must be ${JSON.stringify(RUNNABLE_OCCURRENCE_SCHEMA_VERSION)}.`,
      'INVALID_SCHEMA_VERSION',
    );
  }
  assertValidTaskId(record.sourceTaskId);
  assertValidRunnableOccurrenceSlot(record.emissionSlot);
  assertNonEmptyString(record.emissionId, 'emissionId', MAX_RUNNABLE_OCCURRENCE_ID_FIELD_LENGTH);
  assertNonEmptyString(record.admissionId, 'admissionId', MAX_RUNNABLE_OCCURRENCE_ID_FIELD_LENGTH);
  assertValidTaskId(record.nextTaskId);
  assertSpecBinding(record.nextTaskSpecBinding);
  assertNonEmptyString(
    record.occurrenceId,
    'occurrenceId',
    MAX_RUNNABLE_OCCURRENCE_ID_FIELD_LENGTH,
  );
  const expectedOccurrenceId = buildRunnableOccurrenceId({
    admissionId: record.admissionId,
    nextTaskId: record.nextTaskId,
    nextTaskSpecBinding: record.nextTaskSpecBinding,
  });
  if (record.occurrenceId !== expectedOccurrenceId) {
    fail(
      `occurrenceId mismatch (expected ${expectedOccurrenceId}): identity must be derived from the embedded admission binding only.`,
      'RUNNABLE_OCCURRENCE_BINDING_MISMATCH',
    );
  }
  if (!RUNNABLE_OCCURRENCE_STATES.includes(record.occurrenceState)) {
    fail(
      `occurrenceState must be one of ${RUNNABLE_OCCURRENCE_STATES.join(', ')} (got ${JSON.stringify(record.occurrenceState)}).`,
    );
  }
  const claim = validateClaimProjection(record.claim);
  if (record.occurrenceState === RUNNABLE_OCCURRENCE_STATE_RUNNABLE && claim !== null) {
    fail('RUNNABLE occurrence must not carry a claim binding (no execution authority exists yet).');
  }
  if (
    (record.occurrenceState === RUNNABLE_OCCURRENCE_STATE_CLAIMED ||
      record.occurrenceState === RUNNABLE_OCCURRENCE_STATE_TERMINAL) &&
    claim === null
  ) {
    fail(
      `${record.occurrenceState} occurrence must carry the exact worker/claimGeneration binding.`,
    );
  }
  const json = JSON.stringify(record);
  if (json.length > MAX_RUNNABLE_OCCURRENCE_JSON_BYTES) {
    fail(
      `runnable occurrence projection JSON is ${json.length} bytes (> ${MAX_RUNNABLE_OCCURRENCE_JSON_BYTES}): use bounded bindings, never embedded bodies.`,
      'CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return Object.freeze({
    schemaVersion: RUNNABLE_OCCURRENCE_SCHEMA_VERSION,
    occurrenceId: record.occurrenceId,
    sourceTaskId: record.sourceTaskId,
    emissionSlot: record.emissionSlot,
    emissionId: record.emissionId,
    admissionId: record.admissionId,
    nextTaskId: record.nextTaskId,
    nextTaskSpecBinding: record.nextTaskSpecBinding,
    occurrenceState: record.occurrenceState,
    claim,
  });
}

/** Build a canonical runnable-occurrence projection (validated, frozen). */
export function buildRunnableOccurrenceRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('runnable occurrence input must be an object.');
  }
  assertNoBlockedOccurrenceFields(input, 'runnable occurrence input');
  const record = {
    schemaVersion: RUNNABLE_OCCURRENCE_SCHEMA_VERSION,
    occurrenceId: buildRunnableOccurrenceId({
      admissionId: input.admissionId,
      nextTaskId: input.nextTaskId,
      nextTaskSpecBinding: input.nextTaskSpecBinding,
    }),
    sourceTaskId: input.sourceTaskId,
    emissionSlot: input.emissionSlot,
    emissionId: input.emissionId,
    admissionId: input.admissionId,
    nextTaskId: input.nextTaskId,
    nextTaskSpecBinding: input.nextTaskSpecBinding,
    occurrenceState: input.occurrenceState,
    claim: validateClaimProjection(input.claim ?? null),
  };
  return validateRunnableOccurrenceRecord(record);
}
