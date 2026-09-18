// Bounded read owner: GREENHUB-COORDINATION-CANONICAL-SCHEDULABLE-WORK-READ-17A.
// Surface: scripts/coordination/*schedulable-work-read* (this module) + the
// store read-only method readCanonicalSchedulableWork ONLY (pure projection
// over the exact canonical emission admission; no mutation, no repair).
//
// Explicitly OUT OF SCOPE (must NOT be implemented here or in the store read):
//   listReadyTasks, findReadyTask, nextReady, oldestReady, newestReady,
//   priority scheduling, queue polling, scheduler loop, daemon, cron, fan-out,
//   automatic claim, worker selection, worker inference, worker registry,
//   assignment record, dispatch, dispatch attempt, executor adapter,
//   executor invocation, process spawn, result watcher.
//
// Contract summary:
//   readCanonicalSchedulableWork() != scheduleNextTask() != dispatchNextTask()
//     != decideNextTask() != emitNextTask() != admitEmittedTask()
//     != claimAdmittedTask().
//   The caller explicitly supplies (sourceTaskId, emissionSlot). This primitive
//   never scans READY tasks, never enumerates tasks/, never orders by
//   filesystem/mtime/createdAt/admittedAt, never picks oldest/newest, never
//   scores priority/fairness, never selects or infers workers, and never runs
//   a scheduler loop: it is a pure read projection, not a selector, scheduler,
//   or dispatcher.
//   Ordering is CANONICAL ADMISSION AUTHORITY -> PROJECTION (never
//   READY-scan -> SELECTION): every binding is re-verified live against the
//   durable authority (source task, canonical emission, canonical admission,
//   child spec binding, single sequence membership) and drift fails closed
//   with no auto-repair, no rewind, and no READY recreation.
//   The projection preserves the canonical semantic identity
//   (sourceTaskId, emissionSlot, emissionId, admissionId, nextTaskId,
//   nextTaskSpecBinding, sequencePosition, childStatus) and reports the live
//   child lifecycle status as-is: READY stays READY, CLAIMED stays CLAIMED,
//   RESULT_DELIVERED stays terminal.

import { TASK_ID_PATTERN, TASK_STATUSES } from './task-envelope.mjs';
import { EMISSION_SLOT_PATTERN } from './next-task-emission.mjs';

export const SCHEDULABLE_WORK_SCHEMA_VERSION = '1';

export const MAX_SCHEDULABLE_WORK_JSON_BYTES = 16 * 1024;
export const MAX_SCHEDULABLE_WORK_ID_FIELD_LENGTH = 128;

// Canonical projection fields, in fixed order. Lifecycle timestamps, worker
// identity, claim tokens, and scheduling metadata are never part of the
// projection: the same logical admission always projects identically no
// matter when, in which process, or under what clock skew it is read.
export const SCHEDULABLE_WORK_PROJECTION_FIELDS = Object.freeze([
  'sourceTaskId',
  'emissionSlot',
  'emissionId',
  'admissionId',
  'nextTaskId',
  'nextTaskSpecBinding',
  'sequencePosition',
  'childStatus',
]);

// Inline-embed fields that violate the reference-first / context-budget
// contract and the read boundary (no scheduler/claim/dispatch/fan-out/
// adapters, no embedded bodies). The projection carries identity and bindings
// only: the canonical nextTaskSpec body lives in the emission record and the
// child task envelope, never duplicated here.
export const BLOCKED_SCHEDULABLE_WORK_INLINE_FIELDS = Object.freeze([
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
  'claimToken',
  'executor',
  'worker',
  'workerId',
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

export class SchedulableWorkValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SchedulableWorkValidationError';
    this.code = details.code ?? 'INVALID_SCHEDULABLE_WORK';
  }
}

function fail(message, code = 'INVALID_SCHEDULABLE_WORK') {
  throw new SchedulableWorkValidationError(message, { code });
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, 'INVALID_TASK_ID');
  }
}

export function assertValidSchedulableSlot(slot) {
  if (typeof slot !== 'string' || !EMISSION_SLOT_PATTERN.test(slot)) {
    fail(
      `emissionSlot must match ${String(EMISSION_SLOT_PATTERN)} (got ${JSON.stringify(slot)}).`,
      'INVALID_SCHEDULABLE_SLOT',
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
  for (const field of BLOCKED_SCHEDULABLE_WORK_INLINE_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not embed "${field}": the projection carries identity/bindings only; ` +
          'scheduler/claim/dispatch/fan-out/adapter domains are out of scope.',
        'CONTEXT_BUDGET_EXCEEDED',
      );
    }
  }
}

function assertSpecBinding(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail('nextTaskSpecBinding must be a stable content hash of form "sha256:<64 hex>".');
  }
}

/**
 * Validate a canonical schedulable-work projection. Returns a frozen copy.
 * Fail-closed, no repair. The projection is a pure function of the durable
 * canonical admission authority: it carries the exact semantic identity
 * (sourceTaskId, emissionSlot, emissionId, admissionId, nextTaskId,
 * nextTaskSpecBinding, sequencePosition, childStatus) and nothing else.
 */
export function validateSchedulableWorkProjection(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('schedulable-work projection must be an object.');
  }
  assertNoBlockedInlineFields(record, 'schedulable-work projection');

  if (record.schemaVersion !== SCHEDULABLE_WORK_SCHEMA_VERSION) {
    fail(
      `schedulable-work schemaVersion must be ${JSON.stringify(SCHEDULABLE_WORK_SCHEMA_VERSION)}.`,
      'INVALID_SCHEMA_VERSION',
    );
  }
  assertValidTaskId(record.sourceTaskId);
  assertValidSchedulableSlot(record.emissionSlot);
  assertNonEmptyString(record.emissionId, 'emissionId', MAX_SCHEDULABLE_WORK_ID_FIELD_LENGTH);
  assertNonEmptyString(record.admissionId, 'admissionId', MAX_SCHEDULABLE_WORK_ID_FIELD_LENGTH);
  assertValidTaskId(record.nextTaskId);
  assertSpecBinding(record.nextTaskSpecBinding);
  if (!Number.isInteger(record.sequencePosition) || record.sequencePosition < 1) {
    fail('sequencePosition must be an integer >= 1 (canonical append-stable position).');
  }
  if (typeof record.childStatus !== 'string' || !TASK_STATUSES.includes(record.childStatus)) {
    fail(`childStatus must be one of ${TASK_STATUSES.join(', ')} (got ${JSON.stringify(record.childStatus)}).`);
  }

  const json = JSON.stringify(record);
  if (json.length > MAX_SCHEDULABLE_WORK_JSON_BYTES) {
    fail(
      `schedulable-work projection JSON is ${json.length} bytes (> ${MAX_SCHEDULABLE_WORK_JSON_BYTES}): use bounded refs, never embedded bodies.`,
      'CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return Object.freeze({ ...record });
}

/** Build a canonical schedulable-work projection (validated, frozen). */
export function buildSchedulableWorkProjection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('schedulable-work input must be an object.');
  }
  assertNoBlockedInlineFields(input, 'schedulable-work input');
  const emissionSlot = input.emissionSlot ?? 'next';
  assertValidSchedulableSlot(emissionSlot);
  const record = {
    schemaVersion: SCHEDULABLE_WORK_SCHEMA_VERSION,
    sourceTaskId: input.sourceTaskId,
    emissionSlot,
    emissionId: input.emissionId,
    admissionId: input.admissionId,
    nextTaskId: input.nextTaskId,
    nextTaskSpecBinding: input.nextTaskSpecBinding,
    sequencePosition: input.sequencePosition,
    childStatus: input.childStatus,
  };
  return validateSchedulableWorkProjection(record);
}
