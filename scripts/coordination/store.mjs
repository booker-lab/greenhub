// Bounded mutation owner: GREENHUB-COORDINATION-DURABLE-CORE-01.
// Durable local coordination store: TASK CREATED -> READY -> CLAIMED -> RESULT_DELIVERED.
//
// Filesystem layout under a durable home (never the repository worktree):
//   <home>/tasks/<taskId>/task.json
//   <home>/tasks/<taskId>/claim.json
//   <home>/tasks/<taskId>/result.json            (canonical terminal result)
//   <home>/tasks/<taskId>/results/<resultId>.json (per-delivery record)
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

export const LEASE_ACTIVE = 'LEASE_ACTIVE';
export const CLAIM_NOT_FOUND = 'CLAIM_NOT_FOUND';
export const STALE_CLAIM = 'STALE_CLAIM';
export const TASK_ALREADY_EXISTS = 'TASK_ALREADY_EXISTS';
export const TASK_NOT_FOUND = 'TASK_NOT_FOUND';
export const TASK_NOT_READY = 'TASK_NOT_READY';
export const TASK_TERMINAL = 'TASK_TERMINAL';
export const DUPLICATE_RESULT_ID_CONFLICT = 'DUPLICATE_RESULT_ID_CONFLICT';

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
  };
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
 * Exclusive-create write. Returns true when this caller created the file;
 * false when another claimant already owns the path (EEXIST). Never follows
 * the race-prone exists()->write() pattern.
 */
function writeJsonExclusive(targetPath, document) {
  nodeFs.mkdirSync(nodePath.dirname(targetPath), { recursive: true });
  let descriptor;
  try {
    descriptor = nodeFs.openSync(targetPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') return { created: false };
    throw error;
  }
  try {
    nodeFs.writeSync(descriptor, JSON.stringify(document, null, 2));
  } catch (error) {
    try {
      nodeFs.closeSync(descriptor);
    } catch {
      // best effort
    }
    try {
      nodeFs.unlinkSync(targetPath);
    } catch {
      // best effort
    }
    throw error;
  }
  nodeFs.closeSync(descriptor);
  return { created: true };
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
}
