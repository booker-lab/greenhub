// Bounded mutation owner: GREENHUB-COORDINATION-CANONICAL-MATERIALIZATION-CONSUMPTION-CURSOR-11.
// Surface: scripts/coordination/** materialization/readback/ACK/consumed/cursor ONLY.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   next-task emission, deterministic child-task creation, scheduler, fan-out,
//   emissionSlot, Astra integration, OpenCode integration, Web GPT adapter,
//   autonomous Control Tower loop, application code, publication automation,
//   57C, full project snapshot, chat transcript persistence.
//
// Contract summary:
//   ADOPTED disposition -> canonical per-task materialization (reference-first,
//   deterministic identity, revision-guarded) -> durable reopen/read-back
//   verification -> ACK -> CONSUMED -> highest-contiguous-consumed cursor.
//   Only ADOPTED may materialize. Raw RESULT/disposition evidence is preserved.
//   Cursor is a watermark, never truth.

import { createHash } from 'node:crypto';
import { TASK_ID_PATTERN } from './task-envelope.mjs';
import { buildCanonicalTransitionId, DISPOSITION_STATE_ADOPTED } from './disposition.mjs';

export const MATERIALIZATION_SCHEMA_VERSION = '1';
export const ACK_SCHEMA_VERSION = '1';
export const CONSUMED_SCHEMA_VERSION = '1';
export const CURSOR_SCHEMA_VERSION = '1';

// Minimal sequence contract for the cursor watermark. Derived only from
// existing durable task/result identity (lexicographic taskId order). No
// timestamp ordering is invented here.
export const CURSOR_SEQUENCE_CONTRACT = 'lexicographic-task-id-v1';

export const MATERIALIZATION_STATE_ADOPTED = DISPOSITION_STATE_ADOPTED;

export const MAX_MATERIALIZATION_JSON_BYTES = 16 * 1024;
export const MAX_MATERIALIZATION_REF_LENGTH = 512;
export const MAX_MATERIALIZATION_ID_FIELD_LENGTH = 128;

// Inline-embed fields that violate reference-first / context-budget and the
// emission/adapter boundary. Materialization/ACK/CONSUMED/cursor records must
// carry refs only, never dumps, transcripts, SSOT bodies, or emission domains.
export const BLOCKED_MATERIALIZATION_INLINE_FIELDS = Object.freeze([
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
  'dispositionBody',
  'taskBody',
  'syncCursor',
  'cursor',
  'consumed',
  'acknowledged',
  'acknowledgement',
  'materializationBody',
  'nextTasks',
  'nextTask',
  'emission',
  'emissionSlot',
  'scheduler',
  'schedule',
  'fanOut',
  'fanout',
  'adapter',
  'adapters',
  'astra',
  'openCode',
  'opencode',
  'autonomousLoop',
  'controlLoop',
]);

export class MaterializationValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MaterializationValidationError';
    this.code = details.code ?? 'INVALID_MATERIALIZATION';
  }
}

function fail(message, code = 'INVALID_MATERIALIZATION') {
  throw new MaterializationValidationError(message, { code });
}

export function isIsoDateTime(value) {
  if (typeof value !== 'string' || !value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function assertNonEmptyString(value, fieldName, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${fieldName} must be a non-empty string.`);
  }
  if (maxLength > 0 && value.length > maxLength) {
    fail(`${fieldName} exceeds ${maxLength} chars.`, 'CONTEXT_BUDGET_EXCEEDED');
  }
}

function assertRefStringArray(value, fieldName) {
  if (!Array.isArray(value)) fail(`${fieldName} must be an array of reference strings.`);
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      fail(`${fieldName} entries must be non-empty reference strings.`);
    }
    if (entry.length > MAX_MATERIALIZATION_REF_LENGTH) {
      fail(
        `${fieldName} entry exceeds ${MAX_MATERIALIZATION_REF_LENGTH} chars: reference-first contract requires short refs, not embedded bodies.`,
        'CONTEXT_BUDGET_EXCEEDED',
      );
    }
    if (entry.includes('\n\n\n')) {
      fail(`${fieldName} entry looks like an embedded dump, not a reference.`, 'CONTEXT_BUDGET_EXCEEDED');
    }
  }
}

function assertNoBlockedInlineFields(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return;
  for (const field of BLOCKED_MATERIALIZATION_INLINE_FIELDS) {
    if (Object.hasOwn(record, field)) {
      fail(
        `record must not embed "${field}": use policyRefs/proofRefs/evidenceRefs/authorityRefs instead (reference-first contract).`,
        'CONTEXT_BUDGET_EXCEEDED',
      );
    }
  }
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, 'INVALID_TASK_ID');
  }
}

function assertValidResultId(resultId) {
  assertNonEmptyString(resultId, 'resultId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  if (resultId.includes('/') || resultId.includes('\\') || resultId.includes('..')) {
    fail('resultId must not contain path separators or "..".');
  }
}

/**
 * Deterministic materialization identity for the same ADOPTED disposition.
 * No timestamp/randomness may determine it.
 */
export function buildMaterializationId({ taskId, dispositionGeneration, resultId }) {
  assertValidTaskId(taskId);
  if (!Number.isInteger(dispositionGeneration) || dispositionGeneration < 1) {
    fail('dispositionGeneration must be an integer >= 1 for materializationId.');
  }
  assertValidResultId(resultId);
  const digest = createHash('sha256')
    .update(taskId, 'utf8')
    .update('\0', 'utf8')
    .update(String(dispositionGeneration), 'utf8')
    .update('\0', 'utf8')
    .update(resultId, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `mat_${digest}`;
}

/** Deterministic ACK identity bound to the materialization identity. */
export function buildAckId({ taskId, materializationId }) {
  assertValidTaskId(taskId);
  assertNonEmptyString(materializationId, 'materializationId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  const digest = createHash('sha256')
    .update(taskId, 'utf8')
    .update('\0', 'utf8')
    .update(materializationId, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `ack_${digest}`;
}

/** Deterministic CONSUMED identity bound to the materialization + ACK identity. */
export function buildConsumedId({ taskId, materializationId, ackId }) {
  assertValidTaskId(taskId);
  assertNonEmptyString(materializationId, 'materializationId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  assertNonEmptyString(ackId, 'ackId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  const digest = createHash('sha256')
    .update(taskId, 'utf8')
    .update('\0', 'utf8')
    .update(materializationId, 'utf8')
    .update('\0', 'utf8')
    .update(ackId, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `con_${digest}`;
}

export function materializationRef(taskId, dispositionGeneration) {
  assertValidTaskId(taskId);
  if (!Number.isInteger(dispositionGeneration) || dispositionGeneration < 1) {
    fail('dispositionGeneration must be an integer >= 1 for materializationRef.');
  }
  return `${taskId}@${dispositionGeneration}`;
}

function assertResultBinding(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail('resultBinding must be a stable content hash of form "sha256:<64 hex>".');
  }
}

/**
 * Validate a canonical per-task materialization record. Returns frozen copy.
 * Fail-closed, no repair.
 */
export function validateMaterializationRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('materialization record must be an object.');
  }
  assertNoBlockedInlineFields(record);

  if (record.schemaVersion !== MATERIALIZATION_SCHEMA_VERSION) {
    fail(
      `materialization schemaVersion must be ${JSON.stringify(MATERIALIZATION_SCHEMA_VERSION)}.`,
      'INVALID_SCHEMA_VERSION',
    );
  }
  assertValidTaskId(record.taskId);
  assertValidResultId(record.resultId);
  if (!Number.isInteger(record.claimGeneration) || record.claimGeneration < 1) {
    fail('claimGeneration (provenance) must be an integer >= 1.');
  }
  if (!Number.isInteger(record.dispositionGeneration) || record.dispositionGeneration < 1) {
    fail('dispositionGeneration must be an integer >= 1.');
  }
  assertNonEmptyString(record.dispositionRef, 'dispositionRef', MAX_MATERIALIZATION_REF_LENGTH);
  if (record.dispositionRef !== materializationRef(record.taskId, record.dispositionGeneration)) {
    fail(`dispositionRef must equal "${materializationRef(record.taskId, record.dispositionGeneration)}".`);
  }
  assertNonEmptyString(record.canonicalTransitionId, 'canonicalTransitionId', 128);
  const expectedTransitionId = buildCanonicalTransitionId({
    taskId: record.taskId,
    dispositionGeneration: record.dispositionGeneration,
    resultId: record.resultId,
  });
  if (record.canonicalTransitionId !== expectedTransitionId) {
    fail(`canonicalTransitionId mismatch (expected ${expectedTransitionId}).`, 'DISPOSITION_TRANSITION_ID_MISMATCH');
  }
  assertResultBinding(record.resultBinding);
  if (record.state !== MATERIALIZATION_STATE_ADOPTED) {
    fail(
      `materialization state must be ADOPTED (got ${JSON.stringify(record.state)}): only ADOPTED dispositions may materialize.`,
      'MATERIALIZATION_NOT_ELIGIBLE',
    );
  }
  assertNonEmptyString(record.materializationId, 'materializationId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  const expectedId = buildMaterializationId({
    taskId: record.taskId,
    dispositionGeneration: record.dispositionGeneration,
    resultId: record.resultId,
  });
  if (record.materializationId !== expectedId) {
    fail(`materializationId mismatch (expected ${expectedId}).`, 'MATERIALIZATION_ID_MISMATCH');
  }
  assertRefStringArray(record.policyRefs ?? [], 'policyRefs');
  assertRefStringArray(record.proofRefs ?? [], 'proofRefs');
  assertRefStringArray(record.evidenceRefs ?? [], 'evidenceRefs');
  if (record.authorityRefs !== undefined) assertRefStringArray(record.authorityRefs, 'authorityRefs');
  if (record.publicationRefs !== undefined) assertRefStringArray(record.publicationRefs, 'publicationRefs');
  if (record.closureRefs !== undefined) assertRefStringArray(record.closureRefs, 'closureRefs');
  if (!isIsoDateTime(record.materializedAt)) fail('materializedAt must be an ISO date-time string.');
  assertNonEmptyString(record.materializerId, 'materializerId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);

  const json = JSON.stringify(record);
  if (json.length > MAX_MATERIALIZATION_JSON_BYTES) {
    fail(
      `materialization record JSON is ${json.length} bytes (> ${MAX_MATERIALIZATION_JSON_BYTES}): use bounded refs, never embedded bodies.`,
      'CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return Object.freeze({ ...record });
}

/** Build a canonical materialization record (validated, frozen). */
export function buildMaterializationRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('materialization input must be an object.');
  }
  const record = {
    ...input,
    schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
    materializationId: buildMaterializationId({
      taskId: input.taskId,
      dispositionGeneration: input.dispositionGeneration,
      resultId: input.resultId,
    }),
    taskId: input.taskId,
    resultId: input.resultId,
    claimGeneration: input.claimGeneration,
    dispositionGeneration: input.dispositionGeneration,
    dispositionRef: materializationRef(input.taskId, input.dispositionGeneration),
    canonicalTransitionId: buildCanonicalTransitionId({
      taskId: input.taskId,
      dispositionGeneration: input.dispositionGeneration,
      resultId: input.resultId,
    }),
    resultBinding: input.resultBinding,
    state: MATERIALIZATION_STATE_ADOPTED,
    policyRefs: input.policyRefs ?? [],
    proofRefs: input.proofRefs ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    ...(input.authorityRefs === undefined ? {} : { authorityRefs: input.authorityRefs }),
    ...(input.publicationRefs === undefined ? {} : { publicationRefs: input.publicationRefs }),
    ...(input.closureRefs === undefined ? {} : { closureRefs: input.closureRefs }),
    materializedAt: input.materializedAt,
    materializerId: input.materializerId,
  };
  return validateMaterializationRecord(record);
}

/** Validate an ACK record bound to a materialization identity. */
export function validateAckRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('ack record must be an object.', 'INVALID_ACK');
  }
  assertNoBlockedInlineFields(record);
  if (record.schemaVersion !== ACK_SCHEMA_VERSION) {
    fail(`ack schemaVersion must be ${JSON.stringify(ACK_SCHEMA_VERSION)}.`, 'INVALID_SCHEMA_VERSION');
  }
  assertValidTaskId(record.taskId);
  assertValidResultId(record.resultId);
  if (!Number.isInteger(record.dispositionGeneration) || record.dispositionGeneration < 1) {
    fail('ack dispositionGeneration must be an integer >= 1.', 'INVALID_ACK');
  }
  assertNonEmptyString(record.materializationId, 'materializationId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  const expectedMaterializationId = buildMaterializationId({
    taskId: record.taskId,
    dispositionGeneration: record.dispositionGeneration,
    resultId: record.resultId,
  });
  if (record.materializationId !== expectedMaterializationId) {
    fail(`ack materializationId mismatch (expected ${expectedMaterializationId}).`, 'ACK_BINDING_MISMATCH');
  }
  assertNonEmptyString(record.ackId, 'ackId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  const expectedAckId = buildAckId({ taskId: record.taskId, materializationId: record.materializationId });
  if (record.ackId !== expectedAckId) {
    fail(`ackId mismatch (expected ${expectedAckId}).`, 'ACK_BINDING_MISMATCH');
  }
  assertNonEmptyString(record.canonicalTransitionId, 'canonicalTransitionId', 128);
  const expectedTransitionId = buildCanonicalTransitionId({
    taskId: record.taskId,
    dispositionGeneration: record.dispositionGeneration,
    resultId: record.resultId,
  });
  if (record.canonicalTransitionId !== expectedTransitionId) {
    fail(`ack canonicalTransitionId mismatch (expected ${expectedTransitionId}).`, 'ACK_BINDING_MISMATCH');
  }
  assertResultBinding(record.resultBinding);
  if (!isIsoDateTime(record.ackedAt)) fail('ackedAt must be an ISO date-time string.', 'INVALID_ACK');
  assertNonEmptyString(record.acknowledgerId, 'acknowledgerId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  assertRefStringArray(record.proofRefs ?? [], 'proofRefs');
  const json = JSON.stringify(record);
  if (json.length > MAX_MATERIALIZATION_JSON_BYTES) {
    fail('ack record exceeds size budget; keep refs short.', 'CONTEXT_BUDGET_EXCEEDED');
  }
  return Object.freeze({ ...record });
}

/** Build a canonical ACK record (validated, frozen). */
export function buildAckRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('ack input must be an object.', 'INVALID_ACK');
  }
  const materializationId = buildMaterializationId({
    taskId: input.taskId,
    dispositionGeneration: input.dispositionGeneration,
    resultId: input.resultId,
  });
  const record = {
    ...input,
    schemaVersion: ACK_SCHEMA_VERSION,
    ackId: buildAckId({ taskId: input.taskId, materializationId }),
    taskId: input.taskId,
    materializationId,
    dispositionGeneration: input.dispositionGeneration,
    resultId: input.resultId,
    canonicalTransitionId: buildCanonicalTransitionId({
      taskId: input.taskId,
      dispositionGeneration: input.dispositionGeneration,
      resultId: input.resultId,
    }),
    resultBinding: input.resultBinding,
    ackedAt: input.ackedAt,
    acknowledgerId: input.acknowledgerId,
    proofRefs: input.proofRefs ?? [],
  };
  return validateAckRecord(record);
}

/** Validate a CONSUMED record bound to materialization + ACK identity. */
export function validateConsumedRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('consumed record must be an object.', 'INVALID_CONSUMED');
  }
  assertNoBlockedInlineFields(record);
  if (record.schemaVersion !== CONSUMED_SCHEMA_VERSION) {
    fail(`consumed schemaVersion must be ${JSON.stringify(CONSUMED_SCHEMA_VERSION)}.`, 'INVALID_SCHEMA_VERSION');
  }
  assertValidTaskId(record.taskId);
  assertValidResultId(record.resultId);
  if (!Number.isInteger(record.dispositionGeneration) || record.dispositionGeneration < 1) {
    fail('consumed dispositionGeneration must be an integer >= 1.', 'INVALID_CONSUMED');
  }
  assertNonEmptyString(record.materializationId, 'materializationId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  const expectedMaterializationId = buildMaterializationId({
    taskId: record.taskId,
    dispositionGeneration: record.dispositionGeneration,
    resultId: record.resultId,
  });
  if (record.materializationId !== expectedMaterializationId) {
    fail(`consumed materializationId mismatch (expected ${expectedMaterializationId}).`, 'CONSUMED_BINDING_MISMATCH');
  }
  const expectedAckId = buildAckId({ taskId: record.taskId, materializationId: record.materializationId });
  assertNonEmptyString(record.ackId, 'ackId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  if (record.ackId !== expectedAckId) {
    fail(`consumed ackId mismatch (expected ${expectedAckId}).`, 'CONSUMED_BINDING_MISMATCH');
  }
  assertNonEmptyString(record.consumedId, 'consumedId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  const expectedConsumedId = buildConsumedId({
    taskId: record.taskId,
    materializationId: record.materializationId,
    ackId: record.ackId,
  });
  if (record.consumedId !== expectedConsumedId) {
    fail(`consumedId mismatch (expected ${expectedConsumedId}).`, 'CONSUMED_BINDING_MISMATCH');
  }
  assertNonEmptyString(record.canonicalTransitionId, 'canonicalTransitionId', 128);
  const expectedTransitionId = buildCanonicalTransitionId({
    taskId: record.taskId,
    dispositionGeneration: record.dispositionGeneration,
    resultId: record.resultId,
  });
  if (record.canonicalTransitionId !== expectedTransitionId) {
    fail(`consumed canonicalTransitionId mismatch (expected ${expectedTransitionId}).`, 'CONSUMED_BINDING_MISMATCH');
  }
  assertResultBinding(record.resultBinding);
  if (!isIsoDateTime(record.consumedAt)) fail('consumedAt must be an ISO date-time string.', 'INVALID_CONSUMED');
  assertNonEmptyString(record.consumerId, 'consumerId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  assertRefStringArray(record.proofRefs ?? [], 'proofRefs');
  const json = JSON.stringify(record);
  if (json.length > MAX_MATERIALIZATION_JSON_BYTES) {
    fail('consumed record exceeds size budget; keep refs short.', 'CONTEXT_BUDGET_EXCEEDED');
  }
  return Object.freeze({ ...record });
}

/** Build a canonical CONSUMED record (validated, frozen). */
export function buildConsumedRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('consumed input must be an object.', 'INVALID_CONSUMED');
  }
  const materializationId = buildMaterializationId({
    taskId: input.taskId,
    dispositionGeneration: input.dispositionGeneration,
    resultId: input.resultId,
  });
  const ackId = buildAckId({ taskId: input.taskId, materializationId });
  const record = {
    ...input,
    schemaVersion: CONSUMED_SCHEMA_VERSION,
    consumedId: buildConsumedId({ taskId: input.taskId, materializationId, ackId }),
    taskId: input.taskId,
    materializationId,
    ackId,
    dispositionGeneration: input.dispositionGeneration,
    resultId: input.resultId,
    canonicalTransitionId: buildCanonicalTransitionId({
      taskId: input.taskId,
      dispositionGeneration: input.dispositionGeneration,
      resultId: input.resultId,
    }),
    resultBinding: input.resultBinding,
    consumedAt: input.consumedAt,
    consumerId: input.consumerId,
    proofRefs: input.proofRefs ?? [],
  };
  return validateConsumedRecord(record);
}

/**
 * Validate the global cursor watermark record. Returns frozen copy.
 * watermarkTaskId is null when no contiguous CONSUMED prefix exists yet.
 */
export function validateCursorRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('cursor record must be an object.', 'INVALID_CURSOR');
  }
  assertNoBlockedInlineFields(record);
  if (record.schemaVersion !== CURSOR_SCHEMA_VERSION) {
    fail(`cursor schemaVersion must be ${JSON.stringify(CURSOR_SCHEMA_VERSION)}.`, 'INVALID_SCHEMA_VERSION');
  }
  if (record.sequenceContract !== CURSOR_SEQUENCE_CONTRACT) {
    fail(`cursor sequenceContract must be ${JSON.stringify(CURSOR_SEQUENCE_CONTRACT)}.`, 'INVALID_CURSOR');
  }
  if (!Array.isArray(record.consumedThrough)) {
    fail('cursor consumedThrough must be an array of taskIds.', 'INVALID_CURSOR');
  }
  const seen = new Set();
  let previous = null;
  for (const taskId of record.consumedThrough) {
    assertValidTaskId(taskId);
    if (seen.has(taskId)) fail('cursor consumedThrough must not contain duplicates.', 'INVALID_CURSOR');
    seen.add(taskId);
    if (previous !== null && !(previous < taskId)) {
      fail('cursor consumedThrough must be strictly ascending lexicographic order.', 'INVALID_CURSOR');
    }
    previous = taskId;
  }
  if (record.consumedThrough.length === 0) {
    if (record.watermarkTaskId !== null) {
      fail('cursor watermarkTaskId must be null when consumedThrough is empty.', 'INVALID_CURSOR');
    }
  } else {
    const last = record.consumedThrough[record.consumedThrough.length - 1];
    if (record.watermarkTaskId !== last) {
      fail('cursor watermarkTaskId must equal the last entry of consumedThrough.', 'INVALID_CURSOR');
    }
  }
  if (record.watermarkTaskId !== null) assertValidTaskId(record.watermarkTaskId);
  if (!isIsoDateTime(record.updatedAt)) fail('cursor updatedAt must be an ISO date-time string.', 'INVALID_CURSOR');
  assertNonEmptyString(record.evaluatorId, 'evaluatorId', MAX_MATERIALIZATION_ID_FIELD_LENGTH);
  const json = JSON.stringify(record);
  if (json.length > MAX_MATERIALIZATION_JSON_BYTES) {
    fail('cursor record exceeds size budget.', 'CONTEXT_BUDGET_EXCEEDED');
  }
  return Object.freeze({ ...record, consumedThrough: Object.freeze([...record.consumedThrough]) });
}

/** Build a canonical cursor record (validated, frozen). */
export function buildCursorRecord({ watermarkTaskId, consumedThrough, updatedAt, evaluatorId }) {
  const record = {
    schemaVersion: CURSOR_SCHEMA_VERSION,
    sequenceContract: CURSOR_SEQUENCE_CONTRACT,
    watermarkTaskId: watermarkTaskId ?? null,
    consumedThrough: [...(consumedThrough ?? [])],
    updatedAt,
    evaluatorId,
  };
  return validateCursorRecord(record);
}
