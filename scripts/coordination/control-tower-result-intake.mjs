// Bounded composition owner:
// GREENHUB-COORDINATION-CONTROL-TOWER-RESULT-INTAKE-GF07.
// Surface: scripts/coordination/*control-tower-result-intake* (this module + its
// proof spec) + the operator-facing `coordination:return` composition and the
// automatic post-delivery step inside the existing `coordination:run` ONLY.
// No store.mjs mutation, no new durable artifact, no new durable directory, and
// no new JSON domain: this module composes EXISTING canonical authorities.
//
// State transition added here:
//   RESULT_DELIVERED(taskId)
//     -> CONTROL_TOWER_RESULT_AVAILABLE(taskId)   [durable PENDING_DISPOSITION generation 1]
//
// Contract summary:
//   performControlTowerResultIntake() != deliverExecutorResultReceipt()
//     != executeTask() != invokeExecutor() != writeDisposition()
//     != reconcileTerminalResult() != materialization != ACK != CONSUMED
//     != successor emission.
//   CONTROL_TOWER_RESULT_AVAILABLE != Control Tower verdict (ADOPTED/REJECTED/
//     SUPERSEDED/BLOCKED/NEEDS_USER_DECISION) != adoption != publication
//     authority != successor permission != task completion.
//   The automatic intake may record ONLY generation 1 PENDING_DISPOSITION bound
//   to the exact canonical result. It never authors a semantic verdict, never
//   advances a disposition generation, never materializes/ACKs/consumes, never
//   emits a successor, never invokes an executor, and never performs a Git read
//   or a publication classification.
//
// Reused canonical authorities (never re-authored):
//   - canonical task lifecycle + canonical Result Envelope: store.readTask /
//     store.readResult (the durable RESULT_DELIVERED + first-wins result),
//   - canonical claim/fencing record: store.readClaim (workerId + the SOLE
//     claim generation),
//   - canonical pre-execution authority: store.readUserApprovedIntake (GF-06
//     intake authority) or store.readEmissionAdmission (existing emission
//     admission); the two sources are never merged and the caller supplies the
//     exactly one that owns the delivered task,
//   - the existing admission-bound claim token builder
//     (buildAdmissionBoundClaimToken) is the ONLY claim attribution rule,
//   - the existing result content binding (computeResultBinding),
//   - the existing Control Tower disposition pointer authority
//     (store.beginDisposition / store.readCurrentDisposition): generation 1
//     PENDING_DISPOSITION is the durable "result available to Control Tower"
//     state, and its exclusive-create + same-generation first-wins fencing is
//     the ONLY concurrency/serialization authority used here.
//
// Entry paths (EXACTLY these two; both compose the same derivation):
//   deriveControlTowerResultIntake({ store, taskId, authority })
//     READ-ONLY: verify task/result/claim/authority binding and return the
//     frozen Control Tower intake envelope (canonical result + provenance
//     binding). Zero durable writes.
//   performControlTowerResultIntake({ store, taskId, authority })
//     compose derive + converge the durable PENDING_DISPOSITION generation 1:
//       - no disposition yet            -> exclusive-create generation 1
//                                          PENDING_DISPOSITION (newlyIntaken)
//       - same result already intaken   -> read-only convergence (exactReplay)
//       - a later generation exists     -> read-only convergence: the Control
//                                          Tower verdict pointer is never
//                                          rewound, never duplicated
//       - conflicting durable bytes     -> fail closed (existing disposition
//                                          codes propagate UNCHANGED)
//
// Determinism / replay contract:
//   - intakeId = `ctintake_<sha256(taskId \0 resultId)[:32]>`: identity is a
//     pure composition of durable canonical result identity; clock/pid/hostname/
//     random never participate.
//   - The intake disposition candidate is byte-deterministic: controlTowerId /
//     controlTowerToken are module constants, decidedAt is the canonical
//     result's deliveredAt (the store clock's delivery authority), and the
//     refs are derived from the result/authority binding only. Any replay or
//     concurrent writer therefore recomputes the EXACT same record instead of a
//     clock-dependent near-duplicate.
//   - Crash windows:
//       A. RESULT_DELIVERED before any intake -> replay finds the same
//          canonical result and converges to generation 1 PENDING.
//       B. after the canonical read, before the durable write -> zero durable
//          delta; replay is identical to A.
//       C. generation record durable, current pointer missing -> the identical
//          candidate converges through the EXISTING same-generation fencing and
//          the current pointer is restored; no second generation is created.
//       D. terminal task replay -> zero executor invocations and zero new
//          semantic tasks; the existing disposition (pending or later) is
//          re-read and returned.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   Control Tower DROP/WATCH/CHANGE invention, terminal reconciliation verdicts
//   (owned by terminal-reconciliation.mjs), live-main/Git reads, publication or
//   merge authority, materialization, ACK, CONSUMED, cursor advancement,
//   successor/spec emission, scheduler, READY scan, polling, daemon, cron,
//   watchdog, retry, backoff, executor invocation, mutation capability,
//   production deploy, new generation/fencing authority.

import { createHash } from 'node:crypto';
import { buildAdmissionBoundClaimToken } from './admission-bound-claim.mjs';
import { computeResultBinding, DISPOSITION_STATE_PENDING, dispositionRef } from './disposition.mjs';
import { EMISSION_SLOT_PATTERN } from './next-task-emission.mjs';
import {
  TASK_ID_PATTERN,
  TASK_KINDS,
  TASK_STATUS_RESULT_DELIVERED,
  validateResultEnvelope,
} from './task-envelope.mjs';
import {
  AUTHORITY_KIND_EMISSION_ADMISSION,
  AUTHORITY_KIND_USER_APPROVED_INTAKE,
} from './user-approved-intake.mjs';

export const CONTROL_TOWER_RESULT_INTAKE_SCHEMA_VERSION = '1';
export const CONTROL_TOWER_RESULT_INTAKE_ID_PREFIX = 'ctintake_';

// Deterministic Control Tower intake provenance for the automatic return. These
// are provenance/fencing identifiers only (never secrets, never a semantic
// verdict): a constant value keeps the disposition candidate byte-identical for
// every replay and concurrent writer, so the existing same-generation fencing
// converges instead of conflicting.
export const CONTROL_TOWER_RESULT_INTAKE_CONTROL_TOWER_ID = 'control-tower';
export const CONTROL_TOWER_RESULT_INTAKE_CONTROL_TOWER_TOKEN = 'control-tower-result-intake';

// The automatic intake is bound to EXACTLY generation 1 PENDING_DISPOSITION.
export const CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_GENERATION = 1;

export const MAX_CONTROL_TOWER_RESULT_INTAKE_ID_LENGTH = 128;
export const MAX_CONTROL_TOWER_RESULT_INTAKE_JSON_BYTES = 24 * 1024;

// Exact derived-envelope fields, in fixed order. The envelope is a read
// projection (never durable state): it carries the canonical result plus the
// bounded provenance binding the Control Tower needs for intake.
export const CONTROL_TOWER_RESULT_INTAKE_FIELDS = Object.freeze([
  'schemaVersion',
  'intakeId',
  'taskId',
  'taskKind',
  'authorityKind',
  'authorityId',
  'sourceTaskId',
  'emissionSlot',
  'resultId',
  'resultBinding',
  'claimWorkerId',
  'claimGeneration',
  'dispositionRef',
  'result',
]);

// The exact caller-supplied authority binding. The caller supplies the ONE
// canonical pre-execution authority that owns the delivered task; this module
// re-reads it and never scans, infers, or merges authority sources.
export const CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_FIELDS = Object.freeze([
  'authorityKind',
  'authorityId',
  'sourceTaskId',
  'emissionSlot',
]);

export const CONTROL_TOWER_RESULT_INTAKE_POLICY_REFS = Object.freeze([
  'AGENTS.md',
  'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
]);

// Intake-native meanings ONLY. Missing/corrupt canonical authorities and
// disposition fencing failures propagate their EXISTING store codes unchanged.
export const CORRUPT_CONTROL_TOWER_RESULT_INTAKE = 'CORRUPT_CONTROL_TOWER_RESULT_INTAKE';
export const INVALID_CONTROL_TOWER_RESULT_INTAKE_STORE =
  'INVALID_CONTROL_TOWER_RESULT_INTAKE_STORE';
export const INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY =
  'INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY';
export const CONTROL_TOWER_RESULT_INTAKE_NOT_DELIVERED =
  'CONTROL_TOWER_RESULT_INTAKE_NOT_DELIVERED';
export const CONTROL_TOWER_RESULT_INTAKE_RESULT_BINDING_MISMATCH =
  'CONTROL_TOWER_RESULT_INTAKE_RESULT_BINDING_MISMATCH';
export const CONTROL_TOWER_RESULT_INTAKE_CLAIM_BINDING_MISMATCH =
  'CONTROL_TOWER_RESULT_INTAKE_CLAIM_BINDING_MISMATCH';
export const CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH =
  'CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH';
export const CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_BINDING_MISMATCH =
  'CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_BINDING_MISMATCH';

export class ControlTowerResultIntakeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ControlTowerResultIntakeError';
    this.code = details.code ?? CORRUPT_CONTROL_TOWER_RESULT_INTAKE;
    this.taskId = details.taskId ?? null;
  }
}

function fail(message, details = {}) {
  throw new ControlTowerResultIntakeError(message, details);
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function assertValidTaskId(taskId, code = INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, { code });
  }
  return taskId;
}

function assertNonEmptyBoundedString(value, fieldName, maxLength, code) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${fieldName} must be a non-empty string.`, { code });
  }
  if (value.length > maxLength) {
    fail(`${fieldName} exceeds ${maxLength} chars.`, { code });
  }
  return value;
}

function optionalRead(readFn, notFoundCode) {
  try {
    return readFn();
  } catch (error) {
    if (error?.code === notFoundCode) return null;
    throw error;
  }
}

/**
 * Deterministic Control Tower result-intake identity for one durable canonical
 * result: `ctintake_<sha256(taskId \0 resultId)[:32]>`. Identity participates
 * only in the derived envelope (the durable disposition pointer is the existing
 * `<taskId>@<generation>` identity); clock/pid/hostname/random never
 * participate, so the same delivered result always binds identically in any
 * process under any clock skew.
 */
export function buildControlTowerResultIntakeId({ taskId, resultId }) {
  assertValidTaskId(taskId, INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY);
  if (typeof resultId !== 'string' || !resultId.trim()) {
    fail('resultId must be a non-empty string for control tower result intake identity.', {
      code: INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY,
      taskId,
    });
  }
  const digest = createHash('sha256')
    .update(taskId, 'utf8')
    .update('\0', 'utf8')
    .update(resultId, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `${CONTROL_TOWER_RESULT_INTAKE_ID_PREFIX}${digest}`;
}

function assertValidAuthority(authority, taskId) {
  if (authority === null || typeof authority !== 'object' || Array.isArray(authority)) {
    fail(
      'control tower result intake requires the exact caller-supplied authority binding { authorityKind, authorityId, sourceTaskId, emissionSlot } of the ONE canonical pre-execution authority that owns the delivered task.',
      { code: INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY, taskId },
    );
  }
  if (Object.getOwnPropertySymbols(authority).length > 0) {
    fail('authority binding must not carry symbol keys.', {
      code: INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY,
      taskId,
    });
  }
  for (const key of Object.getOwnPropertyNames(authority)) {
    if (!CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_FIELDS.includes(key)) {
      fail(
        `authority binding accepts exactly (${CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_FIELDS.join(', ')}); received unknown field "${key}".`,
        { code: INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY, taskId },
      );
    }
  }
  if (
    authority.authorityKind !== AUTHORITY_KIND_USER_APPROVED_INTAKE &&
    authority.authorityKind !== AUTHORITY_KIND_EMISSION_ADMISSION
  ) {
    fail(
      `authorityKind must be exactly ${AUTHORITY_KIND_USER_APPROVED_INTAKE} or ${AUTHORITY_KIND_EMISSION_ADMISSION} (got ${describeValue(authority.authorityKind)}).`,
      { code: INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY, taskId },
    );
  }
  assertNonEmptyBoundedString(
    authority.authorityId,
    'authorityId',
    MAX_CONTROL_TOWER_RESULT_INTAKE_ID_LENGTH,
    INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY,
  );
  assertValidTaskId(authority.sourceTaskId, INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY);
  if (
    typeof authority.emissionSlot !== 'string' ||
    !EMISSION_SLOT_PATTERN.test(authority.emissionSlot)
  ) {
    fail(
      `emissionSlot must match ${String(EMISSION_SLOT_PATTERN)} (got ${JSON.stringify(authority.emissionSlot)}).`,
      { code: INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY, taskId },
    );
  }
  if (
    authority.authorityKind === AUTHORITY_KIND_USER_APPROVED_INTAKE &&
    authority.sourceTaskId !== taskId
  ) {
    fail(
      `user-approved intake authority is self-bound: authority.sourceTaskId must equal the delivered taskId (${taskId} vs ${authority.sourceTaskId}).`,
      { code: CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH, taskId },
    );
  }
  return authority;
}

function assertBaseIntakeStoreCapabilities(store, taskId) {
  if (
    !store ||
    typeof store.readTask !== 'function' ||
    typeof store.readResult !== 'function' ||
    typeof store.readClaim !== 'function' ||
    typeof store.readCurrentDisposition !== 'function'
  ) {
    fail(
      'control tower result intake requires a caller-supplied store exposing readTask / readResult / readClaim / readCurrentDisposition (composition only; the caller supplies the store explicitly).',
      { code: INVALID_CONTROL_TOWER_RESULT_INTAKE_STORE, taskId },
    );
  }
}

/**
 * Re-read the ONE canonical pre-execution authority and derive the exact
 * admission-bound claim token that owns the delivered result. The authority
 * source is never inferred, scanned, or merged: a mismatch (wrong authority id,
 * wrong child binding, or a claim token that does not recompose) fails closed.
 */
function resolveAuthorityClaimBinding({ store, taskId, authority, claim }) {
  let admissionId;
  if (authority.authorityKind === AUTHORITY_KIND_USER_APPROVED_INTAKE) {
    if (typeof store.readUserApprovedIntake !== 'function') {
      fail(
        'store does not expose readUserApprovedIntake for the supplied user-approved intake authority.',
        { code: INVALID_CONTROL_TOWER_RESULT_INTAKE_STORE, taskId },
      );
    }
    const intake = store.readUserApprovedIntake({ taskId });
    if (intake.intakeId !== authority.authorityId) {
      fail(
        `user-approved intake authority id mismatch (fail-closed): caller supplied ${authority.authorityId} but the durable authority carries ${intake.intakeId}.`,
        { code: CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH, taskId },
      );
    }
    admissionId = intake.intakeId;
  } else {
    if (typeof store.readEmissionAdmission !== 'function') {
      fail(
        'store does not expose readEmissionAdmission for the supplied emission admission authority.',
        { code: INVALID_CONTROL_TOWER_RESULT_INTAKE_STORE, taskId },
      );
    }
    const admission = store.readEmissionAdmission({
      sourceTaskId: authority.sourceTaskId,
      emissionSlot: authority.emissionSlot,
    });
    if (admission.admissionId !== authority.authorityId) {
      fail(
        `emission admission authority id mismatch (fail-closed): caller supplied ${authority.authorityId} but the durable admission carries ${admission.admissionId}.`,
        { code: CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH, taskId },
      );
    }
    if (admission.nextTaskId !== taskId) {
      fail(
        `emission admission does not bind the delivered task (fail-closed): admission child=${admission.nextTaskId} delivered task=${taskId}.`,
        { code: CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH, taskId },
      );
    }
    admissionId = admission.admissionId;
  }
  let expectedClaimToken;
  try {
    expectedClaimToken = buildAdmissionBoundClaimToken({
      admissionId,
      nextTaskId: taskId,
      workerId: claim.workerId,
    });
  } catch (error) {
    fail(
      `admission-bound claim token could not be recomposed from the durable authority binding (fail-closed): ${error?.message}`,
      {
        code: CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH,
        taskId,
      },
    );
  }
  return { admissionId, expectedClaimToken };
}

/**
 * Validate one derived Control Tower result-intake envelope. Returns a frozen
 * copy. Fail-closed, no repair:
 *   1. exact field shape/order and schema version,
 *   2. bounded identity/provenance fields,
 *   3. identity recomputation from (taskId, resultId),
 *   4. authority kind conventions,
 *   5. exact canonical Result Envelope plus result/claim/authority convergence
 *      (resultId, taskId, workerId, claimGeneration, content binding).
 */
export function validateControlTowerResultIntakeRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    fail('control tower result intake envelope must be a plain object.', {
      code: CORRUPT_CONTROL_TOWER_RESULT_INTAKE,
    });
  }
  const keys = Object.keys(record);
  if (keys.length !== CONTROL_TOWER_RESULT_INTAKE_FIELDS.length) {
    fail(
      `control tower result intake envelope must carry exactly ${CONTROL_TOWER_RESULT_INTAKE_FIELDS.length} fields (${CONTROL_TOWER_RESULT_INTAKE_FIELDS.join(', ')}).`,
      { code: CORRUPT_CONTROL_TOWER_RESULT_INTAKE },
    );
  }
  for (let index = 0; index < CONTROL_TOWER_RESULT_INTAKE_FIELDS.length; index += 1) {
    if (keys[index] !== CONTROL_TOWER_RESULT_INTAKE_FIELDS[index]) {
      fail(
        `control tower result intake envelope key order/shape mismatch at position ${index}: expected "${CONTROL_TOWER_RESULT_INTAKE_FIELDS[index]}" got "${keys[index]}".`,
        { code: CORRUPT_CONTROL_TOWER_RESULT_INTAKE },
      );
    }
  }
  if (record.schemaVersion !== CONTROL_TOWER_RESULT_INTAKE_SCHEMA_VERSION) {
    fail(
      `control tower result intake schemaVersion must be ${JSON.stringify(CONTROL_TOWER_RESULT_INTAKE_SCHEMA_VERSION)}.`,
      { code: 'INVALID_SCHEMA_VERSION' },
    );
  }
  const taskId = assertValidTaskId(record.taskId, CORRUPT_CONTROL_TOWER_RESULT_INTAKE);
  if (!TASK_KINDS.includes(record.taskKind)) {
    fail(`taskKind must be one of ${TASK_KINDS.join(', ')}.`, {
      code: CORRUPT_CONTROL_TOWER_RESULT_INTAKE,
    });
  }
  assertValidAuthority(
    {
      authorityKind: record.authorityKind,
      authorityId: record.authorityId,
      sourceTaskId: record.sourceTaskId,
      emissionSlot: record.emissionSlot,
    },
    taskId,
  );
  assertNonEmptyBoundedString(
    record.resultId,
    'resultId',
    MAX_CONTROL_TOWER_RESULT_INTAKE_ID_LENGTH,
    CORRUPT_CONTROL_TOWER_RESULT_INTAKE,
  );
  if (
    record.resultId.includes('/') ||
    record.resultId.includes('\\') ||
    record.resultId.includes('..')
  ) {
    fail('resultId must not contain path separators or "..".', {
      code: CORRUPT_CONTROL_TOWER_RESULT_INTAKE,
    });
  }
  const expectedIntakeId = buildControlTowerResultIntakeId({
    taskId,
    resultId: record.resultId,
  });
  if (record.intakeId !== expectedIntakeId) {
    fail(`intakeId mismatch (expected ${expectedIntakeId}).`, {
      code: 'CONTROL_TOWER_RESULT_INTAKE_ID_MISMATCH',
      taskId,
    });
  }
  if (
    typeof record.resultBinding !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(record.resultBinding)
  ) {
    fail('resultBinding must be a stable content hash of form "sha256:<64 hex>".', {
      code: CORRUPT_CONTROL_TOWER_RESULT_INTAKE,
    });
  }
  assertNonEmptyBoundedString(
    record.claimWorkerId,
    'claimWorkerId',
    MAX_CONTROL_TOWER_RESULT_INTAKE_ID_LENGTH,
    CORRUPT_CONTROL_TOWER_RESULT_INTAKE,
  );
  if (!Number.isInteger(record.claimGeneration) || record.claimGeneration < 1) {
    fail('claimGeneration must be an integer >= 1 (the existing claim fencing generation).', {
      code: CORRUPT_CONTROL_TOWER_RESULT_INTAKE,
    });
  }
  if (
    record.dispositionRef !==
    dispositionRef(taskId, CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_GENERATION)
  ) {
    fail(
      `dispositionRef must equal the generation-1 Control Tower pointer "${dispositionRef(taskId, CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_GENERATION)}".`,
      { code: CORRUPT_CONTROL_TOWER_RESULT_INTAKE },
    );
  }
  const result = validateResultEnvelope(record.result);
  if (result.taskId !== taskId || result.resultId !== record.resultId) {
    fail(
      'embedded canonical result does not bind to the intake envelope task/result identity (fail-closed).',
      { code: CONTROL_TOWER_RESULT_INTAKE_RESULT_BINDING_MISMATCH, taskId },
    );
  }
  if (
    result.workerId !== record.claimWorkerId ||
    result.claimGeneration !== record.claimGeneration
  ) {
    fail('embedded canonical result does not bind to the intake claim provenance (fail-closed).', {
      code: CONTROL_TOWER_RESULT_INTAKE_CLAIM_BINDING_MISMATCH,
      taskId,
    });
  }
  if (computeResultBinding(result) !== record.resultBinding) {
    fail('resultBinding does not match the embedded canonical result (fail-closed).', {
      code: CONTROL_TOWER_RESULT_INTAKE_RESULT_BINDING_MISMATCH,
      taskId,
    });
  }
  const json = JSON.stringify(record);
  if (json.length > MAX_CONTROL_TOWER_RESULT_INTAKE_JSON_BYTES) {
    fail(
      `control tower result intake envelope JSON is ${json.length} bytes (> ${MAX_CONTROL_TOWER_RESULT_INTAKE_JSON_BYTES}): reference-first, no embedded dumps.`,
      { code: 'CONTEXT_BUDGET_EXCEEDED', taskId },
    );
  }
  return Object.freeze({
    schemaVersion: CONTROL_TOWER_RESULT_INTAKE_SCHEMA_VERSION,
    intakeId: record.intakeId,
    taskId,
    taskKind: record.taskKind,
    authorityKind: record.authorityKind,
    authorityId: record.authorityId,
    sourceTaskId: record.sourceTaskId,
    emissionSlot: record.emissionSlot,
    resultId: record.resultId,
    resultBinding: record.resultBinding,
    claimWorkerId: record.claimWorkerId,
    claimGeneration: record.claimGeneration,
    dispositionRef: record.dispositionRef,
    result,
  });
}

/**
 * Derive the frozen Control Tower result-intake envelope for ONE already
 * delivered canonical result. Pure read: zero durable writes, zero Git reads,
 * zero executor invocations.
 *
 * Fail-closed cases (no envelope is returned):
 *   - task is not RESULT_DELIVERED,
 *   - canonical result missing/corrupt (the existing store code propagates),
 *   - canonical result does not bind to the task,
 *   - claim record missing/corrupt or result worker/generation mismatch,
 *   - the supplied authority does not own the delivered task or the result
 *     claim token does not recompose from the admission-bound authority.
 */
export function deriveControlTowerResultIntake({ store, taskId, authority } = {}) {
  assertBaseIntakeStoreCapabilities(store, taskId);
  assertValidTaskId(taskId, INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY);
  assertValidAuthority(authority, taskId);

  const task = store.readTask(taskId);
  if (task?.taskId !== taskId) {
    fail(`task read does not bind to the requested task (fail-closed): expected ${taskId}.`, {
      code: CONTROL_TOWER_RESULT_INTAKE_RESULT_BINDING_MISMATCH,
      taskId,
    });
  }
  if (task.status !== TASK_STATUS_RESULT_DELIVERED) {
    fail(
      `control tower result intake requires RESULT_DELIVERED (task=${taskId} status=${task.status}): there is no delivered canonical result to hand over.`,
      { code: CONTROL_TOWER_RESULT_INTAKE_NOT_DELIVERED, taskId },
    );
  }
  const result = store.readResult(taskId);
  if (result?.taskId !== taskId) {
    fail(
      `canonical result does not bind to the delivered task (fail-closed): expected ${taskId} got ${String(result?.taskId)}.`,
      { code: CONTROL_TOWER_RESULT_INTAKE_RESULT_BINDING_MISMATCH, taskId },
    );
  }
  const claim = store.readClaim(taskId);
  if (
    claim?.taskId !== taskId ||
    claim.workerId !== result.workerId ||
    claim.generation !== result.claimGeneration
  ) {
    fail(
      `canonical result does not bind to the durable claim record (fail-closed): result worker/generation do not match the claim authority for ${taskId}.`,
      { code: CONTROL_TOWER_RESULT_INTAKE_CLAIM_BINDING_MISMATCH, taskId },
    );
  }
  const { expectedClaimToken } = resolveAuthorityClaimBinding({
    store,
    taskId,
    authority,
    claim,
  });
  if (claim.claimToken !== expectedClaimToken || result.claimToken !== expectedClaimToken) {
    fail(
      `canonical result claim token does not recompose from the supplied canonical authority (fail-closed): the delivered result is not attributed to the admission-bound claim winner.`,
      { code: CONTROL_TOWER_RESULT_INTAKE_AUTHORITY_BINDING_MISMATCH, taskId },
    );
  }
  return validateControlTowerResultIntakeRecord({
    schemaVersion: CONTROL_TOWER_RESULT_INTAKE_SCHEMA_VERSION,
    intakeId: buildControlTowerResultIntakeId({ taskId, resultId: result.resultId }),
    taskId,
    taskKind: task.taskKind,
    authorityKind: authority.authorityKind,
    authorityId: authority.authorityId,
    sourceTaskId: authority.sourceTaskId,
    emissionSlot: authority.emissionSlot,
    resultId: result.resultId,
    resultBinding: computeResultBinding(result),
    claimWorkerId: claim.workerId,
    claimGeneration: claim.generation,
    dispositionRef: dispositionRef(taskId, CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_GENERATION),
    result,
  });
}

function assertIntakeDisposition(disposition, intake, taskId) {
  if (
    disposition.resultId !== intake.resultId ||
    disposition.resultBinding !== intake.resultBinding ||
    disposition.claimGeneration !== intake.claimGeneration
  ) {
    fail(
      `existing disposition does not bind to the delivered canonical result (fail-closed): ${intake.dispositionRef}.`,
      { code: CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_BINDING_MISMATCH, taskId },
    );
  }
  if (
    disposition.dispositionGeneration === CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_GENERATION &&
    disposition.state !== DISPOSITION_STATE_PENDING
  ) {
    fail(
      `generation 1 disposition must be ${DISPOSITION_STATE_PENDING} (fail-closed): found ${disposition.state}.`,
      { code: CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_BINDING_MISMATCH, taskId },
    );
  }
  // Any EXISTING generation-1 PENDING_DISPOSITION (including one begun by a
  // manual Control Tower flow) is the canonical first winner: read-only
  // convergence only, never overwrite, never rewrite provenance.
  return disposition;
}

/**
 * Perform (or converge) the durable Control Tower result intake for ONE already
 * delivered canonical result:
 *
 *   RESULT_DELIVERED(taskId)
 *     -> CONTROL_TOWER_RESULT_AVAILABLE(taskId)   [PENDING_DISPOSITION gen 1]
 *
 * The canonical Result Envelope is the ONLY result authority; the durable
 * disposition pointer is the ONLY durable state written (through the EXISTING
 * store.beginDisposition exclusive-create + same-generation first-wins
 * fencing). No verdict is authored, no generation advances, no executor runs.
 *
 * Returns a frozen `{ intake, disposition, newlyIntaken, exactReplay }`:
 *   - newlyIntaken true  -> generation 1 PENDING_DISPOSITION was created now,
 *   - exactReplay true   -> the same intake (or a later Control Tower verdict)
 *                           already existed; zero durable byte changes.
 * A conflicting/corrupt durable disposition fails closed with the EXISTING
 * disposition codes propagated UNCHANGED; nothing is overwritten or repaired.
 */
export function performControlTowerResultIntake({ store, taskId, authority } = {}) {
  assertBaseIntakeStoreCapabilities(store, taskId);
  if (!store || typeof store.beginDisposition !== 'function') {
    fail(
      'control tower result intake requires a caller-supplied store exposing beginDisposition (the EXISTING Control Tower disposition pointer authority).',
      { code: INVALID_CONTROL_TOWER_RESULT_INTAKE_STORE, taskId },
    );
  }
  const intake = deriveControlTowerResultIntake({ store, taskId, authority });

  // Any existing disposition (pending intake OR a later Control Tower verdict)
  // is authoritative: converge read-only, never advance, never duplicate.
  const current = optionalRead(() => store.readCurrentDisposition(taskId), 'DISPOSITION_NOT_FOUND');
  if (current !== null) {
    return Object.freeze({
      intake,
      disposition: assertIntakeDisposition(current, intake, taskId),
      newlyIntaken: false,
      exactReplay: true,
    });
  }

  // No disposition yet: create EXACTLY generation 1 PENDING_DISPOSITION bound
  // to the canonical result. decidedAt is the canonical delivery timestamp (not
  // the current clock), so replays and concurrent writers recompute the exact
  // same candidate bytes and converge through the existing fencing.
  const written = store.beginDisposition({
    taskId,
    resultId: intake.resultId,
    controlTowerToken: CONTROL_TOWER_RESULT_INTAKE_CONTROL_TOWER_TOKEN,
    controlTowerId: CONTROL_TOWER_RESULT_INTAKE_CONTROL_TOWER_ID,
    policyRefs: [...CONTROL_TOWER_RESULT_INTAKE_POLICY_REFS],
    proofRefs: [`canonical-result:${intake.resultId}`, `result-binding:${intake.resultBinding}`],
    evidenceRefs: [
      `authority:${intake.authorityKind}:${intake.authorityId}`,
      `claim:${intake.claimWorkerId}@${intake.claimGeneration}`,
    ],
    decidedAt: intake.result.deliveredAt,
  });
  const disposition = store.readCurrentDisposition(taskId);
  assertIntakeDisposition(disposition, intake, taskId);
  if (
    disposition.dispositionGeneration !== CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_GENERATION ||
    disposition.state !== DISPOSITION_STATE_PENDING
  ) {
    fail(
      `control tower result intake must converge to generation 1 PENDING_DISPOSITION (fail-closed): got generation=${disposition.dispositionGeneration} state=${disposition.state}.`,
      { code: CONTROL_TOWER_RESULT_INTAKE_DISPOSITION_BINDING_MISMATCH, taskId },
    );
  }
  return Object.freeze({
    intake,
    disposition,
    newlyIntaken: written.duplicate !== true,
    exactReplay: written.duplicate === true,
  });
}
