// Bounded mutation owner: GREENHUB-COORDINATION-DETERMINISTIC-NEXT-TASK-EMISSION-13.
// Surface: scripts/coordination/*emission* (this module) + the store emission
// domain ONLY (durable emitNextTask/readEmission over a CONSUMED source closure).
//
// Explicitly OUT OF SCOPE (must NOT be implemented here or in the store domain):
//   semantic next-task planning/selection, AI task generation, automatic
//   desiredExitState inference, scheduler, queue polling loop, autonomous
//   Control Tower loop, worker selection, executor dispatch, Astra adapter,
//   OpenCode adapter, ChatGPT/Web adapter, fan-out, parallel child generation,
//   DAG planner, priority queue, retry scheduler, cron, event daemon,
//   application code, API/consumer/seller/driver changes, deployment automation
//   framework, production deployment, 57C.
//
// Contract summary:
//   emitNextTask() != scheduleNextTask() != dispatchNextTask() != decideNextTask().
//   The caller (Control Tower or an upper caller) has ALREADY decided the next
//   task specification. This primitive only binds that caller-supplied spec to
//   one canonical emission slot of one fully-closed source task and durably
//   creates the child through the canonical createTask path, exactly once per
//   logical emission:
//     - source eligibility: CONSUMED only (ADOPTED -> materialization ->
//       read-back ACK -> CONSUMED chain re-verified live; RESULT_DELIVERED,
//       PENDING_DISPOSITION, BLOCKED/REJECTED/SUPERSEDED, pre-ACK, pre-CONSUMED
//       are all refused fail-closed).
//     - one source closure carries one canonical slot by default (`next`);
//       same source + same slot + same spec replays idempotently to the same
//       canonical emission; same source + same slot + different spec fails
//       closed with EMISSION_CONFLICT (first winner wins, never overwritten,
//       never last-writer-wins).
//     - concurrent writers serialize in the OS via exclusive-create: exactly
//       one canonical winner per slot; losers never overwrite the winner.
//     - timestamps (createdAt/updatedAt/emittedAt/mtime/wall-clock) are
//       provenance only, never emission identity or ordering authority: the
//       spec binding is computed over the canonical serialized spec with
//       sentinel lifecycle metadata, so wall-clock skew can never fork identity.
//     - corruption fails closed with no auto-repair and no silent overwrite.

import { createHash } from 'node:crypto';
import { TASK_ID_PATTERN, validateTaskEnvelope } from './task-envelope.mjs';
import { buildCanonicalTransitionId } from './disposition.mjs';

export const EMISSION_SCHEMA_VERSION = '1';
export const DEFAULT_EMISSION_SLOT = 'next';

export const EMISSION_SLOT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-_]{0,63}$/;

export const MAX_EMISSION_JSON_BYTES = 16 * 1024;
export const MAX_EMISSION_REF_LENGTH = 512;
export const MAX_EMISSION_ID_FIELD_LENGTH = 128;

// Sentinel lifecycle metadata used ONLY to validate the caller-supplied spec
// against the Task Envelope v1 contract without letting wall-clock time leak
// into the deterministic spec binding. Never persisted as authority.
const SPEC_BINDING_SENTINEL_AT = '1970-01-01T00:00:00.000Z';

// Inline-embed fields that violate the reference-first / context-budget
// contract and the emission boundary (no scheduler/dispatch/fan-out/adapters).
export const BLOCKED_EMISSION_INLINE_FIELDS = Object.freeze([
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
  'dispatch',
  'dispatcher',
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

// Canonical next-task spec fields, in fixed order. Lifecycle metadata
// (schemaVersion/createdAt/updatedAt/status) is store-generated and therefore
// excluded: the binding must be identical for the same logical spec no matter
// when or how many times it is emitted.
const CANONICAL_SPEC_FIELDS = Object.freeze([
  'taskId',
  'taskKind',
  'desiredExitState',
  'policyRefs',
  'evidenceRefs',
  'contextRefs',
  'authorityRequirement',
  'ownedSurface',
  'mutationBoundary',
  'proofRequirement',
]);

export class EmissionValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'EmissionValidationError';
    this.code = details.code ?? 'INVALID_EMISSION';
  }
}

function fail(message, code = 'INVALID_EMISSION') {
  throw new EmissionValidationError(message, { code });
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, 'INVALID_TASK_ID');
  }
}

function assertValidResultId(resultId) {
  if (typeof resultId !== 'string' || !resultId.trim() || resultId.length > MAX_EMISSION_ID_FIELD_LENGTH) {
    fail('resultId must be a non-empty string within length budget.', 'INVALID_EMISSION');
  }
  if (resultId.includes('/') || resultId.includes('\\') || resultId.includes('..')) {
    fail('resultId must not contain path separators or "..".', 'INVALID_EMISSION');
  }
}

export function assertValidEmissionSlot(slot) {
  if (typeof slot !== 'string' || !EMISSION_SLOT_PATTERN.test(slot)) {
    fail(
      `emissionSlot must match ${String(EMISSION_SLOT_PATTERN)} (got ${JSON.stringify(slot)}).`,
      'INVALID_EMISSION_SLOT',
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
  for (const field of BLOCKED_EMISSION_INLINE_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not embed "${field}": use policyRefs/evidenceRefs/contextRefs instead (reference-first contract); ` +
          'scheduler/dispatch/fan-out/adapter domains are out of scope.',
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

/**
 * Normalize a caller-supplied next-task spec to its canonical binding form:
 * exactly CANONICAL_SPEC_FIELDS in fixed order. The input is validated against
 * the Task Envelope v1 contract (reference-first, context budget, valid
 * taskKind, ownedSurface, mutationBoundary, proofRequirement) using sentinel
 * lifecycle metadata so wall-clock time can never fork logical identity.
 * Unknown blocked inline-embed fields fail closed instead of being dropped.
 * Returns a frozen canonical spec object.
 */
export function normalizeNextTaskSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('nextTaskSpec must be an object.');
  }
  assertNoBlockedInlineFields(input, 'nextTaskSpec');
  const nested = ['authorityRequirement', 'mutationBoundary'];
  for (const field of nested) {
    if (input[field] !== undefined) assertNoBlockedInlineFields(input[field], `nextTaskSpec.${field}`);
  }
  // Validate the full envelope contract with sentinel (deterministic)
  // lifecycle metadata. Throws CONTEXT_BUDGET_EXCEEDED / INVALID_* on dump
  // embedding, oversized payloads, or contract violations.
  try {
    validateTaskEnvelope({
      ...input,
      schemaVersion: '1',
      createdAt: SPEC_BINDING_SENTINEL_AT,
      updatedAt: SPEC_BINDING_SENTINEL_AT,
      status: 'CREATED',
    });
  } catch (error) {
    fail(`nextTaskSpec violates the Task Envelope v1 contract (fail-closed): ${error?.message}`, error?.code ?? 'INVALID_EMISSION');
  }
  const normalized = {};
  for (const field of CANONICAL_SPEC_FIELDS) {
    if (input[field] === undefined) {
      fail(`nextTaskSpec is missing canonical field "${field}".`);
    }
    normalized[field] = input[field];
  }
  return Object.freeze(normalized);
}

/**
 * Deterministic spec binding over the canonical serialized spec only.
 * Store-generated lifecycle metadata (createdAt/updatedAt/status) and
 * wall-clock emission time never participate: the same logical spec always
 * binds identically.
 */
export function computeNextTaskSpecBinding(specInput) {
  const normalized = normalizeNextTaskSpec(specInput);
  const json = JSON.stringify(normalized);
  return `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`;
}

/**
 * Deterministic emission identity for one source closure slot binding.
 * No timestamp/randomness may determine it.
 */
export function buildEmissionId({ sourceTaskId, emissionSlot, nextTaskSpecBinding }) {
  assertValidTaskId(sourceTaskId);
  assertValidEmissionSlot(emissionSlot);
  assertSpecBinding(nextTaskSpecBinding);
  const digest = createHash('sha256')
    .update(sourceTaskId, 'utf8')
    .update('\0', 'utf8')
    .update(emissionSlot, 'utf8')
    .update('\0', 'utf8')
    .update(nextTaskSpecBinding, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `emt_${digest}`;
}

export function emissionRef(sourceTaskId, emissionSlot) {
  assertValidTaskId(sourceTaskId);
  assertValidEmissionSlot(emissionSlot);
  return `${sourceTaskId}@emission:${emissionSlot}`;
}

/**
 * Validate a canonical emission record. Returns a frozen copy.
 * Fail-closed, no repair. Recomputes the spec binding from the embedded
 * canonical spec and the emission identity from (source, slot, binding) so a
 * tampered record can never validate.
 */
export function validateEmissionRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('emission record must be an object.');
  }
  assertNoBlockedInlineFields(record, 'emission record');

  if (record.schemaVersion !== EMISSION_SCHEMA_VERSION) {
    fail(
      `emission schemaVersion must be ${JSON.stringify(EMISSION_SCHEMA_VERSION)}.`,
      'INVALID_SCHEMA_VERSION',
    );
  }
  assertValidTaskId(record.sourceTaskId);
  assertValidEmissionSlot(record.emissionSlot);
  assertValidTaskId(record.nextTaskId);
  assertNonEmptyString(record.emissionId, 'emissionId', MAX_EMISSION_ID_FIELD_LENGTH);
  assertNonEmptyString(record.sourceConsumedId, 'sourceConsumedId', MAX_EMISSION_ID_FIELD_LENGTH);
  assertNonEmptyString(record.sourceMaterializationId, 'sourceMaterializationId', MAX_EMISSION_ID_FIELD_LENGTH);
  assertNonEmptyString(record.sourceAckId, 'sourceAckId', MAX_EMISSION_ID_FIELD_LENGTH);
  if (!Number.isInteger(record.dispositionGeneration) || record.dispositionGeneration < 1) {
    fail('emission dispositionGeneration must be an integer >= 1.');
  }
  assertValidResultId(record.resultId);
  assertResultBinding(record.resultBinding);
  assertNonEmptyString(record.canonicalTransitionId, 'canonicalTransitionId', 128);
  const expectedTransitionId = buildCanonicalTransitionId({
    taskId: record.sourceTaskId,
    dispositionGeneration: record.dispositionGeneration,
    resultId: record.resultId,
  });
  if (record.canonicalTransitionId !== expectedTransitionId) {
    fail(`emission canonicalTransitionId mismatch (expected ${expectedTransitionId}).`, 'EMISSION_BINDING_MISMATCH');
  }

  if (!record.nextTaskSpec || typeof record.nextTaskSpec !== 'object' || Array.isArray(record.nextTaskSpec)) {
    fail('emission nextTaskSpec must be a canonical spec object.');
  }
  assertSpecBinding(record.nextTaskSpecBinding);
  let recomputed;
  try {
    recomputed = computeNextTaskSpecBinding(record.nextTaskSpec);
  } catch (error) {
    fail(`emission nextTaskSpec invalid (fail-closed): ${error?.message}`, error?.code ?? 'INVALID_EMISSION');
  }
  if (recomputed !== record.nextTaskSpecBinding) {
    fail('emission nextTaskSpecBinding mismatch: binding does not match the embedded canonical spec (fail-closed).', 'EMISSION_BINDING_MISMATCH');
  }
  const normalized = normalizeNextTaskSpec(record.nextTaskSpec);
  if (normalized.taskId !== record.nextTaskId) {
    fail('emission nextTaskId mismatch: must equal the canonical spec taskId (fail-closed).', 'EMISSION_BINDING_MISMATCH');
  }

  const expectedEmissionId = buildEmissionId({
    sourceTaskId: record.sourceTaskId,
    emissionSlot: record.emissionSlot,
    nextTaskSpecBinding: record.nextTaskSpecBinding,
  });
  if (record.emissionId !== expectedEmissionId) {
    fail(`emission emissionId mismatch (expected ${expectedEmissionId}).`, 'EMISSION_BINDING_MISMATCH');
  }

  if (!isIsoDateTime(record.emittedAt)) fail('emittedAt must be an ISO date-time string (provenance only).');
  assertNonEmptyString(record.emitterId, 'emitterId', MAX_EMISSION_ID_FIELD_LENGTH);

  const json = JSON.stringify(record);
  if (json.length > MAX_EMISSION_JSON_BYTES) {
    fail(
      `emission record JSON is ${json.length} bytes (> ${MAX_EMISSION_JSON_BYTES}): use bounded refs, never embedded bodies.`,
      'CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return Object.freeze({ ...record, nextTaskSpec: Object.freeze({ ...record.nextTaskSpec }) });
}

/** Build a canonical emission record (validated, frozen). */
export function buildEmissionRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('emission input must be an object.');
  }
  const normalized = normalizeNextTaskSpec(input.nextTaskSpec);
  const nextTaskSpecBinding = computeNextTaskSpecBinding(normalized);
  const emissionSlot = input.emissionSlot ?? DEFAULT_EMISSION_SLOT;
  assertValidEmissionSlot(emissionSlot);
  const record = {
    ...input,
    schemaVersion: EMISSION_SCHEMA_VERSION,
    emissionId: buildEmissionId({
      sourceTaskId: input.sourceTaskId,
      emissionSlot,
      nextTaskSpecBinding,
    }),
    sourceTaskId: input.sourceTaskId,
    emissionSlot,
    nextTaskId: normalized.taskId,
    nextTaskSpec: { ...normalized },
    nextTaskSpecBinding,
    sourceConsumedId: input.sourceConsumedId,
    sourceMaterializationId: input.sourceMaterializationId,
    sourceAckId: input.sourceAckId,
    dispositionGeneration: input.dispositionGeneration,
    resultId: input.resultId,
    resultBinding: input.resultBinding,
    canonicalTransitionId: buildCanonicalTransitionId({
      taskId: input.sourceTaskId,
      dispositionGeneration: input.dispositionGeneration,
      resultId: input.resultId,
    }),
    emittedAt: input.emittedAt,
    emitterId: input.emitterId,
  };
  return validateEmissionRecord(record);
}
