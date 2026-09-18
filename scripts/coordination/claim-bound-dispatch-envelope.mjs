// Bounded read owner: GREENHUB-COORDINATION-CLAIM-BOUND-DISPATCH-ENVELOPE-18.
// Surface: scripts/coordination/*claim-bound-dispatch-envelope* (this module)
// + the store claim-bound dispatch-envelope read domain ONLY (pure
// readClaimBoundDispatchEnvelope / verifyClaimBoundDispatchEnvelope over the
// exact canonical emission admission + current claim.json; no mutation,
// no repair).
//
// Explicitly OUT OF SCOPE (must NOT be implemented here or in the store domain):
//   dispatchAttempt, sendDispatch, dispatchNextTask, scheduler loop, queue
//   polling, worker selection, executor selection, adapter registry, process
//   spawn, executor invocation, ACK persistence, DISPATCHED task status,
//   EXECUTOR_ACCEPTED task status, dispatchGeneration, retry counter authority,
//   daemon, cron, result watcher, fan-out, load balancing, priority/fairness,
//   durable dispatch-attempt file, dispatch directory, exclusive-create
//   dispatch persistence, transport, HTTP/WebSocket/MCP/stdin adapter,
//   OpenCode invocation, Codex invocation, Astra invocation, ChatGPT invocation,
//   subprocess, ACK protocol, ACK storage, executor acceptance, execution
//   status, result submission changes, result authority changes, deliverResult
//   changes, scheduler, selector, worker registry, capability matching,
//   assignment authority, automatic worker inference.
//
// Contract summary:
//   buildClaimBoundDispatchEnvelope() != scheduleNextTask()
//     != dispatchNextTask() != decideNextTask() != emitNextTask()
//     != admitEmittedTask() != claimAdmittedTask().
//   The caller explicitly supplies (admissionId, nextTaskId, workerId,
//   claimGeneration). This primitive never creates/increments/resets/repairs
//   generations, never takes over claims, never extends leases, never
//   READY->CLAIMED, never scans READY, never selects workers, never dispatches,
//   and never persists: it is an identity + binding envelope, not a dispatcher.
//   Ordering is CANONICAL ADMISSION + CURRENT CLAIM -> ENVELOPE (never
//   ENVELOPE -> CLAIM): the store read re-verifies the live canonical
//   schedulable-work identity, the canonical admission identity, the exact
//   child, the current claim.json, the worker binding, the admission-bound
//   token, and CLAIMED status before building from the CURRENT generation.
//   Generation fencing stays owned by the existing claim path: identical
//   claimTokens across generations still fence by generation, while dispatch
//   identity always forks by generation.
//   The deterministic dispatch id is computed ONLY over
//   (admissionId, nextTaskId, workerId, claimGeneration) in fixed order,
//   NUL-separated, SHA-256. Timestamps, clocks, pids, hostnames, random UUIDs,
//   retry counts, and transport metadata never participate: the same logical
//   admission + task + worker + generation always binds identically no matter
//   when, in which process, or under what clock skew it is replayed.
//   Corruption fails closed with no auto-repair and no silent overwrite.

import { createHash } from 'node:crypto';
import { TASK_ID_PATTERN } from './task-envelope.mjs';

export const CLAIM_BOUND_DISPATCH_ID_PREFIX = 'dsp_';

export const MAX_CLAIM_BOUND_DISPATCH_ID_FIELD_LENGTH = 128;

// Fields that must never appear in a dispatch envelope input or envelope.
// They indicate provenance / transport / scheduler / executor smuggling:
// identity is (admissionId, nextTaskId, workerId, claimGeneration) ONLY.
// In particular emissionId, nextTaskSpecBinding, claimToken, dispatchedAt,
// sentAt, ackedAt, wall clock, mtime, pid, hostname, random UUID, retry count,
// transport metadata, and any dispatchGeneration counter are never part of
// dispatchId identity and must never be embedded here.
export const BLOCKED_CLAIM_BOUND_DISPATCH_FIELDS = Object.freeze([
  'emissionId',
  'nextTaskSpecBinding',
  'claimToken',
  'dispatchGeneration',
  'generation',
  'dispatchedAt',
  'sentAt',
  'ackedAt',
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
  'transport',
  'dispatched',
  'sent',
  'ack',
  'adapter',
  'adapters',
  'scheduler',
  'schedule',
  'scheduleNextTask',
  'dispatch',
  'dispatcher',
  'dispatchNextTask',
  'dispatchAttempt',
  'sendDispatch',
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
  'queue',
  'cron',
  'daemon',
  'astra',
  'openCode',
  'opencode',
  'autonomousLoop',
  'controlLoop',
  'schemaVersion',
]);

export class ClaimBoundDispatchValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ClaimBoundDispatchValidationError';
    this.code = details.code ?? 'INVALID_DISPATCH_BINDING';
  }
}

function fail(message, code = 'INVALID_DISPATCH_BINDING') {
  throw new ClaimBoundDispatchValidationError(message, { code });
}

function assertNonEmptyBoundedString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${fieldName} must be a non-empty string.`, 'INVALID_DISPATCH_BINDING');
  }
  if (value.length > MAX_CLAIM_BOUND_DISPATCH_ID_FIELD_LENGTH) {
    fail(
      `${fieldName} exceeds ${MAX_CLAIM_BOUND_DISPATCH_ID_FIELD_LENGTH} chars.`,
      'INVALID_DISPATCH_BINDING',
    );
  }
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`nextTaskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, 'INVALID_DISPATCH_BINDING');
  }
}

function assertValidWorkerId(workerId) {
  if (typeof workerId !== 'string' || !workerId.trim()) {
    fail('workerId must be a non-empty string (caller-supplied; never inferred).', 'INVALID_DISPATCH_BINDING');
  }
  if (workerId.length > MAX_CLAIM_BOUND_DISPATCH_ID_FIELD_LENGTH) {
    fail(
      `workerId exceeds ${MAX_CLAIM_BOUND_DISPATCH_ID_FIELD_LENGTH} chars.`,
      'INVALID_DISPATCH_BINDING',
    );
  }
}

function assertValidClaimGeneration(claimGeneration) {
  if (!Number.isInteger(claimGeneration) || claimGeneration < 1) {
    fail('claimGeneration must be an integer >= 1 (SOLE generation fencing authority).', 'INVALID_DISPATCH_BINDING');
  }
}

function assertNoBlockedDispatchFields(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const field of BLOCKED_CLAIM_BOUND_DISPATCH_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not contain "${field}": dispatch identity is ` +
          '(admissionId, nextTaskId, workerId, claimGeneration) ONLY; ' +
          'emissionId/specBinding/claimToken/timestamps/clock/pid/hostname/random/retry/transport/dispatchGeneration never participate.',
        'INVALID_DISPATCH_BINDING',
      );
    }
  }
}

/**
 * Canonical claimGeneration representation: String(integer).
 * Integer 1 serializes as "1" (no padding, no float, no hex).
 * Pinned by deterministic tests; never JSON.stringify(object).
 */
export function canonicalClaimGenerationString(claimGeneration) {
  assertValidClaimGeneration(claimGeneration);
  return String(claimGeneration);
}

/**
 * Deterministic claim-bound dispatch id for one canonical admission binding
 * + one explicit worker + one current claim generation.
 * Computed ONLY over (admissionId, nextTaskId, workerId, claimGeneration)
 * in fixed order, NUL-separated, SHA-256, encoded as `dsp_<64 hex>`.
 * Timestamps/clock/pid/hostname/random/retry/transport never participate:
 * same admission + task + worker + generation -> same id; any fork differs.
 */
export function buildClaimBoundDispatchId({ admissionId, nextTaskId, workerId, claimGeneration }) {
  assertNonEmptyBoundedString(admissionId, 'admissionId');
  assertValidTaskId(nextTaskId);
  assertValidWorkerId(workerId);
  assertValidClaimGeneration(claimGeneration);
  const generationString = canonicalClaimGenerationString(claimGeneration);
  const digest = createHash('sha256')
    .update(admissionId, 'utf8')
    .update('\0', 'utf8')
    .update(nextTaskId, 'utf8')
    .update('\0', 'utf8')
    .update(workerId, 'utf8')
    .update('\0', 'utf8')
    .update(generationString, 'utf8')
    .digest('hex');
  return `${CLAIM_BOUND_DISPATCH_ID_PREFIX}${digest}`;
}

/**
 * Build a claim-bound dispatch envelope (validated, frozen).
 * Returns exactly { dispatchId, admissionId, nextTaskId, workerId,
 * claimGeneration } in fixed key order, frozen. No timestamps, no
 * claimToken, no spec binding, no transport metadata.
 */
export function buildClaimBoundDispatchEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('dispatch envelope input must be an object.', 'INVALID_DISPATCH_BINDING');
  }
  assertNoBlockedDispatchFields(input, 'dispatch envelope input');
  const { admissionId, nextTaskId, workerId, claimGeneration } = input;
  const dispatchId = buildClaimBoundDispatchId({ admissionId, nextTaskId, workerId, claimGeneration });
  const envelope = {
    dispatchId,
    admissionId,
    nextTaskId,
    workerId,
    claimGeneration,
  };
  return validateClaimBoundDispatchEnvelope(envelope);
}

/**
 * Validate a claim-bound dispatch envelope. Returns a frozen copy.
 * Fail-closed, no repair:
 * 1. field shape validation (INVALID_DISPATCH_BINDING on malformed),
 * 2. dispatchId recomputation from the other four fields,
 * 3. exact equality check (DISPATCH_BINDING_MISMATCH on tamper),
 * 4. generation integer validity.
 */
export function validateClaimBoundDispatchEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail('dispatch envelope must be an object.', 'INVALID_DISPATCH_BINDING');
  }
  assertNoBlockedDispatchFields(envelope, 'dispatch envelope');
  const allowed = ['dispatchId', 'admissionId', 'nextTaskId', 'workerId', 'claimGeneration'];
  for (const key of Object.keys(envelope)) {
    if (!allowed.includes(key)) {
      fail(
        `dispatch envelope must not contain "${key}": envelope carries identity/binding only (dispatchId, admissionId, nextTaskId, workerId, claimGeneration).`,
        'INVALID_DISPATCH_BINDING',
      );
    }
  }
  assertNonEmptyBoundedString(envelope.admissionId, 'admissionId');
  assertValidTaskId(envelope.nextTaskId);
  assertValidWorkerId(envelope.workerId);
  assertValidClaimGeneration(envelope.claimGeneration);
  if (typeof envelope.dispatchId !== 'string' || !envelope.dispatchId.startsWith(CLAIM_BOUND_DISPATCH_ID_PREFIX)) {
    fail(`dispatchId must be a string starting with ${JSON.stringify(CLAIM_BOUND_DISPATCH_ID_PREFIX)}.`, 'INVALID_DISPATCH_BINDING');
  }
  const hex = envelope.dispatchId.slice(CLAIM_BOUND_DISPATCH_ID_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    fail('dispatchId must be `dsp_<64 lowercase hex>` (SHA-256 digest family).', 'INVALID_DISPATCH_BINDING');
  }
  let recomputed;
  try {
    recomputed = buildClaimBoundDispatchId({
      admissionId: envelope.admissionId,
      nextTaskId: envelope.nextTaskId,
      workerId: envelope.workerId,
      claimGeneration: envelope.claimGeneration,
    });
  } catch (error) {
    fail(`dispatch envelope binding invalid (fail-closed): ${error?.message}`, error?.code ?? 'INVALID_DISPATCH_BINDING');
  }
  if (envelope.dispatchId !== recomputed) {
    fail(
      `dispatch envelope dispatchId mismatch (fail-closed): expected ${recomputed}.`,
      'DISPATCH_BINDING_MISMATCH',
    );
  }
  return Object.freeze({
    dispatchId: envelope.dispatchId,
    admissionId: envelope.admissionId,
    nextTaskId: envelope.nextTaskId,
    workerId: envelope.workerId,
    claimGeneration: envelope.claimGeneration,
  });
}
