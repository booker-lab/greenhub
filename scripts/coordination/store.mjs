// Bounded mutation owner: GREENHUB-COORDINATION-DURABLE-CORE-01
// + GREENHUB-COORDINATION-DISPOSITION-STORE-07 (disposition persistence/state/fencing only)
// + GREENHUB-COORDINATION-CANONICAL-MATERIALIZATION-CONSUMPTION-CURSOR-11
//   (ADOPTED materialization/read-back/ACK/CONSUMED/cursor only; no emission).
// + GREENHUB-COORDINATION-CURSOR-APPEND-STABILITY-12
//   (append-stable task sequence + v1 cursor migration ONLY; no emission).
// Durable local coordination store: TASK CREATED -> READY -> CLAIMED -> RESULT_DELIVERED,
// plus a separate durable disposition domain (PENDING_DISPOSITION/BLOCKED/
// NEEDS_USER_DECISION/ADOPTED/REJECTED/SUPERSEDED) bound to the canonical result,
// plus ADOPTED-only canonical per-task materialization with durable read-back,
// ACK, CONSUMED, and highest-contiguous-CONSUMED cursor over an append-stable
// task sequence. Next-task emission,
// scheduler, fan-out, adapters, Astra/OpenCode integration, autonomous loop,
// application code, publication automation, and 57C remain out of scope.
//
// Filesystem layout under a durable home (never the repository worktree):
//   <home>/tasks/<taskId>/task.json
//   <home>/tasks/<taskId>/claim.json
//   <home>/tasks/<taskId>/result.json            (canonical terminal result)
//   <home>/tasks/<taskId>/results/<resultId>.json (per-delivery record)
//   <home>/tasks/<taskId>/disposition/current.json
//   <home>/tasks/<taskId>/disposition/generations/<n>.json (immutable history)
//   <home>/tasks/<taskId>/materialization.json  (ADOPTED-only canonical adoption record)
//   <home>/tasks/<taskId>/ack.json              (durable read-back ACK, bound to materialization)
//   <home>/tasks/<taskId>/consumed.json         (durable closure marker, bound to ACK)
//   <home>/consumption/cursor.json              (highest contiguous CONSUMED watermark; not truth)
//   <home>/consumption/sequence/entries/<seq10>.json (append-stable task sequence; not truth)
//   <home>/consumption/sequence/migration.json  (v1 migration provenance, if migrated)
//
// Claim atomicity uses OS exclusive-create (`wx`) semantics plus a
// read-verify-unlink-recreate takeover dance (same family as
// scripts/dev/local/runtime-lease.mjs). The race-prone
// `exists() -> write()` pattern is never used: every creation goes through
// `openSync(path, 'wx')`, so concurrent claimants serialize in the OS and
// exactly one wins. Takeover additionally re-verifies generation before
// unlink so a concurrent winner is never clobbered silently.
//
// Cursor/disposition note: delivered results stay in the inbox; CONSUMED is a
// durable closure marker and cursor.json is only the highest contiguous
// CONSUMED watermark. Raw RESULT/disposition/materialization history is never
// deleted by ACK/CONSUMED/cursor.

import { randomUUID } from 'node:crypto';
import nodeFs from 'node:fs';
import nodePath from 'node:path';
import { resolveCoordinationHome, resolveTaskDirectory } from './coordination-home.mjs';
import {
  CLAIM_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  TASK_STATUS_CLAIMED,
  TASK_STATUS_CREATED,
  TASK_STATUS_READY,
  TASK_STATUS_RESULT_DELIVERED,
  assertValidTaskId,
  buildTaskEnvelope,
  validateClaimRecord,
  validateResultEnvelope,
  validateTaskEnvelope,
} from './task-envelope.mjs';
import {
  DISPOSITION_STATE_ADOPTED,
  DISPOSITION_STATE_PENDING,
  assertLegalDispositionTransition,
  buildCanonicalTransitionId,
  buildDispositionRecord,
  computeResultBinding,
  validateDispositionRecord,
} from './disposition.mjs';
import {
  CURSOR_SEQUENCE_CONTRACT,
  LEGACY_CURSOR_SEQUENCE_CONTRACT,
  buildAckRecord,
  buildConsumedRecord,
  buildMaterializationRecord,
  validateAckRecord,
  validateConsumedRecord,
  validateCursorRecord,
  validateLegacyCursorRecord,
  validateMaterializationRecord,
} from './materialization.mjs';
import {
  buildSequenceEntryRecord,
  buildSequenceMigrationRecord,
  parseSequenceEntryFileName,
  sequenceEntryFileName,
  validateSequenceEntryRecord,
  validateSequenceMigrationRecord,
} from './task-sequence.mjs';

export const LEASE_ACTIVE = 'LEASE_ACTIVE';
export const CLAIM_NOT_FOUND = 'CLAIM_NOT_FOUND';
export const STALE_CLAIM = 'STALE_CLAIM';
export const TASK_ALREADY_EXISTS = 'TASK_ALREADY_EXISTS';
export const TASK_NOT_FOUND = 'TASK_NOT_FOUND';
export const TASK_NOT_READY = 'TASK_NOT_READY';
export const TASK_TERMINAL = 'TASK_TERMINAL';
export const DUPLICATE_RESULT_ID_CONFLICT = 'DUPLICATE_RESULT_ID_CONFLICT';
export const DISPOSITION_NOT_FOUND = 'DISPOSITION_NOT_FOUND';
export const DISPOSITION_CONFLICT = 'DISPOSITION_CONFLICT';
export const STALE_DISPOSITION_GENERATION = 'STALE_DISPOSITION_GENERATION';
export const DISPOSITION_GENERATION_GAP = 'DISPOSITION_GENERATION_GAP';
export const DISPOSITION_ILLEGAL_TRANSITION = 'DISPOSITION_ILLEGAL_TRANSITION';
export const DISPOSITION_MISSING_RESULT = 'DISPOSITION_MISSING_RESULT';
export const DISPOSITION_RESULT_MISMATCH = 'DISPOSITION_RESULT_MISMATCH';
export const DISPOSITION_RESULT_BINDING_MISMATCH = 'DISPOSITION_RESULT_BINDING_MISMATCH';
export const DISPOSITION_TRANSITION_ID_MISMATCH = 'DISPOSITION_TRANSITION_ID_MISMATCH';
export const CORRUPT_DISPOSITION = 'CORRUPT_DISPOSITION';
export const DISPOSITION_TASK_NOT_DELIVERED = 'DISPOSITION_TASK_NOT_DELIVERED';
export const MATERIALIZATION_NOT_ELIGIBLE = 'MATERIALIZATION_NOT_ELIGIBLE';
export const MATERIALIZATION_CONFLICT = 'MATERIALIZATION_CONFLICT';
export const MATERIALIZATION_ID_MISMATCH = 'MATERIALIZATION_ID_MISMATCH';
export const CORRUPT_MATERIALIZATION = 'CORRUPT_MATERIALIZATION';
export const MATERIALIZATION_NOT_FOUND = 'MATERIALIZATION_NOT_FOUND';
export const ACK_NOT_READY = 'ACK_NOT_READY';
export const ACK_CONFLICT = 'ACK_CONFLICT';
export const ACK_BINDING_MISMATCH = 'ACK_BINDING_MISMATCH';
export const CORRUPT_ACK = 'CORRUPT_ACK';
export const ACK_NOT_FOUND = 'ACK_NOT_FOUND';
export const CONSUMED_NOT_READY = 'CONSUMED_NOT_READY';
export const CONSUMED_CONFLICT = 'CONSUMED_CONFLICT';
export const CONSUMED_BINDING_MISMATCH = 'CONSUMED_BINDING_MISMATCH';
export const CORRUPT_CONSUMED = 'CORRUPT_CONSUMED';
export const CONSUMED_NOT_FOUND = 'CONSUMED_NOT_FOUND';
export const CURSOR_NOT_FOUND = 'CURSOR_NOT_FOUND';
export const CORRUPT_CURSOR = 'CORRUPT_CURSOR';
export const CURSOR_CONFLICT = 'CURSOR_CONFLICT';
export const CURSOR_REWIND_REFUSED = 'CURSOR_REWIND_REFUSED';
export const CURSOR_ORDER_VIOLATION = 'CURSOR_ORDER_VIOLATION';
export const CORRUPT_SEQUENCE = 'CORRUPT_SEQUENCE';
export const SEQUENCE_CONFLICT = 'SEQUENCE_CONFLICT';
export const SEQUENCE_ORDER_VIOLATION = 'SEQUENCE_ORDER_VIOLATION';

export class CoordinationStoreError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CoordinationStoreError';
    this.code = details.code ?? 'COORDINATION_STORE_ERROR';
    this.taskId = details.taskId;
  }
}

function storeFail(message, details = {}) {
  throw new CoordinationStoreError(message, details);
}

function taskFilePaths(home, taskId) {
  const taskDir = resolveTaskDirectory(home, taskId);
  return {
    taskDir,
    taskPath: nodePath.join(taskDir, 'task.json'),
    claimPath: nodePath.join(taskDir, 'claim.json'),
    resultPath: nodePath.join(taskDir, 'result.json'),
    resultsDir: nodePath.join(taskDir, 'results'),
    dispositionDir: nodePath.join(taskDir, 'disposition'),
    dispositionCurrentPath: nodePath.join(taskDir, 'disposition', 'current.json'),
    dispositionGenerationsDir: nodePath.join(taskDir, 'disposition', 'generations'),
    materializationPath: nodePath.join(taskDir, 'materialization.json'),
    ackPath: nodePath.join(taskDir, 'ack.json'),
    consumedPath: nodePath.join(taskDir, 'consumed.json'),
  };
}

function cursorFilePath(home) {
  return nodePath.join(home, 'consumption', 'cursor.json');
}

function listTaskIds(home) {
  let entries;
  try {
    entries = nodeFs.readdirSync(nodePath.join(home, 'tasks'), { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        assertValidTaskId(name);
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

// ---------------------------------------------------------------------------
// Append-stable task sequence authority (CURSOR_APPEND_STABILITY).
// Durable under <home>/consumption/sequence/entries/<seq10>.json.
// BOOTSTRAP ONCE from the existing task set lexicographically; afterwards
// new tasks append only after the frozen prefix. Positions immutable,
// exclusive-create, no overwrite, no delete-and-recreate, no timestamps.
// ---------------------------------------------------------------------------

function sequenceBaseDirectory(home) {
  return nodePath.join(home, 'consumption', 'sequence');
}

function sequenceEntriesDirectory(home) {
  return nodePath.join(sequenceBaseDirectory(home), 'entries');
}

function sequenceMigrationFilePath(home) {
  return nodePath.join(sequenceBaseDirectory(home), 'migration.json');
}

function sequenceEntryPath(home, sequenceNumber) {
  return nodePath.join(sequenceEntriesDirectory(home), sequenceEntryFileName(sequenceNumber));
}

function readValidatedSequenceEntryDocument(path, expectedSequenceNumber) {
  const found = readJsonFile(path);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') {
    storeFail(
      `task sequence entry is corrupt (fail-closed, no auto-repair): seq=${expectedSequenceNumber}`,
      { code: CORRUPT_SEQUENCE },
    );
  }
  let record;
  try {
    record = validateSequenceEntryRecord(found.document);
  } catch (error) {
    const code =
      error?.code === 'CONTEXT_BUDGET_EXCEEDED' ? 'CONTEXT_BUDGET_EXCEEDED' : CORRUPT_SEQUENCE;
    storeFail(`task sequence entry invalid (fail-closed): seq=${expectedSequenceNumber}: ${error?.message}`, {
      code,
    });
  }
  if (record.sequenceNumber !== expectedSequenceNumber) {
    storeFail(
      `task sequence entry number/filename mismatch (fail-closed): expected=${expectedSequenceNumber} got=${record.sequenceNumber}`,
      { code: CORRUPT_SEQUENCE },
    );
  }
  return { state: 'present', record };
}

/**
 * Load the canonical append-stable sequence, validated fail-closed.
 * Returns array of { sequenceNumber, taskId } sorted by sequenceNumber.
 * Empty array means not yet bootstrapped (not an error).
 * Corruption (gap, duplicate seq/task, invalid entry) throws fail-closed.
 */
function listCanonicalSequenceEntries(home) {
  let names;
  try {
    names = nodeFs.readdirSync(sequenceEntriesDirectory(home));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const parsed = [];
  for (const name of names) {
    const seq = parseSequenceEntryFileName(name);
    if (seq === null) {
      storeFail(`task sequence directory contains non-entry file (fail-closed): ${name}`, {
        code: CORRUPT_SEQUENCE,
      });
    }
    parsed.push(seq);
  }
  parsed.sort((a, b) => a - b);
  const entries = [];
  const seenTaskIds = new Set();
  let expected = 1;
  for (const seq of parsed) {
    if (seq !== expected) {
      storeFail(`task sequence gap (fail-closed): expected seq=${expected} got=${seq}`, {
        code: CORRUPT_SEQUENCE,
      });
    }
    const found = readValidatedSequenceEntryDocument(sequenceEntryPath(home, seq), seq);
    if (found.state === 'missing') {
      storeFail(`task sequence entry vanished during load (fail-closed): seq=${seq}`, {
        code: CORRUPT_SEQUENCE,
      });
    }
    if (seenTaskIds.has(found.record.taskId)) {
      storeFail(`task sequence duplicate membership (fail-closed): ${found.record.taskId}`, {
        code: CORRUPT_SEQUENCE,
      });
    }
    seenTaskIds.add(found.record.taskId);
    entries.push(found.record);
    expected += 1;
  }
  return entries;
}

function readValidatedSequenceMigrationDocument(path) {
  const found = readJsonFile(path);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') {
    storeFail('task sequence migration provenance is corrupt (fail-closed, no auto-repair).', {
      code: CORRUPT_SEQUENCE,
    });
  }
  let record;
  try {
    record = validateSequenceMigrationRecord(found.document);
  } catch (error) {
    storeFail(`task sequence migration provenance invalid (fail-closed): ${error?.message}`, {
      code: CORRUPT_SEQUENCE,
    });
  }
  return { state: 'present', record };
}

/**
 * Claim a single sequence position for a task via exclusive-create.
 * Idempotent replay (same seq + same taskId, identical payload) returns
 * duplicate:true. Different taskId for the same seq is a canonical conflict:
 * the loser must retry at a new tail position (handled by the caller loop).
 */
function claimSequencePosition(home, sequenceNumber, taskId) {
  const candidate = buildSequenceEntryRecord({ sequenceNumber, taskId });
  const created = writeJsonExclusive(sequenceEntryPath(home, sequenceNumber), candidate);
  if (created.created) {
    const reread = readValidatedSequenceEntryDocument(sequenceEntryPath(home, sequenceNumber), sequenceNumber);
    if (reread.state !== 'present' || JSON.stringify(reread.record) !== JSON.stringify(candidate)) {
      storeFail(`task sequence entry failed to verify after write (fail-closed): seq=${sequenceNumber}`, {
        code: CORRUPT_SEQUENCE,
        taskId,
      });
    }
    return { record: candidate, duplicate: false };
  }
  const winnerFound = readValidatedSequenceEntryDocument(sequenceEntryPath(home, sequenceNumber), sequenceNumber);
  if (winnerFound.state === 'missing') {
    storeFail(`task sequence race could not be resolved deterministically: seq=${sequenceNumber}`, {
      code: CORRUPT_SEQUENCE,
      taskId,
    });
  }
  if (JSON.stringify(winnerFound.record) === JSON.stringify(candidate)) {
    return { record: winnerFound.record, duplicate: true };
  }
  storeFail(`task sequence position conflict (first wins, retry at tail): seq=${sequenceNumber} winner=${winnerFound.record.taskId} loser=${taskId}`, {
    code: SEQUENCE_CONFLICT,
    taskId,
  });
  return { record: winnerFound.record, duplicate: true };
}

/**
 * Ensure every taskId in orderedTaskIds has a canonical position, in order.
 * Missing tasks are appended at the tail via exclusive-create retries.
 * Already-sequenced tasks are skipped (idempotent). Previously assigned
 * positions are never changed. Concurrent winners serialize in the OS:
 * exactly one winner per position; losers retry at the new tail.
 */
function ensureSequenceContainsOrdered(home, orderedTaskIds) {
  for (const taskId of orderedTaskIds) {
    assertValidTaskId(taskId);
  }
  for (const taskId of orderedTaskIds) {
    // Fast + race-safe loop per task: re-list, claim next when missing.
    for (;;) {
      const entries = listCanonicalSequenceEntries(home);
      const existing = entries.find((entry) => entry.taskId === taskId);
      if (existing) break;
      const next = entries.length === 0 ? 1 : entries[entries.length - 1].sequenceNumber + 1;
      try {
        claimSequencePosition(home, next, taskId);
        break;
      } catch (error) {
        if (error?.code === SEQUENCE_CONFLICT) {
          // Another writer won this position; retry at the new tail.
          continue;
        }
        throw error;
      }
    }
  }
  return listCanonicalSequenceEntries(home);
}

/**
 * Deterministic recovery for post-bootstrap divergence:
 * every current taskId missing from the sequence is appended after the
 * frozen prefix in lexicographic order among the missing set.
 * Existing prefix order is never rewritten.
 */
function reconcileSequenceWithCurrentTasks(home) {
  const current = listTaskIds(home);
  const entries = listCanonicalSequenceEntries(home);
  const sequenced = new Set(entries.map((entry) => entry.taskId));
  const missing = current.filter((taskId) => !sequenced.has(taskId)).sort();
  if (missing.length === 0) return entries;
  return ensureSequenceContainsOrdered(home, missing);
}

function dispositionGenerationPath(home, taskId, generation) {
  return nodePath.join(
    resolveTaskDirectory(home, taskId),
    'disposition',
    'generations',
    `${generation}.json`,
  );
}

function readValidatedDispositionDocument(path, taskId, generation) {
  const found = readJsonFile(path);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') {
    storeFail(
      `disposition record is corrupt (fail-closed, no auto-repair): ${taskId}@${generation}`,
      { code: CORRUPT_DISPOSITION, taskId },
    );
  }
  let record;
  try {
    record = validateDispositionRecord(found.document);
  } catch (error) {
    const code =
      error?.code === 'DISPOSITION_TRANSITION_ID_MISMATCH'
        ? DISPOSITION_TRANSITION_ID_MISMATCH
        : error?.code === 'CONTEXT_BUDGET_EXCEEDED'
          ? 'CONTEXT_BUDGET_EXCEEDED'
          : error?.code === 'DISPOSITION_GENERATION_GAP'
            ? DISPOSITION_GENERATION_GAP
            : error?.code === 'DISPOSITION_ILLEGAL_TRANSITION'
              ? DISPOSITION_ILLEGAL_TRANSITION
              : CORRUPT_DISPOSITION;
    storeFail(`disposition record invalid (fail-closed): ${taskId}@${generation}: ${error?.message}`, {
      code,
      taskId,
    });
  }
  if (record.taskId !== taskId) {
    storeFail(`disposition taskId/path mismatch (fail-closed): ${taskId}@${generation}`, {
      code: CORRUPT_DISPOSITION,
      taskId,
    });
  }
  if (record.dispositionGeneration !== generation) {
    storeFail(`disposition generation/path mismatch (fail-closed): ${taskId}@${generation}`, {
      code: CORRUPT_DISPOSITION,
      taskId,
    });
  }
  return { state: 'present', record };
}

function canonicalRecordsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readValidatedMaterializationDocument(path, taskId) {
  const found = readJsonFile(path);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') {
    storeFail(`materialization record is corrupt (fail-closed, no auto-repair): ${taskId}`, {
      code: CORRUPT_MATERIALIZATION,
      taskId,
    });
  }
  let record;
  try {
    record = validateMaterializationRecord(found.document);
  } catch (error) {
    const code =
      error?.code === 'MATERIALIZATION_NOT_ELIGIBLE'
        ? MATERIALIZATION_NOT_ELIGIBLE
        : error?.code === 'CONTEXT_BUDGET_EXCEEDED'
          ? 'CONTEXT_BUDGET_EXCEEDED'
          : error?.code === 'MATERIALIZATION_ID_MISMATCH'
            ? MATERIALIZATION_ID_MISMATCH
            : error?.code === 'DISPOSITION_TRANSITION_ID_MISMATCH'
              ? DISPOSITION_TRANSITION_ID_MISMATCH
              : CORRUPT_MATERIALIZATION;
    storeFail(`materialization record invalid (fail-closed): ${taskId}: ${error?.message}`, {
      code,
      taskId,
    });
  }
  if (record.taskId !== taskId) {
    storeFail(`materialization taskId/path mismatch (fail-closed): ${taskId}`, {
      code: CORRUPT_MATERIALIZATION,
      taskId,
    });
  }
  return { state: 'present', record };
}

function readValidatedAckDocument(path, taskId) {
  const found = readJsonFile(path);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') {
    storeFail(`ack record is corrupt (fail-closed, no auto-repair): ${taskId}`, {
      code: CORRUPT_ACK,
      taskId,
    });
  }
  let record;
  try {
    record = validateAckRecord(found.document);
  } catch (error) {
    const code =
      error?.code === 'CONTEXT_BUDGET_EXCEEDED'
        ? 'CONTEXT_BUDGET_EXCEEDED'
        : error?.code === 'ACK_BINDING_MISMATCH'
          ? ACK_BINDING_MISMATCH
          : CORRUPT_ACK;
    storeFail(`ack record invalid (fail-closed): ${taskId}: ${error?.message}`, { code, taskId });
  }
  if (record.taskId !== taskId) {
    storeFail(`ack taskId/path mismatch (fail-closed): ${taskId}`, { code: CORRUPT_ACK, taskId });
  }
  return { state: 'present', record };
}

function readValidatedConsumedDocument(path, taskId) {
  const found = readJsonFile(path);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') {
    storeFail(`consumed record is corrupt (fail-closed, no auto-repair): ${taskId}`, {
      code: CORRUPT_CONSUMED,
      taskId,
    });
  }
  let record;
  try {
    record = validateConsumedRecord(found.document);
  } catch (error) {
    const code =
      error?.code === 'CONTEXT_BUDGET_EXCEEDED'
        ? 'CONTEXT_BUDGET_EXCEEDED'
        : error?.code === 'CONSUMED_BINDING_MISMATCH'
          ? CONSUMED_BINDING_MISMATCH
          : CORRUPT_CONSUMED;
    storeFail(`consumed record invalid (fail-closed): ${taskId}: ${error?.message}`, { code, taskId });
  }
  if (record.taskId !== taskId) {
    storeFail(`consumed taskId/path mismatch (fail-closed): ${taskId}`, {
      code: CORRUPT_CONSUMED,
      taskId,
    });
  }
  return { state: 'present', record };
}

function readValidatedCursorDocument(path) {
  const found = readJsonFile(path);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') {
    storeFail('cursor record is corrupt (fail-closed, no auto-repair).', { code: CORRUPT_CURSOR });
  }
  let record;
  try {
    record = validateCursorRecord(found.document);
  } catch (error) {
    const code =
      error?.code === 'CONTEXT_BUDGET_EXCEEDED' ? 'CONTEXT_BUDGET_EXCEEDED' : CORRUPT_CURSOR;
    storeFail(`cursor record invalid (fail-closed): ${error?.message}`, { code });
  }
  return { state: 'present', record };
}

function readJsonFile(path) {
  let raw;
  try {
    raw = nodeFs.readFileSync(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing' };
    throw error;
  }
  try {
    return { state: 'present', document: JSON.parse(raw) };
  } catch {
    return { state: 'corrupt', raw };
  }
}

/** Durable atomic write: temp file in the same directory + atomic rename. */
function writeJsonAtomic(targetPath, document) {
  nodeFs.mkdirSync(nodePath.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  nodeFs.writeFileSync(tempPath, JSON.stringify(document, null, 2), 'utf8');
  try {
    nodeFs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      nodeFs.unlinkSync(tempPath);
    } catch {
      // best effort
    }
    throw error;
  }
}

/**
 * Exclusive-create write with atomic publication.
 * INVARIANT: TARGET_VISIBLE => TARGET_COMPLETE_AND_PARSEABLE.
 * The target name never becomes visible with empty/partial bytes: JSON is
 * fully written + closed to a unique temp file in the same directory, then
 * published via hard-link. `link(temp, target)` is atomic and exclusive on
 * POSIX + Windows/NTFS: EEXIST means a complete winner already owns target,
 * and the loser never overwrites it (rename would violate exclusivity, so it
 * is not used here). Temp artifacts are cleaned up on success and failure.
 * No fsync is added: the pre-existing durability contract used close-only
 * semantics for both atomic and exclusive writes.
 */
function writeJsonExclusive(targetPath, document) {
  nodeFs.mkdirSync(nodePath.dirname(targetPath), { recursive: true });
  const payload = JSON.stringify(document, null, 2);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tempPath = `${targetPath}.${process.pid}.${randomUUID().replace(/-/g, '')}.tmp`;
    try {
      nodeFs.writeFileSync(tempPath, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST' && attempt < 2) continue;
      throw error;
    }
    try {
      nodeFs.linkSync(tempPath, targetPath);
    } catch (error) {
      try {
        nodeFs.unlinkSync(tempPath);
      } catch {
        // best effort
      }
      if (error?.code === 'EEXIST') return { created: false };
      throw error;
    }
    try {
      nodeFs.unlinkSync(tempPath);
    } catch {
      // best effort: target already holds the complete bytes.
    }
    return { created: true };
  }
  storeFail(`exclusive temp publication could not allocate a unique temp name: ${targetPath}`, {
    code: CORRUPT_DISPOSITION,
  });
  return { created: false };
}

export class CoordinationStore {
  constructor({ dir, home, env = process.env, platform = process.platform, nowProvider } = {}) {
    this.home = dir ?? home ?? resolveCoordinationHome({ env, platform });
    if (typeof this.home !== 'string' || !this.home.trim()) {
      storeFail('coordination home must be a non-empty directory path.', { code: 'INVALID_HOME' });
    }
    this.nowProvider = typeof nowProvider === 'function' ? nowProvider : () => Date.now();
  }

  nowMs() {
    return this.nowProvider();
  }

  nowIso() {
    return new Date(this.nowMs()).toISOString();
  }

  createTask(input) {
    const envelope = buildTaskEnvelope(input, { nowIso: this.nowIso() });
    const paths = taskFilePaths(this.home, envelope.taskId);
    const created = writeJsonExclusive(paths.taskPath, envelope);
    if (!created.created) {
      storeFail(`task already exists: ${envelope.taskId}`, {
        code: TASK_ALREADY_EXISTS,
        taskId: envelope.taskId,
      });
    }
    // Append-stable sequence membership: every task.json must have a
    // canonical position. Bootstrap once lexicographically; afterwards new
    // tasks append only after the frozen prefix. Deterministic recovery for
    // crash windows (task file visible but sequence entry not yet claimed)
    // happens here and in cursor reconciliation. No timestamp ordering.
    try {
      this.#ensureSequenceMembershipAfterTaskWrite();
    } catch (error) {
      // Task file already won exclusive-create; sequence divergence is
      // fail-closed here (never silently skipped). A later cursor
      // reconciliation will deterministically append the missing member.
      if (error?.code === CORRUPT_SEQUENCE || error?.code === SEQUENCE_CONFLICT) {
        throw error;
      }
      throw error;
    }
    return validateTaskEnvelope(envelope);
  }

  #ensureSequenceMembershipAfterTaskWrite() {
    reconcileSequenceWithCurrentTasks(this.home);
  }

  readTask(taskId) {
    assertValidTaskId(taskId);
    const paths = taskFilePaths(this.home, taskId);
    const found = readJsonFile(paths.taskPath);
    if (found.state === 'missing') {
      storeFail(`task not found: ${taskId}`, { code: TASK_NOT_FOUND, taskId });
    }
    if (found.state === 'corrupt') {
      storeFail(`task record is corrupt (fail-closed, no auto-repair): ${taskId}`, {
        code: 'CORRUPT_TASK',
        taskId,
      });
    }
    return validateTaskEnvelope(found.document);
  }

  markReady(taskId) {
    const task = this.readTask(taskId);
    if (task.status === TASK_STATUS_READY) return task;
    if (task.status !== TASK_STATUS_CREATED) {
      storeFail(`only CREATED tasks can transition to READY (task=${taskId} status=${task.status}).`, {
        code: TASK_NOT_READY,
        taskId,
      });
    }
    const next = validateTaskEnvelope({ ...task, status: TASK_STATUS_READY, updatedAt: this.nowIso() });
    const paths = taskFilePaths(this.home, taskId);
    writeJsonAtomic(paths.taskPath, next);
    return next;
  }

  readClaim(taskId) {
    assertValidTaskId(taskId);
    const paths = taskFilePaths(this.home, taskId);
    const found = readJsonFile(paths.claimPath);
    if (found.state === 'missing') {
      storeFail(`no claim for task: ${taskId}`, { code: CLAIM_NOT_FOUND, taskId });
    }
    if (found.state === 'corrupt') {
      storeFail(`claim record is corrupt (fail-closed, no auto-repair): ${taskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }
    return validateClaimRecord(found.document);
  }

  /**
   * Atomically acquire (or take over after expiry) the claim for a READY task.
   * Exactly one concurrent claimant wins; losers get LEASE_ACTIVE.
   */
  claimTask({ taskId, workerId, leaseDurationMs = 60_000, claimToken, nowMs } = {}) {
    assertValidTaskId(taskId);
    if (typeof workerId !== 'string' || !workerId.trim()) {
      storeFail('workerId must be a non-empty string.', { code: 'INVALID_WORKER', taskId });
    }
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      storeFail('leaseDurationMs must be a positive integer.', { code: 'INVALID_LEASE', taskId });
    }
    const now = Number.isInteger(nowMs) ? nowMs : this.nowMs();
    const task = this.readTask(taskId);
    if (task.status === TASK_STATUS_RESULT_DELIVERED) {
      storeFail(`task is terminal (RESULT_DELIVERED); no new claims accepted: ${taskId}`, {
        code: TASK_TERMINAL,
        taskId,
      });
    }
    if (task.status !== TASK_STATUS_READY && task.status !== TASK_STATUS_CLAIMED) {
      storeFail(`only READY tasks can be claimed (task=${taskId} status=${task.status}).`, {
        code: TASK_NOT_READY,
        taskId,
      });
    }

    const paths = taskFilePaths(this.home, taskId);
    const buildCandidate = (generation) =>
      validateClaimRecord({
        schemaVersion: CLAIM_SCHEMA_VERSION,
        taskId,
        workerId,
        claimToken: claimToken ?? randomUUID(),
        generation,
        claimedAt: new Date(now).toISOString(),
        leaseExpiresAt: new Date(now + leaseDurationMs).toISOString(),
      });

    // Fast path: no claim yet -> exclusive create generation 1.
    const first = writeJsonExclusive(paths.claimPath, buildCandidate(1));
    if (first.created) {
      const claim = this.readClaim(taskId);
      this.#markClaimed(taskId);
      return claim;
    }

    const existing = readJsonFile(paths.claimPath);
    if (existing.state === 'corrupt') {
      storeFail(`claim record is corrupt (fail-closed, no auto-takeover): ${taskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }
    if (existing.state === 'missing') {
      // Lost a creation race that then vanished: retry once as generation 1.
      const retry = writeJsonExclusive(paths.claimPath, buildCandidate(1));
      if (retry.created) {
        const claim = this.readClaim(taskId);
        this.#markClaimed(taskId);
        return claim;
      }
      return this.#rejectLeaseActive(taskId);
    }

    const current = validateClaimRecord(existing.document);
    if (current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) > now) {
      return this.#rejectLeaseActive(taskId, current);
    }

    // Lease expired -> takeover with generation+1. Re-verify generation
    // immediately before unlink so a concurrent winner is never clobbered.
    const reread = readJsonFile(paths.claimPath);
    if (reread.state !== 'present') {
      const retry = writeJsonExclusive(paths.claimPath, buildCandidate(current.generation + 1));
      if (retry.created) {
        const claim = this.readClaim(taskId);
        this.#markClaimed(taskId);
        return claim;
      }
      return this.#rejectLeaseActive(taskId);
    }
    let latest;
    try {
      latest = validateClaimRecord(reread.document);
    } catch {
      storeFail(`claim record is corrupt (fail-closed, no auto-takeover): ${taskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }
    if (latest.claimToken !== current.claimToken || latest.generation !== current.generation) {
      // Another worker already took over between our reads.
      return this.#rejectLeaseActive(taskId, latest);
    }
    if (Date.parse(latest.leaseExpiresAt) > now) {
      return this.#rejectLeaseActive(taskId, latest);
    }

    try {
      nodeFs.unlinkSync(paths.claimPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const takeover = writeJsonExclusive(paths.claimPath, buildCandidate(current.generation + 1));
    if (takeover.created) {
      const claim = this.readClaim(taskId);
      this.#markClaimed(taskId);
      return claim;
    }
    return this.#rejectLeaseActive(taskId);
  }

  #rejectLeaseActive(taskId, current) {
    let detail = `task is claimed with a valid lease: ${taskId}`;
    if (current) {
      detail += ` (owner=${current.workerId} generation=${current.generation} expires=${current.leaseExpiresAt}).`;
    } else {
      detail += ' (another worker won the acquisition race).';
    }
    storeFail(detail, { code: LEASE_ACTIVE, taskId });
  }

  #markClaimed(taskId) {
    const task = this.readTask(taskId);
    if (task.status === TASK_STATUS_CLAIMED || task.status === TASK_STATUS_RESULT_DELIVERED) return task;
    const next = validateTaskEnvelope({ ...task, status: TASK_STATUS_CLAIMED, updatedAt: this.nowIso() });
    const paths = taskFilePaths(this.home, taskId);
    writeJsonAtomic(paths.taskPath, next);
    return next;
  }

  /**
   * Deliver an executor RESULT. Verifies current claim owner + fencing token.
   * - stale claimToken/generation -> STALE_CLAIM (never adopted as canonical)
   * - same resultId retransmission with identical payload -> idempotent return
   * - same resultId with different payload -> DUPLICATE_RESULT_ID_CONFLICT (first wins)
   * - different resultId after terminal delivery -> deterministic ALREADY_DELIVERED (first wins)
   */
  deliverResult({
    taskId,
    resultId,
    workerId,
    claimToken,
    claimGeneration,
    status,
    summary,
    proofRefs = [],
    evidenceRefs = [],
    frictionObserved = [],
    usage,
    deliveredAt,
  } = {}) {
    assertValidTaskId(taskId);
    const finalResultId = resultId ?? randomUUID();
    if (typeof finalResultId !== 'string' || !finalResultId.trim()) {
      storeFail('resultId must be a non-empty string.', { code: 'INVALID_RESULT', taskId });
    }
    if (finalResultId.includes('/') || finalResultId.includes('\\') || finalResultId.includes('..')) {
      storeFail('resultId must not contain path separators or "..".', { code: 'INVALID_RESULT', taskId });
    }
    const nowIso = this.nowIso();
    const candidate = validateResultEnvelope({
      schemaVersion: RESULT_SCHEMA_VERSION,
      resultId: finalResultId,
      taskId,
      workerId,
      claimToken,
      claimGeneration,
      status,
      summary,
      proofRefs,
      evidenceRefs,
      frictionObserved,
      ...(usage === undefined ? {} : { usage }),
      deliveredAt: deliveredAt ?? nowIso,
    });

    const paths = taskFilePaths(this.home, taskId);
    const task = this.readTask(taskId);

    // Duplicate fast path: same resultId already stored -> deterministic handling.
    const existingById = readJsonFile(nodePath.join(paths.resultsDir, `${finalResultId}.json`));
    if (existingById.state === 'present') {
      const stored = validateResultEnvelope(existingById.document);
      if (
        stored.taskId === candidate.taskId &&
        stored.workerId === candidate.workerId &&
        stored.claimToken === candidate.claimToken &&
        stored.claimGeneration === candidate.claimGeneration &&
        stored.status === candidate.status &&
        stored.summary === candidate.summary
      ) {
        return { record: stored, duplicate: true, alreadyDelivered: task.status === TASK_STATUS_RESULT_DELIVERED };
      }
      storeFail(`duplicate resultId with different payload (first delivery wins): ${finalResultId}`, {
        code: DUPLICATE_RESULT_ID_CONFLICT,
        taskId,
      });
    }
    if (existingById.state === 'corrupt') {
      storeFail(`stored result is corrupt (fail-closed): ${finalResultId}`, {
        code: 'CORRUPT_RESULT',
        taskId,
      });
    }

    // Terminal fast path: a canonical result already exists -> first wins.
    const terminal = readJsonFile(paths.resultPath);
    if (terminal.state === 'present') {
      const stored = validateResultEnvelope(terminal.document);
      if (stored.resultId === finalResultId) {
        return { record: stored, duplicate: true, alreadyDelivered: true };
      }
      return { record: stored, duplicate: false, alreadyDelivered: true };
    }
    if (terminal.state === 'corrupt') {
      storeFail(`canonical result is corrupt (fail-closed): ${taskId}`, { code: 'CORRUPT_RESULT', taskId });
    }

    // Fencing: only the current claim owner/generation may deliver.
    const claimFound = readJsonFile(paths.claimPath);
    if (claimFound.state !== 'present') {
      storeFail(`no active claim for task (stale or unclaimed delivery refused): ${taskId}`, {
        code: STALE_CLAIM,
        taskId,
      });
    }
    let currentClaim;
    try {
      currentClaim = validateClaimRecord(claimFound.document);
    } catch {
      storeFail(`claim record is corrupt (delivery fail-closed): ${taskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }
    if (
      currentClaim.workerId !== candidate.workerId ||
      currentClaim.claimToken !== candidate.claimToken ||
      currentClaim.generation !== candidate.claimGeneration
    ) {
      storeFail(
        `stale claim: delivery owner/fencing token does not match current claim ` +
          `(task=${taskId} current generation=${currentClaim.generation}).`,
        { code: STALE_CLAIM, taskId },
      );
    }

    nodeFs.mkdirSync(paths.resultsDir, { recursive: true });
    const perIdCreated = writeJsonExclusive(nodePath.join(paths.resultsDir, `${finalResultId}.json`), candidate);
    if (!perIdCreated.created) {
      // Concurrent duplicate delivery won the race; resolve deterministically.
      return this.deliverResult({
        taskId,
        resultId: finalResultId,
        workerId,
        claimToken,
        claimGeneration,
        status,
        summary,
        proofRefs,
        evidenceRefs,
        frictionObserved,
        ...(usage === undefined ? {} : { usage }),
        deliveredAt: candidate.deliveredAt,
      });
    }
    const canonicalCreated = writeJsonExclusive(paths.resultPath, candidate);
    if (!canonicalCreated.created) {
      const winner = readJsonFile(paths.resultPath);
      if (winner.state === 'present') {
        const stored = validateResultEnvelope(winner.document);
        return { record: stored, duplicate: false, alreadyDelivered: true };
      }
      storeFail(`canonical result race could not be resolved deterministically: ${taskId}`, {
        code: 'CORRUPT_RESULT',
        taskId,
      });
    }

    const nextTask = validateTaskEnvelope({
      ...task,
      status: TASK_STATUS_RESULT_DELIVERED,
      updatedAt: this.nowIso(),
    });
    writeJsonAtomic(paths.taskPath, nextTask);
    return { record: candidate, duplicate: false, alreadyDelivered: false };
  }

  readResult(taskId) {
    assertValidTaskId(taskId);
    const paths = taskFilePaths(this.home, taskId);
    const found = readJsonFile(paths.resultPath);
    if (found.state === 'missing') {
      storeFail(`no result delivered for task: ${taskId}`, { code: 'RESULT_NOT_FOUND', taskId });
    }
    if (found.state === 'corrupt') {
      storeFail(`canonical result is corrupt (fail-closed): ${taskId}`, { code: 'CORRUPT_RESULT', taskId });
    }
    return validateResultEnvelope(found.document);
  }

  readResultById(taskId, resultId) {
    assertValidTaskId(taskId);
    const paths = taskFilePaths(this.home, taskId);
    const found = readJsonFile(nodePath.join(paths.resultsDir, `${resultId}.json`));
    if (found.state === 'missing') {
      storeFail(`result not found: ${taskId}/${resultId}`, { code: 'RESULT_NOT_FOUND', taskId });
    }
    if (found.state === 'corrupt') {
      storeFail(`stored result is corrupt (fail-closed): ${resultId}`, { code: 'CORRUPT_RESULT', taskId });
    }
    return validateResultEnvelope(found.document);
  }

  // ---------------------------------------------------------------------------
  // Disposition domain (separate durable fencing from executor claim fencing).
  // RESULT_DELIVERED never auto-creates a disposition; Control Tower must
  // explicitly begin generation 1 as PENDING_DISPOSITION bound to the exact
  // canonical result. Generations are immutable; current pointer moves only
  // via explicitly allowed transitions. No ACK/consumed/cursor/materialization
  // is modelled here.
  // ---------------------------------------------------------------------------

  #requireDeliveredTask(taskId) {
    const task = this.readTask(taskId);
    if (task.status !== TASK_STATUS_RESULT_DELIVERED) {
      storeFail(
        `disposition requires RESULT_DELIVERED (task=${taskId} status=${task.status}).`,
        { code: DISPOSITION_TASK_NOT_DELIVERED, taskId },
      );
    }
    return task;
  }

  #requireCanonicalResultForDisposition(taskId, resultId) {
    const paths = taskFilePaths(this.home, taskId);
    const terminal = readJsonFile(paths.resultPath);
    if (terminal.state === 'missing') {
      storeFail(`disposition cannot reference missing RESULT (fail-closed): ${taskId}`, {
        code: DISPOSITION_MISSING_RESULT,
        taskId,
      });
    }
    if (terminal.state === 'corrupt') {
      storeFail(`canonical result is corrupt (disposition fail-closed): ${taskId}`, {
        code: 'CORRUPT_RESULT',
        taskId,
      });
    }
    let canonical;
    try {
      canonical = validateResultEnvelope(terminal.document);
    } catch {
      storeFail(`canonical result is invalid (disposition fail-closed): ${taskId}`, {
        code: 'CORRUPT_RESULT',
        taskId,
      });
    }
    const effectiveResultId = resultId ?? canonical.resultId;
    if (effectiveResultId !== canonical.resultId) {
      storeFail(
        `disposition resultId mismatch: requested=${effectiveResultId} canonical=${canonical.resultId} (fail-closed).`,
        { code: DISPOSITION_RESULT_MISMATCH, taskId },
      );
    }
    if (canonical.taskId !== taskId) {
      storeFail(`canonical result taskId mismatch (fail-closed): ${taskId}`, {
        code: DISPOSITION_RESULT_MISMATCH,
        taskId,
      });
    }
    return canonical;
  }

  #readCurrentDispositionInternal(taskId) {
    assertValidTaskId(taskId);
    const paths = taskFilePaths(this.home, taskId);
    const currentFound = readJsonFile(paths.dispositionCurrentPath);
    if (currentFound.state === 'missing') return { state: 'missing' };
    if (currentFound.state === 'corrupt') {
      storeFail(`disposition current pointer is corrupt (fail-closed): ${taskId}`, {
        code: CORRUPT_DISPOSITION,
        taskId,
      });
    }
    let current;
    try {
      current = validateDispositionRecord(currentFound.document);
    } catch (error) {
      const code =
        error?.code === 'DISPOSITION_TRANSITION_ID_MISMATCH'
          ? DISPOSITION_TRANSITION_ID_MISMATCH
          : error?.code === 'CONTEXT_BUDGET_EXCEEDED'
            ? 'CONTEXT_BUDGET_EXCEEDED'
            : CORRUPT_DISPOSITION;
      storeFail(`disposition current pointer invalid (fail-closed): ${taskId}: ${error?.message}`, {
        code,
        taskId,
      });
    }
    if (current.taskId !== taskId) {
      storeFail(`disposition current taskId mismatch (fail-closed): ${taskId}`, {
        code: CORRUPT_DISPOSITION,
        taskId,
      });
    }
    // Current pointer must reference an existing identical generation record.
    const generationFound = readValidatedDispositionDocument(
      dispositionGenerationPath(this.home, taskId, current.dispositionGeneration),
      taskId,
      current.dispositionGeneration,
    );
    if (generationFound.state === 'missing') {
      storeFail(
        `disposition current pointer references missing generation ${current.dispositionGeneration} (fail-closed): ${taskId}`,
        { code: CORRUPT_DISPOSITION, taskId },
      );
    }
    if (!canonicalRecordsEqual(current, generationFound.record)) {
      storeFail(
        `conflicting same-generation disposition record: current.json != generations/${current.dispositionGeneration}.json (fail-closed): ${taskId}`,
        { code: DISPOSITION_CONFLICT, taskId },
      );
    }
    // Linear history check: every generation 1..current must exist and chain.
    for (let generation = 1; generation <= current.dispositionGeneration; generation += 1) {
      const entry = readValidatedDispositionDocument(
        dispositionGenerationPath(this.home, taskId, generation),
        taskId,
        generation,
      );
      if (entry.state === 'missing') {
        storeFail(`disposition generation gap at ${generation} (fail-closed): ${taskId}`, {
          code: DISPOSITION_GENERATION_GAP,
          taskId,
        });
      }
    }
    // Result binding check against live canonical result (fail-closed on drift).
    const canonical = this.#requireCanonicalResultForDisposition(taskId, current.resultId);
    const expectedBinding = computeResultBinding(canonical);
    if (current.resultBinding !== expectedBinding) {
      storeFail(`disposition result binding mismatch (fail-closed): ${taskId}@${current.dispositionGeneration}`, {
        code: DISPOSITION_RESULT_BINDING_MISMATCH,
        taskId,
      });
    }
    if (current.claimGeneration !== canonical.claimGeneration) {
      storeFail(`disposition claim-generation provenance mismatch (fail-closed): ${taskId}`, {
        code: DISPOSITION_RESULT_BINDING_MISMATCH,
        taskId,
      });
    }
    const expectedTransitionId = buildCanonicalTransitionId({
      taskId,
      dispositionGeneration: current.dispositionGeneration,
      resultId: current.resultId,
    });
    if (current.canonicalTransitionId !== expectedTransitionId) {
      storeFail(`disposition canonicalTransitionId mismatch (fail-closed): ${taskId}`, {
        code: DISPOSITION_TRANSITION_ID_MISMATCH,
        taskId,
      });
    }
    return { state: 'present', record: current };
  }

  readCurrentDisposition(taskId) {
    const found = this.#readCurrentDispositionInternal(taskId);
    if (found.state === 'missing') {
      storeFail(`no disposition for task: ${taskId}`, { code: DISPOSITION_NOT_FOUND, taskId });
    }
    return found.record;
  }

  readDispositionGeneration(taskId, generation) {
    assertValidTaskId(taskId);
    if (!Number.isInteger(generation) || generation < 1) {
      storeFail('disposition generation must be an integer >= 1.', {
        code: DISPOSITION_GENERATION_GAP,
        taskId,
      });
    }
    const found = readValidatedDispositionDocument(
      dispositionGenerationPath(this.home, taskId, generation),
      taskId,
      generation,
    );
    if (found.state === 'missing') {
      storeFail(`disposition generation not found: ${taskId}@${generation}`, {
        code: DISPOSITION_NOT_FOUND,
        taskId,
      });
    }
    const canonical = this.#requireCanonicalResultForDisposition(taskId, found.record.resultId);
    const expectedBinding = computeResultBinding(canonical);
    if (found.record.resultBinding !== expectedBinding) {
      storeFail(`disposition result binding mismatch (fail-closed): ${taskId}@${generation}`, {
        code: DISPOSITION_RESULT_BINDING_MISMATCH,
        taskId,
      });
    }
    return found.record;
  }

  #ensureCurrentPointer(taskId, record) {
    const paths = taskFilePaths(this.home, taskId);
    const current = readJsonFile(paths.dispositionCurrentPath);
    if (current.state === 'missing') {
      writeJsonAtomic(paths.dispositionCurrentPath, record);
      return this.#readCurrentDispositionInternal(taskId).record;
    }
    if (current.state === 'corrupt') {
      storeFail(`disposition current pointer is corrupt (fail-closed, no takeover): ${taskId}`, {
        code: CORRUPT_DISPOSITION,
        taskId,
      });
    }
    let stored;
    try {
      stored = validateDispositionRecord(current.document);
    } catch (error) {
      storeFail(`disposition current pointer invalid (fail-closed, no takeover): ${taskId}: ${error?.message}`, {
        code: CORRUPT_DISPOSITION,
        taskId,
      });
    }
    if (stored.dispositionGeneration < record.dispositionGeneration) {
      writeJsonAtomic(paths.dispositionCurrentPath, record);
      return this.#readCurrentDispositionInternal(taskId).record;
    }
    if (stored.dispositionGeneration === record.dispositionGeneration) {
      if (!canonicalRecordsEqual(stored, record)) {
        storeFail(`conflicting same-generation disposition record (fail-closed): ${taskId}@${record.dispositionGeneration}`, {
          code: DISPOSITION_CONFLICT,
          taskId,
        });
      }
      return stored;
    }
    return stored;
  }

  /**
   * Write/advance a disposition generation with Control Tower fencing.
   * - generation 1 must be PENDING_DISPOSITION (RESULT_DELIVERED never auto-adopts).
   * - generation N+1 requires an explicitly allowed transition + supersedes=N.
   * - same-generation concurrent writers: exactly one canonical winner;
   *   identical replay is idempotent, conflicting payload is DISPOSITION_CONFLICT.
   * - stale (generation < current) is STALE_DISPOSITION_GENERATION.
   * - gap (generation > current+1) is DISPOSITION_GENERATION_GAP.
   */
  writeDisposition({
    taskId,
    dispositionGeneration,
    resultId,
    controlTowerToken,
    controlTowerId,
    state,
    policyRefs = [],
    proofRefs = [],
    evidenceRefs = [],
    supersedes,
    userDecision,
    decidedAt,
    ...extraTopLevel
  } = {}) {
    assertValidTaskId(taskId);
    if (!Number.isInteger(dispositionGeneration) || dispositionGeneration < 1) {
      storeFail('dispositionGeneration must be an integer >= 1.', {
        code: DISPOSITION_GENERATION_GAP,
        taskId,
      });
    }
    this.#requireDeliveredTask(taskId);
    const canonical = this.#requireCanonicalResultForDisposition(taskId, resultId);

    const current = this.#readCurrentDispositionInternal(taskId);
    if (current.state === 'missing') {
      if (dispositionGeneration !== 1) {
        storeFail(
          `first disposition generation must be 1 (requested ${dispositionGeneration}); no gap/fork allowed.`,
          { code: DISPOSITION_GENERATION_GAP, taskId },
        );
      }
    } else {
      const currentGeneration = current.record.dispositionGeneration;
      if (dispositionGeneration < currentGeneration) {
        storeFail(
          `stale disposition generation ${dispositionGeneration} (current=${currentGeneration}); never overwrite winner.`,
          { code: STALE_DISPOSITION_GENERATION, taskId },
        );
      }
      if (dispositionGeneration === currentGeneration) {
        // Same-generation fencing: compare against canonical winner.
        // extraTopLevel is forwarded so blocked inline-embed fields fail
        // closed instead of being silently dropped (reference-first).
        // Uses the same supersedes normalization as the main write path so a
        // replay that omits supersedes (gen>=2 => gen-1) validates before the
        // canonical payload comparison instead of failing with GAP.
        const effectiveSupersedesForReplay =
          supersedes !== undefined
            ? supersedes
            : dispositionGeneration === 1
              ? undefined
              : dispositionGeneration - 1;
        let candidate;
        try {
          candidate = buildDispositionRecord({
            ...extraTopLevel,
            taskId,
            dispositionGeneration,
            resultId: canonical.resultId,
            resultBinding: computeResultBinding(canonical),
            claimGeneration: canonical.claimGeneration,
            controlTowerToken,
            controlTowerId,
            state,
            decidedAt: decidedAt ?? this.nowIso(),
            policyRefs,
            proofRefs,
            evidenceRefs,
            ...(effectiveSupersedesForReplay === undefined ? {} : { supersedes: effectiveSupersedesForReplay }),
            ...(userDecision === undefined ? {} : { userDecision }),
          });
        } catch (error) {
          if (error?.code) {
            storeFail(`invalid disposition replay (fail-closed): ${error.message}`, {
              code: error.code,
              taskId,
            });
          }
          throw error;
        }
        const winnerFound = readValidatedDispositionDocument(
          dispositionGenerationPath(this.home, taskId, dispositionGeneration),
          taskId,
          dispositionGeneration,
        );
        if (winnerFound.state === 'missing') {
          storeFail(`disposition current/generation inconsistency (fail-closed): ${taskId}@${dispositionGeneration}`, {
            code: CORRUPT_DISPOSITION,
            taskId,
          });
        }
        if (canonicalRecordsEqual(winnerFound.record, candidate)) {
          this.#ensureCurrentPointer(taskId, winnerFound.record);
          return { record: winnerFound.record, duplicate: true };
        }
        storeFail(`conflicting same-generation disposition payload (first wins, fail-closed): ${taskId}@${dispositionGeneration}`, {
          code: DISPOSITION_CONFLICT,
          taskId,
        });
      }
      if (dispositionGeneration > currentGeneration + 1) {
        storeFail(
          `disposition generation gap: requested ${dispositionGeneration}, current ${currentGeneration} (fail-closed).`,
          { code: DISPOSITION_GENERATION_GAP, taskId },
        );
      }
      try {
        assertLegalDispositionTransition(current.record.state, state);
      } catch (error) {
        storeFail(error.message, { code: DISPOSITION_ILLEGAL_TRANSITION, taskId });
      }
      if (supersedes !== undefined && supersedes !== currentGeneration) {
        storeFail(
          `supersedes must equal previous generation (${currentGeneration}) for generation ${dispositionGeneration}.`,
          { code: DISPOSITION_GENERATION_GAP, taskId },
        );
      }
    }

    const effectiveSupersedes =
      supersedes !== undefined ? supersedes : dispositionGeneration === 1 ? undefined : dispositionGeneration - 1;
    let candidate;
    try {
      candidate = buildDispositionRecord({
        ...extraTopLevel,
        taskId,
        dispositionGeneration,
        resultId: canonical.resultId,
        resultBinding: computeResultBinding(canonical),
        claimGeneration: canonical.claimGeneration,
        controlTowerToken,
        controlTowerId,
        state,
        decidedAt: decidedAt ?? this.nowIso(),
        policyRefs,
        proofRefs,
        evidenceRefs,
        ...(effectiveSupersedes === undefined ? {} : { supersedes: effectiveSupersedes }),
        ...(userDecision === undefined ? {} : { userDecision }),
      });
    } catch (error) {
      if (error?.code) {
        storeFail(`invalid disposition record (fail-closed): ${error.message}`, {
          code: error.code,
          taskId,
        });
      }
      throw error;
    }

    // Enforce initial-disposition rule explicitly (defense in depth; the
    // record validator already requires gen 1 == PENDING_DISPOSITION).
    if (dispositionGeneration === 1 && candidate.state !== DISPOSITION_STATE_PENDING) {
      storeFail('generation 1 must be PENDING_DISPOSITION (RESULT_DELIVERED never auto-adopts).', {
        code: DISPOSITION_ILLEGAL_TRANSITION,
        taskId,
      });
    }

    const generationPath = dispositionGenerationPath(this.home, taskId, dispositionGeneration);
    const created = writeJsonExclusive(generationPath, candidate);
    if (!created.created) {
      const winnerFound = readValidatedDispositionDocument(generationPath, taskId, dispositionGeneration);
      if (winnerFound.state === 'missing') {
        storeFail(`disposition race could not be resolved deterministically: ${taskId}@${dispositionGeneration}`, {
          code: CORRUPT_DISPOSITION,
          taskId,
        });
      }
      if (canonicalRecordsEqual(winnerFound.record, candidate)) {
        const reconciled = this.#ensureCurrentPointer(taskId, winnerFound.record);
        return { record: reconciled, duplicate: true };
      }
      storeFail(`conflicting same-generation disposition payload (first wins, fail-closed): ${taskId}@${dispositionGeneration}`, {
        code: DISPOSITION_CONFLICT,
        taskId,
      });
    }

    const paths = taskFilePaths(this.home, taskId);
    if (current.state === 'missing') {
      writeJsonAtomic(paths.dispositionCurrentPath, candidate);
    } else {
      // Advance the canonical pointer only from the expected previous
      // generation; never overwrite a newer winner.
      const reread = this.#readCurrentDispositionInternal(taskId);
      if (reread.record.dispositionGeneration !== dispositionGeneration - 1) {
        // Another writer already advanced (or a concurrent winner exists).
        // Resolve deterministically against the canonical generation file.
        if (reread.record.dispositionGeneration >= dispositionGeneration) {
          const winnerFound = readValidatedDispositionDocument(
            generationPath,
            taskId,
            dispositionGeneration,
          );
          if (canonicalRecordsEqual(winnerFound.record, candidate)) {
            return { record: reread.record, duplicate: true };
          }
          storeFail(`conflicting same-generation disposition payload (first wins, fail-closed): ${taskId}@${dispositionGeneration}`, {
            code: DISPOSITION_CONFLICT,
            taskId,
          });
        }
        storeFail(`disposition current moved during write (fail-closed): ${taskId}`, {
          code: DISPOSITION_CONFLICT,
          taskId,
        });
      }
      writeJsonAtomic(paths.dispositionCurrentPath, candidate);
    }
    const verified = this.#readCurrentDispositionInternal(taskId);
    if (
      verified.state !== 'present' ||
      verified.record.dispositionGeneration !== dispositionGeneration ||
      !canonicalRecordsEqual(verified.record, candidate)
    ) {
      storeFail(`disposition current pointer failed to verify after write (fail-closed): ${taskId}@${dispositionGeneration}`, {
        code: CORRUPT_DISPOSITION,
        taskId,
      });
    }
    return { record: candidate, duplicate: false };
  }

  /**
   * Begin the pending disposition for a RESULT_DELIVERED task.
   * Convenience wrapper for generation 1 PENDING_DISPOSITION.
   */
  beginDisposition({
    taskId,
    resultId,
    controlTowerToken,
    controlTowerId,
    policyRefs = [],
    proofRefs = [],
    evidenceRefs = [],
    decidedAt,
    ...extraTopLevel
  } = {}) {
    return this.writeDisposition({
      ...extraTopLevel,
      taskId,
      dispositionGeneration: 1,
      ...(resultId === undefined ? {} : { resultId }),
      controlTowerToken,
      controlTowerId,
      state: DISPOSITION_STATE_PENDING,
      policyRefs,
      proofRefs,
      evidenceRefs,
      decidedAt,
    });
  }

  // ---------------------------------------------------------------------------
  // Canonical materialization / read-back / ACK / CONSUMED / cursor domain.
  // ADOPTED-only. Reference-first. Deterministic identity. Revision-guarded
  // exclusive-create + reopen verification. Fail-closed, no auto-repair.
  // Raw RESULT/disposition history is preserved. No next-task emission,
  // scheduler, fan-out, adapters, Astra/OpenCode, or autonomous loop here.
  // ---------------------------------------------------------------------------

  #requireAdoptedDisposition(taskId) {
    let current;
    try {
      current = this.#readCurrentDispositionInternal(taskId);
    } catch (error) {
      if (error?.code) {
        storeFail(`materialization requires canonical ADOPTED disposition (fail-closed): ${taskId}: ${error.message}`, {
          code: error.code === CORRUPT_DISPOSITION ? CORRUPT_DISPOSITION : MATERIALIZATION_NOT_ELIGIBLE,
          taskId,
        });
      }
      throw error;
    }
    if (current.state === 'missing') {
      storeFail(`materialization requires canonical ADOPTED disposition (none present): ${taskId}`, {
        code: MATERIALIZATION_NOT_ELIGIBLE,
        taskId,
      });
    }
    if (current.record.state !== DISPOSITION_STATE_ADOPTED) {
      storeFail(
        `only ADOPTED dispositions may materialize (task=${taskId} state=${current.record.state}).`,
        { code: MATERIALIZATION_NOT_ELIGIBLE, taskId },
      );
    }
    return current.record;
  }

  #verifyMaterializationBinding(taskId, record) {
    const canonical = this.#requireCanonicalResultForDisposition(taskId, record.resultId);
    const expectedBinding = computeResultBinding(canonical);
    if (record.resultBinding !== expectedBinding) {
      storeFail(`materialization result binding mismatch (fail-closed): ${taskId}`, {
        code: CORRUPT_MATERIALIZATION,
        taskId,
      });
    }
    if (record.claimGeneration !== canonical.claimGeneration) {
      storeFail(`materialization claim-generation provenance mismatch (fail-closed): ${taskId}`, {
        code: CORRUPT_MATERIALIZATION,
        taskId,
      });
    }
    const expectedTransitionId = buildCanonicalTransitionId({
      taskId,
      dispositionGeneration: record.dispositionGeneration,
      resultId: record.resultId,
    });
    if (record.canonicalTransitionId !== expectedTransitionId) {
      storeFail(`materialization canonicalTransitionId mismatch (fail-closed): ${taskId}`, {
        code: CORRUPT_MATERIALIZATION,
        taskId,
      });
    }
    return canonical;
  }

  /**
   * Materialize an ADOPTED disposition as a canonical per-task adoption record.
   * WRITE -> CLOSE/REOPEN -> READ BACK -> SCHEMA/IDENTITY/BINDING VERIFY.
   * Same identity + same payload = idempotent. Same identity + different
   * payload (including a different disposition generation) = fail-closed
   * MATERIALIZATION_CONFLICT. Never overwrites, never repairs.
   */
  materializeAdoption({
    taskId,
    materializerId,
    policyRefs = [],
    proofRefs = [],
    evidenceRefs = [],
    authorityRefs,
    publicationRefs,
    closureRefs,
    materializedAt,
    ...extraTopLevel
  } = {}) {
    assertValidTaskId(taskId);
    if (typeof materializerId !== 'string' || !materializerId.trim()) {
      storeFail('materializerId must be a non-empty string.', { code: 'INVALID_MATERIALIZER', taskId });
    }
    const disposition = this.#requireAdoptedDisposition(taskId);
    const canonical = this.#requireCanonicalResultForDisposition(taskId, disposition.resultId);
    let candidate;
    try {
      candidate = buildMaterializationRecord({
        ...extraTopLevel,
        taskId,
        resultId: canonical.resultId,
        claimGeneration: canonical.claimGeneration,
        dispositionGeneration: disposition.dispositionGeneration,
        resultBinding: computeResultBinding(canonical),
        policyRefs,
        proofRefs,
        evidenceRefs,
        ...(authorityRefs === undefined ? {} : { authorityRefs }),
        ...(publicationRefs === undefined ? {} : { publicationRefs }),
        ...(closureRefs === undefined ? {} : { closureRefs }),
        materializedAt: materializedAt ?? this.nowIso(),
        materializerId,
      });
    } catch (error) {
      if (error?.code) {
        storeFail(`invalid materialization record (fail-closed): ${error.message}`, {
          code: error.code,
          taskId,
        });
      }
      throw error;
    }
    // Defense in depth: candidate must bind exactly to the live ADOPTED winner.
    if (
      candidate.dispositionGeneration !== disposition.dispositionGeneration ||
      candidate.resultId !== disposition.resultId ||
      candidate.canonicalTransitionId !== disposition.canonicalTransitionId ||
      candidate.resultBinding !== disposition.resultBinding ||
      candidate.claimGeneration !== disposition.claimGeneration
    ) {
      storeFail(`materialization binding drift vs canonical ADOPTED disposition (fail-closed): ${taskId}`, {
        code: CORRUPT_MATERIALIZATION,
        taskId,
      });
    }

    const paths = taskFilePaths(this.home, taskId);
    const created = writeJsonExclusive(paths.materializationPath, candidate);
    if (!created.created) {
      const winnerFound = readValidatedMaterializationDocument(paths.materializationPath, taskId);
      if (winnerFound.state === 'missing') {
        storeFail(`materialization race could not be resolved deterministically: ${taskId}`, {
          code: CORRUPT_MATERIALIZATION,
          taskId,
        });
      }
      if (canonicalRecordsEqual(winnerFound.record, candidate)) {
        const verified = this.verifyMaterializationReadback(taskId);
        if (!canonicalRecordsEqual(verified.record, candidate)) {
          storeFail(`materialization read-back mismatch after idempotent replay (fail-closed): ${taskId}`, {
            code: CORRUPT_MATERIALIZATION,
            taskId,
          });
        }
        return { record: winnerFound.record, duplicate: true };
      }
      storeFail(`conflicting materialization payload for same ADOPTED identity (first wins, fail-closed): ${taskId}`, {
        code: MATERIALIZATION_CONFLICT,
        taskId,
      });
    }
    const verified = this.verifyMaterializationReadback(taskId);
    if (!canonicalRecordsEqual(verified.record, candidate)) {
      storeFail(`materialization failed to verify after write (fail-closed): ${taskId}`, {
        code: CORRUPT_MATERIALIZATION,
        taskId,
      });
    }
    return { record: candidate, duplicate: false };
  }

  /** Durable reopen/read-back verification for a materialization record. */
  verifyMaterializationReadback(taskId) {
    assertValidTaskId(taskId);
    const paths = taskFilePaths(this.home, taskId);
    const found = readValidatedMaterializationDocument(paths.materializationPath, taskId);
    if (found.state === 'missing') {
      storeFail(`no materialization for task: ${taskId}`, { code: MATERIALIZATION_NOT_FOUND, taskId });
    }
    this.#verifyMaterializationBinding(taskId, found.record);
    // Cross-check the live ADOPTED disposition still binds identically.
    const disposition = this.#requireAdoptedDisposition(taskId);
    if (
      found.record.dispositionGeneration !== disposition.dispositionGeneration ||
      found.record.resultId !== disposition.resultId ||
      found.record.canonicalTransitionId !== disposition.canonicalTransitionId ||
      found.record.resultBinding !== disposition.resultBinding
    ) {
      storeFail(`materialization drift vs canonical ADOPTED disposition (fail-closed): ${taskId}`, {
        code: CORRUPT_MATERIALIZATION,
        taskId,
      });
    }
    return { record: found.record, ok: true };
  }

  readMaterialization(taskId) {
    const verified = this.verifyMaterializationReadback(taskId);
    return verified.record;
  }

  #requireMaterializationForAck(taskId) {
    try {
      return this.verifyMaterializationReadback(taskId).record;
    } catch (error) {
      if (error?.code) {
        const code =
          error.code === MATERIALIZATION_NOT_FOUND || error.code === MATERIALIZATION_NOT_ELIGIBLE
            ? ACK_NOT_READY
            : error.code;
        storeFail(`ACK requires durable materialization read-back PASS (fail-closed): ${taskId}: ${error.message}`, {
          code,
          taskId,
        });
      }
      throw error;
    }
  }

  /**
   * ACK an ADOPTED materialization after durable read-back PASS.
   * ACK means: Control Tower materialized the ADOPTED disposition as canonical
   * per-task state and verified durable reopen/read-back identity + binding.
   */
  ackAdoption({ taskId, acknowledgerId, proofRefs = [], ackedAt, ...extraTopLevel } = {}) {
    assertValidTaskId(taskId);
    if (typeof acknowledgerId !== 'string' || !acknowledgerId.trim()) {
      storeFail('acknowledgerId must be a non-empty string.', { code: 'INVALID_ACKNOWLEDGER', taskId });
    }
    this.#requireAdoptedDisposition(taskId);
    const materialization = this.#requireMaterializationForAck(taskId);
    let candidate;
    try {
      candidate = buildAckRecord({
        ...extraTopLevel,
        taskId,
        dispositionGeneration: materialization.dispositionGeneration,
        resultId: materialization.resultId,
        resultBinding: materialization.resultBinding,
        ackedAt: ackedAt ?? this.nowIso(),
        acknowledgerId,
        proofRefs,
      });
    } catch (error) {
      if (error?.code) {
        storeFail(`invalid ack record (fail-closed): ${error.message}`, { code: error.code, taskId });
      }
      throw error;
    }
    if (
      candidate.materializationId !== materialization.materializationId ||
      candidate.canonicalTransitionId !== materialization.canonicalTransitionId ||
      candidate.resultBinding !== materialization.resultBinding
    ) {
      storeFail(`ack binding drift vs canonical materialization (fail-closed): ${taskId}`, {
        code: CORRUPT_ACK,
        taskId,
      });
    }
    const paths = taskFilePaths(this.home, taskId);
    const created = writeJsonExclusive(paths.ackPath, candidate);
    if (!created.created) {
      const winnerFound = readValidatedAckDocument(paths.ackPath, taskId);
      if (winnerFound.state === 'missing') {
        storeFail(`ack race could not be resolved deterministically: ${taskId}`, {
          code: CORRUPT_ACK,
          taskId,
        });
      }
      if (canonicalRecordsEqual(winnerFound.record, candidate)) {
        return { record: winnerFound.record, duplicate: true };
      }
      storeFail(`conflicting ack payload for same materialization (first wins, fail-closed): ${taskId}`, {
        code: ACK_CONFLICT,
        taskId,
      });
    }
    const reread = readValidatedAckDocument(paths.ackPath, taskId);
    if (reread.state !== 'present' || !canonicalRecordsEqual(reread.record, candidate)) {
      storeFail(`ack failed to verify after write (fail-closed): ${taskId}`, {
        code: CORRUPT_ACK,
        taskId,
      });
    }
    return { record: candidate, duplicate: false };
  }

  readAck(taskId) {
    assertValidTaskId(taskId);
    const paths = taskFilePaths(this.home, taskId);
    const found = readValidatedAckDocument(paths.ackPath, taskId);
    if (found.state === 'missing') {
      storeFail(`no ack for task: ${taskId}`, { code: ACK_NOT_FOUND, taskId });
    }
    const materialization = this.#requireMaterializationForAck(taskId);
    if (
      found.record.materializationId !== materialization.materializationId ||
      found.record.canonicalTransitionId !== materialization.canonicalTransitionId ||
      found.record.resultBinding !== materialization.resultBinding
    ) {
      storeFail(`ack drift vs canonical materialization (fail-closed): ${taskId}`, {
        code: CORRUPT_ACK,
        taskId,
      });
    }
    return found.record;
  }

  #requireAckForConsumed(taskId) {
    try {
      return this.readAck(taskId);
    } catch (error) {
      if (error?.code) {
        const code =
          error.code === ACK_NOT_FOUND || error.code === ACK_NOT_READY ? CONSUMED_NOT_READY : error.code;
        storeFail(`CONSUMED requires valid ACK (fail-closed): ${taskId}: ${error.message}`, {
          code,
          taskId,
        });
      }
      throw error;
    }
  }

  /**
   * Mark a task CONSUMED after RESULT + ADOPTED + materialization read-back +
   * ACK are all valid. Durable closure marker; never deletes raw evidence.
   */
  markConsumed({ taskId, consumerId, proofRefs = [], consumedAt, ...extraTopLevel } = {}) {
    assertValidTaskId(taskId);
    if (typeof consumerId !== 'string' || !consumerId.trim()) {
      storeFail('consumerId must be a non-empty string.', { code: 'INVALID_CONSUMER', taskId });
    }
    this.#requireAdoptedDisposition(taskId);
    let materialization;
    try {
      materialization = this.#requireMaterializationForAck(taskId);
    } catch (error) {
      if (error?.code) {
        storeFail(`CONSUMED requires durable materialization read-back PASS (fail-closed): ${taskId}: ${error.message}`, {
          code: CONSUMED_NOT_READY,
          taskId,
        });
      }
      throw error;
    }
    const ack = this.#requireAckForConsumed(taskId);
    let candidate;
    try {
      candidate = buildConsumedRecord({
        ...extraTopLevel,
        taskId,
        dispositionGeneration: materialization.dispositionGeneration,
        resultId: materialization.resultId,
        resultBinding: materialization.resultBinding,
        consumedAt: consumedAt ?? this.nowIso(),
        consumerId,
        proofRefs,
      });
    } catch (error) {
      if (error?.code) {
        storeFail(`invalid consumed record (fail-closed): ${error.message}`, { code: error.code, taskId });
      }
      throw error;
    }
    if (
      candidate.materializationId !== materialization.materializationId ||
      candidate.ackId !== ack.ackId ||
      candidate.canonicalTransitionId !== materialization.canonicalTransitionId ||
      candidate.resultBinding !== materialization.resultBinding
    ) {
      storeFail(`consumed binding drift vs canonical materialization/ack (fail-closed): ${taskId}`, {
        code: CORRUPT_CONSUMED,
        taskId,
      });
    }
    const paths = taskFilePaths(this.home, taskId);
    const created = writeJsonExclusive(paths.consumedPath, candidate);
    if (!created.created) {
      const winnerFound = readValidatedConsumedDocument(paths.consumedPath, taskId);
      if (winnerFound.state === 'missing') {
        storeFail(`consumed race could not be resolved deterministically: ${taskId}`, {
          code: CORRUPT_CONSUMED,
          taskId,
        });
      }
      if (canonicalRecordsEqual(winnerFound.record, candidate)) {
        return { record: winnerFound.record, duplicate: true };
      }
      storeFail(`conflicting consumed payload for same adoption (first wins, fail-closed): ${taskId}`, {
        code: CONSUMED_CONFLICT,
        taskId,
      });
    }
    const reread = readValidatedConsumedDocument(paths.consumedPath, taskId);
    if (reread.state !== 'present' || !canonicalRecordsEqual(reread.record, candidate)) {
      storeFail(`consumed failed to verify after write (fail-closed): ${taskId}`, {
        code: CORRUPT_CONSUMED,
        taskId,
      });
    }
    return { record: candidate, duplicate: false };
  }

  readConsumed(taskId) {
    assertValidTaskId(taskId);
    const paths = taskFilePaths(this.home, taskId);
    const found = readValidatedConsumedDocument(paths.consumedPath, taskId);
    if (found.state === 'missing') {
      storeFail(`no consumed marker for task: ${taskId}`, { code: CONSUMED_NOT_FOUND, taskId });
    }
    const materialization = this.#requireMaterializationForAck(taskId);
    const ack = this.#requireAckForConsumed(taskId);
    if (
      found.record.materializationId !== materialization.materializationId ||
      found.record.ackId !== ack.ackId ||
      found.record.canonicalTransitionId !== materialization.canonicalTransitionId ||
      found.record.resultBinding !== materialization.resultBinding
    ) {
      storeFail(`consumed drift vs canonical materialization/ack (fail-closed): ${taskId}`, {
        code: CORRUPT_CONSUMED,
        taskId,
      });
    }
    return found.record;
  }

  /**
   * True when a task is fully CONSUMED with every prerequisite verified.
   * Missing consumed marker = gap (false). Corrupt/missing canonical chain
   * with a consumed marker present = fail-closed throw (never treated as gap).
   */
  isConsumed(taskId) {
    assertValidTaskId(taskId);
    const paths = taskFilePaths(this.home, taskId);
    const consumedFound = readValidatedConsumedDocument(paths.consumedPath, taskId);
    if (consumedFound.state === 'missing') return false;
    // Full chain verification; any drift/corruption throws fail-closed.
    this.readConsumed(taskId);
    return true;
  }

  // -------------------------------------------------------------------------
  // Append-stable task sequence public surface (cursor ordering authority).
  // TaskId is identity; sequence position is authority. No timestamps used.
  // -------------------------------------------------------------------------

  /** Canonical taskIds in append-stable sequence order (pure read, fail-closed). */
  readTaskSequence() {
    return listCanonicalSequenceEntries(this.home).map((entry) => entry.taskId);
  }

  /** Canonical sequence entries [{ sequenceNumber, taskId }] (pure read). */
  readSequenceEntries() {
    return listCanonicalSequenceEntries(this.home).map((entry) => ({ ...entry }));
  }

  /**
   * Deterministic recovery: append every current task missing from the
   * sequence after the frozen prefix (missing sorted lexicographically).
   * Previously assigned positions never change. Concurrent winners serialize
   * via exclusive-create; losers retry at the new tail.
   */
  syncTaskSequence() {
    return reconcileSequenceWithCurrentTasks(this.home).map((entry) => entry.taskId);
  }

  #revalidateCursorPrefixConsumed(consumedThrough) {
    for (const taskId of consumedThrough) {
      let consumed;
      try {
        consumed = this.isConsumed(taskId);
      } catch (error) {
        storeFail(`cursor prefix failed revalidation (fail-closed): ${taskId}: ${error?.message}`, {
          code: error?.code ?? CORRUPT_CURSOR,
          taskId,
        });
      }
      if (!consumed) {
        storeFail(`cursor prefix is no longer contiguous CONSUMED (fail-closed): ${taskId}`, {
          code: CORRUPT_CURSOR,
          taskId,
        });
      }
    }
  }

  #assertCursorPrefixIsCanonicalPrefix(consumedThrough, canonicalEntries) {
    if (consumedThrough.length > canonicalEntries.length) {
      storeFail('cursor prefix longer than canonical task sequence (fail-closed, no rewind/skip).', {
        code: CORRUPT_CURSOR,
      });
    }
    for (let index = 0; index < consumedThrough.length; index += 1) {
      if (consumedThrough[index] !== canonicalEntries[index].taskId) {
        storeFail(
          `cursor prefix diverges from canonical task sequence at position ${index + 1} (fail-closed): expected=${canonicalEntries[index].taskId} got=${consumedThrough[index]}`,
          { code: CORRUPT_CURSOR },
        );
      }
    }
  }

  /**
   * Migrate a legacy lexicographic-task-id-v1 cursor to the append-stable
   * contract. Fail-closed, no silent delete/reset/rewind/credit-loss.
   * Preserves the existing prefix, appends remaining current tasks after it,
   * and leaves durable migration provenance. Idempotent replay returns winner.
   */
  #migrateLegacyCursorIfNeeded(evaluatorId) {
    const cursorPath = cursorFilePath(this.home);
    const raw = readJsonFile(cursorPath);
    if (raw.state === 'missing') return null;
    if (raw.state === 'corrupt') {
      storeFail('cursor record is corrupt (fail-closed, no auto-repair).', { code: CORRUPT_CURSOR });
    }
    const document = raw.document;
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      storeFail('cursor record invalid (fail-closed).', { code: CORRUPT_CURSOR });
    }
    if (document.sequenceContract === CURSOR_SEQUENCE_CONTRACT) return null;
    if (document.sequenceContract !== LEGACY_CURSOR_SEQUENCE_CONTRACT) {
      storeFail('cursor sequence contract mismatch (fail-closed).', { code: CORRUPT_CURSOR });
    }
    let legacy;
    try {
      legacy = validateLegacyCursorRecord(document);
    } catch (error) {
      const code = error?.code === 'CONTEXT_BUDGET_EXCEEDED' ? 'CONTEXT_BUDGET_EXCEEDED' : CORRUPT_CURSOR;
      storeFail(`legacy cursor record invalid (fail-closed, no auto-repair): ${error?.message}`, { code });
    }
    // Existing watermark + entire consumedThrough revalidation (no credit loss).
    this.#revalidateCursorPrefixConsumed(legacy.consumedThrough);
    const current = listTaskIds(this.home);
    for (const taskId of legacy.consumedThrough) {
      if (!current.includes(taskId)) {
        storeFail(`legacy cursor prefix task missing from durable tasks (fail-closed): ${taskId}`, {
          code: CORRUPT_CURSOR,
          taskId,
        });
      }
    }
    const prefixSet = new Set(legacy.consumedThrough);
    const remaining = current.filter((taskId) => !prefixSet.has(taskId)).sort();
    const bootstrapOrder = [...legacy.consumedThrough, ...remaining];
    const preExisting = listCanonicalSequenceEntries(this.home);
    if (preExisting.length > 0) {
      if (preExisting.length < legacy.consumedThrough.length) {
        storeFail('canonical task sequence shorter than legacy cursor prefix (fail-closed).', {
          code: CORRUPT_CURSOR,
        });
      }
      for (let index = 0; index < legacy.consumedThrough.length; index += 1) {
        if (preExisting[index].taskId !== legacy.consumedThrough[index]) {
          storeFail(
            `canonical task sequence does not preserve legacy cursor prefix at position ${index + 1} (fail-closed): expected=${legacy.consumedThrough[index]} got=${preExisting[index].taskId}`,
            { code: CORRUPT_CURSOR },
          );
        }
      }
    }
    const canonical = ensureSequenceContainsOrdered(this.home, bootstrapOrder);
    for (let index = 0; index < legacy.consumedThrough.length; index += 1) {
      if (canonical[index].taskId !== legacy.consumedThrough[index]) {
        storeFail('migrated task sequence failed to preserve legacy prefix (fail-closed).', {
          code: CORRUPT_CURSOR,
        });
      }
    }
    const migrator = typeof evaluatorId === 'string' && evaluatorId.trim() ? evaluatorId : legacy.evaluatorId;
    const migrated = validateCursorRecord({
      schemaVersion: '1',
      sequenceContract: CURSOR_SEQUENCE_CONTRACT,
      watermarkTaskId: legacy.watermarkTaskId,
      consumedThrough: [...legacy.consumedThrough],
      updatedAt: this.nowIso(),
      evaluatorId: migrator,
    });
    writeJsonAtomic(cursorPath, migrated);
    const reread = readValidatedCursorDocument(cursorPath);
    if (reread.state !== 'present' || !canonicalRecordsEqual(reread.record, migrated)) {
      storeFail('migrated cursor failed to verify after write (fail-closed).', { code: CORRUPT_CURSOR });
    }
    const provenance = buildSequenceMigrationRecord({
      preservedPrefix: [...legacy.consumedThrough],
      appendedRemaining: [...remaining],
      migratorId: migrator,
      migratedAt: this.nowIso(),
    });
    const migrationPath = sequenceMigrationFilePath(this.home);
    const migrationCreated = writeJsonExclusive(migrationPath, provenance);
    if (!migrationCreated.created) {
      const winner = readValidatedSequenceMigrationDocument(migrationPath);
      if (winner.state === 'missing') {
        storeFail('sequence migration race could not be resolved deterministically.', {
          code: CORRUPT_SEQUENCE,
        });
      }
      if (JSON.stringify(winner.record.preservedPrefix) !== JSON.stringify(provenance.preservedPrefix)) {
        storeFail('concurrent cursor migration prefix divergence (fail-closed).', { code: CORRUPT_CURSOR });
      }
    } else {
      const verifyMigration = readValidatedSequenceMigrationDocument(migrationPath);
      if (
        verifyMigration.state !== 'present' ||
        JSON.stringify(verifyMigration.record) !== JSON.stringify(provenance)
      ) {
        storeFail('migration provenance failed to verify after write (fail-closed).', {
          code: CORRUPT_SEQUENCE,
        });
      }
    }
    return { record: migrated, duplicate: false };
  }

  readCursor() {
    // Deterministic migration first: legacy v1 cursors are preserved, never
    // silently deleted/reset. Migration appends remaining tasks after the
    // frozen prefix and leaves provenance.
    const migrated = this.#migrateLegacyCursorIfNeeded();
    if (migrated) {
      const canonicalAfterMigration = listCanonicalSequenceEntries(this.home);
      this.#revalidateCursorPrefixConsumed(migrated.record.consumedThrough);
      this.#assertCursorPrefixIsCanonicalPrefix(migrated.record.consumedThrough, canonicalAfterMigration);
      return migrated.record;
    }
    const found = readValidatedCursorDocument(cursorFilePath(this.home));
    if (found.state === 'missing') {
      storeFail('no cursor watermark yet.', { code: CURSOR_NOT_FOUND });
    }
    // Cursor never overwrites truth: verify the persisted prefix is still
    // contiguous CONSUMED. Any corruption/gap fails closed here.
    this.#revalidateCursorPrefixConsumed(found.record.consumedThrough);
    // Append-stability: persisted prefix must remain the canonical prefix.
    // Deterministic recovery appends missing tail tasks first so a crash
    // window (task.json visible, sequence entry pending) never hides a task.
    const canonical = reconcileSequenceWithCurrentTasks(this.home);
    this.#assertCursorPrefixIsCanonicalPrefix(found.record.consumedThrough, canonical);
    // Re-read after reconciliation to return the verified winner.
    const verified = readValidatedCursorDocument(cursorFilePath(this.home));
    if (verified.state === 'missing') {
      storeFail('no cursor watermark yet.', { code: CURSOR_NOT_FOUND });
    }
    return verified.record;
  }

  /**
   * Advance the cursor watermark over the append-stable task sequence.
   * The durable sequence (not lexicographic taskId, not timestamps) is the
   * sole ordering authority. Caller may supply orderedTaskIds only as an
   * explicit view: it must contain no duplicates and must already be in
   * canonical sequence order, otherwise CURSOR_ORDER_VIOLATION. When omitted,
   * the canonical sequence is used. Missing tail tasks are deterministically
   * appended after the frozen prefix before computing contiguity.
   * Contiguity: stop at the first non-CONSUMED gap; never skip. Corrupt
   * canonical records fail closed. Silent rewind is refused. Idempotent replay
   * returns the canonical winner.
   */
  advanceCursor({ orderedTaskIds, evaluatorId } = {}) {
    if (typeof evaluatorId !== 'string' || !evaluatorId.trim()) {
      storeFail('evaluatorId must be a non-empty string.', { code: 'INVALID_EVALUATOR' });
    }
    // Migrate legacy cursors first (preserves credit, appends remaining).
    this.#migrateLegacyCursorIfNeeded(evaluatorId);
    // Deterministic recovery: every current task must have a position.
    // New tasks append only after the frozen prefix.
    const canonicalEntries = reconcileSequenceWithCurrentTasks(this.home);
    const canonicalOrder = canonicalEntries.map((entry) => entry.taskId);
    const positionByTaskId = new Map(canonicalEntries.map((entry) => [entry.taskId, entry.sequenceNumber]));

    let sequence;
    if (orderedTaskIds === undefined) {
      sequence = [...canonicalOrder];
    } else {
      if (!Array.isArray(orderedTaskIds)) {
        storeFail('orderedTaskIds must be an array of taskIds when present.', {
          code: CURSOR_ORDER_VIOLATION,
        });
      }
      const seen = new Set();
      let previousPosition = null;
      for (const taskId of orderedTaskIds) {
        try {
          assertValidTaskId(taskId);
        } catch {
          storeFail(`orderedTaskIds contains invalid taskId: ${JSON.stringify(taskId)}.`, {
            code: CURSOR_ORDER_VIOLATION,
          });
        }
        if (seen.has(taskId)) {
          storeFail('orderedTaskIds must not contain duplicates.', { code: CURSOR_ORDER_VIOLATION });
        }
        seen.add(taskId);
        const position = positionByTaskId.get(taskId);
        if (position === undefined) {
          storeFail(`orderedTaskIds contains task outside the canonical sequence (fail-closed): ${taskId}.`, {
            code: CURSOR_ORDER_VIOLATION,
            taskId,
          });
        }
        if (previousPosition !== null && !(previousPosition < position)) {
          storeFail('orderedTaskIds must be in canonical append-stable sequence order.', {
            code: CURSOR_ORDER_VIOLATION,
          });
        }
        previousPosition = position;
      }
      sequence = [...orderedTaskIds];
    }

    const prefix = [];
    for (const taskId of sequence) {
      let consumed;
      try {
        consumed = this.isConsumed(taskId);
      } catch (error) {
        storeFail(`cursor advance refused: corrupt canonical chain at ${taskId} (fail-closed): ${error?.message}`, {
          code: error?.code ?? CORRUPT_CURSOR,
          taskId,
        });
      }
      if (!consumed) break;
      prefix.push(taskId);
    }
    const desiredWatermark = prefix.length > 0 ? prefix[prefix.length - 1] : null;

    const cursorPath = cursorFilePath(this.home);
    const existingFound = readValidatedCursorDocument(cursorPath);
    if (existingFound.state === 'missing') {
      const initial = validateCursorRecord({
        schemaVersion: '1',
        sequenceContract: CURSOR_SEQUENCE_CONTRACT,
        watermarkTaskId: desiredWatermark,
        consumedThrough: prefix,
        updatedAt: this.nowIso(),
        evaluatorId,
      });
      // Initial prefix must itself be a canonical prefix (it is, when the
      // view is canonical; for an explicit subset view it must still start
      // at the canonical head).
      const freshCanonical = listCanonicalSequenceEntries(this.home);
      this.#assertCursorPrefixIsCanonicalPrefix(prefix, freshCanonical);
      const created = writeJsonExclusive(cursorPath, initial);
      if (!created.created) {
        const winnerFound = readValidatedCursorDocument(cursorPath);
        if (winnerFound.state === 'missing') {
          storeFail('cursor race could not be resolved deterministically.', { code: CORRUPT_CURSOR });
        }
        return { record: winnerFound.record, duplicate: true, advanced: false };
      }
      const reread = readValidatedCursorDocument(cursorPath);
      if (reread.state !== 'present' || !canonicalRecordsEqual(reread.record, initial)) {
        storeFail('cursor failed to verify after write (fail-closed).', { code: CORRUPT_CURSOR });
      }
      return { record: initial, duplicate: false, advanced: prefix.length > 0 };
    }

    const existing = existingFound.record;
    if (existing.sequenceContract !== CURSOR_SEQUENCE_CONTRACT) {
      storeFail('cursor sequence contract mismatch (fail-closed).', { code: CORRUPT_CURSOR });
    }
    // Revalidate the persisted prefix is still contiguous CONSUMED.
    this.#revalidateCursorPrefixConsumed(existing.consumedThrough);
    // Append-stability: persisted prefix must remain the canonical prefix.
    const currentCanonical = listCanonicalSequenceEntries(this.home);
    this.#assertCursorPrefixIsCanonicalPrefix(existing.consumedThrough, currentCanonical);

    const existingPrefix = existing.consumedThrough;
    const prefixesEqual =
      existingPrefix.length === prefix.length && existingPrefix.every((value, index) => value === prefix[index]);
    if (prefixesEqual && existing.watermarkTaskId === desiredWatermark) {
      return { record: existing, duplicate: true, advanced: false };
    }
    const isStrictPrefix = (shorter, longer) =>
      shorter.length < longer.length && shorter.every((value, index) => value === longer[index]);
    if (isStrictPrefix(existingPrefix, prefix)) {
      // Advance only when the recomputed view extends the canonical prefix.
      // The view must itself start at the canonical head.
      this.#assertCursorPrefixIsCanonicalPrefix(prefix, currentCanonical);
      const next = validateCursorRecord({
        schemaVersion: '1',
        sequenceContract: CURSOR_SEQUENCE_CONTRACT,
        watermarkTaskId: desiredWatermark,
        consumedThrough: prefix,
        updatedAt: this.nowIso(),
        evaluatorId,
      });
      writeJsonAtomic(cursorPath, next);
      const reread = readValidatedCursorDocument(cursorPath);
      if (reread.state !== 'present' || !canonicalRecordsEqual(reread.record, next)) {
        storeFail('cursor failed to verify after advance (fail-closed).', { code: CORRUPT_CURSOR });
      }
      return { record: next, duplicate: false, advanced: true };
    }
    if (isStrictPrefix(prefix, existingPrefix)) {
      // Stale view: already advanced beyond. Never rewind silently.
      return { record: existing, duplicate: true, advanced: false };
    }
    if (prefix.length === 0 && existingPrefix.length === 0) {
      return { record: existing, duplicate: true, advanced: false };
    }
    storeFail('cursor advancement diverges from canonical prefix (fail-closed, no skip/rewind).', {
      code: CURSOR_CONFLICT,
    });
  }
}
