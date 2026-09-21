// Bounded mutation owner: GREENHUB-COORDINATION-USER-APPROVED-READONLY-INTAKE-GF06.
// Surface: scripts/coordination/*user-approved-intake* (this module) + the store
// user-approved intake domain ONLY (durable intakeUserApprovedReadOnlyTask /
// readUserApprovedIntake over one explicit user-approved READ_ONLY Task Envelope
// spec) + the operator-facing `coordination:intake` composition.
//
// Contract summary:
//   USER-APPROVED EXTERNAL INTAKE != successor emission != admission != claim.
//   The caller explicitly supplies ONE bounded READ_ONLY task spec plus the
//   explicit approval signal `userApproved: true` and the approval provenance
//   { approvedBy, approvalRef }. Ordering is INTAKE AUTHORITY -> TASK CREATE ->
//   READY. The successor-emission contract (CONSUMED source -> emitNextTask ->
//   emission-bound admission -> READY) is a DIFFERENT authority source and is
//   never relaxed, merged, or faked here: no fake CONSUMED source, no dummy
//   result/disposition/materialization/ACK, no arbitrary emission admission.
//   READ_ONLY only: taskKind must be READ_ONLY and mutationBoundary.allowsWrite
//   must be false; a BOUNDED_MUTATION spec (or allowsWrite=true) is refused
//   before any durable write.
//   Identity: intakeId = int_<sha256(taskId \0 canonicalSpecBinding)[:32]>.
//   The canonical spec binding is the EXISTING next-task spec binding
//   (computeNextTaskSpecBinding), so no parallel Task Envelope schema exists.
//   Timestamps (recordedAt) and recorderId are provenance only and never enter
//   intake identity: the same logical intake always binds identically no matter
//   when, in which process, or by which recorder it is replayed.
//   Same logical intake replays idempotently to the same canonical identity;
//   a different payload for the same taskId fails closed with INTAKE_CONFLICT
//   (first winner wins, never overwritten, never merged). Concurrent writers
//   serialize in the OS via exclusive-create: exactly one canonical winner.
//   Corruption fails closed with no auto-repair and no silent overwrite.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here or in the store domain):
//   successor generation, emitNextTask relaxation, fake CONSUMED source,
//   admission relaxation, task prioritization, task discovery, READY scan,
//   scheduler, queue poller, cron, watchdog, retry scheduler, fan-out, parallel
//   task planner, automatic DROP/WATCH/CHANGE, autonomous Control Tower loop,
//   Astra/Codex sourcing, mutation-capable OpenCode executor, claim, dispatch,
//   executor invocation, result delivery, deployment automation, application
//   code (apps/api/**, apps/consumer/**, apps/seller/**, apps/driver/**,
//   Firebase rules, deployment/runtime config).

import { createHash } from 'node:crypto';
import nodePath from 'node:path';
import { TASK_ID_PATTERN, TASK_KIND_READ_ONLY } from './task-envelope.mjs';
import {
  computeNextTaskSpecBinding,
  normalizeNextTaskSpec,
} from './next-task-emission.mjs';

export const USER_APPROVED_INTAKE_SCHEMA_VERSION = '1';
export const USER_APPROVED_INTAKE_ID_PREFIX = 'int_';
export const USER_APPROVED_INTAKE_DIRNAME = 'intake-authorities';
// Dispatch-chain provenance slot for intake-authorized work. It is NOT an
// emission slot: no emission record/admission exists for an intake task.
export const USER_APPROVED_INTAKE_DISPATCH_SLOT = 'intake';
// Authority kind markers shared with the operator CLI and the transport
// contract. The emission-admission path keeps its own marker; the two
// authority sources are never conflated.
export const AUTHORITY_KIND_EMISSION_ADMISSION = 'EMISSION_ADMISSION';
export const AUTHORITY_KIND_USER_APPROVED_INTAKE = 'USER_APPROVED_INTAKE';

export const MAX_USER_APPROVED_INTAKE_JSON_BYTES = 16 * 1024;
export const MAX_APPROVAL_FIELD_LENGTH = 512;
export const MAX_RECORDER_ID_LENGTH = 128;

// The one explicit approval marker value. Approval is never inferred from task
// completion, RESULT_DELIVERED, an existing intake record, elapsed time, or
// environment variables: every intake call must carry the current explicit
// signal.
export const USER_APPROVED_INTAKE_REQUIRES_EXPLICIT_USER_APPROVAL =
  'INTAKE_REQUIRES_EXPLICIT_USER_APPROVAL';
export const USER_APPROVED_INTAKE_REQUIRES_READ_ONLY_TASK = 'INTAKE_REQUIRES_READ_ONLY_TASK';
export const USER_APPROVED_INTAKE_REQUIRES_READ_ONLY_BOUNDARY =
  'INTAKE_REQUIRES_READ_ONLY_BOUNDARY';
export const INVALID_USER_APPROVED_INTAKE_RECORD = 'INVALID_INTAKE_RECORD';

// Inline-embed fields that violate the reference-first / context-budget
// contract and the intake boundary (no scheduler/claim/dispatch/executor/
// fan-out/adapter domains). The intake record carries the caller-supplied
// bounded task spec plus approval provenance ONLY.
export const BLOCKED_USER_APPROVED_INTAKE_INLINE_FIELDS = Object.freeze([
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
  'syncCursor',
  'cursor',
  'consumed',
  'acknowledged',
  'acknowledgement',
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

// Fixed canonical key order for one intake authority record. Identity is
// (taskId, intakeSpecBinding) ONLY: recordedAt / recorderId are provenance and
// never participate in intakeId.
export const USER_APPROVED_INTAKE_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'intakeId',
  'taskId',
  'intakeSpecBinding',
  'taskSpec',
  'approval',
  'recordedAt',
  'recorderId',
]);

export const APPROVAL_FIELDS = Object.freeze(['approvedBy', 'approvalRef']);

export class UserApprovedIntakeValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'UserApprovedIntakeValidationError';
    this.code = details.code ?? INVALID_USER_APPROVED_INTAKE_RECORD;
  }
}

function fail(message, code = INVALID_USER_APPROVED_INTAKE_RECORD) {
  throw new UserApprovedIntakeValidationError(message, { code });
}

function assertNonEmptyBoundedString(value, fieldName, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${fieldName} must be a non-empty string.`);
  }
  if (maxLength > 0 && value.length > maxLength) {
    fail(`${fieldName} exceeds ${maxLength} chars.`, 'CONTEXT_BUDGET_EXCEEDED');
  }
  return value;
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, 'INVALID_TASK_ID');
  }
  return taskId;
}

export function isIsoDateTime(value) {
  if (typeof value !== 'string' || !value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function assertNoBlockedInlineFields(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const field of BLOCKED_USER_APPROVED_INTAKE_INLINE_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not embed "${field}": the intake authority carries the bounded task spec and approval provenance ONLY; ` +
          'scheduler/claim/dispatch/executor/fan-out/adapter domains are out of scope.',
        'CONTEXT_BUDGET_EXCEEDED',
      );
    }
  }
}

/**
 * Explicit approval gate: `userApproved` must be EXACTLY the boolean true.
 * Absent / false / malformed / inferred approval fails closed BEFORE any
 * durable write.
 */
export function assertExplicitUserApproval(userApproved) {
  if (userApproved !== true) {
    fail(
      'user-approved intake requires the explicit current approval signal userApproved === true. ' +
        'Approval is never inferred from task existence, an existing intake record, elapsed time, environment variables, or prior approvals.',
      USER_APPROVED_INTAKE_REQUIRES_EXPLICIT_USER_APPROVAL,
    );
  }
  return true;
}

/** Normalize + validate approval provenance { approvedBy, approvalRef }. */
export function normalizeApprovalProvenance(approval) {
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    fail(
      'approval provenance must be an object carrying the explicit user approval authority { approvedBy, approvalRef }.',
      USER_APPROVED_INTAKE_REQUIRES_EXPLICIT_USER_APPROVAL,
    );
  }
  const normalized = {};
  for (const field of APPROVAL_FIELDS) {
    if (!Object.hasOwn(approval, field)) {
      fail(
        `approval provenance is missing "${field}"; explicit user approval must identify the approving authority and an approval reference.`,
        USER_APPROVED_INTAKE_REQUIRES_EXPLICIT_USER_APPROVAL,
      );
    }
    normalized[field] = assertNonEmptyBoundedString(
      approval[field],
      `approval.${field}`,
      MAX_APPROVAL_FIELD_LENGTH,
    );
  }
  return Object.freeze(normalized);
}

/**
 * Normalize one caller-supplied task spec to its canonical binding form and
 * enforce the READ_ONLY intake boundary:
 *   A. taskKind === 'READ_ONLY'                    (else INTAKE_REQUIRES_READ_ONLY_TASK)
 *   B. mutationBoundary.allowsWrite === false      (else INTAKE_REQUIRES_READ_ONLY_BOUNDARY)
 * The EXISTING Task Envelope v1 contract (reference-first, context budget,
 * ownedSurface, proofRequirement) is reused verbatim through
 * normalizeNextTaskSpec: no parallel schema exists.
 */
export function normalizeUserApprovedIntakeTaskSpec(taskSpec) {
  let normalized;
  try {
    normalized = normalizeNextTaskSpec(taskSpec);
  } catch (error) {
    fail(
      `user-approved intake task spec violates the Task Envelope v1 contract (fail-closed): ${error?.message}`,
      typeof error?.code === 'string' && error.code ? error.code : INVALID_USER_APPROVED_INTAKE_RECORD,
    );
  }
  if (normalized.taskKind !== TASK_KIND_READ_ONLY) {
    fail(
      `user-approved intake accepts READ_ONLY tasks only (got taskKind=${JSON.stringify(normalized.taskKind)}); a mutation-capable task must go through its own mutation authority.`,
      USER_APPROVED_INTAKE_REQUIRES_READ_ONLY_TASK,
    );
  }
  if (normalized.mutationBoundary?.allowsWrite !== false) {
    fail(
      `user-approved intake requires mutationBoundary.allowsWrite === false (got ${JSON.stringify(normalized.mutationBoundary?.allowsWrite)}).`,
      USER_APPROVED_INTAKE_REQUIRES_READ_ONLY_BOUNDARY,
    );
  }
  return normalized;
}

/**
 * Deterministic intake identity for one (taskId, canonical spec binding)
 * binding. recordedAt/recorderId/clock/pid/random never participate: the same
 * logical intake always binds identically.
 */
export function buildUserApprovedIntakeId({ taskId, intakeSpecBinding }) {
  assertValidTaskId(taskId);
  if (typeof intakeSpecBinding !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(intakeSpecBinding)) {
    fail('intakeSpecBinding must be a stable content hash of form "sha256:<64 hex>".');
  }
  const digest = createHash('sha256')
    .update(taskId, 'utf8')
    .update('\0', 'utf8')
    .update(intakeSpecBinding, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `${USER_APPROVED_INTAKE_ID_PREFIX}${digest}`;
}

export function userApprovedIntakeRef(taskId) {
  assertValidTaskId(taskId);
  return `${taskId}@user-approved-intake`;
}

export function userApprovedIntakeFileName(taskId) {
  assertValidTaskId(taskId);
  return `${taskId}.json`;
}

/**
 * Durable path for one canonical intake authority.
 * `<home>/intake-authorities/<taskId>.json` (one canonical slot per taskId;
 * first-winner wins, exclusive-create, never overwritten).
 * Never inside the repository worktree: `home` is a coordination home.
 */
export function userApprovedIntakeFilePath(home, taskId) {
  if (typeof home !== 'string' || !home.trim()) {
    fail('coordination home must be a non-empty directory path.');
  }
  assertValidTaskId(taskId);
  return nodePath.join(home, USER_APPROVED_INTAKE_DIRNAME, userApprovedIntakeFileName(taskId));
}

/**
 * Validate a canonical intake authority record. Returns a frozen copy.
 * Fail-closed, no repair. Recomputes the spec binding from the embedded
 * canonical spec and the intake identity from (taskId, binding), and re-enforces
 * the READ_ONLY gates so a tampered record can never validate.
 */
export function validateUserApprovedIntakeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('intake authority record must be an object.');
  }
  assertNoBlockedInlineFields(record, 'intake authority record');

  if (record.schemaVersion !== USER_APPROVED_INTAKE_SCHEMA_VERSION) {
    fail(
      `intake authority schemaVersion must be ${JSON.stringify(USER_APPROVED_INTAKE_SCHEMA_VERSION)}.`,
      'INVALID_SCHEMA_VERSION',
    );
  }
  assertValidTaskId(record.taskId);
  assertNonEmptyBoundedString(record.intakeId, 'intakeId', MAX_RECORDER_ID_LENGTH);
  if (typeof record.intakeSpecBinding !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(record.intakeSpecBinding)) {
    fail('intakeSpecBinding must be a stable content hash of form "sha256:<64 hex>".');
  }
  if (!record.taskSpec || typeof record.taskSpec !== 'object' || Array.isArray(record.taskSpec)) {
    fail('intake authority taskSpec must be a canonical spec object.');
  }
  let normalizedSpec;
  try {
    normalizedSpec = normalizeUserApprovedIntakeTaskSpec(record.taskSpec);
  } catch (error) {
    fail(`intake authority taskSpec invalid (fail-closed): ${error?.message}`, error?.code ?? INVALID_USER_APPROVED_INTAKE_RECORD);
  }
  if (normalizedSpec.taskId !== record.taskId) {
    fail('intake authority taskId mismatch: must equal the canonical taskSpec.taskId (fail-closed).', 'INTAKE_BINDING_MISMATCH');
  }
  let recomputedBinding;
  try {
    recomputedBinding = computeNextTaskSpecBinding(normalizedSpec);
  } catch (error) {
    fail(`intake authority spec binding could not be recomputed (fail-closed): ${error?.message}`, error?.code ?? INVALID_USER_APPROVED_INTAKE_RECORD);
  }
  if (recomputedBinding !== record.intakeSpecBinding) {
    fail(
      'intake authority intakeSpecBinding mismatch: binding does not match the embedded canonical spec (fail-closed).',
      'INTAKE_BINDING_MISMATCH',
    );
  }
  const expectedIntakeId = buildUserApprovedIntakeId({
    taskId: record.taskId,
    intakeSpecBinding: record.intakeSpecBinding,
  });
  if (record.intakeId !== expectedIntakeId) {
    fail(`intake authority intakeId mismatch (expected ${expectedIntakeId}).`, 'INTAKE_BINDING_MISMATCH');
  }
  const approval = normalizeApprovalProvenance(record.approval);
  if (!isIsoDateTime(record.recordedAt)) {
    fail('intake authority recordedAt must be an ISO date-time string (provenance only).');
  }
  assertNonEmptyBoundedString(record.recorderId, 'recorderId', MAX_RECORDER_ID_LENGTH);

  const json = JSON.stringify(record);
  if (json.length > MAX_USER_APPROVED_INTAKE_JSON_BYTES) {
    fail(
      `intake authority record JSON is ${json.length} bytes (> ${MAX_USER_APPROVED_INTAKE_JSON_BYTES}): keep the bounded spec reference-first; never embed dumps.`,
      'CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return Object.freeze({
    ...record,
    taskSpec: Object.freeze({ ...normalizedSpec }),
    approval,
  });
}

/** Build a canonical intake authority record (validated, frozen). */
export function buildUserApprovedIntakeRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('user-approved intake input must be an object.');
  }
  assertExplicitUserApproval(input.userApproved);
  const approval = normalizeApprovalProvenance(input.approval);
  const taskSpec = normalizeUserApprovedIntakeTaskSpec(input.taskSpec);
  const intakeSpecBinding = computeNextTaskSpecBinding(taskSpec);
  const record = {
    schemaVersion: USER_APPROVED_INTAKE_SCHEMA_VERSION,
    intakeId: buildUserApprovedIntakeId({ taskId: taskSpec.taskId, intakeSpecBinding }),
    taskId: taskSpec.taskId,
    intakeSpecBinding,
    taskSpec,
    approval,
    recordedAt: input.recordedAt,
    recorderId: input.recorderId,
  };
  return validateUserApprovedIntakeRecord(record);
}

/**
 * Semantic identity equivalence for one logical intake. Provenance-only fields
 * (recordedAt / recorderId) never participate: the same logical intake always
 * compares equal no matter when or by which recorder it was first recorded.
 */
export function userApprovedIntakeRecordsEquivalent(left, right) {
  if (!left || !right) return false;
  return (
    left.intakeId === right.intakeId &&
    left.taskId === right.taskId &&
    left.intakeSpecBinding === right.intakeSpecBinding &&
    JSON.stringify(left.taskSpec) === JSON.stringify(right.taskSpec) &&
    JSON.stringify(left.approval) === JSON.stringify(right.approval)
  );
}
