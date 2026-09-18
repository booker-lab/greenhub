// Bounded mutation owner: GREENHUB-COORDINATION-ADMISSION-BOUND-CLAIM-15.
// Surface: scripts/coordination/*admission-bound-claim* (this module) + the
// store admission-bound claim domain ONLY (durable claimAdmittedTask /
// readAdmissionBoundClaim over the exact canonical emission admission,
// converging the exact canonical child through the existing claimTask() path).
//
// Explicitly OUT OF SCOPE (must NOT be implemented here or in the store domain):
//   scheduler, queue polling, READY scan (oldest/newest/next), priority
//   scoring, fairness, worker registry, worker capability selection,
//   agent selection, executor selection, automatic workerId inference,
//   dispatch, process spawn, OpenCode call, Astra call, ChatGPT/Web call,
//   fan-out, cron, daemon, autonomous loop, adapters, application code,
//   API/consumer/seller/driver changes, deployment automation framework,
//   production deployment, 57C.
//
// Contract summary:
//   claimAdmittedTask() != scheduleNextTask() != dispatchNextTask()
//     != decideNextTask() != emitNextTask() != admitEmittedTask().
//   The caller explicitly supplies (sourceTaskId, emissionSlot, workerId).
//   This primitive never scans emissions, never polls a queue, never picks
//   oldest/newest, never decides priority, and never runs a scheduler loop:
//   it is a consumer primitive, not a consumer daemon.
//   Ordering is SOURCE CONSUMED -> CANONICAL EMISSION -> EMISSION ADMISSION
//   -> CHILD READY -> ADMISSION-BOUND CLAIM -> CHILD CLAIMED.
//   READY -> CLAIMED itself is owned ONLY by the existing claimTask():
//   this wrapper re-verifies the live canonical admission + child binding,
//   deterministically derives the caller-provided claimToken, then calls the
//   existing claimTask(). No new claim authority model, no new lease
//   subsystem, no new claim file, no new worker registry.
//   The deterministic claim token is computed ONLY over
//   (admissionId, nextTaskId, workerId). claimedAt/nowMs/leaseExpiresAt,
//   wall clock, process id, and random UUIDs never participate: the same
//   logical admission + same worker always binds identically no matter when,
//   in which process, or under what clock skew it is replayed. Generation
//   fencing stays owned by the existing claimTask(): identical tokens across
//   generations are still fenced by generation, never by token alone.
//   Corruption fails closed with no auto-repair and no silent overwrite.

import { createHash } from 'node:crypto';
import { TASK_ID_PATTERN } from './task-envelope.mjs';

export const ADMISSION_BOUND_CLAIM_TOKEN_PREFIX = 'acm_';

export const MAX_ADMISSION_BOUND_CLAIM_ID_FIELD_LENGTH = 128;

export class AdmissionBoundClaimValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AdmissionBoundClaimValidationError';
    this.code = details.code ?? 'INVALID_ADMISSION_BOUND_CLAIM';
  }
}

function fail(message, code = 'INVALID_ADMISSION_BOUND_CLAIM') {
  throw new AdmissionBoundClaimValidationError(message, { code });
}

function assertNonEmptyBoundedString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${fieldName} must be a non-empty string.`, 'INVALID_ADMISSION_BOUND_CLAIM');
  }
  if (value.length > MAX_ADMISSION_BOUND_CLAIM_ID_FIELD_LENGTH) {
    fail(`${fieldName} exceeds ${MAX_ADMISSION_BOUND_CLAIM_ID_FIELD_LENGTH} chars.`, 'CONTEXT_BUDGET_EXCEEDED');
  }
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, 'INVALID_TASK_ID');
  }
}

/**
 * Deterministic admission-bound claim token for one canonical admission
 * binding + one explicit worker.
 * Computed ONLY over (admissionId, nextTaskId, workerId).
 * claimedAt/nowMs/leaseExpiresAt/wall-clock/process-id/random never
 * participate: same admission + same worker -> same token; same admission +
 * different worker -> different token. Fits the existing claimToken contract
 * (non-empty, <= 128 chars).
 */
export function buildAdmissionBoundClaimToken({ admissionId, nextTaskId, workerId }) {
  assertNonEmptyBoundedString(admissionId, 'admissionId');
  assertValidTaskId(nextTaskId);
  if (typeof workerId !== 'string' || !workerId.trim()) {
    fail('workerId must be a non-empty string (caller-supplied; never inferred).', 'INVALID_WORKER');
  }
  if (workerId.length > MAX_ADMISSION_BOUND_CLAIM_ID_FIELD_LENGTH) {
    fail(
      `workerId exceeds ${MAX_ADMISSION_BOUND_CLAIM_ID_FIELD_LENGTH} chars.`,
      'CONTEXT_BUDGET_EXCEEDED',
    );
  }
  const digest = createHash('sha256')
    .update(admissionId, 'utf8')
    .update('\0', 'utf8')
    .update(nextTaskId, 'utf8')
    .update('\0', 'utf8')
    .update(workerId, 'utf8')
    .digest('hex');
  return `${ADMISSION_BOUND_CLAIM_TOKEN_PREFIX}${digest}`;
}
