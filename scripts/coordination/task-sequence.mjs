// Bounded mutation owner: GREENHUB-COORDINATION-CURSOR-APPEND-STABILITY-12.
// Surface: scripts/coordination/*sequence* + *cursor* ONLY (append-stable ordering).
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   emitNextTask, nextTaskSpec, emissionSlot, child task generation, scheduler,
//   fan-out, executor selection, worker dispatch, Astra adapter, OpenCode adapter,
//   Web GPT adapter, autonomous Control Tower loop, application code,
//   publication automation framework.
//
// Contract summary:
//   Task identity (taskId) is distinct from cursor sequence authority.
//   The append-stable task sequence is the sole cursor ordering authority:
//     - durable under <home>/consumption/sequence/entries/<seq>.json
//     - repository worktree outside (never the repo)
//     - BOOTSTRAP ONCE from the existing task set in lexicographic taskId order
//       (legacy v1 meaning preserved for the bootstrap snapshot only)
//     - after bootstrap, new tasks append only after the frozen prefix
//     - positions immutable, exclusive-create, no overwrite, no delete-and-recreate
//     - no last-writer-wins silent takeover
//     - deterministic replay (same task -> same position, idempotent)
//     - concurrent writers: exactly one canonical winner per position
//     - corruption fail-closed, no auto-repair
//   Timestamps (createdAt/updatedAt/consumedAt/materializedAt/mtime/wall-clock)
//   are NEVER ordering authority. Sequence entries carry no timestamps.

import { TASK_ID_PATTERN } from './task-envelope.mjs';

export const TASK_SEQUENCE_CONTRACT = 'append-stable-task-sequence-v1';
export const TASK_SEQUENCE_SCHEMA_VERSION = '1';
export const LEGACY_CURSOR_SEQUENCE_CONTRACT = 'lexicographic-task-id-v1';
export const SEQUENCE_MIGRATION_SCHEMA_VERSION = '1';

export const MAX_SEQUENCE_JSON_BYTES = 16 * 1024;
export const MAX_SEQUENCE_ID_FIELD_LENGTH = 128;

export class TaskSequenceValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TaskSequenceValidationError';
    this.code = details.code ?? 'INVALID_TASK_SEQUENCE';
  }
}

function fail(message, code = 'INVALID_TASK_SEQUENCE') {
  throw new TaskSequenceValidationError(message, { code });
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, 'INVALID_TASK_ID');
  }
}

/**
 * Validate a canonical sequence entry record. Returns frozen copy.
 * Strict: exactly { schemaVersion, sequenceNumber, taskId }, no timestamps,
 * no extra emission/scheduler/adapter domains. Fail-closed, no repair.
 */
export function validateSequenceEntryRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('sequence entry record must be an object.');
  }
  const allowed = new Set(['schemaVersion', 'sequenceNumber', 'taskId']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      fail(`sequence entry must not carry extra field "${key}" (append-stable authority is seq+taskId only, no timestamps/emission).`);
    }
  }
  if (record.schemaVersion !== TASK_SEQUENCE_SCHEMA_VERSION) {
    fail(
      `sequence entry schemaVersion must be ${JSON.stringify(TASK_SEQUENCE_SCHEMA_VERSION)}.`,
      'INVALID_SCHEMA_VERSION',
    );
  }
  if (!Number.isInteger(record.sequenceNumber) || record.sequenceNumber < 1) {
    fail('sequence entry sequenceNumber must be an integer >= 1.');
  }
  assertValidTaskId(record.taskId);
  const json = JSON.stringify(record);
  if (json.length > MAX_SEQUENCE_JSON_BYTES) {
    fail('sequence entry record exceeds size budget.', 'CONTEXT_BUDGET_EXCEEDED');
  }
  return Object.freeze({ ...record });
}

/** Build a canonical sequence entry record (validated, frozen). No timestamps. */
export function buildSequenceEntryRecord({ sequenceNumber, taskId }) {
  const record = {
    schemaVersion: TASK_SEQUENCE_SCHEMA_VERSION,
    sequenceNumber,
    taskId,
  };
  return validateSequenceEntryRecord(record);
}

/** Zero-padded entry filename so lexical filename order matches numeric order. */
export function sequenceEntryFileName(sequenceNumber) {
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
    fail('sequenceNumber must be an integer >= 1 for filename.');
  }
  return `${String(sequenceNumber).padStart(10, '0')}.json`;
}

/** Parse an entry filename back to its sequence number, or null when not an entry. */
export function parseSequenceEntryFileName(fileName) {
  if (typeof fileName !== 'string') return null;
  const match = /^(\d{10})\.json$/.exec(fileName);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  // Canonical form must be zero-padded; reject non-canonical spellings.
  if (sequenceEntryFileName(parsed) !== fileName) return null;
  return parsed;
}

/**
 * Validate a sequence migration provenance record. Returns frozen copy.
 * migratedAt is provenance only and MUST NOT be used as ordering authority.
 */
export function validateSequenceMigrationRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('sequence migration record must be an object.', 'INVALID_SEQUENCE_MIGRATION');
  }
  if (record.schemaVersion !== SEQUENCE_MIGRATION_SCHEMA_VERSION) {
    fail(
      `sequence migration schemaVersion must be ${JSON.stringify(SEQUENCE_MIGRATION_SCHEMA_VERSION)}.`,
      'INVALID_SCHEMA_VERSION',
    );
  }
  if (record.fromContract !== LEGACY_CURSOR_SEQUENCE_CONTRACT) {
    fail(
      `sequence migration fromContract must be ${JSON.stringify(LEGACY_CURSOR_SEQUENCE_CONTRACT)}.`,
      'INVALID_SEQUENCE_MIGRATION',
    );
  }
  if (record.toContract !== TASK_SEQUENCE_CONTRACT) {
    fail(
      `sequence migration toContract must be ${JSON.stringify(TASK_SEQUENCE_CONTRACT)}.`,
      'INVALID_SEQUENCE_MIGRATION',
    );
  }
  if (!Array.isArray(record.preservedPrefix)) {
    fail('sequence migration preservedPrefix must be an array.', 'INVALID_SEQUENCE_MIGRATION');
  }
  for (const taskId of record.preservedPrefix) assertValidTaskId(taskId);
  if (!Array.isArray(record.appendedRemaining)) {
    fail('sequence migration appendedRemaining must be an array.', 'INVALID_SEQUENCE_MIGRATION');
  }
  for (const taskId of record.appendedRemaining) assertValidTaskId(taskId);
  if (typeof record.migratorId !== 'string' || !record.migratorId.trim()) {
    fail('sequence migration migratorId must be a non-empty string.', 'INVALID_SEQUENCE_MIGRATION');
  }
  if (record.migratorId.length > MAX_SEQUENCE_ID_FIELD_LENGTH) {
    fail('sequence migration migratorId exceeds length budget.', 'CONTEXT_BUDGET_EXCEEDED');
  }
  // migratedAt is provenance only, never ordering authority.
  if (typeof record.migratedAt !== 'string' || !record.migratedAt.trim() || !Number.isFinite(Date.parse(record.migratedAt))) {
    fail('sequence migration migratedAt must be an ISO date-time string (provenance only).', 'INVALID_SEQUENCE_MIGRATION');
  }
  const json = JSON.stringify(record);
  if (json.length > MAX_SEQUENCE_JSON_BYTES) {
    fail('sequence migration record exceeds size budget.', 'CONTEXT_BUDGET_EXCEEDED');
  }
  return Object.freeze({
    ...record,
    preservedPrefix: Object.freeze([...record.preservedPrefix]),
    appendedRemaining: Object.freeze([...record.appendedRemaining]),
  });
}

/** Build a canonical migration provenance record (validated, frozen). */
export function buildSequenceMigrationRecord({
  preservedPrefix,
  appendedRemaining,
  migratorId,
  migratedAt,
}) {
  const record = {
    schemaVersion: SEQUENCE_MIGRATION_SCHEMA_VERSION,
    fromContract: LEGACY_CURSOR_SEQUENCE_CONTRACT,
    toContract: TASK_SEQUENCE_CONTRACT,
    preservedPrefix: [...(preservedPrefix ?? [])],
    appendedRemaining: [...(appendedRemaining ?? [])],
    migratorId,
    migratedAt,
  };
  return validateSequenceMigrationRecord(record);
}
