// Bounded mutation owner: GREENHUB-COORDINATION-DURABLE-CORE-01
// + GREENHUB-COORDINATION-DISPOSITION-STORE-07 (disposition persistence/state/fencing only).
// Durable local coordination store: TASK CREATED -> READY -> CLAIMED -> RESULT_DELIVERED,
// plus a separate durable disposition domain (PENDING_DISPOSITION/BLOCKED/
// NEEDS_USER_DECISION/ADOPTED/REJECTED/SUPERSEDED) bound to the canonical result.
//
// Filesystem layout under a durable home (never the repository worktree):
//   <home>/tasks/<taskId>/task.json
//   <home>/tasks/<taskId>/claim.json
//   <home>/tasks/<taskId>/result.json            (canonical terminal result)
//   <home>/tasks/<taskId>/results/<resultId>.json (per-delivery record)
//   <home>/tasks/<taskId>/disposition/current.json
//   <home>/tasks/<taskId>/disposition/generations/<n>.json (immutable history)
//
// Claim atomicity uses OS exclusive-create (`wx`) semantics plus a
// read-verify-unlink-recreate takeover dance (same family as
// scripts/dev/local/runtime-lease.mjs). The race-prone
// `exists() -> write()` pattern is never used: every creation goes through
// `openSync(path, 'wx')`, so concurrent claimants serialize in the OS and
// exactly one wins. Takeover additionally re-verifies generation before
// unlink so a concurrent winner is never clobbered silently.
//
// Cursor/disposition is out of scope: delivered results stay in the inbox;
// no consumed/acknowledged marking exists in this module.

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
  DISPOSITION_STATE_PENDING,
  assertLegalDispositionTransition,
  buildCanonicalTransitionId,
  buildDispositionRecord,
  computeResultBinding,
  validateDispositionRecord,
} from './disposition.mjs';

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
  };
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
    return validateTaskEnvelope(envelope);
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
}
