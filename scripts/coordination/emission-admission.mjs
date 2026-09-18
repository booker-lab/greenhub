// Bounded mutation owner: GREENHUB-COORDINATION-EMISSION-BOUND-ADMISSION-14.
// Surface: scripts/coordination/*admission* (this module) + the store admission
// domain ONLY (durable admitEmittedTask/readEmissionAdmission over the exact
// canonical emission of a CONSUMED source closure, converging the canonical
// child through the existing markReady() path).
//
// Explicitly OUT OF SCOPE (must NOT be implemented here or in the store domain):
//   semantic next-task planning/selection, AI task generation, automatic
//   desiredExitState inference, scheduler, queue polling loop, priority queue,
//   fairness, worker capacity, agent/worker/executor selection, claim loop,
//   claim automation, lease loop, dispatch, executor invocation, result watcher,
//   automatic next emission, fan-out, multi-child planner, DAG planner, retry
//   scheduler, cron, event daemon, adapters (Astra/OpenCode/Web), autonomous
//   Control Tower loop, application code, API/consumer/seller/driver changes,
//   deployment automation framework, production deployment, 57C.
//
// Contract summary:
//   emitNextTask() != admitEmittedTask() != scheduleNextTask() != claimTask()
//     != dispatchNextTask() != decideNextTask().
//   The caller explicitly supplies (sourceTaskId, emissionSlot). This primitive
//   never scans emissions, never polls a queue, never picks oldest/newest,
//   never decides priority, and never runs a scheduler loop: it is a consumer
//   primitive, not a consumer daemon.
//   Ordering is ADMISSION AUTHORITY -> READY (never READY -> ADMISSION):
//   every binding is verified, the durable admission authority is created via
//   OS exclusive-create, then the existing markReady(nextTaskId) path moves the
//   exact canonical child to READY. A crash between authority and READY is
//   recovered by replay converging to the same admission + READY (never a
//   duplicate, never delete-and-recreate, never rewind of CLAIMED/RESULT_DELIVERED).
//   Timestamps (admittedAt/mtime/wall-clock) are provenance only and never enter
//   admission identity: the same logical admission always binds identically no
//   matter when, in which process, or by which admitter it is replayed.
//   Corruption fails closed with no auto-repair and no silent overwrite.

import { createHash } from 'node:crypto';
import { TASK_ID_PATTERN } from './task-envelope.mjs';
import { buildCanonicalTransitionId } from './disposition.mjs';
import { EMISSION_SLOT_PATTERN } from './next-task-emission.mjs';

export const EMISSION_ADMISSION_SCHEMA_VERSION = '1';

export const MAX_ADMISSION_JSON_BYTES = 16 * 1024;
export const MAX_ADMISSION_REF_LENGTH = 512;
export const MAX_ADMISSION_ID_FIELD_LENGTH = 128;

// Inline-embed fields that violate the reference-first / context-budget
// contract and the admission boundary (no scheduler/claim/dispatch/fan-out/
// adapters, no embedded bodies). The admission record carries references and
// bindings only: the canonical nextTaskSpec body lives in the emission record
// and the child task envelope, never duplicated here.
export const BLOCKED_ADMISSION_INLINE_FIELDS = Object.freeze([
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
  'materialization',
  'materializationBody',
  'scheduler',
  'schedule',
  'scheduleNextTask',
  'dispatch',
  'dispatcher',
  'dispatchNextTask',
  'decideNextTask',
  'claim',
  'claimTask',
  'executor',
  'worker',
  'lease',
  'priority',
  'fairness',
  'fanOut',
  'fanout',
  'nextTasks',
  'parallelChildren',
  'adapter',
  'adapters',
  'astra',
  'openCode',
  'opencode',
  'autonomousLoop',
  'controlLoop',
  'queue',
  'cron',
  'daemon',
]);

export class AdmissionValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AdmissionValidationError';
    this.code = details.code ?? 'INVALID_ADMISSION';
  }
}

function fail(message, code = 'INVALID_ADMISSION') {
  throw new AdmissionValidationError(message, { code });
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, 'INVALID_TASK_ID');
  }
}

export function assertValidAdmissionSlot(slot) {
  if (typeof slot !== 'string' || !EMISSION_SLOT_PATTERN.test(slot)) {
    fail(
      `emissionSlot must match ${String(EMISSION_SLOT_PATTERN)} (got ${JSON.stringify(slot)}).`,
      'INVALID_ADMISSION_SLOT',
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

function assertNoBlockedInlineFields(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const field of BLOCKED_ADMISSION_INLINE_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not embed "${field}": admission carries bindings/refs only; ` +
          'scheduler/claim/dispatch/fan-out/adapter domains are out of scope.',
        'CONTEXT_BUDGET_EXCEEDED',
      );
    }
  }
}

function assertResultBinding(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail('resultBinding must be a stable content hash of form "sha256:<64 hex>".');
  }
}

function assertSpecBinding(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail('nextTaskSpecBinding must be a stable content hash of form "sha256:<64 hex>".');
  }
}

export function isIsoDateTime(value) {
  if (typeof value !== 'string' || !value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function assertValidResultId(resultId) {
  if (typeof resultId !== 'string' || !resultId.trim() || resultId.length > MAX_ADMISSION_ID_FIELD_LENGTH) {
    fail('resultId must be a non-empty string within length budget.', 'INVALID_ADMISSION');
  }
  if (resultId.includes('/') || resultId.includes('\\') || resultId.includes('..')) {
    fail('resultId must not contain path separators or "..".', 'INVALID_ADMISSION');
  }
}

/**
 * Deterministic admission identity for one canonical emission binding.
 * Computed ONLY over (emissionId, nextTaskId, nextTaskSpecBinding).
 * admittedAt/admitterId/process/clock never participate: the same logical
 * admission always binds identically.
 */
export function buildAdmissionId({ emissionId, nextTaskId, nextTaskSpecBinding }) {
  assertNonEmptyString(emissionId, 'emissionId', MAX_ADMISSION_ID_FIELD_LENGTH);
  assertValidTaskId(nextTaskId);
  assertSpecBinding(nextTaskSpecBinding);
  const digest = createHash('sha256')
    .update(emissionId, 'utf8')
    .update('\0', 'utf8')
    .update(nextTaskId, 'utf8')
    .update('\0', 'utf8')
    .update(nextTaskSpecBinding, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `adm_${digest}`;
}

export function admissionRef(sourceTaskId, emissionSlot) {
  assertValidTaskId(sourceTaskId);
  assertValidAdmissionSlot(emissionSlot);
  return `${sourceTaskId}@admission:${emissionSlot}`;
}

/**
 * Validate a canonical emission-bound admission record. Returns a frozen copy.
 * Fail-closed, no repair. Recomputes the admission identity from
 * (emissionId, nextTaskId, nextTaskSpecBinding) and the canonical transition
 * id from (sourceTaskId, dispositionGeneration, resultId) so a tampered record
 * can never validate.
 */
export function validateAdmissionRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('admission record must be an object.');
  }
  assertNoBlockedInlineFields(record, 'admission record');

  if (record.schemaVersion !== EMISSION_ADMISSION_SCHEMA_VERSION) {
    fail(
      `admission schemaVersion must be ${JSON.stringify(EMISSION_ADMISSION_SCHEMA_VERSION)}.`,
      'INVALID_SCHEMA_VERSION',
    );
  }
  assertValidTaskId(record.sourceTaskId);
  assertValidAdmissionSlot(record.emissionSlot);
  assertValidTaskId(record.nextTaskId);
  assertNonEmptyString(record.admissionId, 'admissionId', MAX_ADMISSION_ID_FIELD_LENGTH);
  assertNonEmptyString(record.emissionId, 'emissionId', MAX_ADMISSION_ID_FIELD_LENGTH);
  assertNonEmptyString(record.sourceConsumedId, 'sourceConsumedId', MAX_ADMISSION_ID_FIELD_LENGTH);
  assertNonEmptyString(record.sourceMaterializationId, 'sourceMaterializationId', MAX_ADMISSION_ID_FIELD_LENGTH);
  assertNonEmptyString(record.sourceAckId, 'sourceAckId', MAX_ADMISSION_ID_FIELD_LENGTH);
  if (!Number.isInteger(record.dispositionGeneration) || record.dispositionGeneration < 1) {
    fail('admission dispositionGeneration must be an integer >= 1.');
  }
  assertValidResultId(record.resultId);
  assertResultBinding(record.resultBinding);
  assertSpecBinding(record.nextTaskSpecBinding);
  assertNonEmptyString(record.canonicalTransitionId, 'canonicalTransitionId', 128);
  const expectedTransitionId = buildCanonicalTransitionId({
    taskId: record.sourceTaskId,
    dispositionGeneration: record.dispositionGeneration,
    resultId: record.resultId,
  });
  if (record.canonicalTransitionId !== expectedTransitionId) {
    fail(`admission canonicalTransitionId mismatch (expected ${expectedTransitionId}).`, 'ADMISSION_BINDING_MISMATCH');
  }

  const expectedAdmissionId = buildAdmissionId({
    emissionId: record.emissionId,
    nextTaskId: record.nextTaskId,
    nextTaskSpecBinding: record.nextTaskSpecBinding,
  });
  if (record.admissionId !== expectedAdmissionId) {
    fail(`admission admissionId mismatch (expected ${expectedAdmissionId}).`, 'ADMISSION_BINDING_MISMATCH');
  }

  if (!isIsoDateTime(record.admittedAt)) fail('admittedAt must be an ISO date-time string (provenance only).');
  assertNonEmptyString(record.admitterId, 'admitterId', MAX_ADMISSION_ID_FIELD_LENGTH);

  const json = JSON.stringify(record);
  if (json.length > MAX_ADMISSION_JSON_BYTES) {
    fail(
      `admission record JSON is ${json.length} bytes (> ${MAX_ADMISSION_JSON_BYTES}): use bounded refs, never embedded bodies.`,
      'CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return Object.freeze({ ...record });
}

/** Build a canonical admission record (validated, frozen). */
export function buildAdmissionRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('admission input must be an object.');
  }
  assertNoBlockedInlineFields(input, 'admission input');
  const emissionSlot = input.emissionSlot ?? 'next';
  assertValidAdmissionSlot(emissionSlot);
  const record = {
    schemaVersion: EMISSION_ADMISSION_SCHEMA_VERSION,
    admissionId: buildAdmissionId({
      emissionId: input.emissionId,
      nextTaskId: input.nextTaskId,
      nextTaskSpecBinding: input.nextTaskSpecBinding,
    }),
    sourceTaskId: input.sourceTaskId,
    emissionSlot,
    emissionId: input.emissionId,
    nextTaskId: input.nextTaskId,
    nextTaskSpecBinding: input.nextTaskSpecBinding,
    sourceConsumedId: input.sourceConsumedId,
    sourceMaterializationId: input.sourceMaterializationId,
    sourceAckId: input.sourceAckId,
    dispositionGeneration: input.dispositionGeneration,
    resultId: input.resultId,
    resultBinding: input.resultBinding,
    canonicalTransitionId: input.canonicalTransitionId,
    admittedAt: input.admittedAt,
    admitterId: input.admitterId,
  };
  return validateAdmissionRecord(record);
}
