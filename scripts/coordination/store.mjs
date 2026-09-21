// Bounded mutation owner: GREENHUB-COORDINATION-DURABLE-CORE-01
// + GREENHUB-COORDINATION-DISPOSITION-STORE-07 (disposition persistence/state/fencing only)
// + GREENHUB-COORDINATION-CANONICAL-MATERIALIZATION-CONSUMPTION-CURSOR-11
//   (ADOPTED materialization/read-back/ACK/CONSUMED/cursor only; no emission).
// + GREENHUB-COORDINATION-CURSOR-APPEND-STABILITY-12
//   (append-stable task sequence + v1 cursor migration ONLY; no emission).
// + GREENHUB-COORDINATION-DETERMINISTIC-NEXT-TASK-EMISSION-13
//   (deterministic next-task emission over a CONSUMED closure ONLY:
//   emitNextTask/readEmission + emission persistence; no scheduler, no
//   dispatch, no fan-out, no adapters, no autonomous loop).
// + GREENHUB-COORDINATION-EMISSION-BOUND-ADMISSION-14
//   (emission-bound admission over the exact canonical emission ONLY:
//   admitEmittedTask/readEmissionAdmission + admission persistence, then the
//   existing markReady() path; no scheduler, no polling, no claim automation,
//   no dispatch, no fan-out, no adapters, no autonomous loop).
// + GREENHUB-COORDINATION-ADMISSION-BOUND-CLAIM-15
//   (admission-bound claim over the exact canonical emission admission ONLY:
//   claimAdmittedTask/readAdmissionBoundClaim + deterministic admission-bound
//   claimToken, then the existing claimTask() path; no scheduler, no READY
//   scan, no worker selection, no dispatch, no fan-out, no adapters,
//   no autonomous loop).
// + GREENHUB-COORDINATION-CANONICAL-SCHEDULABLE-WORK-READ-17A
//   (pure read-only projection readCanonicalSchedulableWork over the exact
//   canonical emission admission ONLY; no mutation, no repair, no scheduler,
//   no READY scan, no dispatch).
// + GREENHUB-COORDINATION-CLAIM-BOUND-DISPATCH-ENVELOPE-18
//   (pure read-only identity readClaimBoundDispatchEnvelope /
//   verifyClaimBoundDispatchEnvelope over the exact canonical emission
//   admission + current claim.json ONLY, consuming the deterministic
//   buildClaimBoundDispatchEnvelope identity; no mutation, no repair, no
//   scheduler, no READY scan, no worker selection, no dispatch persistence,
//   no transport, no executor invocation).
// + GREENHUB-COORDINATION-DURABLE-DISPATCH-ATTEMPT-19
//   (immutable durable dispatch-attempt persistence ONLY:
//   persistDispatchAttempt / readDispatchAttempt over the exact LIVE Task 18
//   envelope, exclusive-create per dispatchId under
//   <home>/tasks/<sourceTaskId>/dispatch-attempts/<dispatchId>.json; no
//   transport, no scheduler, no worker selection, no executor invocation,
//   no ACK, no task status mutation, no new generation/retry authority).
// + GREENHUB-COORDINATION-DURABLE-RECEIVER-ACCEPTANCE-22
//   (immutable durable receiver acceptance persistence ONLY:
//   readReceiverDispatchAcceptance / createReceiverDispatchAcceptance keyed by
//   dispatchId ONLY under <home>/receiver-acceptances/<dispatchId>.json; the
//   durable value is the EXACT validated Task 20 transport request itself;
//   exclusive-create, no overwrite, no auto-repair, no delete-and-recreate,
//   no last-writer-wins; no ACK, no executor invocation, no scheduler, no
//   retry/backoff/resend, no new generation authority, no concrete transport,
//   no task/claim/admission/emission/attempt/result mutation).
// + GREENHUB-COORDINATION-DURABLE-EXECUTOR-INVOCATION-ATTEMPT-28
//   (immutable durable executor invocation attempt persistence ONLY:
//   readExecutorInvocationAttempt / createExecutorInvocationAttempt keyed by
//   dispatchId ONLY under <home>/executor-invocation-attempts/<dispatchId>.json;
//   the durable value is the EXACT canonical Task 27 invocation input itself
//   ({ schemaVersion, dispatchId, decision, decisionInput }) derived directly
//   from the durable Task 22 receiver acceptance, with the invocation-attempt
//   fact expressed by the namespace/path authority ONLY;
//   exclusive-create, no overwrite, no auto-repair, no delete-and-recreate,
//   no last-writer-wins; no ACK, no receipt, no executor invocation, no
//   scheduler, no worker selection, no retry/backoff/resend, no new
//   generation authority, no concrete transport, no execution start, no
//   task/claim/admission/emission/attempt/receiver-acceptance/result
//   mutation).
// + GREENHUB-COORDINATION-DURABLE-EXECUTOR-INVOCATION-OUTCOME-32
//   (immutable durable executor invocation outcome persistence ONLY:
//   readExecutorInvocationOutcome / createExecutorInvocationOutcome keyed by
//   dispatchId ONLY under <home>/executor-invocation-outcomes/<dispatchId>.json;
//   the durable value is the EXACT canonical Task 30 validated outcome itself
//   ({ schemaVersion: 1, dispatchId, outcome }) with no wrapper metadata, with
//   the durable-recording fact expressed by the namespace/path authority ONLY;
//   exclusive-create, no overwrite, no auto-repair, no delete-and-recreate,
//   no last-writer-wins; no ACK, no receipt, no executor invocation, no task
//   status transition, no scheduler, no worker selection, no retry/backoff/
//   resend, no new generation authority, no concrete transport, no execution
//   start, no task/claim/admission/emission/attempt/receiver-acceptance/
//   executor-invocation-attempt/result
//   mutation).
// + GREENHUB-COORDINATION-DURABLE-EXECUTOR-RESULT-RECEIPT-33
//   (immutable durable executor result receipt persistence ONLY:
//   readExecutorResultReceipt / createExecutorResultReceipt keyed by
//   dispatchId ONLY under <home>/executor-result-receipts/<dispatchId>.json;
//   the durable value is the EXACT validated structured executor evidence
//   ({ schemaVersion: 1, dispatchId, taskId, status, summary, proofRefs,
//   evidenceRefs, frictionObserved }) with no wrapper metadata, with the
//   durable-recording fact expressed by the namespace/path authority ONLY;
//   exclusive-create, no overwrite, no auto-repair, no delete-and-recreate,
//   no last-writer-wins; no canonical task result, no deliverResult, no
//   RESULT_DELIVERED, no ACK, no disposition, no task status transition, no
//   executor invocation, no scheduler, no worker selection, no retry/backoff/
//   resend, no new generation authority, no concrete transport, no
//   task/claim/admission/emission/attempt/receiver-acceptance/
//   executor-invocation-attempt/
//   executor-invocation-outcome/result mutation).
// + GREENHUB-COORDINATION-EXECUTOR-INVOCATION-FENCE (COORD-AUDIT-C03,
//   immutable pre-invocation fence persistence ONLY:
//   readExecutorInvocationFence / createExecutorInvocationFence keyed by
//   dispatchId ONLY under <home>/executor-invocation-fences/<dispatchId>.json;
//   the durable value is the EXACT canonical fence record
//   ({ schemaVersion: 1, dispatchId }) with no wrapper metadata, with the
//   pre-invocation fencing fact expressed by the namespace/path authority
//   ONLY; exclusive-create, no overwrite, no auto-repair, no delete-and-
//   recreate, no last-writer-wins, no lease, no expiry; no ACK, no receipt, no
//   executor invocation, no task status transition, no scheduler, no worker
//   selection, no retry/backoff/resend, no new generation authority, no
//   concrete transport, no execution start, no task/claim/admission/emission/
//   attempt/receiver-acceptance/
//   executor-invocation-attempt/executor-invocation-outcome/result mutation).
// + COORD-AUDIT-C01 (interrupted result delivery replay convergence ONLY:
//   an already stored per-id/canonical Result is immutable authority; an exact
//   full-semantic-payload replay converges only the missing canonical/terminal
//   steps with no rewrite and no executor re-invocation; a same-resultId
//   payload difference fails closed with DUPLICATE_RESULT_ID_CONFLICT;
//   first-winner and live claim fencing semantics are unchanged).
// + COORD-AUDIT-C02 (expired claim takeover concurrency safety ONLY: every
//   claim.json mutation is serialized by a per-task generation-bound takeover
//   lock that records the exact generation/token it may replace, so concurrent
//   takeover contenders elect exactly one authoritative winner, a contender
//   that observed generation N can never delete an already-published N+1
//   replacement, and the remove/replace crash window publishes
//   baseGeneration + 1 instead of rewinding; stale-result fencing, terminal
//   safety, and first-winner result semantics are unchanged).
// + GREENHUB-COORDINATION-USER-APPROVED-READONLY-INTAKE-GF06
//   (user-approved external READ_ONLY task intake ONLY:
//   intakeUserApprovedReadOnlyTask / readUserApprovedIntake plus the
//   intake-bound claim/dispatch-attempt/envelope reads for the existing GF-05
//   operator run path over ONE explicit user-approved READ_ONLY Task Envelope
//   spec, durable under <home>/intake-authorities/<taskId>.json; ordering is
//   INTAKE AUTHORITY -> task create -> READY via the existing markReady()
//   path; no fake CONSUMED source, no emission/admission relaxation, no
//   scheduler, no READY scan, no claim automation, no dispatch automation, no
//   executor invocation, no result delivery, no fan-out, no adapter, no
//   autonomous loop).
// Durable local coordination store: TASK CREATED -> READY -> CLAIMED -> RESULT_DELIVERED,
// plus a separate durable disposition domain (PENDING_DISPOSITION/BLOCKED/
// NEEDS_USER_DECISION/ADOPTED/REJECTED/SUPERSEDED) bound to the canonical result,
// plus ADOPTED-only canonical per-task materialization with durable read-back,
// ACK, CONSUMED, and highest-contiguous-CONSUMED cursor over an append-stable
// task sequence, plus deterministic next-task emission from a CONSUMED closure,
// plus emission-bound admission of the exact canonical emission converging the
// exact canonical child through the existing markReady() path, plus
// admission-bound claim of the exact admitted child through the existing
// claimTask() path with a deterministic admission-bound claimToken.
// Scheduler, queue polling, READY scan, worker selection, dispatch, fan-out,
// adapters, Astra/OpenCode integration, autonomous loop, application code,
// publication automation, and 57C remain out of scope.
//
// Filesystem layout under a durable home (never the repository worktree):
//   <home>/tasks/<taskId>/task.json
//   <home>/tasks/<taskId>/claim.json
//   <home>/tasks/<taskId>/claim.takeover.lock
//     (transient generation-bound claim mutation lock; never durable state:
//     created and retired inside one claim operation, and recovered
//     deterministically when its owner process died)
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
//   <home>/tasks/<sourceTaskId>/emissions/<emissionSlot>.json
//     (deterministic next-task emission authority, bound to the CONSUMED closure)
//   <home>/tasks/<sourceTaskId>/emission-admissions/<emissionSlot>.json
//     (emission-bound admission authority, bound to the exact canonical emission;
//     READY is reached only through the existing markReady() path after this
//     authority is durable)
//   <home>/intake-authorities/<taskId>.json
//     (user-approved external READ_ONLY intake authority, bound to the explicit
//     approval provenance + the exact canonical task spec bytes; ordering is
//     INTAKE AUTHORITY -> task create -> READY through the existing markReady()
//     path; exclusive-create, one canonical slot per taskId, no overwrite)
//   <home>/tasks/<sourceTaskId>/dispatch-attempts/<dispatchId>.json
//     (immutable durable dispatch-attempt intent, bound to the exact LIVE Task 18
//     envelope; exclusive-create, no overwrite, no transport)
//   <home>/receiver-acceptances/<dispatchId>.json
//     (immutable durable receiver acceptance fact keyed by dispatchId ONLY: the
//     EXACT validated Task 20 transport request itself; exclusive-create,
//     no wrapper metadata, no ACK, no overwrite, no auto-repair)
//   <home>/executor-invocation-attempts/<dispatchId>.json
//     (immutable durable executor invocation attempt fact keyed by dispatchId
//     ONLY: the EXACT canonical Task 27 invocation input itself
//     ({ schemaVersion, dispatchId, decision, decisionInput }) derived directly
//     from the durable receiver acceptance, with the invocation-attempt meaning
//     expressed by this path authority ONLY;
//     exclusive-create, no wrapper metadata, no ACK/receipt, no executor
//     invocation, no overwrite, no auto-repair, no new generation)
//   <home>/executor-invocation-outcomes/<dispatchId>.json
//     (immutable durable executor invocation outcome fact keyed by dispatchId
//     ONLY: the EXACT canonical Task 30 validated outcome itself
//     ({ schemaVersion: 1, dispatchId, outcome }), with the durable-recording
//     meaning expressed by this path authority ONLY; exclusive-create, no
//     wrapper metadata, no ACK/receipt, no executor invocation, no task
//     status transition, no overwrite, no auto-repair, no new generation)
//   <home>/executor-result-receipts/<dispatchId>.json
//     (immutable durable executor result receipt fact keyed by dispatchId
//     ONLY: the EXACT validated structured executor evidence
//     ({ schemaVersion: 1, dispatchId, taskId, status, summary, proofRefs,
//     evidenceRefs, frictionObserved }), with the durable-recording meaning
//     expressed by this path authority ONLY; exclusive-create, no wrapper
//     metadata, no canonical task result, no ACK/disposition, no executor
//     invocation, no task status transition, no overwrite, no auto-repair,
//     no new generation)
// Claim authority stays <home>/tasks/<taskId>/claim.json (no new claim file,
// no new lease subsystem, no worker registry): the admission-bound layer only
// derives a deterministic claimToken bound to the canonical admission and
// reuses the existing claimTask()/generation fencing.
//
// Claim atomicity (COORD-AUDIT-C02) serializes every claim.json mutation
// (first creation and expired takeover alike) behind a per-task
// generation-bound takeover lock (`claim.takeover.lock`). The lock records the
// exact claim generation/token it may replace (generation 0 for a first
// creation), so a holder only ever removes the exact generation it validated:
// concurrent takeover contenders elect exactly one authoritative winner (the
// rest fail closed with LEASE_ACTIVE), and a contender that observed
// generation N can never delete an already-published N+1 replacement. A stale
// lock (provably dead owner pid) is retired deterministically, and the
// remove/replace crash window publishes baseGeneration + 1 so the canonical
// generation never rewinds. The
// race-prone `exists() -> write()` and unconditional-delete patterns are never
// used: every creation goes through an atomic exclusive create. Claim
// authority stays the single claim.json file; the lock is transient
// mutual-exclusion state, not a new durable registry.
//
// Windows/NTFS replacement contention: durable replacement publishes a
// same-directory temp file through an atomic rename (hard-link for
// exclusive-create). While another process holds the target open, that rename
// can transiently fail with EPERM/EBUSY even though the replacement is
// logically valid. Those two codes only are absorbed by a small bounded retry;
// the target is never deleted first and partial JSON is never exposed. Task
// status transitions re-read their current state before every attempt so a
// retried write can never republish a superseded status. Directory scans
// ignore this module's own in-flight `<name>.json.<pid>.<uuid>.tmp` artifacts
// for the same reason.
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
import {
  DEFAULT_EMISSION_SLOT,
  assertValidEmissionSlot,
  buildEmissionRecord,
  computeNextTaskSpecBinding,
  emissionRef,
  normalizeNextTaskSpec,
  validateEmissionRecord,
} from './next-task-emission.mjs';
import {
  admissionRef,
  buildAdmissionRecord,
  validateAdmissionRecord,
} from './emission-admission.mjs';
import {
  USER_APPROVED_INTAKE_DISPATCH_SLOT,
  buildUserApprovedIntakeRecord,
  userApprovedIntakeFilePath,
  userApprovedIntakeRecordsEquivalent,
  userApprovedIntakeRef,
  validateUserApprovedIntakeRecord,
} from './user-approved-intake.mjs';
import { buildAdmissionBoundClaimToken } from './admission-bound-claim.mjs';
import { buildSchedulableWorkProjection } from './canonical-schedulable-work-read.mjs';
import {
  RUNNABLE_OCCURRENCE_STATE_CLAIMED,
  RUNNABLE_OCCURRENCE_STATE_RUNNABLE,
  RUNNABLE_OCCURRENCE_STATE_TERMINAL,
  buildRunnableOccurrenceRecord,
} from './runnable-occurrence.mjs';
import {
  buildClaimBoundDispatchEnvelope,
  validateClaimBoundDispatchEnvelope,
} from './claim-bound-dispatch-envelope.mjs';
import {
  assertValidDispatchAttemptId,
  buildDispatchAttemptRecord,
  dispatchAttemptFilePath,
  validateDispatchAttemptRecord,
} from './dispatch-attempt.mjs';
import { validateTransportRequest } from './dispatch-transport-contract.mjs';
import {
  CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
  assertValidReceiverAcceptanceDispatchId,
  receiverDispatchAcceptanceFilePath,
} from './dispatch-receiver-acceptance.mjs';
import {
  validateExecutorInvocationInputRecord,
} from './dispatch-executor-invocation-input.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
  assertValidExecutorInvocationAttemptDispatchId,
  executorInvocationAttemptFilePath,
} from './dispatch-executor-invocation-attempt.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
  assertValidExecutorInvocationOutcomeDispatchId,
  executorInvocationOutcomeFilePath,
  validateExecutorInvocationOutcomeRecord,
} from './dispatch-executor-invocation-outcome-persistence.mjs';
import {
  CORRUPT_EXECUTOR_RESULT_RECEIPT,
  assertValidExecutorResultReceiptDispatchId,
  executorResultReceiptFilePath,
  validateExecutorResultReceiptRecord,
} from './executor-result-receipt.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_FENCE,
  assertValidExecutorInvocationFenceDispatchId,
  executorInvocationFenceFilePath,
  validateExecutorInvocationFenceRecord,
} from './dispatch-executor-invocation-fence.mjs';

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
export const EMISSION_NOT_ELIGIBLE = 'EMISSION_NOT_ELIGIBLE';
export const EMISSION_CONFLICT = 'EMISSION_CONFLICT';
export const EMISSION_BINDING_MISMATCH = 'EMISSION_BINDING_MISMATCH';
export const CORRUPT_EMISSION = 'CORRUPT_EMISSION';
export const EMISSION_NOT_FOUND = 'EMISSION_NOT_FOUND';
export const ADMISSION_CONFLICT = 'ADMISSION_CONFLICT';
export const ADMISSION_BINDING_MISMATCH = 'ADMISSION_BINDING_MISMATCH';
export const CORRUPT_ADMISSION = 'CORRUPT_ADMISSION';
export const ADMISSION_NOT_FOUND = 'ADMISSION_NOT_FOUND';
export const ADMISSION_BYPASS_DETECTED = 'ADMISSION_BYPASS_DETECTED';
export const INTAKE_CONFLICT = 'INTAKE_CONFLICT';
export const INTAKE_BINDING_MISMATCH = 'INTAKE_BINDING_MISMATCH';
export const CORRUPT_INTAKE_AUTHORITY = 'CORRUPT_INTAKE_AUTHORITY';
export const INTAKE_NOT_FOUND = 'INTAKE_NOT_FOUND';
export const INTAKE_AUTHORITY_CONFLICT = 'INTAKE_AUTHORITY_CONFLICT';
export const INTAKE_TASK_IDENTITY_CONFLICT = 'INTAKE_TASK_IDENTITY_CONFLICT';
export const INTAKE_TASK_BYPASS_DETECTED = 'INTAKE_TASK_BYPASS_DETECTED';
export const CLAIM_ADMISSION_BYPASS_DETECTED = 'CLAIM_ADMISSION_BYPASS_DETECTED';
export const INVALID_DISPATCH_BINDING = 'INVALID_DISPATCH_BINDING';
export const DISPATCH_BINDING_MISMATCH = 'DISPATCH_BINDING_MISMATCH';
export const STALE_DISPATCH = 'STALE_DISPATCH';
export const TASK_NOT_CLAIMED = 'TASK_NOT_CLAIMED';
export const DISPATCH_ATTEMPT_NOT_FOUND = 'DISPATCH_ATTEMPT_NOT_FOUND';
export const CORRUPT_DISPATCH_ATTEMPT = 'CORRUPT_DISPATCH_ATTEMPT';
export const DISPATCH_ATTEMPT_CONFLICT = 'DISPATCH_ATTEMPT_CONFLICT';
export const DISPATCH_ATTEMPT_BINDING_MISMATCH = 'DISPATCH_ATTEMPT_BINDING_MISMATCH';
export const ATOMIC_WRITE_CONTENTION_EXHAUSTED = 'ATOMIC_WRITE_CONTENTION_EXHAUSTED';
export const CORRUPT_CLAIM_TAKEOVER_LOCK = 'CORRUPT_CLAIM_TAKEOVER_LOCK';

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

// ---------------------------------------------------------------------------
// Deterministic next-task emission authority (DETERMINISTIC_NEXT_TASK_EMISSION).
// Durable under <home>/tasks/<sourceTaskId>/emissions/<emissionSlot>.json.
// One canonical slot per source closure by default (`next`); exclusive-create
// serializes concurrent writers so exactly one wins; timestamps are provenance
// only and never enter emission identity.
// ---------------------------------------------------------------------------

function emissionFilePath(home, sourceTaskId, emissionSlot) {
  assertValidTaskId(sourceTaskId);
  assertValidEmissionSlot(emissionSlot);
  return nodePath.join(resolveTaskDirectory(home, sourceTaskId), 'emissions', `${emissionSlot}.json`);
}

function readValidatedEmissionDocument(path, sourceTaskId, emissionSlot) {
  const found = readJsonFile(path);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') {
    storeFail(
      `emission record is corrupt (fail-closed, no auto-repair): ${emissionRef(sourceTaskId, emissionSlot)}`,
      { code: CORRUPT_EMISSION, taskId: sourceTaskId },
    );
  }
  let record;
  try {
    record = validateEmissionRecord(found.document);
  } catch (error) {
    storeFail(`emission record invalid (fail-closed): ${emissionRef(sourceTaskId, emissionSlot)}: ${error?.message}`, {
      code: typeof error?.code === 'string' && error.code ? error.code : CORRUPT_EMISSION,
      taskId: sourceTaskId,
    });
  }
  if (record.sourceTaskId !== sourceTaskId || record.emissionSlot !== emissionSlot) {
    storeFail(
      `emission identity/path mismatch (fail-closed): ${emissionRef(sourceTaskId, emissionSlot)}`,
      { code: CORRUPT_EMISSION, taskId: sourceTaskId },
    );
  }
  return { state: 'present', record };
}

// ---------------------------------------------------------------------------
// Emission-bound admission authority (EMISSION_BOUND_ADMISSION).
// Durable under <home>/tasks/<sourceTaskId>/emission-admissions/<slot>.json.
// One canonical admission per canonical emission slot; exclusive-create
// serializes concurrent admitters so exactly one wins; admittedAt/admitterId
// are provenance only and never enter admission identity.
// ---------------------------------------------------------------------------

function admissionFilePath(home, sourceTaskId, emissionSlot) {
  assertValidTaskId(sourceTaskId);
  assertValidEmissionSlot(emissionSlot);
  return nodePath.join(resolveTaskDirectory(home, sourceTaskId), 'emission-admissions', `${emissionSlot}.json`);
}

function readValidatedAdmissionDocument(path, sourceTaskId, emissionSlot) {
  const found = readJsonFile(path);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') {
    storeFail(
      `admission record is corrupt (fail-closed, no auto-repair): ${admissionRef(sourceTaskId, emissionSlot)}`,
      { code: CORRUPT_ADMISSION, taskId: sourceTaskId },
    );
  }
  let record;
  try {
    record = validateAdmissionRecord(found.document);
  } catch (error) {
    storeFail(`admission record invalid (fail-closed): ${admissionRef(sourceTaskId, emissionSlot)}: ${error?.message}`, {
      code: typeof error?.code === 'string' && error.code ? error.code : CORRUPT_ADMISSION,
      taskId: sourceTaskId,
    });
  }
  if (record.sourceTaskId !== sourceTaskId || record.emissionSlot !== emissionSlot) {
    storeFail(
      `admission identity/path mismatch (fail-closed): ${admissionRef(sourceTaskId, emissionSlot)}`,
      { code: CORRUPT_ADMISSION, taskId: sourceTaskId },
    );
  }
  return { state: 'present', record };
}

// ---------------------------------------------------------------------------
// User-approved external READ_ONLY intake authority
// (USER_APPROVED_READONLY_INTAKE_GF06).
// Durable under <home>/intake-authorities/<taskId>.json. One canonical slot per
// taskId; exclusive-create serializes concurrent intakes so exactly one wins;
// recordedAt/recorderId are provenance only and never enter intake identity.
// This is a DIFFERENT authority source from successor emission: no source
// CONSUMED closure, no emission, no emission admission.
// ---------------------------------------------------------------------------

function readValidatedIntakeDocument(path, taskId) {
  const found = readJsonFile(path);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') {
    storeFail(
      `intake authority record is corrupt (fail-closed, no auto-repair): ${userApprovedIntakeRef(taskId)}`,
      { code: CORRUPT_INTAKE_AUTHORITY, taskId },
    );
  }
  let record;
  try {
    record = validateUserApprovedIntakeRecord(found.document);
  } catch (error) {
    storeFail(
      `intake authority record invalid (fail-closed): ${userApprovedIntakeRef(taskId)}: ${error?.message}`,
      {
        code: typeof error?.code === 'string' && error.code ? error.code : CORRUPT_INTAKE_AUTHORITY,
        taskId,
      },
    );
  }
  if (record.taskId !== taskId) {
    storeFail(
      `intake authority identity/path mismatch (fail-closed): ${userApprovedIntakeRef(taskId)}`,
      { code: CORRUPT_INTAKE_AUTHORITY, taskId },
    );
  }
  return { state: 'present', record };
}

/**
 * True for fail-closed corruption/drift codes that must propagate unchanged
 * (never remapped to eligibility, never auto-repaired).
 */
function isFailClosedCorruptionCode(code) {
  return (
    typeof code === 'string' &&
    (code.startsWith('CORRUPT_') || code.endsWith('_MISMATCH') || code.endsWith('_CONFLICT'))
  );
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

/**
 * Durable `.json` file names of one directory, sorted. Missing directory means
 * empty. This module's own in-flight atomic-write temp artifacts are skipped;
 * every other unexpected file is returned as-is (callers validate contents).
 */
function listDurableJsonFileNames(directory) {
  let entries;
  try {
    entries = nodeFs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith('.json') && !isInFlightTempArtifactName(entry.name),
    )
    .map((entry) => entry.name)
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
      // A concurrent writer's in-flight temp artifact is transient by
      // construction: its creator publishes it under a durable name or
      // unlinks it. It is not durable corruption, so a scan must not fail
      // closed on it. Any other unexpected file still fails closed.
      if (isInFlightTempArtifactName(name)) continue;
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

// ---------------------------------------------------------------------------
// Atomic durable replacement (Windows/NTFS contention policy).
// EPERM/EBUSY are the only codes retried, they are retried a small bounded
// number of times with a short synchronous backoff, and every other error
// keeps the existing immediate fail-closed semantics.
// ---------------------------------------------------------------------------

const ATOMIC_WRITE_RETRYABLE_CODES = new Set(['EPERM', 'EBUSY']);
const ATOMIC_WRITE_MAX_ATTEMPTS = 8;
const ATOMIC_WRITE_MAX_RETRY_DELAY_MS = 20;

/** Unique in-flight temp artifact path for this module's atomic writers. */
function atomicTempPath(targetPath) {
  return `${targetPath}.${process.pid}.${randomUUID().replace(/-/g, '')}.tmp`;
}

/** True for this module's own in-flight temp artifacts (`<name>.json.<pid>.<uuid>.tmp`). */
function isInFlightTempArtifactName(name) {
  return /\.json\.[0-9]+\.[0-9a-f]+\.tmp$/.test(name);
}

function atomicWriteRetryDelayMs(attempt) {
  return Math.min(2 ** (attempt - 1), ATOMIC_WRITE_MAX_RETRY_DELAY_MS);
}

function sleepSyncMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Durable atomic write: temp file in the same directory + atomic rename.
 *
 * `documentOrBuilder` is either the document to publish or a function that
 * returns the document to publish (null/undefined means the write became
 * obsolete and nothing is published). The builder form is re-evaluated before
 * every attempt so a retried write never republishes superseded state.
 *
 * INVARIANT: TARGET_VISIBLE => TARGET_COMPLETE_AND_PARSEABLE. The target is
 * never unlinked before the replacement rename, so a failed or exhausted
 * write leaves the previous complete document in place.
 *
 * Returns { written, document }.
 */
export function writeJsonAtomic(targetPath, documentOrBuilder, { fileSystem = nodeFs } = {}) {
  fileSystem.mkdirSync(nodePath.dirname(targetPath), { recursive: true });
  const buildDocument = typeof documentOrBuilder === 'function' ? documentOrBuilder : () => documentOrBuilder;
  let lastContentionError = null;
  for (let attempt = 1; attempt <= ATOMIC_WRITE_MAX_ATTEMPTS; attempt += 1) {
    const document = buildDocument();
    if (document === null || document === undefined) return { written: false, document: null };
    const tempPath = atomicTempPath(targetPath);
    fileSystem.writeFileSync(tempPath, JSON.stringify(document, null, 2), 'utf8');
    try {
      fileSystem.renameSync(tempPath, targetPath);
      return { written: true, document };
    } catch (error) {
      try {
        fileSystem.unlinkSync(tempPath);
      } catch {
        // best effort: the temp name is unique to this writer.
      }
      if (!ATOMIC_WRITE_RETRYABLE_CODES.has(error?.code)) throw error;
      lastContentionError = error;
      if (attempt < ATOMIC_WRITE_MAX_ATTEMPTS) sleepSyncMs(atomicWriteRetryDelayMs(attempt));
    }
  }
  storeFail(
    `atomic replacement exhausted ${ATOMIC_WRITE_MAX_ATTEMPTS} attempts under transient filesystem ` +
      `contention (last=${lastContentionError?.code}) for ${targetPath}; no partial target was published.`,
    { code: ATOMIC_WRITE_CONTENTION_EXHAUSTED },
  );
  return { written: false, document: null };
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
    const tempPath = atomicTempPath(targetPath);
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

// ---------------------------------------------------------------------------
// Generation-bound claim takeover lock (COORD-AUDIT-C02).
// Every claim.json mutation is serialized by one transient lock file per task.
// The lock records the exact base generation/token it may replace (generation
// 0 / null token for a first creation), so a holder can only ever delete the
// claim generation it validated. A lock is stale only when its owner process
// is provably dead: a live holder's lock is never removed, even when the claim
// has already moved past its base, because that holder may still be inside its
// remove/replace window. The lock carries no lease/time-based authority.
// ---------------------------------------------------------------------------

const CLAIM_TAKEOVER_LOCK_SCHEMA_VERSION = 1;
const CLAIM_TAKEOVER_LOCK_WAIT_BUDGET_MS = 500;
const CLAIM_TAKEOVER_LOCK_POLL_INTERVAL_MS = 5;
const CLAIM_TAKEOVER_MAX_ATTEMPTS = 32;

function claimTakeoverLockPath(paths) {
  return nodePath.join(paths.taskDir, 'claim.takeover.lock');
}

/** Owner-process liveness: false only when the OS proves the pid is absent. */
function isClaimLockOwnerAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    return undefined;
  }
}

function validateClaimTakeoverLock(document, taskId) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  if (document.schemaVersion !== CLAIM_TAKEOVER_LOCK_SCHEMA_VERSION) return null;
  if (document.taskId !== taskId) return null;
  if (typeof document.lockId !== 'string' || !document.lockId) return null;
  if (!Number.isInteger(document.ownerPid) || document.ownerPid <= 0) return null;
  if (!Number.isInteger(document.baseGeneration) || document.baseGeneration < 0) return null;
  if (
    document.baseClaimToken !== null &&
    (typeof document.baseClaimToken !== 'string' || !document.baseClaimToken)
  ) {
    return null;
  }
  if (typeof document.acquiredAt !== 'string' || !document.acquiredAt) return null;
  return {
    schemaVersion: document.schemaVersion,
    taskId: document.taskId,
    lockId: document.lockId,
    ownerPid: document.ownerPid,
    baseGeneration: document.baseGeneration,
    baseClaimToken: document.baseClaimToken,
    acquiredAt: document.acquiredAt,
  };
}

function readValidatedClaimTakeoverLock(lockPath, taskId) {
  const found = readJsonFile(lockPath);
  if (found.state === 'missing') return { state: 'missing' };
  if (found.state === 'corrupt') return { state: 'corrupt' };
  const record = validateClaimTakeoverLock(found.document, taskId);
  if (!record) return { state: 'corrupt' };
  return { state: 'present', record };
}

// ---------------------------------------------------------------------------
// Result replay identity (COORD-AUDIT-C01).
// A stored Result is the durable authority. An exact replay is recognized only
// when the full semantic payload matches; the stored bytes are then reused and
// only the missing canonical/terminal steps are completed. deliveredAt is the
// store clock authority: a replay that omits it converges against the stored
// timestamp, while an explicitly authored different timestamp is a payload
// conflict. usage is compared by presence and content (absence != explicit).
// ---------------------------------------------------------------------------

const RESULT_REPLAY_IDENTITY_FIELDS = Object.freeze([
  'schemaVersion',
  'resultId',
  'taskId',
  'workerId',
  'claimToken',
  'claimGeneration',
  'status',
  'summary',
  'proofRefs',
  'evidenceRefs',
  'frictionObserved',
]);

function sameResultSemanticPayload(stored, candidate, { deliveredAtAuthored = false } = {}) {
  const project = (record) => {
    const projected = {};
    for (const field of RESULT_REPLAY_IDENTITY_FIELDS) {
      projected[field] = record[field];
    }
    projected.proofRefs = record.proofRefs ?? [];
    projected.evidenceRefs = record.evidenceRefs ?? [];
    projected.usage = record.usage ?? null;
    if (deliveredAtAuthored) projected.deliveredAt = record.deliveredAt;
    return projected;
  };
  return JSON.stringify(project(stored)) === JSON.stringify(project(candidate));
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
    const paths = taskFilePaths(this.home, taskId);
    const outcome = writeJsonAtomic(paths.taskPath, () => {
      const current = this.readTask(taskId);
      // Never rewind a progressed lifecycle: another writer already converged
      // or advanced this task while we were retrying contention.
      if (current.status !== TASK_STATUS_CREATED) return null;
      return validateTaskEnvelope({ ...current, status: TASK_STATUS_READY, updatedAt: this.nowIso() });
    });
    return outcome.written ? outcome.document : this.readTask(taskId);
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
   *
   * Every claim.json mutation (first creation and expired takeover alike) is
   * serialized by the per-task generation-bound takeover lock. The lock binds
   * the exact claim generation/token the holder may replace, so:
   *   - a holder only ever deletes the generation it validated, and a
   *     contender that observed generation N can never delete the N+1
   *     replacement published by the winner;
   *   - concurrent takeover contenders produce exactly one authoritative
   *     winner (the rest fail closed with LEASE_ACTIVE);
   *   - the crash window between removing the old claim and publishing the
   *     replacement publishes baseGeneration + 1, never a rewound generation.
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
    const deadlineMs = Date.now() + CLAIM_TAKEOVER_LOCK_WAIT_BUDGET_MS;
    // Carried base generation of a crashed takeover whose claim.json had
    // already been removed; only consulted while the claim stays missing.
    let carriedBase = null;

    for (let attempt = 1; attempt <= CLAIM_TAKEOVER_MAX_ATTEMPTS; attempt += 1) {
      const found = readJsonFile(paths.claimPath);
      if (found.state === 'corrupt') {
        storeFail(`claim record is corrupt (fail-closed, no auto-takeover): ${taskId}`, {
          code: 'CORRUPT_CLAIM',
          taskId,
        });
      }
      let current = null;
      let base;
      if (found.state === 'present') {
        current = this.#validateCurrentClaimRecord(found.document, taskId);
        if (current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) > now) {
          return this.#rejectLeaseActive(taskId, current);
        }
        base = { generation: current.generation, claimToken: current.claimToken };
        carriedBase = null;
      } else {
        base = carriedBase ?? { generation: 0, claimToken: null };
      }

      const lockAttempt = this.#acquireClaimTakeoverLock({ paths, taskId, base, deadlineMs });
      if (lockAttempt.state === 'retry') continue;
      if (lockAttempt.state === 'stale') {
        // Dead holder: adopt its base only while the claim is still missing so
        // the crash window publishes baseGeneration + 1 instead of rewinding.
        carriedBase = {
          generation: lockAttempt.lock.baseGeneration,
          claimToken: lockAttempt.lock.baseClaimToken,
        };
        continue;
      }
      if (lockAttempt.state === 'timeout') {
        return this.#rejectLeaseActive(taskId, current);
      }
      if (lockAttempt.state === 'busy') {
        sleepSyncMs(CLAIM_TAKEOVER_LOCK_POLL_INTERVAL_MS);
        continue;
      }

      // Lock acquired: this contender is the only claim.json mutator for the
      // exact generation/token recorded in the lock.
      try {
        const under = readJsonFile(paths.claimPath);
        if (under.state === 'corrupt') {
          storeFail(`claim record is corrupt (fail-closed, no auto-takeover): ${taskId}`, {
            code: 'CORRUPT_CLAIM',
            taskId,
          });
        }
        if (under.state === 'present') {
          const latest = this.#validateCurrentClaimRecord(under.document, taskId);
          if (latest.claimToken !== base.claimToken || latest.generation !== base.generation) {
            // The guarded generation moved on between the optimistic read and
            // the lock acquisition. Never delete a claim this lock does not
            // own; reclassify on the next iteration.
            continue;
          }
          if (latest.leaseExpiresAt && Date.parse(latest.leaseExpiresAt) > now) {
            return this.#rejectLeaseActive(taskId, latest);
          }
          try {
            nodeFs.unlinkSync(paths.claimPath);
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
          const candidate = buildCandidate(latest.generation + 1);
          const takeover = writeJsonExclusive(paths.claimPath, candidate);
          if (!takeover.created) continue;
          return this.#verifyClaimAfterWrite({ taskId, candidate });
        }

        // Claim missing while the lock is held: first creation (base
        // generation 0), or the crash window of a takeover whose stale lock
        // carried the base generation. Never rewind.
        const candidate = buildCandidate(base.generation + 1);
        const creation = writeJsonExclusive(paths.claimPath, candidate);
        if (!creation.created) continue;
        return this.#verifyClaimAfterWrite({ taskId, candidate });
      } finally {
        this.#releaseClaimTakeoverLock(lockAttempt.lock, lockAttempt.lockPath);
      }
    }
    return this.#rejectLeaseActive(taskId);
  }

  #validateCurrentClaimRecord(document, taskId) {
    try {
      return validateClaimRecord(document);
    } catch (error) {
      storeFail(`claim record is corrupt (fail-closed, no auto-takeover): ${taskId}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : 'CORRUPT_CLAIM',
        taskId,
      });
    }
    return null;
  }

  /**
   * Read-back contract of a published claim: a write-syscall success alone is
   * never a success. The returned record must be the canonical claim.
   */
  #verifyClaimAfterWrite({ taskId, candidate }) {
    const claim = this.readClaim(taskId);
    if (claim.claimToken !== candidate.claimToken || claim.generation !== candidate.generation) {
      storeFail(`claim failed to verify after write (fail-closed): ${taskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }
    this.#markClaimed(taskId);
    return claim;
  }

  /**
   * Try to acquire the generation-bound takeover lock. Returns:
   *   acquired -> this contender owns the lock
   *   stale    -> a dead holder's lock was retired; caller may carry its base
   *   busy     -> a live holder owns the lock; caller retries within budget
   *   timeout  -> budget exhausted while a live holder owns the lock
   *   retry    -> the lock vanished between create and read; caller retries
   * A corrupt lock fails closed (no auto-repair).
   */
  #acquireClaimTakeoverLock({ paths, taskId, base, deadlineMs }) {
    const lockPath = claimTakeoverLockPath(paths);
    const candidate = {
      schemaVersion: CLAIM_TAKEOVER_LOCK_SCHEMA_VERSION,
      taskId,
      lockId: randomUUID(),
      ownerPid: process.pid,
      baseGeneration: base.generation,
      baseClaimToken: base.claimToken,
      acquiredAt: this.nowIso(),
    };
    const created = writeJsonExclusive(lockPath, candidate);
    if (created.created) return { state: 'acquired', lock: candidate, lockPath };

    const existing = readValidatedClaimTakeoverLock(lockPath, taskId);
    if (existing.state === 'corrupt') {
      storeFail(`claim takeover lock is corrupt (fail-closed, no auto-repair): ${taskId}`, {
        code: CORRUPT_CLAIM_TAKEOVER_LOCK,
        taskId,
      });
    }
    if (existing.state === 'missing') return { state: 'retry' };

    const lock = existing.record;
    const claimFound = readJsonFile(paths.claimPath);
    if (claimFound.state === 'corrupt') {
      storeFail(`claim record is corrupt (fail-closed, no auto-takeover): ${taskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }
    // Only a provably dead owner makes a lock stale. A live holder's lock is
    // never retired, even when the claim has already moved past its base: that
    // holder may still be inside its remove/replace window, and removing its
    // lock would let two mutators overlap.
    if (isClaimLockOwnerAlive(lock.ownerPid) === false) {
      try {
        nodeFs.unlinkSync(lockPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      return { state: 'stale', lock };
    }
    if (Date.now() >= deadlineMs) return { state: 'timeout', lock };
    return { state: 'busy', lock };
  }

  #releaseClaimTakeoverLock(lock, lockPath) {
    const found = readJsonFile(lockPath);
    if (found.state !== 'present') return;
    if (found.document?.lockId !== lock.lockId) return;
    // Best effort: the claim mutation already succeeded, so a release failure
    // must not mask it. Transient Windows share violations are retried a small
    // bounded number of times; a lock that still cannot be retired keeps the
    // task fail-closed until its owner process exits, after which dead-owner
    // recovery retires it.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        nodeFs.unlinkSync(lockPath);
        return;
      } catch (error) {
        if (error?.code === 'ENOENT') return;
        if (attempt >= 3 || !ATOMIC_WRITE_RETRYABLE_CODES.has(error?.code)) return;
        sleepSyncMs(atomicWriteRetryDelayMs(attempt));
      }
    }
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
    const paths = taskFilePaths(this.home, taskId);
    const outcome = writeJsonAtomic(paths.taskPath, () => {
      const current = this.readTask(taskId);
      if (current.status === TASK_STATUS_CLAIMED || current.status === TASK_STATUS_RESULT_DELIVERED) return null;
      return validateTaskEnvelope({ ...current, status: TASK_STATUS_CLAIMED, updatedAt: this.nowIso() });
    });
    return outcome.written ? outcome.document : this.readTask(taskId);
  }

  /**
   * Converge the CLAIMED -> RESULT_DELIVERED terminal projection. Idempotent,
   * never rewinds, and never republishes a superseded status.
   */
  #markResultDelivered(taskId) {
    const task = this.readTask(taskId);
    if (task.status === TASK_STATUS_RESULT_DELIVERED) return task;
    const paths = taskFilePaths(this.home, taskId);
    const outcome = writeJsonAtomic(paths.taskPath, () => {
      const current = this.readTask(taskId);
      if (current.status === TASK_STATUS_RESULT_DELIVERED) return null;
      return validateTaskEnvelope({
        ...current,
        status: TASK_STATUS_RESULT_DELIVERED,
        updatedAt: this.nowIso(),
      });
    });
    return outcome.written ? outcome.document : this.readTask(taskId);
  }

  /**
   * Publish the canonical result from a stored per-id record if it is still
   * missing. Exclusive-create only: a concurrent winner is never overwritten.
   */
  #ensureCanonicalResult(taskId, paths, stored) {
    const created = writeJsonExclusive(paths.resultPath, stored);
    if (created.created) return stored;
    const winner = readJsonFile(paths.resultPath);
    if (winner.state !== 'present') {
      storeFail(`canonical result race could not be resolved deterministically: ${taskId}`, {
        code: 'CORRUPT_RESULT',
        taskId,
      });
    }
    return validateResultEnvelope(winner.document);
  }

  /**
   * Deliver an executor RESULT. Verifies current claim owner + fencing token.
   * - stale claimToken/generation -> STALE_CLAIM (never adopted as canonical)
   * - same resultId retransmission with identical full semantic payload ->
   *   idempotent return; a stored per-id result whose canonical/terminal steps
   *   never completed converges those steps from the stored authority
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
    const alreadyDelivered = task.status === TASK_STATUS_RESULT_DELIVERED;
    const deliveredAtAuthored = deliveredAt !== undefined;

    // Duplicate fast path: same resultId already stored -> deterministic
    // handling. The full semantic payload must match; the stored record is the
    // authority and is never rewritten, deleted, or regenerated.
    const existingById = readJsonFile(nodePath.join(paths.resultsDir, `${finalResultId}.json`));
    let storedById = null;
    if (existingById.state === 'present') {
      storedById = validateResultEnvelope(existingById.document);
      if (!sameResultSemanticPayload(storedById, candidate, { deliveredAtAuthored })) {
        storeFail(`duplicate resultId with different payload (first delivery wins): ${finalResultId}`, {
          code: DUPLICATE_RESULT_ID_CONFLICT,
          taskId,
        });
      }
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
        if (!sameResultSemanticPayload(stored, candidate, { deliveredAtAuthored })) {
          storeFail(`duplicate resultId with different payload (first delivery wins): ${finalResultId}`, {
            code: DUPLICATE_RESULT_ID_CONFLICT,
            taskId,
          });
        }
        // The canonical authority already won; only a lagging terminal task
        // projection is repaired. No re-fencing, no rewrite.
        this.#markResultDelivered(taskId);
        return { record: stored, duplicate: true, alreadyDelivered };
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

    if (storedById) {
      // Crash recovery: per-id bytes already exist but the canonical/terminal
      // steps never completed. The stored record is the authority; only the
      // missing steps are completed. No overwrite, no executor re-invocation.
      const canonicalRecord = this.#ensureCanonicalResult(taskId, paths, storedById);
      if (canonicalRecord.resultId !== storedById.resultId) {
        return { record: canonicalRecord, duplicate: false, alreadyDelivered: true };
      }
      this.#markResultDelivered(taskId);
      return { record: canonicalRecord, duplicate: true, alreadyDelivered };
    }

    nodeFs.mkdirSync(paths.resultsDir, { recursive: true });
    const perIdCreated = writeJsonExclusive(nodePath.join(paths.resultsDir, `${finalResultId}.json`), candidate);
    if (!perIdCreated.created) {
      // Concurrent duplicate delivery won the race; resolve deterministically
      // through the stored authority (recursion re-reads the stored bytes and
      // keeps deliveredAt store-clock-owned, exactly like the original call).
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
      });
    }
    const canonicalCreated = writeJsonExclusive(paths.resultPath, candidate);
    if (!canonicalCreated.created) {
      const winner = readJsonFile(paths.resultPath);
      if (winner.state === 'present') {
        const stored = validateResultEnvelope(winner.document);
        if (stored.resultId === finalResultId) {
          this.#markResultDelivered(taskId);
          return { record: stored, duplicate: false, alreadyDelivered };
        }
        return { record: stored, duplicate: false, alreadyDelivered: true };
      }
      storeFail(`canonical result race could not be resolved deterministically: ${taskId}`, {
        code: 'CORRUPT_RESULT',
        taskId,
      });
    }

    this.#markResultDelivered(taskId);
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

  // -------------------------------------------------------------------------
  // Deterministic next-task emission domain.
  // emitNextTask() != scheduleNextTask() != dispatchNextTask() != decideNextTask():
  // the caller has ALREADY decided nextTaskSpec; this primitive only binds it
  // to one canonical slot of one fully-closed (CONSUMED) source task and
  // durably creates the child through the canonical createTask path, exactly
  // once per logical emission. No planning, scheduling, dispatch, fan-out,
  // adapters, or autonomous loop exists here.
  // -------------------------------------------------------------------------

  /**
   * Re-verify the full source closure chain live against durable bindings:
   * canonical ADOPTED disposition -> materialization -> read-back ACK ->
   * CONSUMED. Returns { disposition, materialization, ack, consumed, canonical }.
   * Missing/ineligible prerequisites map to EMISSION_NOT_ELIGIBLE;
   * corruption/drift codes propagate unchanged (fail closed, no auto-repair).
   */
  #requireConsumedSourceClosure(sourceTaskId) {
    assertValidTaskId(sourceTaskId);
    const eligibleOrThrow = (error) => {
      if (isFailClosedCorruptionCode(error?.code)) throw error;
      storeFail(`emission requires a fully CONSUMED source closure (fail-closed): ${sourceTaskId}: ${error?.message}`, {
        code: EMISSION_NOT_ELIGIBLE,
        taskId: sourceTaskId,
      });
    };
    let disposition;
    try {
      disposition = this.#requireAdoptedDisposition(sourceTaskId);
    } catch (error) {
      eligibleOrThrow(error);
    }
    let materialization;
    try {
      materialization = this.verifyMaterializationReadback(sourceTaskId).record;
    } catch (error) {
      eligibleOrThrow(error);
    }
    let ack;
    try {
      ack = this.readAck(sourceTaskId);
    } catch (error) {
      eligibleOrThrow(error);
    }
    let consumed;
    try {
      consumed = this.readConsumed(sourceTaskId);
    } catch (error) {
      eligibleOrThrow(error);
    }
    // Coherence: every link must bind the same adopted generation/result.
    if (
      materialization.dispositionGeneration !== disposition.dispositionGeneration ||
      ack.dispositionGeneration !== disposition.dispositionGeneration ||
      consumed.dispositionGeneration !== disposition.dispositionGeneration ||
      materialization.resultId !== disposition.resultId ||
      ack.resultId !== disposition.resultId ||
      consumed.resultId !== disposition.resultId ||
      materialization.resultBinding !== disposition.resultBinding ||
      ack.resultBinding !== disposition.resultBinding ||
      consumed.resultBinding !== disposition.resultBinding ||
      consumed.materializationId !== materialization.materializationId ||
      consumed.ackId !== ack.ackId
    ) {
      storeFail(`emission source closure drift vs canonical ADOPTED disposition (fail-closed): ${sourceTaskId}`, {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    let canonical;
    try {
      canonical = this.#requireCanonicalResultForDisposition(sourceTaskId, disposition.resultId);
    } catch (error) {
      if (isFailClosedCorruptionCode(error?.code)) throw error;
      eligibleOrThrow(error);
    }
    return { disposition, materialization, ack, consumed, canonical };
  }

  /**
   * Durably create (or recover) the emitted child through the canonical
   * createTask path. TASK_ALREADY_EXISTS with an identical canonical spec
   * binding is safe recovery to the same child; a colliding taskId with
   * different content fails closed (never reused, never overwritten).
   */
  #ensureEmissionChild(sourceTaskId, candidate) {
    const nextTaskId = candidate.nextTaskId;
    try {
      return this.createTask({ ...candidate.nextTaskSpec });
    } catch (error) {
      if (error?.code !== TASK_ALREADY_EXISTS) throw error;
    }
    let existing;
    try {
      existing = this.readTask(nextTaskId);
    } catch (error) {
      storeFail(`emission child race could not be resolved deterministically: ${nextTaskId}`, {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    let existingBinding;
    try {
      existingBinding = computeNextTaskSpecBinding(existing);
    } catch (validationError) {
      storeFail(`emission child violates the Task Envelope v1 contract (fail-closed): ${nextTaskId}`, {
        code: validationError?.code ?? CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    if (existingBinding !== candidate.nextTaskSpecBinding) {
      storeFail(
        `emission child taskId collides with different content (first task wins, never reused): ${nextTaskId}`,
        { code: EMISSION_CONFLICT, taskId: sourceTaskId },
      );
    }
    return existing;
  }

  /**
   * Verify the emitted child holds exactly one append-stable sequence
   * membership. A crash window (task file visible, sequence entry pending) is
   * recovered deterministically via syncTaskSequence; duplicates fail closed.
   */
  #assertSingleEmissionSequenceMembership(sourceTaskId, nextTaskId) {
    const countMembership = () =>
      listCanonicalSequenceEntries(this.home).filter((entry) => entry.taskId === nextTaskId).length;
    let count;
    try {
      count = countMembership();
    } catch (error) {
      throw error;
    }
    if (count === 0) {
      this.syncTaskSequence();
      count = countMembership();
    }
    if (count !== 1) {
      storeFail(`emission child sequence membership != 1 (fail-closed): ${nextTaskId} count=${count}`, {
        code: CORRUPT_SEQUENCE,
        taskId: sourceTaskId,
      });
    }
  }

  /**
   * Full read-back contract: canonical emission record + emitted child task +
   * spec binding + sequence membership + live source closure binding.
   * Write-syscall success alone never decides success.
   */
  #verifyEmissionReadback({ sourceTaskId, emissionSlot, candidate, child, closure }) {
    const path = emissionFilePath(this.home, sourceTaskId, emissionSlot);
    const reread = readValidatedEmissionDocument(path, sourceTaskId, emissionSlot);
    if (reread.state !== 'present' || !canonicalRecordsEqual(reread.record, candidate)) {
      storeFail(`emission failed to verify after write (fail-closed): ${emissionRef(sourceTaskId, emissionSlot)}`, {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    const rereadChild = this.readTask(candidate.nextTaskId);
    let childBinding;
    try {
      childBinding = computeNextTaskSpecBinding(rereadChild);
    } catch (error) {
      storeFail(`emission child failed spec read-back (fail-closed): ${candidate.nextTaskId}`, {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    if (childBinding !== candidate.nextTaskSpecBinding || rereadChild.taskId !== candidate.nextTaskId) {
      storeFail(`emission child spec binding mismatch on read-back (fail-closed): ${candidate.nextTaskId}`, {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    if (child != null && child.taskId !== candidate.nextTaskId) {
      storeFail(`emission child identity mismatch on read-back (fail-closed): ${candidate.nextTaskId}`, {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    this.#assertSingleEmissionSequenceMembership(sourceTaskId, candidate.nextTaskId);
    // Source closure must still be the same CONSUMED winner (no drift).
    let liveConsumed;
    try {
      liveConsumed = this.readConsumed(sourceTaskId);
    } catch (error) {
      storeFail(`emission source closure failed revalidation on read-back (fail-closed): ${sourceTaskId}`, {
        code: isFailClosedCorruptionCode(error?.code) ? error.code : CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    if (liveConsumed.consumedId !== closure.consumed.consumedId) {
      storeFail(`emission source closure changed during emission (fail-closed): ${sourceTaskId}`, {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    return { record: reread.record, child: rereadChild };
  }

  /**
   * Resolve an emission-slot creation race deterministically: the canonical
   * winner is re-validated against the live source closure; an identical
   * replay recovers to the same emission + same child (duplicate:true); a
   * conflicting spec fails closed with EMISSION_CONFLICT (never overwritten).
   */
  #resolveEmissionRace({ sourceTaskId, emissionSlot, candidate, closure }) {
    const path = emissionFilePath(this.home, sourceTaskId, emissionSlot);
    const winnerFound = readValidatedEmissionDocument(path, sourceTaskId, emissionSlot);
    if (winnerFound.state === 'missing') {
      storeFail(`emission race could not be resolved deterministically: ${emissionRef(sourceTaskId, emissionSlot)}`, {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    const winner = winnerFound.record;
    // Winner must still bind the live CONSUMED closure; drift fails closed.
    if (
      winner.sourceConsumedId !== closure.consumed.consumedId ||
      winner.sourceMaterializationId !== closure.materialization.materializationId ||
      winner.sourceAckId !== closure.ack.ackId ||
      winner.dispositionGeneration !== closure.disposition.dispositionGeneration ||
      winner.resultId !== closure.disposition.resultId ||
      winner.resultBinding !== closure.disposition.resultBinding ||
      winner.canonicalTransitionId !== closure.disposition.canonicalTransitionId
    ) {
      storeFail(`emission winner drift vs live CONSUMED closure (fail-closed, no overwrite): ${emissionRef(sourceTaskId, emissionSlot)}`, {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    if (
      winner.nextTaskSpecBinding !== candidate.nextTaskSpecBinding ||
      winner.nextTaskId !== candidate.nextTaskId ||
      winner.emissionId !== candidate.emissionId
    ) {
      storeFail(`conflicting emission for same source slot (first wins, fail-closed): ${emissionRef(sourceTaskId, emissionSlot)} winner=${winner.nextTaskId}`, {
        code: EMISSION_CONFLICT,
        taskId: sourceTaskId,
      });
    }
    // Identical replay: recover to the same child (covers crash windows where
    // the authority won but the child create or read-back never completed).
    const child = this.#ensureEmissionChild(sourceTaskId, winner);
    const verified = this.#verifyEmissionReadback({
      sourceTaskId,
      emissionSlot,
      candidate: winner,
      child,
      closure,
    });
    return { record: verified.record, child: verified.child, duplicate: true };
  }

  /**
   * Deterministically emit the caller-decided nextTaskSpec from a CONSUMED
   * source closure into one canonical emission slot.
   *
   * - same source + same slot + same spec -> idempotent replay
   *   ({ duplicate:true }, same emission, same child, single sequence member).
   * - same source + same slot + different spec -> EMISSION_CONFLICT, the first
   *   winner is preserved and never overwritten (no last-writer-wins).
   * - concurrent writers serialize via exclusive-create: exactly one winner.
   * - emittedAt is provenance only and never enters emission identity.
   */
  emitNextTask({ sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT, nextTaskSpec, emitterId, emittedAt } = {}) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    if (typeof emitterId !== 'string' || !emitterId.trim()) {
      storeFail('emitterId must be a non-empty string.', { code: 'INVALID_EMITTER', taskId: sourceTaskId });
    }
    // Caller spec validation FIRST: context budget / reference-first / Task
    // Envelope v1 contract fail closed before any durable mutation.
    let normalized;
    let specBinding;
    try {
      normalized = normalizeNextTaskSpec(nextTaskSpec);
      specBinding = computeNextTaskSpecBinding(normalized);
    } catch (error) {
      storeFail(`invalid nextTaskSpec (fail-closed, no emission): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : 'INVALID_EMISSION',
        taskId: sourceTaskId,
      });
    }
    // Source eligibility: the full CONSUMED closure is re-verified live.
    // RESULT_DELIVERED-only, PENDING/BLOCKED/REJECTED/SUPERSEDED, pre-
    // materialization, pre-ACK, and pre-CONSUMED sources are all refused here.
    const closure = this.#requireConsumedSourceClosure(sourceTaskId);
    let candidate;
    try {
      candidate = buildEmissionRecord({
        sourceTaskId,
        emissionSlot,
        sourceConsumedId: closure.consumed.consumedId,
        sourceMaterializationId: closure.materialization.materializationId,
        sourceAckId: closure.ack.ackId,
        dispositionGeneration: closure.disposition.dispositionGeneration,
        resultId: closure.canonical.resultId,
        resultBinding: computeResultBinding(closure.canonical),
        nextTaskSpec: normalized,
        emittedAt: emittedAt ?? this.nowIso(),
        emitterId,
      });
    } catch (error) {
      storeFail(`invalid emission record (fail-closed): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : 'INVALID_EMISSION',
        taskId: sourceTaskId,
      });
    }
    if (specBinding !== candidate.nextTaskSpecBinding) {
      storeFail('emission spec binding mismatch (fail-closed, no emission).', {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }

    const path = emissionFilePath(this.home, sourceTaskId, emissionSlot);
    const created = writeJsonExclusive(path, candidate);
    if (!created.created) {
      return this.#resolveEmissionRace({ sourceTaskId, emissionSlot, candidate, closure });
    }
    // Emission authority now durable; the child create below is the
    // partial-failure boundary B/C: a crash here is recovered by replay to the
    // same child (never a duplicate, never delete-and-recreate).
    const child = this.#ensureEmissionChild(sourceTaskId, candidate);
    const verified = this.#verifyEmissionReadback({ sourceTaskId, emissionSlot, candidate, child, closure });
    return { record: verified.record, child: verified.child, duplicate: false };
  }

  /**
   * Read the canonical emission for a source slot, re-validated against the
   * live CONSUMED closure binding. Drift fails closed (no auto-repair).
   */
  readEmission(sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    const found = readValidatedEmissionDocument(
      emissionFilePath(this.home, sourceTaskId, emissionSlot),
      sourceTaskId,
      emissionSlot,
    );
    if (found.state === 'missing') {
      storeFail(`no emission for source slot: ${emissionRef(sourceTaskId, emissionSlot)}`, {
        code: EMISSION_NOT_FOUND,
        taskId: sourceTaskId,
      });
    }
    const closure = this.#requireConsumedSourceClosure(sourceTaskId);
    const winner = found.record;
    if (
      winner.sourceConsumedId !== closure.consumed.consumedId ||
      winner.sourceMaterializationId !== closure.materialization.materializationId ||
      winner.sourceAckId !== closure.ack.ackId ||
      winner.dispositionGeneration !== closure.disposition.dispositionGeneration ||
      winner.resultId !== closure.disposition.resultId ||
      winner.resultBinding !== closure.disposition.resultBinding ||
      winner.canonicalTransitionId !== closure.disposition.canonicalTransitionId
    ) {
      storeFail(`emission drift vs live CONSUMED closure (fail-closed, no auto-repair): ${emissionRef(sourceTaskId, emissionSlot)}`, {
        code: CORRUPT_EMISSION,
        taskId: sourceTaskId,
      });
    }
    return winner;
  }

  // -------------------------------------------------------------------------
  // Emission-bound admission domain.
  // admitEmittedTask() != emitNextTask() != scheduleNextTask() != claimTask()
  //   != dispatchNextTask() != decideNextTask():
  // the caller explicitly supplies (sourceTaskId, emissionSlot); this primitive
  // never scans emissions, never polls a queue, never picks oldest/newest,
  // never decides priority, and never runs a scheduler loop.
  // Ordering is ADMISSION AUTHORITY -> READY (never READY -> ADMISSION):
  // every binding is verified, the durable admission authority is created via
  // OS exclusive-create, then the existing markReady(nextTaskId) path moves the
  // exact canonical child to READY. Timestamps are provenance only.
  // -------------------------------------------------------------------------

  /**
   * Verify the admitted child holds exactly one append-stable sequence
   * membership. A crash window (task file visible, sequence entry pending) is
   * recovered deterministically via syncTaskSequence; duplicates fail closed.
   */
  #assertSingleAdmissionSequenceMembership(sourceTaskId, nextTaskId) {
    const countMembership = () =>
      listCanonicalSequenceEntries(this.home).filter((entry) => entry.taskId === nextTaskId).length;
    let count;
    try {
      count = countMembership();
    } catch (error) {
      throw error;
    }
    if (count === 0) {
      this.syncTaskSequence();
      count = countMembership();
    }
    if (count !== 1) {
      storeFail(`admission child sequence membership != 1 (fail-closed): ${nextTaskId} count=${count}`, {
        code: CORRUPT_SEQUENCE,
        taskId: sourceTaskId,
      });
    }
  }

  /**
   * Verify a durable admission record still binds the live canonical emission.
   * Drift/tamper fails closed (no auto-repair, no overwrite).
   */
  #assertAdmissionBindsLiveEmission({ sourceTaskId, emissionSlot, admission, emission }) {
    if (
      admission.sourceTaskId !== sourceTaskId ||
      admission.emissionSlot !== emissionSlot ||
      admission.emissionId !== emission.emissionId ||
      admission.nextTaskId !== emission.nextTaskId ||
      admission.nextTaskSpecBinding !== emission.nextTaskSpecBinding ||
      admission.sourceConsumedId !== emission.sourceConsumedId ||
      admission.sourceMaterializationId !== emission.sourceMaterializationId ||
      admission.sourceAckId !== emission.sourceAckId ||
      admission.dispositionGeneration !== emission.dispositionGeneration ||
      admission.resultId !== emission.resultId ||
      admission.resultBinding !== emission.resultBinding ||
      admission.canonicalTransitionId !== emission.canonicalTransitionId
    ) {
      storeFail(`admission drift vs live canonical emission (fail-closed, no auto-repair): ${admissionRef(sourceTaskId, emissionSlot)}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
  }

  /**
   * Converge the admitted child to at least READY without ever rewinding a
   * progressed lifecycle: CREATED -> markReady(); READY -> idempotent
   * markReady(); CLAIMED/RESULT_DELIVERED -> returned as-is (normal history).
   */
  #convergeAdmissionChild(nextTaskId) {
    const live = this.readTask(nextTaskId);
    if (live.status === TASK_STATUS_CREATED) return this.markReady(nextTaskId);
    if (live.status === TASK_STATUS_READY) return this.markReady(nextTaskId);
    if (live.status === TASK_STATUS_CLAIMED || live.status === TASK_STATUS_RESULT_DELIVERED) return live;
    storeFail(`admission child in unexpected status (fail-closed): ${nextTaskId} status=${live.status}`, {
      code: CORRUPT_ADMISSION,
      taskId: nextTaskId,
    });
    return live;
  }

  /**
   * Full read-back contract: canonical admission record + live emission binding
   * + child spec binding + sequence membership + child at least READY.
   * Write-syscall success alone never decides success.
   */
  #verifyAdmissionReadback({ sourceTaskId, emissionSlot, candidate }) {
    const path = admissionFilePath(this.home, sourceTaskId, emissionSlot);
    const reread = readValidatedAdmissionDocument(path, sourceTaskId, emissionSlot);
    if (reread.state !== 'present' || !canonicalRecordsEqual(reread.record, candidate)) {
      storeFail(`admission failed to verify after write (fail-closed): ${admissionRef(sourceTaskId, emissionSlot)}`, {
        code: CORRUPT_ADMISSION,
        taskId: sourceTaskId,
      });
    }
    const emission = this.readEmission(sourceTaskId, emissionSlot);
    this.#assertAdmissionBindsLiveEmission({ sourceTaskId, emissionSlot, admission: reread.record, emission });
    const rereadChild = this.readTask(candidate.nextTaskId);
    let childBinding;
    try {
      childBinding = computeNextTaskSpecBinding(rereadChild);
    } catch (error) {
      storeFail(`admission child failed spec read-back (fail-closed): ${candidate.nextTaskId}: ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : CORRUPT_ADMISSION,
        taskId: sourceTaskId,
      });
    }
    if (childBinding !== candidate.nextTaskSpecBinding || rereadChild.taskId !== candidate.nextTaskId) {
      storeFail(`admission child spec binding mismatch on read-back (fail-closed): ${candidate.nextTaskId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    this.#assertSingleAdmissionSequenceMembership(sourceTaskId, candidate.nextTaskId);
    if (rereadChild.status === TASK_STATUS_CREATED) {
      storeFail(`admission child never reached READY (fail-closed): ${candidate.nextTaskId}`, {
        code: CORRUPT_ADMISSION,
        taskId: sourceTaskId,
      });
    }
    return { record: reread.record, child: rereadChild };
  }

  /**
   * Resolve an admission-slot creation race deterministically: the canonical
   * winner is re-validated against the live emission; an identical logical
   * admission (same admissionId) recovers to the same record + converged child
   * (duplicate:true, first provenance bytes preserved, never overwritten); a
   * conflicting logical identity fails closed with ADMISSION_CONFLICT.
   */
  #resolveAdmissionRaceAndConverge({ sourceTaskId, emissionSlot, emission, candidate }) {
    const path = admissionFilePath(this.home, sourceTaskId, emissionSlot);
    const winnerFound = readValidatedAdmissionDocument(path, sourceTaskId, emissionSlot);
    if (winnerFound.state === 'missing') {
      storeFail(`admission race could not be resolved deterministically: ${admissionRef(sourceTaskId, emissionSlot)}`, {
        code: CORRUPT_ADMISSION,
        taskId: sourceTaskId,
      });
    }
    const winner = winnerFound.record;
    this.#assertAdmissionBindsLiveEmission({ sourceTaskId, emissionSlot, admission: winner, emission });
    if (winner.admissionId !== candidate.admissionId) {
      storeFail(`conflicting admission for same source slot (first wins, fail-closed): ${admissionRef(sourceTaskId, emissionSlot)} winner=${winner.nextTaskId}`, {
        code: ADMISSION_CONFLICT,
        taskId: sourceTaskId,
      });
    }
    if (winner.nextTaskId !== candidate.nextTaskId || winner.nextTaskSpecBinding !== candidate.nextTaskSpecBinding) {
      storeFail(`conflicting admission binding for same source slot (first wins, fail-closed): ${admissionRef(sourceTaskId, emissionSlot)}`, {
        code: ADMISSION_CONFLICT,
        taskId: sourceTaskId,
      });
    }
    // Identical logical replay: converge the winner child (covers crash windows
    // where the authority won but markReady never completed). First provenance
    // bytes are preserved; the loser never overwrites the winner.
    const child = this.#convergeAdmissionChild(winner.nextTaskId);
    const verified = this.#verifyAdmissionReadback({ sourceTaskId, emissionSlot, candidate: winner });
    void child;
    return { record: verified.record, child: verified.child, duplicate: true };
  }

  /**
   * Admit the exact canonical emission of a source slot, then move the exact
   * canonical child through the existing markReady() path.
   *
   * Caller supplies (sourceTaskId, emissionSlot) explicitly: no emission scan,
   * no polling, no oldest/newest, no priority, no scheduler loop.
   *
   * - emission missing/corrupt/tampered, source closure drift, child missing,
   *   child spec mismatch, or sequence violation fails closed with no mutation
   *   of the child and no admission created (or winner bytes preserved).
   * - admission missing + child already READY/CLAIMED/RESULT_DELIVERED fails
   *   closed with ADMISSION_BYPASS_DETECTED (never auto-adopted).
   * - existing admission + child CLAIMED/RESULT_DELIVERED is normal history:
   *   replay succeeds without rewind (duplicate:true).
   * - same logical admission replays idempotently to the same record
   *   (duplicate:true); admittedAt/admitterId never fork identity and never
   *   overwrite the first canonical provenance.
   */
  admitEmittedTask({ sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT, admitterId, admittedAt } = {}) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    if (typeof admitterId !== 'string' || !admitterId.trim()) {
      storeFail('admitterId must be a non-empty string.', { code: 'INVALID_ADMITTER', taskId: sourceTaskId });
    }
    const admittedAtIso = admittedAt ?? this.nowIso();
    if (typeof admittedAtIso !== 'string' || !Number.isFinite(Date.parse(admittedAtIso))) {
      storeFail('admittedAt must be an ISO date-time string (provenance only).', {
        code: 'INVALID_ADMISSION',
        taskId: sourceTaskId,
      });
    }

    // A. Source task must exist (fail-closed before any admission mutation).
    this.readTask(sourceTaskId);

    // B-D. Canonical emission + live CONSUMED closure binding, re-verified live.
    // Missing/ineligible/corrupt/drift propagates fail-closed (EMISSION_*,
    // CORRUPT_*, *_MISMATCH) with no child mutation and no admission created.
    const emission = this.readEmission(sourceTaskId, emissionSlot);

    // E-F. Exact child must exist (never auto-created) and its canonical spec
    // must bind the emission spec exactly.
    const child = this.readTask(emission.nextTaskId);
    if (child.taskId !== emission.nextTaskId) {
      storeFail(`admission child taskId mismatch (fail-closed): ${emission.nextTaskId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    let childBinding;
    try {
      childBinding = computeNextTaskSpecBinding(child);
    } catch (error) {
      storeFail(`admission child violates the Task Envelope v1 contract (fail-closed): ${emission.nextTaskId}: ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    if (childBinding !== emission.nextTaskSpecBinding) {
      storeFail(`admission child spec binding mismatch (fail-closed): ${emission.nextTaskId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }

    // G. Single append-stable sequence membership (fail-closed on duplication).
    this.#assertSingleAdmissionSequenceMembership(sourceTaskId, emission.nextTaskId);

    const path = admissionFilePath(this.home, sourceTaskId, emissionSlot);
    const existingFound = readValidatedAdmissionDocument(path, sourceTaskId, emissionSlot);

    if (existingFound.state === 'missing') {
      // No authority yet: the child must still be CREATED, otherwise this is a
      // bypass (READY/CLAIMED/RESULT_DELIVERED without admission) and must fail
      // closed without auto-adoption.
      if (child.status !== TASK_STATUS_CREATED) {
        storeFail(`admission bypass detected: child ${emission.nextTaskId} is ${child.status} without canonical admission authority (fail-closed, no auto-adoption).`, {
          code: ADMISSION_BYPASS_DETECTED,
          taskId: sourceTaskId,
        });
      }
      let candidate;
      try {
        candidate = buildAdmissionRecord({
          sourceTaskId,
          emissionSlot,
          emissionId: emission.emissionId,
          nextTaskId: emission.nextTaskId,
          nextTaskSpecBinding: emission.nextTaskSpecBinding,
          sourceConsumedId: emission.sourceConsumedId,
          sourceMaterializationId: emission.sourceMaterializationId,
          sourceAckId: emission.sourceAckId,
          dispositionGeneration: emission.dispositionGeneration,
          resultId: emission.resultId,
          resultBinding: emission.resultBinding,
          canonicalTransitionId: emission.canonicalTransitionId,
          admittedAt: admittedAtIso,
          admitterId,
        });
      } catch (error) {
        storeFail(`invalid admission record (fail-closed): ${error?.message}`, {
          code: typeof error?.code === 'string' && error.code ? error.code : 'INVALID_ADMISSION',
          taskId: sourceTaskId,
        });
      }
      const created = writeJsonExclusive(path, candidate);
      if (!created.created) {
        return this.#resolveAdmissionRaceAndConverge({ sourceTaskId, emissionSlot, emission, candidate });
      }
      // Admission authority now durable (CASE2 boundary); the READY transition
      // below is recovered by replay on crash (never a duplicate, never rewind).
      this.#convergeAdmissionChild(candidate.nextTaskId);
      const verified = this.#verifyAdmissionReadback({ sourceTaskId, emissionSlot, candidate });
      return { record: verified.record, child: verified.child, duplicate: false };
    }

    // Existing authority: replay path (CASE3/CASE4). Re-validate the winner
    // against the live emission, converge the child without rewind, verify.
    const winner = existingFound.record;
    this.#assertAdmissionBindsLiveEmission({ sourceTaskId, emissionSlot, admission: winner, emission });
    const liveChild = this.readTask(winner.nextTaskId);
    let liveBinding;
    try {
      liveBinding = computeNextTaskSpecBinding(liveChild);
    } catch (error) {
      storeFail(`admission child failed spec read-back (fail-closed): ${winner.nextTaskId}: ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    if (liveBinding !== winner.nextTaskSpecBinding || liveChild.taskId !== winner.nextTaskId) {
      storeFail(`admission child spec binding mismatch on replay (fail-closed): ${winner.nextTaskId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    this.#assertSingleAdmissionSequenceMembership(sourceTaskId, winner.nextTaskId);
    this.#convergeAdmissionChild(winner.nextTaskId);
    const verified = this.#verifyAdmissionReadback({ sourceTaskId, emissionSlot, candidate: winner });
    return { record: verified.record, child: verified.child, duplicate: true };
  }

  /**
   * Read the canonical admission for a source slot, re-validated against the
   * live canonical emission, child spec binding, and sequence membership.
   * Pure read: never mutates, never repairs, never rewinds a progressed child.
   * Drift/corruption fails closed (no auto-repair).
   */
  readEmissionAdmission({ sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT } = {}) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    const found = readValidatedAdmissionDocument(
      admissionFilePath(this.home, sourceTaskId, emissionSlot),
      sourceTaskId,
      emissionSlot,
    );
    if (found.state === 'missing') {
      storeFail(`no admission for source slot: ${admissionRef(sourceTaskId, emissionSlot)}`, {
        code: ADMISSION_NOT_FOUND,
        taskId: sourceTaskId,
      });
    }
    const emission = this.readEmission(sourceTaskId, emissionSlot);
    this.#assertAdmissionBindsLiveEmission({ sourceTaskId, emissionSlot, admission: found.record, emission });
    const child = this.readTask(found.record.nextTaskId);
    let childBinding;
    try {
      childBinding = computeNextTaskSpecBinding(child);
    } catch (error) {
      storeFail(`admission child failed spec read-back (fail-closed): ${found.record.nextTaskId}: ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    if (childBinding !== found.record.nextTaskSpecBinding || child.taskId !== found.record.nextTaskId) {
      storeFail(`admission child spec binding mismatch (fail-closed): ${found.record.nextTaskId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    this.#assertSingleAdmissionSequenceMembership(sourceTaskId, found.record.nextTaskId);
    return found.record;
  }

  // -------------------------------------------------------------------------
  // User-approved external READ_ONLY intake domain
  // (GREENHUB-COORDINATION-USER-APPROVED-READONLY-INTAKE-GF06).
  // intakeUserApprovedReadOnlyTask() != emitNextTask() != admitEmittedTask()
  //   != claimAdmittedTask() != scheduleNextTask() != dispatchNextTask():
  // the caller explicitly supplies ONE bounded user-approved READ_ONLY task
  // spec. This primitive never scans READY tasks, never polls a queue, never
  // picks priority, never claims, never dispatches, never invokes an executor,
  // and never generates a successor. Ordering is INTAKE AUTHORITY -> TASK
  // CREATE -> READY (never READY -> AUTHORITY): the durable intake authority
  // (explicit approval + canonical task bytes binding) is created first via OS
  // exclusive-create, then the exact canonical task is created through the
  // existing createTask path, then converged through the existing markReady()
  // path. A crash between authority and READY is recovered by replay
  // converging to the same authority + task + READY (never a duplicate, never
  // delete-and-recreate, never a rewind of CLAIMED/RESULT_DELIVERED).
  // The successor emission/admission contract is a DIFFERENT authority source
  // and is never relaxed, merged, or faked here.
  // -------------------------------------------------------------------------

  /**
   * Verify no existing successor emission or emission admission already binds
   * `taskId` as its child. A task produced by successor emission is never
   * adopted by user-approved intake (fail-closed, authority sources are never
   * merged). Corruption in a scanned record fails closed (no auto-repair).
   */
  #assertNoEmissionAuthorityBindsTask(taskId) {
    assertValidTaskId(taskId);
    for (const sourceTaskId of listTaskIds(this.home)) {
      const taskDirectory = resolveTaskDirectory(this.home, sourceTaskId);
      const emissionsDirectory = nodePath.join(taskDirectory, 'emissions');
      for (const fileName of listDurableJsonFileNames(emissionsDirectory)) {
        const path = nodePath.join(emissionsDirectory, fileName);
        const found = readJsonFile(path);
        if (found.state !== 'present') continue;
        let record;
        try {
          record = validateEmissionRecord(found.document);
        } catch (error) {
          storeFail(
            `emission record invalid while checking intake authority conflicts (fail-closed, no auto-repair): ${sourceTaskId}/${fileName}: ${error?.message}`,
            {
              code: typeof error?.code === 'string' && error.code ? error.code : CORRUPT_EMISSION,
              taskId,
            },
          );
        }
        if (record.nextTaskId === taskId) {
          storeFail(
            `successor emission authority already binds taskId ${taskId} (${emissionRef(sourceTaskId, record.emissionSlot)}): a task produced by successor emission is never adopted by user-approved intake (fail-closed; the two authority sources are never merged).`,
            { code: INTAKE_AUTHORITY_CONFLICT, taskId },
          );
        }
      }
      const admissionsDirectory = nodePath.join(taskDirectory, 'emission-admissions');
      for (const fileName of listDurableJsonFileNames(admissionsDirectory)) {
        const path = nodePath.join(admissionsDirectory, fileName);
        const found = readJsonFile(path);
        if (found.state !== 'present') continue;
        let record;
        try {
          record = validateAdmissionRecord(found.document);
        } catch (error) {
          storeFail(
            `admission record invalid while checking intake authority conflicts (fail-closed, no auto-repair): ${sourceTaskId}/${fileName}: ${error?.message}`,
            {
              code: typeof error?.code === 'string' && error.code ? error.code : CORRUPT_ADMISSION,
              taskId,
            },
          );
        }
        if (record.nextTaskId === taskId) {
          storeFail(
            `emission admission authority already binds taskId ${taskId} (${admissionRef(sourceTaskId, record.emissionSlot)}): a task admitted by successor emission is never adopted by user-approved intake (fail-closed; the two authority sources are never merged).`,
            { code: INTAKE_AUTHORITY_CONFLICT, taskId },
          );
        }
      }
    }
  }

  /**
   * Create (or recover) the exact canonical task of one intake authority
   * through the existing createTask path and verify its canonical bytes bind
   * the authority binding exactly. A colliding taskId with different bytes
   * fails closed (never reused, never overwritten).
   */
  #ensureIntakeTask(record) {
    const paths = taskFilePaths(this.home, record.taskId);
    const found = readJsonFile(paths.taskPath);
    let task;
    if (found.state === 'missing') {
      try {
        task = this.createTask({ ...record.taskSpec });
      } catch (error) {
        if (error?.code !== TASK_ALREADY_EXISTS) throw error;
        task = this.readTask(record.taskId);
      }
    } else if (found.state === 'corrupt') {
      storeFail(`intake task record is corrupt (fail-closed, no auto-repair): ${record.taskId}`, {
        code: 'CORRUPT_TASK',
        taskId: record.taskId,
      });
    } else {
      task = validateTaskEnvelope(found.document);
    }
    let binding;
    try {
      binding = computeNextTaskSpecBinding(task);
    } catch (error) {
      storeFail(
        `intake task violates the Task Envelope v1 contract (fail-closed): ${record.taskId}: ${error?.message}`,
        {
          code: typeof error?.code === 'string' && error.code ? error.code : INTAKE_TASK_IDENTITY_CONFLICT,
          taskId: record.taskId,
        },
      );
    }
    if (binding !== record.intakeSpecBinding || task.taskId !== record.taskId) {
      storeFail(
        `intake task identity conflict: taskId ${record.taskId} is bound to different canonical task bytes (first authority wins; never reused or overwritten).`,
        { code: INTAKE_TASK_IDENTITY_CONFLICT, taskId: record.taskId },
      );
    }
    return task;
  }

  /**
   * Converge the intake task to at least READY without ever rewinding a
   * progressed lifecycle: CREATED -> markReady(); READY -> idempotent
   * markReady(); CLAIMED/RESULT_DELIVERED -> returned as-is (normal history).
   */
  #convergeIntakeTask(taskId) {
    const live = this.readTask(taskId);
    if (live.status === TASK_STATUS_CREATED || live.status === TASK_STATUS_READY) {
      return this.markReady(taskId);
    }
    if (live.status === TASK_STATUS_CLAIMED || live.status === TASK_STATUS_RESULT_DELIVERED) {
      return live;
    }
    storeFail(`intake task in unexpected status (fail-closed): ${taskId} status=${live.status}`, {
      code: CORRUPT_INTAKE_AUTHORITY,
      taskId,
    });
    return live;
  }

  /**
   * Full read-back contract: canonical intake authority record + canonical
   * task bytes binding + single sequence membership + task at least READY.
   * Write-syscall success alone never decides success.
   */
  #verifyIntakeReadback(record) {
    const found = readValidatedIntakeDocument(
      userApprovedIntakeFilePath(this.home, record.taskId),
      record.taskId,
    );
    if (found.state !== 'present' || !userApprovedIntakeRecordsEquivalent(found.record, record)) {
      storeFail(
        `intake authority failed to verify after write (fail-closed): ${userApprovedIntakeRef(record.taskId)}`,
        { code: CORRUPT_INTAKE_AUTHORITY, taskId: record.taskId },
      );
    }
    const task = this.readTask(record.taskId);
    let binding;
    try {
      binding = computeNextTaskSpecBinding(task);
    } catch (error) {
      storeFail(`intake task failed spec read-back (fail-closed): ${record.taskId}: ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : INTAKE_BINDING_MISMATCH,
        taskId: record.taskId,
      });
    }
    if (binding !== found.record.intakeSpecBinding || task.taskId !== found.record.taskId) {
      storeFail(`intake task spec binding mismatch on read-back (fail-closed): ${record.taskId}`, {
        code: INTAKE_BINDING_MISMATCH,
        taskId: record.taskId,
      });
    }
    this.#assertSingleAdmissionSequenceMembership(record.taskId, record.taskId);
    if (task.status === TASK_STATUS_CREATED) {
      storeFail(`intake task never reached READY (fail-closed): ${record.taskId}`, {
        code: TASK_NOT_READY,
        taskId: record.taskId,
      });
    }
    return { record: found.record, task };
  }

  /**
   * Intake exactly ONE explicitly user-approved bounded READ_ONLY task spec
   * into one canonical durable intake authority, then converge the exact
   * canonical task to READY.
   *
   * - taskKind != READ_ONLY -> refused before any durable write.
   * - mutationBoundary.allowsWrite != false -> refused before any durable write.
   * - userApproved !== true / approval provenance missing -> refused before any
   *   durable write.
   * - malformed Task Envelope v1 spec -> refused before any durable write.
   * - same logical intake replays idempotently (duplicate:true) with the first
   *   provenance bytes preserved; different payload for the same taskId fails
   *   closed with INTAKE_CONFLICT (never overwritten, never merged).
   * - a task produced by successor emission/admission fails closed with
   *   INTAKE_AUTHORITY_CONFLICT; a pre-existing task without this intake
   *   authority fails closed with INTAKE_TASK_BYPASS_DETECTED (no
   *   auto-adoption).
   * - no claim, no dispatch, no executor invocation, no result delivery, no
   *   successor generation.
   */
  intakeUserApprovedReadOnlyTask({ userApproved, approval, taskSpec, recorderId, recordedAt } = {}) {
    let candidate;
    try {
      candidate = buildUserApprovedIntakeRecord({
        userApproved,
        approval,
        taskSpec,
        recorderId,
        recordedAt: recordedAt ?? this.nowIso(),
      });
    } catch (error) {
      storeFail(`invalid user-approved intake (fail-closed, zero durable writes): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : 'INVALID_INTAKE_RECORD',
        taskId: taskSpec?.taskId,
      });
    }

    // Gate G: no existing successor emission/admission may already bind this
    // taskId (authority sources are never merged).
    this.#assertNoEmissionAuthorityBindsTask(candidate.taskId);

    const path = userApprovedIntakeFilePath(this.home, candidate.taskId);
    const existingFound = readValidatedIntakeDocument(path, candidate.taskId);
    let record;
    let duplicate;
    if (existingFound.state === 'present') {
      if (!userApprovedIntakeRecordsEquivalent(existingFound.record, candidate)) {
        storeFail(
          `conflicting user-approved intake for taskId (first wins, fail-closed, no overwrite/merge): ${userApprovedIntakeRef(candidate.taskId)} winner=${existingFound.record.intakeId}`,
          { code: INTAKE_CONFLICT, taskId: candidate.taskId },
        );
      }
      record = existingFound.record;
      duplicate = true;
    } else {
      // No authority yet: a pre-existing task must never be adopted by a newly
      // created intake authority. This check runs BEFORE the authority write so
      // the bypass/identity conflict leaves zero durable intake delta.
      const preExistingTask = readJsonFile(taskFilePaths(this.home, candidate.taskId).taskPath);
      if (preExistingTask.state === 'corrupt') {
        storeFail(`intake task record is corrupt (fail-closed, no auto-repair): ${candidate.taskId}`, {
          code: 'CORRUPT_TASK',
          taskId: candidate.taskId,
        });
      }
      if (preExistingTask.state === 'present') {
        const task = validateTaskEnvelope(preExistingTask.document);
        let binding;
        try {
          binding = computeNextTaskSpecBinding(task);
        } catch (error) {
          storeFail(
            `pre-existing task violates the Task Envelope v1 contract (fail-closed): ${candidate.taskId}: ${error?.message}`,
            {
              code: typeof error?.code === 'string' && error.code ? error.code : INTAKE_TASK_IDENTITY_CONFLICT,
              taskId: candidate.taskId,
            },
          );
        }
        if (binding !== candidate.intakeSpecBinding || task.taskId !== candidate.taskId) {
          storeFail(
            `intake task identity conflict: taskId ${candidate.taskId} already exists with different canonical task bytes (first task wins; never reused or overwritten).`,
            { code: INTAKE_TASK_IDENTITY_CONFLICT, taskId: candidate.taskId },
          );
        }
        storeFail(
          `intake bypass detected: task ${candidate.taskId} already exists (${task.status}) without a pre-existing user-approved intake authority (fail-closed, no auto-adoption).`,
          { code: INTAKE_TASK_BYPASS_DETECTED, taskId: candidate.taskId },
        );
      }
      const created = writeJsonExclusive(path, candidate);
      if (created.created) {
        record = candidate;
        duplicate = false;
      } else {
        const winnerFound = readValidatedIntakeDocument(path, candidate.taskId);
        if (winnerFound.state !== 'present') {
          storeFail(
            `intake authority race could not be resolved deterministically: ${userApprovedIntakeRef(candidate.taskId)}`,
            { code: CORRUPT_INTAKE_AUTHORITY, taskId: candidate.taskId },
          );
        }
        if (!userApprovedIntakeRecordsEquivalent(winnerFound.record, candidate)) {
          storeFail(
            `conflicting user-approved intake for taskId (first wins, fail-closed, no overwrite/merge): ${userApprovedIntakeRef(candidate.taskId)} winner=${winnerFound.record.intakeId}`,
            { code: INTAKE_CONFLICT, taskId: candidate.taskId },
          );
        }
        record = winnerFound.record;
        duplicate = true;
      }
    }

    // Authority durable: task create + READY convergence (crash windows
    // recover on replay to the same authority + task + READY).
    this.#ensureIntakeTask(record);
    this.#assertNoEmissionAuthorityBindsTask(record.taskId);
    this.#convergeIntakeTask(record.taskId);
    const verified = this.#verifyIntakeReadback(record);
    return { record: verified.record, task: verified.task, duplicate };
  }

  /**
   * Read the canonical intake authority for one taskId, re-validated against
   * the live exact task bytes and sequence membership. Pure read: never
   * mutates the authority, never repairs, never rewinds.
   */
  readUserApprovedIntake({ taskId } = {}) {
    assertValidTaskId(taskId);
    const found = readValidatedIntakeDocument(userApprovedIntakeFilePath(this.home, taskId), taskId);
    if (found.state === 'missing') {
      storeFail(`no user-approved intake for task: ${userApprovedIntakeRef(taskId)}`, {
        code: INTAKE_NOT_FOUND,
        taskId,
      });
    }
    const task = this.readTask(taskId);
    let binding;
    try {
      binding = computeNextTaskSpecBinding(task);
    } catch (error) {
      storeFail(`intake task failed spec read-back (fail-closed): ${taskId}: ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : INTAKE_BINDING_MISMATCH,
        taskId,
      });
    }
    if (binding !== found.record.intakeSpecBinding || task.taskId !== found.record.taskId) {
      storeFail(`intake task spec binding mismatch (fail-closed): ${taskId}`, {
        code: INTAKE_BINDING_MISMATCH,
        taskId,
      });
    }
    this.#assertSingleAdmissionSequenceMembership(taskId, taskId);
    return found.record;
  }

  #verifyIntakeClaimAfterWrite({ taskId, authority, workerId, expectedToken, claim }) {
    if (claim.taskId !== taskId || claim.workerId !== workerId || claim.claimToken !== expectedToken) {
      storeFail(`intake-bound claim failed binding read-back (fail-closed): ${taskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }
    const reread = this.#readCurrentAdmissionClaim(taskId);
    if (reread.state !== 'present' || JSON.stringify(reread.record) !== JSON.stringify(claim)) {
      storeFail(`intake-bound claim failed to verify after write (fail-closed): ${taskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }
    const liveChild = this.readTask(taskId);
    if (liveChild.status !== TASK_STATUS_CLAIMED && liveChild.status !== TASK_STATUS_RESULT_DELIVERED) {
      storeFail(`intake-bound task never reached CLAIMED (fail-closed): ${taskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }
    if (liveChild.status === TASK_STATUS_RESULT_DELIVERED) {
      return { record: authority, child: liveChild, claim: reread.record, duplicate: true, terminal: true };
    }
    return { record: authority, child: liveChild, claim: reread.record, duplicate: false, terminal: false };
  }

  #resolveIntakeClaimWriteRace({ error, taskId, authority, workerId, expectedToken, now }) {
    if (error?.code === CLAIM_ADMISSION_BYPASS_DETECTED || error?.code === 'CORRUPT_CLAIM') throw error;
    if (error?.code !== LEASE_ACTIVE && error?.code !== TASK_TERMINAL) throw error;
    const liveChild = this.readTask(taskId);
    const currentFound = this.#readCurrentAdmissionClaim(taskId);
    if (currentFound.state === 'missing') throw error;
    const persisted = currentFound.record;
    let expectedPersisted;
    try {
      expectedPersisted = buildAdmissionBoundClaimToken({
        admissionId: authority.intakeId,
        nextTaskId: taskId,
        workerId: persisted.workerId,
      });
    } catch {
      storeFail(`foreign claim for intake task (fail-closed, no auto-adoption): ${taskId}`, {
        code: CLAIM_ADMISSION_BYPASS_DETECTED,
        taskId,
      });
    }
    if (persisted.claimToken !== expectedPersisted) {
      storeFail(`foreign claim for intake task (fail-closed, no auto-adoption): ${taskId}`, {
        code: CLAIM_ADMISSION_BYPASS_DETECTED,
        taskId,
      });
    }
    const isSameLogical = persisted.workerId === workerId && persisted.claimToken === expectedToken;
    if (liveChild.status === TASK_STATUS_RESULT_DELIVERED) {
      return { record: authority, child: liveChild, claim: persisted, duplicate: true, terminal: true };
    }
    if (isSameLogical && this.#isClaimLeaseActive(persisted, now)) {
      if (liveChild.status === TASK_STATUS_CLAIMED) {
        return { record: authority, child: liveChild, claim: persisted, duplicate: true, terminal: false };
      }
      if (liveChild.status === TASK_STATUS_READY) {
        const beforeBytes = JSON.stringify(persisted);
        const converged = this.#markClaimed(taskId);
        const reread = this.#readCurrentAdmissionClaim(taskId);
        if (reread.state !== 'present' || JSON.stringify(reread.record) !== beforeBytes) {
          storeFail(`intake-bound claim changed during status convergence (fail-closed): ${taskId}`, {
            code: 'CORRUPT_CLAIM',
            taskId,
          });
        }
        return { record: authority, child: converged, claim: reread.record, duplicate: true, terminal: false };
      }
    }
    throw error;
  }

  /**
   * Claim the exact user-approved intake task for a caller-supplied worker
   * through the existing claimTask() path with a deterministic authority-bound
   * claimToken over (intakeId, taskId, workerId).
   *
   * - live intake authority + task bytes + sequence re-verified first.
   * - READY -> CLAIMED is owned ONLY by the existing claimTask().
   * - same logical active replay returns duplicate:true with no new claim and
   *   no generation change; expired leases reuse the existing takeover
   *   semantics; terminal replay never rewinds.
   * - a foreign/manual claim never auto-adopts (CLAIM_ADMISSION_BYPASS_DETECTED).
   * - no emission/admission authority is created or consumed here.
   */
  claimUserApprovedIntakeTask(
    { taskId, workerId, leaseDurationMs = 60_000, nowMs } = {},
  ) {
    assertValidTaskId(taskId);
    if (typeof workerId !== 'string' || !workerId.trim()) {
      storeFail('workerId must be a non-empty string (caller-supplied; never inferred).', {
        code: 'INVALID_WORKER',
        taskId,
      });
    }
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      storeFail('leaseDurationMs must be a positive integer.', { code: 'INVALID_LEASE', taskId });
    }
    const now = Number.isInteger(nowMs) ? nowMs : this.nowMs();

    const authority = this.readUserApprovedIntake({ taskId });
    const expectedToken = buildAdmissionBoundClaimToken({
      admissionId: authority.intakeId,
      nextTaskId: taskId,
      workerId,
    });
    const liveChild = this.readTask(taskId);
    if (liveChild.status === TASK_STATUS_CREATED) {
      storeFail(
        `only READY intake-authorized tasks can be claimed (task=${taskId} status=CREATED; converge via intakeUserApprovedReadOnlyTask first).`,
        { code: TASK_NOT_READY, taskId },
      );
    }
    if (
      liveChild.status !== TASK_STATUS_READY &&
      liveChild.status !== TASK_STATUS_CLAIMED &&
      liveChild.status !== TASK_STATUS_RESULT_DELIVERED
    ) {
      storeFail(`intake-bound task in unexpected status (fail-closed): ${taskId} status=${liveChild.status}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }

    const currentFound = this.#readCurrentAdmissionClaim(taskId);

    // TERMINAL path: never a new claim, never rewind.
    if (liveChild.status === TASK_STATUS_RESULT_DELIVERED) {
      if (currentFound.state === 'missing') {
        storeFail(`no intake-bound claim for terminal task (fail-closed, no auto-repair): ${taskId}`, {
          code: CLAIM_NOT_FOUND,
          taskId,
        });
      }
      const persisted = currentFound.record;
      let expectedPersisted;
      try {
        expectedPersisted = buildAdmissionBoundClaimToken({
          admissionId: authority.intakeId,
          nextTaskId: taskId,
          workerId: persisted.workerId,
        });
      } catch {
        storeFail(`terminal task carries a foreign claim (fail-closed, no auto-adoption): ${taskId}`, {
          code: CLAIM_ADMISSION_BYPASS_DETECTED,
          taskId,
        });
      }
      if (persisted.claimToken !== expectedPersisted) {
        storeFail(`terminal task carries a foreign claim (fail-closed, no auto-adoption): ${taskId}`, {
          code: CLAIM_ADMISSION_BYPASS_DETECTED,
          taskId,
        });
      }
      return { record: authority, child: liveChild, claim: persisted, duplicate: true, terminal: true };
    }

    if (currentFound.state === 'present') {
      const persisted = currentFound.record;
      let expectedPersisted;
      try {
        expectedPersisted = buildAdmissionBoundClaimToken({
          admissionId: authority.intakeId,
          nextTaskId: taskId,
          workerId: persisted.workerId,
        });
      } catch {
        storeFail(`foreign claim for intake task (fail-closed, no auto-adoption): ${taskId}`, {
          code: CLAIM_ADMISSION_BYPASS_DETECTED,
          taskId,
        });
      }
      if (persisted.claimToken !== expectedPersisted) {
        storeFail(`foreign claim for intake task (fail-closed, no auto-adoption): ${taskId}`, {
          code: CLAIM_ADMISSION_BYPASS_DETECTED,
          taskId,
        });
      }
      const isSameLogical = persisted.workerId === workerId && persisted.claimToken === expectedToken;
      if (liveChild.status === TASK_STATUS_READY && isSameLogical && this.#isClaimLeaseActive(persisted, now)) {
        const beforeBytes = JSON.stringify(persisted);
        const converged = this.#markClaimed(taskId);
        const reread = this.#readCurrentAdmissionClaim(taskId);
        if (reread.state !== 'present' || JSON.stringify(reread.record) !== beforeBytes) {
          storeFail(`intake-bound claim changed during status convergence (fail-closed): ${taskId}`, {
            code: 'CORRUPT_CLAIM',
            taskId,
          });
        }
        return { record: authority, child: converged, claim: reread.record, duplicate: true, terminal: false };
      }
      if (liveChild.status === TASK_STATUS_CLAIMED && isSameLogical && this.#isClaimLeaseActive(persisted, now)) {
        return { record: authority, child: liveChild, claim: persisted, duplicate: true, terminal: false };
      }
      // Valid claim for another worker (or expired same-worker lease): delegate
      // to the existing claimTask() for canonical contention/takeover.
    } else if (liveChild.status !== TASK_STATUS_READY) {
      storeFail(`no intake-bound claim for progressed task (fail-closed, no auto-repair): ${taskId}`, {
        code: CLAIM_NOT_FOUND,
        taskId,
      });
    }

    try {
      const claim = this.claimTask({
        taskId,
        workerId,
        leaseDurationMs,
        claimToken: expectedToken,
        nowMs: now,
      });
      return this.#verifyIntakeClaimAfterWrite({ taskId, authority, workerId, expectedToken, claim });
    } catch (error) {
      return this.#resolveIntakeClaimWriteRace({ error, taskId, authority, workerId, expectedToken, now });
    }
  }

  /**
   * Read the claim-bound dispatch envelope for one intake-authorized task and
   * one caller worker. Pure read + builder consumption: the dispatch envelope
   * shape is the EXISTING Task 18 identity/binding envelope with the intake
   * authority id in the generic authority binding slot. Never mutates, never
   * auto-claims, never rewinds.
   */
  readUserApprovedIntakeClaimBoundDispatchEnvelope({ taskId, workerId } = {}) {
    assertValidTaskId(taskId);
    if (typeof workerId !== 'string' || !workerId.trim()) {
      storeFail('workerId must be a non-empty string (caller-supplied; never inferred).', {
        code: 'INVALID_WORKER',
        taskId,
      });
    }
    const authority = this.readUserApprovedIntake({ taskId });
    const child = this.readTask(taskId);
    if (child.taskId !== taskId) {
      storeFail(`intake dispatch child taskId mismatch (fail-closed): ${taskId}`, {
        code: INTAKE_BINDING_MISMATCH,
        taskId,
      });
    }
    const currentFound = this.#readCurrentAdmissionClaim(taskId);
    if (currentFound.state === 'missing') {
      storeFail(`no claim for intake dispatch-bound task (fail-closed, claim first): ${taskId}`, {
        code: CLAIM_NOT_FOUND,
        taskId,
      });
    }
    const claim = currentFound.record;
    if (claim.workerId !== workerId) {
      storeFail(
        `intake dispatch worker binding mismatch (fail-closed, no claim mutation): live owner=${claim.workerId} caller=${workerId}.`,
        { code: DISPATCH_BINDING_MISMATCH, taskId },
      );
    }
    if (!Number.isInteger(claim.generation) || claim.generation < 1) {
      storeFail(`intake dispatch claim generation invalid (fail-closed): ${taskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId,
      });
    }
    let expectedToken;
    try {
      expectedToken = buildAdmissionBoundClaimToken({
        admissionId: authority.intakeId,
        nextTaskId: taskId,
        workerId: claim.workerId,
      });
    } catch {
      storeFail(`intake dispatch child carries a foreign claim (fail-closed, no auto-adoption): ${taskId}`, {
        code: CLAIM_ADMISSION_BYPASS_DETECTED,
        taskId,
      });
    }
    if (claim.claimToken !== expectedToken) {
      storeFail(`intake dispatch child carries a foreign claim (fail-closed, no auto-adoption): ${taskId}`, {
        code: CLAIM_ADMISSION_BYPASS_DETECTED,
        taskId,
      });
    }
    if (child.status === TASK_STATUS_RESULT_DELIVERED) {
      storeFail(`intake dispatch child is terminal (RESULT_DELIVERED); no new dispatch envelope: ${taskId}`, {
        code: TASK_TERMINAL,
        taskId,
      });
    }
    if (child.status !== TASK_STATUS_CLAIMED) {
      storeFail(
        `intake dispatch child is not CLAIMED (task=${taskId} status=${child.status}; converge via claimUserApprovedIntakeTask first, never auto-claim here).`,
        { code: TASK_NOT_CLAIMED, taskId },
      );
    }
    try {
      return buildClaimBoundDispatchEnvelope({
        admissionId: authority.intakeId,
        nextTaskId: taskId,
        workerId: claim.workerId,
        claimGeneration: claim.generation,
      });
    } catch (error) {
      storeFail(`intake dispatch envelope build failed (fail-closed): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : INVALID_DISPATCH_BINDING,
        taskId,
      });
    }
    return null;
  }

  /**
   * Verify a supplied dispatch envelope against the current live intake
   * authority + claim binding. Pure read + recomputation: never mutates,
   * never repairs.
   */
  verifyUserApprovedIntakeClaimBoundDispatchEnvelope({ taskId, envelope } = {}) {
    assertValidTaskId(taskId);
    let supplied;
    try {
      supplied = validateClaimBoundDispatchEnvelope(envelope);
    } catch (error) {
      storeFail(`supplied intake dispatch envelope invalid (fail-closed): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : INVALID_DISPATCH_BINDING,
        taskId,
      });
    }
    const current = this.readUserApprovedIntakeClaimBoundDispatchEnvelope({
      taskId,
      workerId: supplied.workerId,
    });
    if (supplied.admissionId !== current.admissionId || supplied.nextTaskId !== current.nextTaskId) {
      storeFail(
        `supplied intake dispatch envelope binds a different authority/task than live (fail-closed): supplied authority=${supplied.admissionId} task=${supplied.nextTaskId} live authority=${current.admissionId} task=${current.nextTaskId}.`,
        { code: DISPATCH_BINDING_MISMATCH, taskId },
      );
    }
    if (supplied.workerId !== current.workerId) {
      storeFail(
        `supplied intake dispatch envelope binds a different worker than live (fail-closed): supplied=${supplied.workerId} live=${current.workerId}.`,
        { code: DISPATCH_BINDING_MISMATCH, taskId },
      );
    }
    if (supplied.claimGeneration !== current.claimGeneration || supplied.dispatchId !== current.dispatchId) {
      storeFail(
        `stale intake dispatch envelope: supplied generation=${supplied.claimGeneration} dispatchId=${supplied.dispatchId} vs current generation=${current.claimGeneration} dispatchId=${current.dispatchId} (fail-closed, no rewind).`,
        { code: STALE_DISPATCH, taskId },
      );
    }
    return current;
  }

  /**
   * Persist the immutable durable dispatch attempt for the CURRENT live
   * intake claim-bound dispatch envelope (exclusive-create per dispatchId,
   * idempotent replay, never overwrites).
   */
  persistUserApprovedIntakeDispatchAttempt({ taskId, workerId } = {}) {
    assertValidTaskId(taskId);
    if (typeof workerId !== 'string' || !workerId.trim()) {
      storeFail('workerId must be a non-empty string (caller-supplied; never inferred).', {
        code: 'INVALID_WORKER',
        taskId,
      });
    }
    const envelope = this.readUserApprovedIntakeClaimBoundDispatchEnvelope({ taskId, workerId });
    let candidate;
    try {
      candidate = buildDispatchAttemptRecord({
        sourceTaskId: taskId,
        emissionSlot: USER_APPROVED_INTAKE_DISPATCH_SLOT,
        envelope,
      });
    } catch (error) {
      storeFail(`intake dispatch attempt build failed (fail-closed): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : CORRUPT_DISPATCH_ATTEMPT,
        taskId,
      });
    }
    return this.#writeDispatchAttemptCandidate(taskId, candidate);
  }

  // -------------------------------------------------------------------------
  // Admission-bound claim domain.
  // claimAdmittedTask() != emitNextTask() != admitEmittedTask()
  //   != scheduleNextTask() != dispatchNextTask() != decideNextTask():
  // the caller explicitly supplies (sourceTaskId, emissionSlot, workerId);
  // this primitive never scans emissions, never polls a queue, never picks
  // oldest/newest, never scores priority/fairness, never selects workers,
  // and never runs a scheduler loop. Ordering is ADMISSION AUTHORITY ->
  // CLAIM (never CLAIM -> ADMISSION): every binding is re-verified live,
  // a deterministic admission-bound claimToken is derived ONLY over
  // (admissionId, nextTaskId, workerId), then the existing claimTask() path
  // moves the exact canonical child to CLAIMED. Timestamps are provenance
  // only. No new claim file, no new lease subsystem, no worker registry.
  // -------------------------------------------------------------------------

  /**
   * Re-verify the live canonical admission binding for a source slot.
   * Returns { emission, admission, child, childBinding }.
   * Missing/ineligible/corrupt/drift propagates fail-closed with no claim
   * mutation and no auto-repair.
   */
  #requireLiveAdmissionClaimBinding(sourceTaskId, emissionSlot) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    // Source must exist (fail-closed before any claim mutation).
    this.readTask(sourceTaskId);
    // Canonical emission + live CONSUMED closure binding.
    const emission = this.readEmission(sourceTaskId, emissionSlot);
    // Canonical admission + emission binding + child binding + sequence.
    const admission = this.readEmissionAdmission({ sourceTaskId, emissionSlot });
    if (
      admission.sourceTaskId !== sourceTaskId ||
      admission.emissionSlot !== emissionSlot ||
      admission.emissionId !== emission.emissionId ||
      admission.nextTaskId !== emission.nextTaskId ||
      admission.nextTaskSpecBinding !== emission.nextTaskSpecBinding
    ) {
      storeFail(
        `admission drift vs live canonical emission (fail-closed, no claim): ${admissionRef(sourceTaskId, emissionSlot)}`,
        { code: ADMISSION_BINDING_MISMATCH, taskId: sourceTaskId },
      );
    }
    const child = this.readTask(admission.nextTaskId);
    if (child.taskId !== admission.nextTaskId) {
      storeFail(`admission-bound child taskId mismatch (fail-closed): ${admission.nextTaskId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    let childBinding;
    try {
      childBinding = computeNextTaskSpecBinding(child);
    } catch (error) {
      storeFail(
        `admission-bound child violates the Task Envelope v1 contract (fail-closed): ${admission.nextTaskId}: ${error?.message}`,
        {
          code: typeof error?.code === 'string' && error.code ? error.code : ADMISSION_BINDING_MISMATCH,
          taskId: sourceTaskId,
        },
      );
    }
    if (childBinding !== admission.nextTaskSpecBinding || childBinding !== emission.nextTaskSpecBinding) {
      storeFail(`admission-bound child spec binding mismatch (fail-closed): ${admission.nextTaskId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    // Single append-stable sequence membership (fail-closed on duplication).
    this.#assertSingleAdmissionSequenceMembership(sourceTaskId, admission.nextTaskId);
    return { emission, admission, child, childBinding };
  }

  /**
   * Read the current claim for a child without auto-repair.
   * Returns { state: 'missing' } or { state: 'present', record }.
   * Corrupt/invalid bytes throw CORRUPT_CLAIM (never repaired, never removed).
   */
  #readCurrentAdmissionClaim(childTaskId) {
    const claimPath = taskFilePaths(this.home, childTaskId).claimPath;
    const raw = readJsonFile(claimPath);
    if (raw.state === 'missing') return { state: 'missing' };
    if (raw.state === 'corrupt') {
      storeFail(`claim record is corrupt (fail-closed, no auto-repair): ${childTaskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId: childTaskId,
      });
    }
    try {
      const record = validateClaimRecord(raw.document);
      if (record.taskId !== childTaskId) {
        storeFail(`claim taskId/path mismatch (fail-closed): ${childTaskId}`, {
          code: 'CORRUPT_CLAIM',
          taskId: childTaskId,
        });
      }
      return { state: 'present', record };
    } catch (error) {
      if (error?.code === 'CORRUPT_CLAIM') throw error;
      storeFail(`claim record is corrupt (fail-closed, no auto-repair): ${childTaskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId: childTaskId,
      });
    }
    return { state: 'missing' };
  }

  #expectedAdmissionBoundToken(admissionId, nextTaskId, workerId, sourceTaskId) {
    try {
      return buildAdmissionBoundClaimToken({ admissionId, nextTaskId, workerId });
    } catch (error) {
      storeFail(`invalid admission-bound claim binding (fail-closed): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : 'INVALID_ADMISSION_BOUND_CLAIM',
        taskId: sourceTaskId ?? nextTaskId,
      });
    }
    return null;
  }

  #isClaimLeaseActive(claimRecord, now) {
    return Number.isFinite(Date.parse(claimRecord.leaseExpiresAt)) && Date.parse(claimRecord.leaseExpiresAt) > now;
  }

  /**
   * Claim the exact canonical admitted child for a caller-supplied worker.
   *
   * Caller supplies (sourceTaskId, emissionSlot, workerId) explicitly: no
   * emission scan, no polling, no oldest/newest, no priority, no scheduler
   * loop, no worker inference.
   *
   * - live admission/child/sequence re-verified before any claim mutation.
   * - deterministic admission-bound claimToken derived ONLY over
   *   (admissionId, nextTaskId, workerId); clock/pid/random never participate.
   * - READY -> CLAIMED itself is owned ONLY by the existing claimTask().
   * - same logical active replay returns duplicate:true with no new claim,
   *   no generation change, no bytes overwrite, no lease extension.
   * - claim authority without status (claim present + READY) converges to
   *   CLAIMED only for the exact expected token/worker via the existing
   *   markClaimed path (claim bytes preserved).
   * - foreign/manual/random tokens never auto-adopt: fail closed with
   *   CLAIM_ADMISSION_BYPASS_DETECTED.
   * - expired leases reuse the existing takeover semantics (generation + 1).
   * - terminal replay returns duplicate:true terminal:true without rewind.
   */
  claimAdmittedTask(
    { sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT, workerId, leaseDurationMs = 60_000, nowMs } = {},
  ) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    if (typeof workerId !== 'string' || !workerId.trim()) {
      storeFail('workerId must be a non-empty string (caller-supplied; never inferred).', {
        code: 'INVALID_WORKER',
        taskId: sourceTaskId,
      });
    }
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      storeFail('leaseDurationMs must be a positive integer.', { code: 'INVALID_LEASE', taskId: sourceTaskId });
    }
    const now = Number.isInteger(nowMs) ? nowMs : this.nowMs();

    // A-K. Live admission re-verification before any claim mutation.
    const { emission, admission, child: liveChild } = this.#requireLiveAdmissionClaimBinding(
      sourceTaskId,
      emissionSlot,
    );
    const childId = admission.nextTaskId;
    const expectedToken = this.#expectedAdmissionBoundToken(admission.admissionId, childId, workerId, sourceTaskId);

    // CREATED children refuse the claim path: Task 14 admission/READY first.
    if (liveChild.status === TASK_STATUS_CREATED) {
      storeFail(
        `only READY admitted children can be claimed (task=${childId} status=CREATED; converge via admitEmittedTask first).`,
        { code: TASK_NOT_READY, taskId: childId },
      );
    }
    if (
      liveChild.status !== TASK_STATUS_READY &&
      liveChild.status !== TASK_STATUS_CLAIMED &&
      liveChild.status !== TASK_STATUS_RESULT_DELIVERED
    ) {
      storeFail(`admission-bound child in unexpected status (fail-closed): ${childId} status=${liveChild.status}`, {
        code: 'CORRUPT_CLAIM',
        taskId: childId,
      });
    }

    const currentFound = this.#readCurrentAdmissionClaim(childId);
    const expectedForPersisted = (persistedWorkerId) =>
      this.#expectedAdmissionBoundToken(admission.admissionId, childId, persistedWorkerId, sourceTaskId);

    // TERMINAL path: never a new claim, never rewind, never generation bump.
    if (liveChild.status === TASK_STATUS_RESULT_DELIVERED) {
      if (currentFound.state === 'missing') {
        storeFail(`no admission-bound claim for terminal child (fail-closed, no auto-repair): ${childId}`, {
          code: CLAIM_NOT_FOUND,
          taskId: childId,
        });
      }
      const persisted = currentFound.record;
      let expectedPersisted;
      try {
        expectedPersisted = buildAdmissionBoundClaimToken({
          admissionId: admission.admissionId,
          nextTaskId: childId,
          workerId: persisted.workerId,
        });
      } catch {
        storeFail(`terminal child carries a foreign claim (fail-closed, no auto-adoption): ${childId}`, {
          code: CLAIM_ADMISSION_BYPASS_DETECTED,
          taskId: sourceTaskId,
        });
      }
      if (persisted.claimToken !== expectedPersisted) {
        storeFail(`terminal child carries a foreign claim (fail-closed, no auto-adoption): ${childId}`, {
          code: CLAIM_ADMISSION_BYPASS_DETECTED,
          taskId: sourceTaskId,
        });
      }
      return {
        record: admission,
        emission,
        child: liveChild,
        claim: persisted,
        duplicate: true,
        terminal: true,
      };
    }

    // CLAIMED / READY paths share the persisted-validity gate.
    if (currentFound.state === 'present') {
      const persisted = currentFound.record;
      let expectedPersisted;
      try {
        expectedPersisted = buildAdmissionBoundClaimToken({
          admissionId: admission.admissionId,
          nextTaskId: childId,
          workerId: persisted.workerId,
        });
      } catch {
        storeFail(`foreign claim for admitted child (fail-closed, no auto-adoption): ${childId}`, {
          code: CLAIM_ADMISSION_BYPASS_DETECTED,
          taskId: sourceTaskId,
        });
      }
      const persistedIsBound = persisted.claimToken === expectedPersisted;
      if (!persistedIsBound) {
        storeFail(
          `foreign claim for admitted child (fail-closed, no auto-adoption): ${childId} owner=${persisted.workerId}`,
          { code: CLAIM_ADMISSION_BYPASS_DETECTED, taskId: sourceTaskId },
        );
      }
      const isSameLogical = persisted.workerId === workerId && persisted.claimToken === expectedToken;

      if (liveChild.status === TASK_STATUS_READY) {
        if (isSameLogical) {
          if (this.#isClaimLeaseActive(persisted, now)) {
            // Authority-without-status recovery: converge READY -> CLAIMED
            // without touching claim bytes/generation/token.
            const beforeBytes = JSON.stringify(persisted);
            const converged = this.#markClaimed(childId);
            const reread = this.#readCurrentAdmissionClaim(childId);
            if (reread.state !== 'present' || JSON.stringify(reread.record) !== beforeBytes) {
              storeFail(`admission-bound claim changed during status convergence (fail-closed): ${childId}`, {
                code: 'CORRUPT_CLAIM',
                taskId: childId,
              });
            }
            return {
              record: admission,
              emission,
              child: converged,
              claim: reread.record,
              duplicate: true,
              terminal: false,
            };
          }
          // Same worker, expired lease, still READY: reclaim via takeover.
          return this.#takeoverAdmissionBoundClaim({
            sourceTaskId,
            emissionSlot,
            admission,
            emission,
            childId,
            workerId,
            expectedToken,
            leaseDurationMs,
            now,
          });
        }
        // Valid claim for another worker while READY: delegate to the
        // existing claimTask for canonical contention (active -> LEASE_ACTIVE,
        // expired -> takeover). Never converge for a mismatched worker.
        return this.#takeoverAdmissionBoundClaim({
          sourceTaskId,
          emissionSlot,
          admission,
          emission,
          childId,
          workerId,
          expectedToken,
          leaseDurationMs,
          now,
        });
      }

      // CLAIMED with a persisted valid claim.
      if (isSameLogical) {
        if (this.#isClaimLeaseActive(persisted, now)) {
          return {
            record: admission,
            emission,
            child: liveChild,
            claim: persisted,
            duplicate: true,
            terminal: false,
          };
        }
        // Same worker, expired lease: reclaim via takeover (generation + 1,
        // same deterministic token).
        return this.#takeoverAdmissionBoundClaim({
          sourceTaskId,
          emissionSlot,
          admission,
          emission,
          childId,
          workerId,
          expectedToken,
          leaseDurationMs,
          now,
        });
      }
      // Valid claim for another worker: contention or takeover via existing
      // semantics (active -> LEASE_ACTIVE, expired -> generation + 1).
      return this.#takeoverAdmissionBoundClaim({
        sourceTaskId,
        emissionSlot,
        admission,
        emission,
        childId,
        workerId,
        expectedToken,
        leaseDurationMs,
        now,
      });
    }

    // No claim yet.
    if (liveChild.status !== TASK_STATUS_READY) {
      // CLAIMED without authority is inconsistent: never auto-create.
      storeFail(`no admission-bound claim for progressed child (fail-closed, no auto-repair): ${childId}`, {
        code: CLAIM_NOT_FOUND,
        taskId: childId,
      });
    }
    try {
      const claim = this.claimTask({
        taskId: childId,
        workerId,
        leaseDurationMs,
        claimToken: expectedToken,
        nowMs: now,
      });
      return this.#verifyAdmissionBoundClaimAfterWrite({
        sourceTaskId,
        emissionSlot,
        admission,
        emission,
        childId,
        workerId,
        expectedToken,
        claim,
        duplicate: false,
      });
    } catch (error) {
      return this.#resolveAdmissionBoundClaimWriteRace({
        error,
        sourceTaskId,
        emissionSlot,
        admission,
        emission,
        childId,
        workerId,
        expectedToken,
        leaseDurationMs,
        now,
      });
    }
  }

  /**
   * Takeover/reclaim path: delegate to the existing claimTask() (expiry-gated
   * generation + 1) then read-back verify the admission binding.
   */
  #takeoverAdmissionBoundClaim({
    sourceTaskId,
    emissionSlot,
    admission,
    emission,
    childId,
    workerId,
    expectedToken,
    leaseDurationMs,
    now,
  }) {
    let claim;
    try {
      claim = this.claimTask({
        taskId: childId,
        workerId,
        leaseDurationMs,
        claimToken: expectedToken,
        nowMs: now,
      });
    } catch (error) {
      return this.#resolveAdmissionBoundClaimWriteRace({
        error,
        sourceTaskId,
        emissionSlot,
        admission,
        emission,
        childId,
        workerId,
        expectedToken,
        leaseDurationMs,
        now,
      });
    }
    return this.#verifyAdmissionBoundClaimAfterWrite({
      sourceTaskId,
      emissionSlot,
      admission,
      emission,
      childId,
      workerId,
      expectedToken,
      claim,
      duplicate: false,
    });
  }

  /**
   * Read-back contract after a successful claimTask(): claim bytes bind the
   * live admission deterministically and the child is CLAIMED.
   * Write-syscall success alone never decides success.
   */
  #verifyAdmissionBoundClaimAfterWrite({
    sourceTaskId,
    emissionSlot,
    admission,
    emission,
    childId,
    workerId,
    expectedToken,
    claim,
    duplicate,
  }) {
    if (claim.taskId !== childId || claim.workerId !== workerId || claim.claimToken !== expectedToken) {
      storeFail(`admission-bound claim failed binding read-back (fail-closed): ${childId}`, {
        code: 'CORRUPT_CLAIM',
        taskId: childId,
      });
    }
    const reread = this.#readCurrentAdmissionClaim(childId);
    if (reread.state !== 'present' || JSON.stringify(reread.record) !== JSON.stringify(claim)) {
      storeFail(`admission-bound claim failed to verify after write (fail-closed): ${childId}`, {
        code: 'CORRUPT_CLAIM',
        taskId: childId,
      });
    }
    const liveChild = this.readTask(childId);
    if (liveChild.status !== TASK_STATUS_CLAIMED && liveChild.status !== TASK_STATUS_RESULT_DELIVERED) {
      storeFail(`admission-bound child never reached CLAIMED (fail-closed): ${childId}`, {
        code: 'CORRUPT_CLAIM',
        taskId: childId,
      });
    }
    if (liveChild.status === TASK_STATUS_RESULT_DELIVERED) {
      return { record: admission, emission, child: liveChild, claim: reread.record, duplicate: true, terminal: true };
    }
    void sourceTaskId;
    void emissionSlot;
    void emission;
    return { record: admission, emission, child: liveChild, claim: reread.record, duplicate, terminal: false };
  }

  /**
   * Resolve a claimTask() race deterministically. A LEASE_ACTIVE loser that
   * is the same logical admission-bound claim recovers to duplicate:true
   * (response-loss / concurrent same-worker replay) with no new ownership
   * event; a valid foreign winner propagates LEASE_ACTIVE; a foreign persisted
   * claim fails closed with CLAIM_ADMISSION_BYPASS_DETECTED; a concurrent
   * terminal delivery recovers to terminal replay when the persisted claim is
   * the exact admission-bound claim.
   */
  #resolveAdmissionBoundClaimWriteRace({
    error,
    sourceTaskId,
    emissionSlot,
    admission,
    emission,
    childId,
    workerId,
    expectedToken,
    leaseDurationMs,
    now,
  }) {
    void leaseDurationMs;
    if (error?.code === CLAIM_ADMISSION_BYPASS_DETECTED || error?.code === 'CORRUPT_CLAIM') throw error;
    if (error?.code !== LEASE_ACTIVE && error?.code !== TASK_TERMINAL) throw error;
    const liveChild = this.readTask(childId);
    const currentFound = this.#readCurrentAdmissionClaim(childId);
    if (currentFound.state === 'missing') throw error;
    const persisted = currentFound.record;
    let expectedPersisted;
    try {
      expectedPersisted = buildAdmissionBoundClaimToken({
        admissionId: admission.admissionId,
        nextTaskId: childId,
        workerId: persisted.workerId,
      });
    } catch {
      storeFail(`foreign claim for admitted child (fail-closed, no auto-adoption): ${childId}`, {
        code: CLAIM_ADMISSION_BYPASS_DETECTED,
        taskId: sourceTaskId,
      });
    }
    if (persisted.claimToken !== expectedPersisted) {
      storeFail(`foreign claim for admitted child (fail-closed, no auto-adoption): ${childId}`, {
        code: CLAIM_ADMISSION_BYPASS_DETECTED,
        taskId: sourceTaskId,
      });
    }
    const isSameLogical = persisted.workerId === workerId && persisted.claimToken === expectedToken;
    if (liveChild.status === TASK_STATUS_RESULT_DELIVERED) {
      return { record: admission, emission, child: liveChild, claim: persisted, duplicate: true, terminal: true };
    }
    if (isSameLogical) {
      if (liveChild.status === TASK_STATUS_READY && this.#isClaimLeaseActive(persisted, now)) {
        const beforeBytes = JSON.stringify(persisted);
        const converged = this.#markClaimed(childId);
        const reread = this.#readCurrentAdmissionClaim(childId);
        if (reread.state !== 'present' || JSON.stringify(reread.record) !== beforeBytes) {
          storeFail(`admission-bound claim changed during status convergence (fail-closed): ${childId}`, {
            code: 'CORRUPT_CLAIM',
            taskId: childId,
          });
        }
        void emissionSlot;
        return { record: admission, emission, child: converged, claim: reread.record, duplicate: true, terminal: false };
      }
      if (liveChild.status === TASK_STATUS_CLAIMED && this.#isClaimLeaseActive(persisted, now)) {
        return { record: admission, emission, child: liveChild, claim: persisted, duplicate: true, terminal: false };
      }
    }
    throw error;
  }

  /**
   * Read the canonical admission-bound claim for a source slot.
   * Pure read: never mutates, never repairs, never rewinds a progressed child.
   * A foreign/manual/random token is never returned as a valid claim: it
   * fails closed with CLAIM_ADMISSION_BYPASS_DETECTED.
   */
  readAdmissionBoundClaim({ sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT } = {}) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    const admission = this.readEmissionAdmission({ sourceTaskId, emissionSlot });
    const emission = this.readEmission(sourceTaskId, emissionSlot);
    const child = this.readTask(admission.nextTaskId);
    let childBinding;
    try {
      childBinding = computeNextTaskSpecBinding(child);
    } catch (error) {
      storeFail(`admission-bound child failed spec read-back (fail-closed): ${admission.nextTaskId}: ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    if (childBinding !== admission.nextTaskSpecBinding || child.taskId !== admission.nextTaskId) {
      storeFail(`admission-bound child spec binding mismatch (fail-closed): ${admission.nextTaskId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    this.#assertSingleAdmissionSequenceMembership(sourceTaskId, admission.nextTaskId);
    const currentFound = this.#readCurrentAdmissionClaim(admission.nextTaskId);
    if (currentFound.state === 'missing') {
      storeFail(`no admission-bound claim for admitted child (fail-closed): ${admission.nextTaskId}`, {
        code: CLAIM_NOT_FOUND,
        taskId: admission.nextTaskId,
      });
    }
    const claim = currentFound.record;
    if (claim.taskId !== admission.nextTaskId) {
      storeFail(`admission-bound claim taskId mismatch (fail-closed): ${admission.nextTaskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId: admission.nextTaskId,
      });
    }
    if (typeof claim.workerId !== 'string' || !claim.workerId.trim()) {
      storeFail(`admission-bound claim workerId missing (fail-closed): ${admission.nextTaskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId: admission.nextTaskId,
      });
    }
    let expected;
    try {
      expected = buildAdmissionBoundClaimToken({
        admissionId: admission.admissionId,
        nextTaskId: admission.nextTaskId,
        workerId: claim.workerId,
      });
    } catch {
      storeFail(`foreign claim for admitted child (fail-closed): ${admission.nextTaskId}`, {
        code: CLAIM_ADMISSION_BYPASS_DETECTED,
        taskId: sourceTaskId,
      });
    }
    if (claim.claimToken !== expected) {
      storeFail(`foreign claim for admitted child (fail-closed, no auto-adoption): ${admission.nextTaskId}`, {
        code: CLAIM_ADMISSION_BYPASS_DETECTED,
        taskId: sourceTaskId,
      });
    }
    if (child.status !== TASK_STATUS_CLAIMED && child.status !== TASK_STATUS_RESULT_DELIVERED) {
      storeFail(
        `admission-bound child is not CLAIMED (task=${admission.nextTaskId} status=${child.status}; converge via claimAdmittedTask first).`,
        { code: TASK_NOT_READY, taskId: admission.nextTaskId },
      );
    }
    if (!Number.isInteger(claim.generation) || claim.generation < 1) {
      storeFail(`admission-bound claim generation invalid (fail-closed): ${admission.nextTaskId}`, {
        code: 'CORRUPT_CLAIM',
        taskId: admission.nextTaskId,
      });
    }
    return { admission, emission, child, claim };
  }

  // -------------------------------------------------------------------------
  // Canonical schedulable-work read domain
  // (GREENHUB-COORDINATION-CANONICAL-SCHEDULABLE-WORK-READ-17A, pure read).
  // readCanonicalSchedulableWork() != emitNextTask() != admitEmittedTask()
  //   != claimAdmittedTask() != scheduleNextTask() != dispatchNextTask()
  //   != decideNextTask(): the caller explicitly supplies
  //   (sourceTaskId, emissionSlot); this primitive never scans READY tasks,
  //   never enumerates tasks/, never orders by filesystem/mtime/timestamps,
  //   never picks oldest/newest, never scores priority/fairness, never
  //   selects or infers workers, never mutates, never repairs, and never
  //   runs a scheduler loop. Every binding is re-verified live against the
  //   durable authority; drift fails closed. Sequence membership is read
  //   as-is (no sync append, no repair): missing/duplicate fails closed.
  // -------------------------------------------------------------------------

  /**
   * Read the canonical schedulable-work projection for one exact
   * (sourceTaskId, emissionSlot) admission binding.
   * Pure read: never mutates, never repairs, never rewinds a progressed
   * child, never recreates READY.
   *
   * - admitted + READY returns the exact canonical projection.
   * - admitted + CLAIMED returns the same canonical identity with CLAIMED.
   * - admitted + RESULT_DELIVERED returns the same identity as terminal.
   * - READY/CLAIMED/RESULT_DELIVERED child without admission authority
   *   fails closed with ADMISSION_BYPASS_DETECTED (never auto-adopted).
   * - emission/admission/child-spec/sequence drift fails closed.
   */
  readCanonicalSchedulableWork({ sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT } = {}) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    // Source task must exist (fail-closed before any further read).
    this.readTask(sourceTaskId);
    // Canonical emission + live CONSUMED closure binding, re-verified live.
    // Missing/ineligible/corrupt/drift propagates fail-closed.
    const emission = this.readEmission(sourceTaskId, emissionSlot);
    // Canonical admission authority, read as-is (no sync, no repair, no
    // converge). Corrupt bytes propagate fail-closed.
    const admissionFound = readValidatedAdmissionDocument(
      admissionFilePath(this.home, sourceTaskId, emissionSlot),
      sourceTaskId,
      emissionSlot,
    );
    if (admissionFound.state === 'missing') {
      // No authority yet: a progressed emission child without authority is a
      // bypass (fail-closed, never auto-adopted). A CREATED-or-absent child
      // is the normal pre-admission state.
      let progressedStatus = null;
      try {
        const emissionChild = this.readTask(emission.nextTaskId);
        progressedStatus = emissionChild.status;
      } catch (error) {
        if (error?.code !== TASK_NOT_FOUND) throw error;
      }
      if (progressedStatus !== null && progressedStatus !== TASK_STATUS_CREATED) {
        storeFail(
          `admission bypass detected: child ${emission.nextTaskId} is ${progressedStatus} without canonical admission authority (fail-closed, no auto-adoption).`,
          { code: ADMISSION_BYPASS_DETECTED, taskId: sourceTaskId },
        );
      }
      storeFail(`no admission for source slot: ${admissionRef(sourceTaskId, emissionSlot)}`, {
        code: ADMISSION_NOT_FOUND,
        taskId: sourceTaskId,
      });
    }
    const admission = admissionFound.record;
    this.#assertAdmissionBindsLiveEmission({ sourceTaskId, emissionSlot, admission, emission });
    // Exact child must exist (never auto-created) and bind exactly.
    const child = this.readTask(admission.nextTaskId);
    if (child.taskId !== admission.nextTaskId) {
      storeFail(`schedulable-work child taskId mismatch (fail-closed): ${admission.nextTaskId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    let childBinding;
    try {
      childBinding = computeNextTaskSpecBinding(child);
    } catch (error) {
      storeFail(`schedulable-work child failed spec read-back (fail-closed): ${admission.nextTaskId}: ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    if (childBinding !== admission.nextTaskSpecBinding || childBinding !== emission.nextTaskSpecBinding) {
      storeFail(`schedulable-work child spec binding mismatch (fail-closed): ${admission.nextTaskId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    // Single append-stable sequence membership, read as-is: no sync append,
    // no repair. Missing/duplicate fails closed.
    const membership = listCanonicalSequenceEntries(this.home).filter(
      (entry) => entry.taskId === admission.nextTaskId,
    );
    if (membership.length !== 1) {
      storeFail(
        `schedulable-work child sequence membership != 1 (fail-closed, no repair): ${admission.nextTaskId} count=${membership.length}`,
        { code: CORRUPT_SEQUENCE, taskId: sourceTaskId },
      );
    }
    return buildSchedulableWorkProjection({
      sourceTaskId,
      emissionSlot,
      emissionId: emission.emissionId,
      admissionId: admission.admissionId,
      nextTaskId: admission.nextTaskId,
      nextTaskSpecBinding: admission.nextTaskSpecBinding,
      sequencePosition: membership[0].sequenceNumber,
      childStatus: child.status,
    });
  }

  // -------------------------------------------------------------------------
  // Runnable-occurrence read domain
  // (GREENHUB-COORDINATION-RUNNABLE-OCCURRENCE-GF03, pure read).
  // readRunnableOccurrence() != claimTask() != claimAdmittedTask()
  //   != admitEmittedTask() != emitNextTask() != scheduleNextTask()
  //   != dispatchNextTask() != decideNextTask(): the caller explicitly supplies
  //   (sourceTaskId, emissionSlot); this primitive never scans tasks or
  //   emissions, never polls a queue, never picks oldest/newest, never selects
  //   or infers workers/executors, never mutates, never repairs, and never runs
  //   a scheduler loop. It derives the ONE runnable occurrence of the exact
  //   canonical admission authority from durable bytes only: no clock, no lease
  //   activity, no pid, no random, and no mtime participates, so the same
  //   logical admission + durable claim state always projects identically in
  //   any process under any clock skew. claimGeneration stays the SOLE fencing
  //   generation; the projection never invents another one and never exposes
  //   the claimToken capability. Exactly one approved admission projects to
  //   exactly one occurrence identity (occ_<sha256> over admissionId,
  //   nextTaskId, nextTaskSpecBinding); replay creates no duplicate occurrence
  //   and no durable byte churn.
  // -------------------------------------------------------------------------

  /**
   * Read the canonical runnable occurrence for one exact (sourceTaskId,
   * emissionSlot) admission binding. Pure read: never mutates, never repairs,
   * never rewinds a progressed child, never creates READY.
   *
   * - admitted + READY without claim authority -> RUNNABLE.
   * - valid admission-bound claim authority -> CLAIMED, including the crash
   *   window where claim.json was published but the child never reached
   *   CLAIMED (the durable claim winner decides, never the status).
   * - RESULT_DELIVERED -> TERMINAL.
   * - admission authority without READY (child CREATED) fails closed with
   *   TASK_NOT_READY (converge via admitEmittedTask first): the occurrence is
   *   not materialized yet and no claim authority may exist.
   * - CLAIMED/RESULT_DELIVERED without claim authority fails closed with
   *   CLAIM_NOT_FOUND (no auto-repair).
   * - foreign/manual/corrupt claim bytes fail closed with the exact existing
   *   claim codes and are never projected or adopted.
   */
  readRunnableOccurrence({ sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT } = {}) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    // Canonical schedulable-work projection: pure read of the exact admission
    // binding (source/emission/admission/child-spec/sequence). Drift fails
    // closed with the existing codes; membership is read as-is (no repair).
    const projection = this.readCanonicalSchedulableWork({ sourceTaskId, emissionSlot });
    // Current durable claim bytes, read as-is (corrupt fails closed, never
    // repaired, never removed).
    const currentFound = this.#readCurrentAdmissionClaim(projection.nextTaskId);
    let claim = null;
    if (currentFound.state === 'present') {
      const persisted = currentFound.record;
      let expected;
      try {
        expected = buildAdmissionBoundClaimToken({
          admissionId: projection.admissionId,
          nextTaskId: projection.nextTaskId,
          workerId: persisted.workerId,
        });
      } catch {
        storeFail(`foreign claim for admitted child (fail-closed, no auto-adoption): ${projection.nextTaskId}`, {
          code: CLAIM_ADMISSION_BYPASS_DETECTED,
          taskId: sourceTaskId,
        });
      }
      if (persisted.claimToken !== expected) {
        storeFail(`foreign claim for admitted child (fail-closed, no auto-adoption): ${projection.nextTaskId}`, {
          code: CLAIM_ADMISSION_BYPASS_DETECTED,
          taskId: sourceTaskId,
        });
      }
      claim = persisted;
    }
    let occurrenceState;
    if (projection.childStatus === TASK_STATUS_CREATED) {
      if (claim !== null) {
        storeFail(`claim authority exists before READY (fail-closed, no auto-repair): ${projection.nextTaskId}`, {
          code: 'CORRUPT_CLAIM',
          taskId: projection.nextTaskId,
        });
      }
      storeFail(
        `admission authority exists but the occurrence is not materialized yet (task=${projection.nextTaskId} status=CREATED; converge via admitEmittedTask first).`,
        { code: TASK_NOT_READY, taskId: projection.nextTaskId },
      );
    } else if (projection.childStatus === TASK_STATUS_READY) {
      occurrenceState =
        claim === null ? RUNNABLE_OCCURRENCE_STATE_RUNNABLE : RUNNABLE_OCCURRENCE_STATE_CLAIMED;
    } else if (projection.childStatus === TASK_STATUS_CLAIMED) {
      if (claim === null) {
        storeFail(`no admission-bound claim for progressed child (fail-closed, no auto-repair): ${projection.nextTaskId}`, {
          code: CLAIM_NOT_FOUND,
          taskId: projection.nextTaskId,
        });
      }
      occurrenceState = RUNNABLE_OCCURRENCE_STATE_CLAIMED;
    } else if (projection.childStatus === TASK_STATUS_RESULT_DELIVERED) {
      if (claim === null) {
        storeFail(`no admission-bound claim for terminal child (fail-closed, no auto-repair): ${projection.nextTaskId}`, {
          code: CLAIM_NOT_FOUND,
          taskId: projection.nextTaskId,
        });
      }
      occurrenceState = RUNNABLE_OCCURRENCE_STATE_TERMINAL;
    } else {
      storeFail(
        `runnable-occurrence child in unexpected status (fail-closed): ${projection.nextTaskId} status=${projection.childStatus}`,
        { code: 'CORRUPT_CLAIM', taskId: projection.nextTaskId },
      );
    }
    return buildRunnableOccurrenceRecord({
      sourceTaskId,
      emissionSlot,
      emissionId: projection.emissionId,
      admissionId: projection.admissionId,
      nextTaskId: projection.nextTaskId,
      nextTaskSpecBinding: projection.nextTaskSpecBinding,
      occurrenceState,
      claim: claim === null ? null : { workerId: claim.workerId, claimGeneration: claim.generation },
    });
  }

  // -------------------------------------------------------------------------
  // Durable dispatch-attempt domain
  // (GREENHUB-COORDINATION-DURABLE-DISPATCH-ATTEMPT-19, persistence ONLY).
  // persistDispatchAttempt() != sendDispatch() != dispatchNextTask()
  //   != scheduleNextTask() != decideNextTask(): the caller explicitly supplies
  //   (sourceTaskId, emissionSlot, workerId); this primitive never READY-scans,
  //   never infers workers, never creates/increments/resets dispatch
  //   generations, never takes over claims, never extends leases, never mutates
  //   task/claim/admission/emission, never transports, never invokes executors,
  //   never ACKs, never sets task status. Ordering is preserved exactly:
  //   1. caller supplies (sourceTaskId, emissionSlot, workerId),
  //   2. live Task 18 envelope read (fail-closed, durable delta 0 on error),
  //   3. deterministic attempt record build (timestamp-free),
  //   4. dispatchId exact-path exclusive-create (OS `wx` family),
  //   5. EEXIST -> read + validate winner (no repair),
  //   6. byte/semantic equivalent -> idempotent replay,
  //   7. different/corrupt binding -> fail-closed (no overwrite, no delete).
  //   Drift/corruption fails closed (no auto-repair, no last-writer-wins).
  // -------------------------------------------------------------------------

  /**
   * Persist the immutable durable dispatch attempt for the CURRENT live
   * claim-bound dispatch envelope. Exclusive-create per dispatchId.
   * Idempotent replay returns the existing record when byte/semantically
   * equivalent. Never mutates claim/task/admission.
   */
  persistDispatchAttempt({ sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT, workerId } = {}) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    if (typeof workerId !== 'string' || !workerId.trim()) {
      storeFail('workerId must be a non-empty string (caller-supplied; never inferred).', {
        code: 'INVALID_WORKER',
        taskId: sourceTaskId,
      });
    }

    // 1. LIVE canonical envelope (Task 18 read; throws fail-closed with zero
    //    durable dispatch delta on wrong worker / unclaimed / terminal /
    //    missing / foreign / corrupt claim).
    const envelope = this.readClaimBoundDispatchEnvelope({ sourceTaskId, emissionSlot, workerId });

    // 2. Deterministic timestamp-free record (provenance + Task 18 binding).
    let candidate;
    try {
      candidate = buildDispatchAttemptRecord({ sourceTaskId, emissionSlot, envelope });
    } catch (error) {
      storeFail(`dispatch attempt build failed (fail-closed): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : CORRUPT_DISPATCH_ATTEMPT,
        taskId: sourceTaskId,
      });
    }

    // 3. Exact-path exclusive-create (never exists()->write()).
    return this.#writeDispatchAttemptCandidate(sourceTaskId, candidate);
  }

  /**
   * Exact-path exclusive-create of one immutable dispatch-attempt record with
   * fail-closed read-back and first-winner race resolution. Shared by the
   * emission-admission-bound and user-approved-intake-bound dispatch attempts.
   */
  #writeDispatchAttemptCandidate(sourceTaskId, candidate) {
    const targetPath = dispatchAttemptFilePath(this.home, sourceTaskId, candidate.dispatchId);
    const created = writeJsonExclusive(targetPath, candidate);
    if (created.created) {
      const reread = readJsonFile(targetPath);
      if (reread.state !== 'present' || JSON.stringify(reread.document) !== JSON.stringify(candidate)) {
        storeFail(`dispatch attempt failed to verify after write (fail-closed): ${sourceTaskId}@${candidate.dispatchId}`, {
          code: CORRUPT_DISPATCH_ATTEMPT,
          taskId: sourceTaskId,
        });
      }
      try {
        validateDispatchAttemptRecord(reread.document);
      } catch (error) {
        storeFail(`persisted dispatch attempt invalid after write (fail-closed): ${error?.message}`, {
          code: CORRUPT_DISPATCH_ATTEMPT,
          taskId: sourceTaskId,
        });
      }
      return candidate;
    }

    // EEXIST: read + validate winner (no repair, no overwrite).
    const winnerFound = readJsonFile(targetPath);
    if (winnerFound.state === 'missing') {
      storeFail(`dispatch attempt race could not be resolved deterministically: ${sourceTaskId}@${candidate.dispatchId}`, {
        code: CORRUPT_DISPATCH_ATTEMPT,
        taskId: sourceTaskId,
      });
    }
    if (winnerFound.state === 'corrupt') {
      storeFail(`dispatch attempt is corrupt (fail-closed, no auto-repair, no overwrite): ${sourceTaskId}@${candidate.dispatchId}`, {
        code: CORRUPT_DISPATCH_ATTEMPT,
        taskId: sourceTaskId,
      });
    }
    let winner;
    try {
      winner = validateDispatchAttemptRecord(winnerFound.document);
    } catch (error) {
      if (error?.code === DISPATCH_BINDING_MISMATCH) {
        storeFail(`existing dispatch attempt binding mismatch (fail-closed, no overwrite): ${sourceTaskId}@${candidate.dispatchId}: ${error?.message}`, {
          code: error.code,
          taskId: sourceTaskId,
        });
      }
      storeFail(`existing dispatch attempt invalid (fail-closed, no auto-repair, no overwrite): ${sourceTaskId}@${candidate.dispatchId}: ${error?.message}`, {
        code: CORRUPT_DISPATCH_ATTEMPT,
        taskId: sourceTaskId,
      });
    }
    if (winner.sourceTaskId !== sourceTaskId || winner.dispatchId !== candidate.dispatchId) {
      storeFail(`dispatch attempt path/record binding mismatch (fail-closed, no overwrite): ${sourceTaskId}@${candidate.dispatchId}`, {
        code: DISPATCH_ATTEMPT_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    if (JSON.stringify(winner) === JSON.stringify(candidate)) {
      return winner;
    }
    storeFail(`dispatch attempt conflict (first wins, no overwrite, no last-writer-wins): ${sourceTaskId}@${candidate.dispatchId}`, {
      code: DISPATCH_ATTEMPT_CONFLICT,
      taskId: sourceTaskId,
    });
    return winner;
  }

  /**
   * Read one durable dispatch attempt by exact (sourceTaskId, dispatchId).
   * Strict validation, path/record identity match, corruption fail-closed,
   * no repair.
   */
  readDispatchAttempt({ sourceTaskId, dispatchId } = {}) {
    assertValidTaskId(sourceTaskId);
    try {
      assertValidDispatchAttemptId(dispatchId);
    } catch (error) {
      storeFail(`dispatch attempt id invalid (fail-closed): ${error?.message}`, {
        code: CORRUPT_DISPATCH_ATTEMPT,
        taskId: sourceTaskId,
      });
    }
    const targetPath = dispatchAttemptFilePath(this.home, sourceTaskId, dispatchId);
    const found = readJsonFile(targetPath);
    if (found.state === 'missing') {
      storeFail(`dispatch attempt not found: ${sourceTaskId}@${dispatchId}`, {
        code: DISPATCH_ATTEMPT_NOT_FOUND,
        taskId: sourceTaskId,
      });
    }
    if (found.state === 'corrupt') {
      storeFail(`dispatch attempt is corrupt (fail-closed, no auto-repair): ${sourceTaskId}@${dispatchId}`, {
        code: CORRUPT_DISPATCH_ATTEMPT,
        taskId: sourceTaskId,
      });
    }
    let record;
    try {
      record = validateDispatchAttemptRecord(found.document);
    } catch (error) {
      if (error?.code === DISPATCH_BINDING_MISMATCH) {
        storeFail(`dispatch attempt binding mismatch (fail-closed): ${sourceTaskId}@${dispatchId}: ${error?.message}`, {
          code: error.code,
          taskId: sourceTaskId,
        });
      }
      storeFail(`dispatch attempt invalid (fail-closed, no auto-repair): ${sourceTaskId}@${dispatchId}: ${error?.message}`, {
        code: CORRUPT_DISPATCH_ATTEMPT,
        taskId: sourceTaskId,
      });
    }
    if (record.sourceTaskId !== sourceTaskId || record.dispatchId !== dispatchId) {
      storeFail(`dispatch attempt path/record binding mismatch (fail-closed): ${sourceTaskId}@${dispatchId}`, {
        code: DISPATCH_ATTEMPT_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }
    return record;
  }

  // -------------------------------------------------------------------------
  // Durable receiver dispatch acceptance domain
  // (GREENHUB-COORDINATION-DURABLE-RECEIVER-ACCEPTANCE-22, dispatchId ONLY).
  // acceptReceiverDispatch() != acknowledgeDispatch() != executeTask():
  // this domain is the durable storage primitive ONLY. The durable value is
  // the EXACT validated Task 20 transport request itself (no wrapper metadata,
  // no timestamps, no ACK, no new generation). LOOKUP KEY = dispatchId ONLY:
  // sourceTaskId / workerId / taskId / admissionId / claim are never lookup
  // keys here. Ordering:
  //   1. dispatchId path resolution (path-safe identity family),
  //   2. existing record -> validated exact request (or missing -> null),
  //   3. corruption / invalid request / key-binding mismatch -> fail closed,
  //   4. create -> OS exclusive-create (never exists()->write()),
  //   5. existing winner -> created:false (caller resolves the race; this
  //      primitive never overwrites, never repairs, never deletes).
  // No task/claim/admission/emission/attempt/result mutation happens here.
  // -------------------------------------------------------------------------

  /**
   * Read one durable receiver acceptance record by dispatchId ONLY.
   * Returns null when no acceptance exists for this dispatchId (unseen), or
   * the EXACT validated frozen Task 20 transport request when present.
   * Corrupt / invalid / wrong-key records fail closed with no auto-repair.
   */
  readReceiverDispatchAcceptance(dispatchId) {
    try {
      assertValidReceiverAcceptanceDispatchId(dispatchId);
    } catch (error) {
      storeFail(`receiver acceptance dispatchId invalid (fail-closed): ${error?.message}`, {
        code: CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
      });
    }
    const targetPath = receiverDispatchAcceptanceFilePath(this.home, dispatchId);
    const found = readJsonFile(targetPath);
    if (found.state === 'missing') return null;
    if (found.state === 'corrupt') {
      storeFail(`receiver acceptance record is corrupt (fail-closed, no auto-repair): ${dispatchId}`, {
        code: CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
      });
    }
    let record;
    try {
      record = validateTransportRequest(found.document);
    } catch (error) {
      storeFail(
        `receiver acceptance record invalid (fail-closed, no auto-repair): ${dispatchId}: ${error?.message}`,
        {
          code:
            typeof error?.code === 'string' && error.code
              ? error.code
              : CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
        },
      );
    }
    if (record.dispatchId !== dispatchId) {
      storeFail(
        `receiver acceptance key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${record.dispatchId}`,
        { code: CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE },
      );
    }
    return record;
  }

  /**
   * Exclusive-create one immutable receiver acceptance record keyed by
   * dispatchId ONLY. The persisted value is the EXACT validated Task 20
   * request with no wrapper metadata. Returns { created: true } when this
   * call won the OS exclusive-create, { created: false } when a record
   * already exists. Never overwrites, never repairs, never deletes:
   * the existing winner is immutable.
   */
  createReceiverDispatchAcceptance(request) {
    let candidate;
    try {
      candidate = validateTransportRequest(request);
    } catch (error) {
      storeFail(`receiver acceptance request invalid (fail-closed): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : CORRUPT_RECEIVER_DISPATCH_ACCEPTANCE,
      });
    }
    const targetPath = receiverDispatchAcceptanceFilePath(this.home, candidate.dispatchId);
    const created = writeJsonExclusive(targetPath, candidate);
    return { created: created.created };
  }

  // -------------------------------------------------------------------------
  // Durable executor invocation attempt domain
  // (GREENHUB-COORDINATION-DURABLE-EXECUTOR-INVOCATION-ATTEMPT-28,
  // dispatchId ONLY).
  // persistExecutorInvocationAttempt() != acknowledgeDispatch() !=
  // executeTask() != invokeExecutor(): this domain is the durable storage
  // primitive ONLY. The durable value is the EXACT canonical Task 27
  // invocation input itself
  // ({ schemaVersion, dispatchId, decision, decisionInput }) derived directly
  // from the durable Task 22 receiver acceptance; the executor
  // invocation attempt fact is expressed by the namespace/path authority
  // <home>/executor-invocation-attempts/<dispatchId>.json ONLY (no wrapper
  // metadata, no timestamps, no ACK/receipt, no executor invocation, no new
  // generation; claimGeneration stays the SOLE fencing generation inside
  // decisionInput). LOOKUP KEY = dispatchId ONLY: sourceTaskId / nextTaskId /
  // taskId / workerId / admissionId / emissionSlot / claimToken /
  // claimGeneration are never lookup keys here. Ordering:
  //   1. dispatchId path resolution (path-safe identity family),
  //   2. existing record -> validated exact record (or missing -> null),
  //   3. corruption / invalid record / key-binding mismatch -> fail closed,
  //   4. create -> OS exclusive-create (never exists()->write()),
  //   5. existing winner -> created:false (caller resolves the race; this
  //      primitive never overwrites, never repairs, never deletes).
  // No task/claim/admission/emission/attempt/receiver-acceptance/result
  // mutation happens here.
  // -------------------------------------------------------------------------

  /**
   * Read one durable executor invocation attempt by dispatchId ONLY.
   * Returns null when no invocation attempt exists for this dispatchId
   * (unseen), or the EXACT validated frozen Task 27 invocation input when
   * present. Corrupt / invalid / wrong-key records fail closed with no
   * auto-repair.
   */
  readExecutorInvocationAttempt(dispatchId) {
    try {
      assertValidExecutorInvocationAttemptDispatchId(dispatchId);
    } catch (error) {
      storeFail(`executor invocation attempt dispatchId invalid (fail-closed): ${error?.message}`, {
        code: CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
      });
    }
    const targetPath = executorInvocationAttemptFilePath(this.home, dispatchId);
    const found = readJsonFile(targetPath);
    if (found.state === 'missing') return null;
    if (found.state === 'corrupt') {
      storeFail(
        `executor invocation attempt record is corrupt (fail-closed, no auto-repair): ${dispatchId}`,
        {
          code: CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
        },
      );
    }
    let record;
    try {
      record = validateExecutorInvocationInputRecord(found.document);
    } catch (error) {
      storeFail(
        `executor invocation attempt record invalid (fail-closed, no auto-repair): ${dispatchId}: ${error?.message}`,
        {
          code:
            typeof error?.code === 'string' && error.code
              ? error.code
              : CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
        },
      );
    }
    if (record.dispatchId !== dispatchId) {
      storeFail(
        `executor invocation attempt key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${record.dispatchId}`,
        { code: CORRUPT_EXECUTOR_INVOCATION_ATTEMPT },
      );
    }
    return record;
  }

  /**
   * Exclusive-create one immutable executor invocation-attempt record keyed by
   * dispatchId ONLY. The persisted value is the EXACT validated Task 27
   * invocation input with no wrapper metadata. Returns { created: true } when
   * this call won the OS exclusive-create, { created: false } when a record
   * already exists. Never overwrites, never repairs, never deletes: the
   * existing winner is immutable.
   */
  createExecutorInvocationAttempt(record) {
    let candidate;
    try {
      candidate = validateExecutorInvocationInputRecord(record);
    } catch (error) {
      storeFail(`executor invocation attempt record invalid (fail-closed): ${error?.message}`, {
        code:
          typeof error?.code === 'string' && error.code
            ? error.code
            : CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
      });
    }
    const targetPath = executorInvocationAttemptFilePath(this.home, candidate.dispatchId);
    const created = writeJsonExclusive(targetPath, candidate);
    return { created: created.created };
  }

  // -------------------------------------------------------------------------
  // Durable executor invocation outcome domain
  // (GREENHUB-COORDINATION-DURABLE-EXECUTOR-INVOCATION-OUTCOME-32,
  // dispatchId ONLY).
  // persistExecutorInvocationOutcome() != executeTask() != invokeExecutor()
  // != invokeExecutorAndValidateOutcome != invokeExecutorInvocationAdapter
  // != persistExecutorInvocationAttempt(): this domain is the durable storage
  // primitive ONLY. The durable value is the EXACT canonical Task 30 validated
  // outcome itself ({ schemaVersion: 1, dispatchId, outcome }); the durable
  // recording fact is expressed by the namespace/path authority
  // <home>/executor-invocation-outcomes/<dispatchId>.json ONLY (no wrapper
  // metadata, no timestamps, no ACK/receipt, no executor invocation, no task
  // status transition, no new generation; claimGeneration stays the SOLE
  // fencing generation). LOOKUP KEY = dispatchId ONLY: sourceTaskId /
  // nextTaskId / taskId / workerId / admissionId / emissionSlot / claimToken /
  // claimGeneration are never lookup keys here. Ordering:
  //   1. dispatchId path resolution (path-safe identity family),
  //   2. existing record -> validated exact record (or missing -> null),
  //   3. corruption / invalid record / key-binding mismatch -> fail closed,
  //   4. create -> OS exclusive-create (never exists()->write()),
  //   5. existing winner -> created:false (caller resolves the race; this
  //      primitive never overwrites, never repairs, never deletes).
  // No task/claim/admission/emission/attempt/receiver-acceptance/
  // executor-invocation-attempt/result mutation
  // happens here.
  // -------------------------------------------------------------------------

  /**
   * Read one durable executor invocation outcome by dispatchId ONLY.
   * Returns null when no outcome exists for this dispatchId (unseen), or the
   * EXACT validated frozen Task 30 outcome record when present. Corrupt /
   * invalid / wrong-key records fail closed with no auto-repair.
   */
  readExecutorInvocationOutcome(dispatchId) {
    try {
      assertValidExecutorInvocationOutcomeDispatchId(dispatchId);
    } catch (error) {
      storeFail(`executor invocation outcome dispatchId invalid (fail-closed): ${error?.message}`, {
        code: CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
      });
    }
    const targetPath = executorInvocationOutcomeFilePath(this.home, dispatchId);
    const found = readJsonFile(targetPath);
    if (found.state === 'missing') return null;
    if (found.state === 'corrupt') {
      storeFail(
        `executor invocation outcome record is corrupt (fail-closed, no auto-repair): ${dispatchId}`,
        {
          code: CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
        },
      );
    }
    let record;
    try {
      record = validateExecutorInvocationOutcomeRecord(found.document);
    } catch (error) {
      storeFail(
        `executor invocation outcome record invalid (fail-closed, no auto-repair): ${dispatchId}: ${error?.message}`,
        {
          code:
            typeof error?.code === 'string' && error.code
              ? error.code
              : CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
        },
      );
    }
    if (record.dispatchId !== dispatchId) {
      storeFail(
        `executor invocation outcome key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${record.dispatchId}`,
        { code: CORRUPT_EXECUTOR_INVOCATION_OUTCOME },
      );
    }
    return record;
  }

  /**
   * Exclusive-create one immutable executor invocation outcome record keyed by
   * dispatchId ONLY. The persisted value is the EXACT canonical Task 30
   * validated outcome with no wrapper metadata. Returns { created: true } when
   * this call won the OS exclusive-create, { created: false } when a record
   * already exists. Never overwrites, never repairs, never deletes: the
   * existing winner is immutable.
   */
  createExecutorInvocationOutcome(record) {
    let candidate;
    try {
      candidate = validateExecutorInvocationOutcomeRecord(record);
    } catch (error) {
      storeFail(`executor invocation outcome record invalid (fail-closed): ${error?.message}`, {
        code:
          typeof error?.code === 'string' && error.code
            ? error.code
            : CORRUPT_EXECUTOR_INVOCATION_OUTCOME,
      });
    }
    const targetPath = executorInvocationOutcomeFilePath(this.home, candidate.dispatchId);
    const created = writeJsonExclusive(targetPath, candidate);
    return { created: created.created };
  }

  // -------------------------------------------------------------------------
  // Durable executor invocation fence domain
  // (GREENHUB-COORDINATION-EXECUTOR-INVOCATION-FENCE / COORD-AUDIT-C03,
  // dispatchId ONLY).
  // invokeExecutorWithInvocationFence() != executeTask() != invokeExecutor()
  // != persistExecutorInvocationOutcome() != persistExecutorResultReceipt():
  // this domain is the durable storage primitive ONLY. The durable value is the
  // EXACT canonical fence record itself ({ schemaVersion: 1, dispatchId }); the
  // pre-invocation fencing fact is expressed by the namespace/path authority
  // <home>/executor-invocation-fences/<dispatchId>.json ONLY (no owner pid, no
  // hostname, no claimToken, no timestamps, no lease, no expiry, no attempt/
  // retry counter, no new generation; claimGeneration stays the SOLE fencing
  // generation). The record is an immutable one-way fact: once published, the
  // executor boundary is treated as possibly crossed for exactly one
  // invocation accounting and is never removed, overwritten, or expired.
  // LOOKUP KEY = dispatchId ONLY: sourceTaskId / nextTaskId / taskId /
  // workerId / admissionId / emissionSlot / claimToken / claimGeneration are
  // never lookup keys here. Ordering:
  //   1. dispatchId path resolution (path-safe identity family),
  //   2. existing record -> validated exact record (or missing -> null),
  //   3. corruption / invalid record / key-binding mismatch -> fail closed,
  //   4. create -> OS exclusive-create (never exists()->write()),
  //   5. existing winner -> created:false (caller resolves the race; this
  //      primitive never overwrites, never repairs, never deletes).
  // No task/claim/admission/emission/attempt/receiver-acceptance/
  // executor-invocation-attempt/executor-invocation-outcome/result mutation happens here.
  // -------------------------------------------------------------------------

  /**
   * Read one durable executor invocation fence by dispatchId ONLY.
   * Returns null when no fence exists for this dispatchId (unseen), or the
   * EXACT validated frozen fence record when present. Corrupt / invalid /
   * wrong-key records fail closed with no auto-repair.
   */
  readExecutorInvocationFence(dispatchId) {
    try {
      assertValidExecutorInvocationFenceDispatchId(dispatchId);
    } catch (error) {
      storeFail(`executor invocation fence dispatchId invalid (fail-closed): ${error?.message}`, {
        code: CORRUPT_EXECUTOR_INVOCATION_FENCE,
      });
    }
    const targetPath = executorInvocationFenceFilePath(this.home, dispatchId);
    const found = readJsonFile(targetPath);
    if (found.state === 'missing') return null;
    if (found.state === 'corrupt') {
      storeFail(
        `executor invocation fence record is corrupt (fail-closed, no auto-repair): ${dispatchId}`,
        { code: CORRUPT_EXECUTOR_INVOCATION_FENCE },
      );
    }
    let record;
    try {
      record = validateExecutorInvocationFenceRecord(found.document);
    } catch (error) {
      storeFail(
        `executor invocation fence record invalid (fail-closed, no auto-repair): ${dispatchId}: ${error?.message}`,
        {
          code:
            typeof error?.code === 'string' && error.code
              ? error.code
              : CORRUPT_EXECUTOR_INVOCATION_FENCE,
        },
      );
    }
    if (record.dispatchId !== dispatchId) {
      storeFail(
        `executor invocation fence key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${record.dispatchId}`,
        { code: CORRUPT_EXECUTOR_INVOCATION_FENCE },
      );
    }
    return record;
  }

  /**
   * Exclusive-create one immutable executor invocation fence keyed by
   * dispatchId ONLY. The persisted value is the EXACT canonical fence record
   * with no wrapper metadata. Returns { created: true } when this call won the
   * OS exclusive-create, { created: false } when a fence already exists. Never
   * overwrites, never repairs, never deletes: the existing winner is
   * immutable, has no lease, and never expires.
   */
  createExecutorInvocationFence(record) {
    let candidate;
    try {
      candidate = validateExecutorInvocationFenceRecord(record);
    } catch (error) {
      storeFail(`executor invocation fence record invalid (fail-closed): ${error?.message}`, {
        code:
          typeof error?.code === 'string' && error.code
            ? error.code
            : CORRUPT_EXECUTOR_INVOCATION_FENCE,
      });
    }
    const targetPath = executorInvocationFenceFilePath(this.home, candidate.dispatchId);
    const created = writeJsonExclusive(targetPath, candidate);
    return { created: created.created };
  }

  // -------------------------------------------------------------------------
  // Durable executor result receipt domain
  // (GREENHUB-COORDINATION-DURABLE-EXECUTOR-RESULT-RECEIPT-33, dispatchId
  // ONLY).
  // persistExecutorResultReceipt() != executeTask() != invokeExecutor()
  // != canonical result delivery != persistExecutorInvocationOutcome(): this
  // domain is the durable storage primitive ONLY. The durable value is the
  // EXACT validated structured executor evidence itself ({ schemaVersion: 1,
  // dispatchId, taskId, status, summary, proofRefs, evidenceRefs,
  // frictionObserved }); the durable-recording fact is expressed by the
  // namespace/path authority <home>/executor-result-receipts/<dispatchId>.json
  // ONLY (no wrapper metadata, no timestamps, no canonical result, no ACK, no
  // disposition, no executor invocation, no task status transition, no new
  // generation; claimGeneration stays the SOLE fencing generation). LOOKUP KEY
  // = dispatchId ONLY: taskId / sourceTaskId / nextTaskId / workerId /
  // admissionId / emissionSlot / claimToken / claimGeneration are never lookup
  // keys here. Ordering:
  //   1. dispatchId path resolution (path-safe identity family),
  //   2. existing record -> validated exact record (or missing -> null),
  //   3. corruption / invalid record / key-binding mismatch -> fail closed,
  //   4. create -> OS exclusive-create (never exists()->write()),
  //   5. existing winner -> created:false (caller resolves the race; this
  //      primitive never overwrites, never repairs, never deletes).
  // No task/claim/admission/emission/attempt/receiver-acceptance/
  // executor-invocation-attempt/executor-invocation-outcome/result/
  // disposition mutation happens here.
  // -------------------------------------------------------------------------

  /**
   * Read one durable executor result receipt by dispatchId ONLY.
   * Returns null when no receipt exists for this dispatchId (unseen), or the
   * EXACT validated frozen receipt record when present. Corrupt / invalid /
   * wrong-key records fail closed with no auto-repair.
   */
  readExecutorResultReceipt(dispatchId) {
    try {
      assertValidExecutorResultReceiptDispatchId(dispatchId);
    } catch (error) {
      storeFail(`executor result receipt dispatchId invalid (fail-closed): ${error?.message}`, {
        code: CORRUPT_EXECUTOR_RESULT_RECEIPT,
      });
    }
    const targetPath = executorResultReceiptFilePath(this.home, dispatchId);
    const found = readJsonFile(targetPath);
    if (found.state === 'missing') return null;
    if (found.state === 'corrupt') {
      storeFail(`executor result receipt record is corrupt (fail-closed, no auto-repair): ${dispatchId}`, {
        code: CORRUPT_EXECUTOR_RESULT_RECEIPT,
      });
    }
    let record;
    try {
      record = validateExecutorResultReceiptRecord(found.document);
    } catch (error) {
      storeFail(
        `executor result receipt record invalid (fail-closed, no auto-repair): ${dispatchId}: ${error?.message}`,
        {
          code:
            typeof error?.code === 'string' && error.code
              ? error.code
              : CORRUPT_EXECUTOR_RESULT_RECEIPT,
        },
      );
    }
    if (record.dispatchId !== dispatchId) {
      storeFail(
        `executor result receipt key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${record.dispatchId}`,
        { code: CORRUPT_EXECUTOR_RESULT_RECEIPT },
      );
    }
    return record;
  }

  /**
   * Exclusive-create one immutable executor result receipt keyed by dispatchId
   * ONLY. The persisted value is the EXACT validated structured executor
   * evidence with no wrapper metadata. Returns { created: true } when this
   * call won the OS exclusive-create, { created: false } when a record already
   * exists. Never overwrites, never repairs, never deletes: the existing
   * winner is immutable.
   */
  createExecutorResultReceipt(record) {
    let candidate;
    try {
      candidate = validateExecutorResultReceiptRecord(record);
    } catch (error) {
      storeFail(`executor result receipt record invalid (fail-closed): ${error?.message}`, {
        code:
          typeof error?.code === 'string' && error.code
            ? error.code
            : CORRUPT_EXECUTOR_RESULT_RECEIPT,
      });
    }
    const targetPath = executorResultReceiptFilePath(this.home, candidate.dispatchId);
    const created = writeJsonExclusive(targetPath, candidate);
    return { created: created.created };
  }

  // -------------------------------------------------------------------------
  // Claim-bound dispatch envelope domain
  // (GREENHUB-COORDINATION-CLAIM-BOUND-DISPATCH-ENVELOPE-18, pure read).
  // readClaimBoundDispatchEnvelope() != emitNextTask() != admitEmittedTask()
  //   != claimAdmittedTask() != scheduleNextTask() != dispatchNextTask()
  //   != decideNextTask(): the caller explicitly supplies
  //   (sourceTaskId, emissionSlot, workerId); this primitive never creates,
  //   increments, resets, or repairs generations, never takes over claims,
  //   never extends leases, never READY->CLAIMED, never scans READY, never
  //   selects workers, never persists dispatch attempts, never transports,
  //   and never invokes executors. Ordering is preserved exactly:
  //   1. canonical schedulable-work identity live read,
  //   2. canonical admission identity confirm,
  //   3. child nextTaskId confirm,
  //   4. current claim.json read,
  //   5. claim.workerId exact match,
  //   6. current claim generation confirm,
  //   7. admission-bound claimToken recompute,
  //   8. persisted claimToken exact match,
  //   9. child status CLAIMED confirm,
  //   10. current-generation dispatch envelope build.
  //   Drift/corruption fails closed (no auto-repair, no auto-claim, no
  //   rewind of RESULT_DELIVERED).
  // -------------------------------------------------------------------------

  /**
   * Read the claim-bound dispatch envelope for one exact
   * (sourceTaskId, emissionSlot) admission binding + one caller worker.
   * Pure read + builder consumption: never mutates, never repairs, never
   * rewinds a progressed child, never recreates READY, never auto-claims.
   *
   * - CLAIMED child + exact current claim -> current-generation envelope.
   * - READY/CREATED child -> TASK_NOT_CLAIMED (no automatic claim).
   * - RESULT_DELIVERED child -> TASK_TERMINAL (no new envelope, no rewind).
   * - missing claim -> CLAIM_NOT_FOUND; corrupt -> CORRUPT_CLAIM.
   * - foreign/manual/random token -> CLAIM_ADMISSION_BYPASS_DETECTED.
   * - caller worker != current claim worker -> DISPATCH_BINDING_MISMATCH.
   */
  readClaimBoundDispatchEnvelope({ sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT, workerId } = {}) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    if (typeof workerId !== 'string' || !workerId.trim()) {
      storeFail('workerId must be a non-empty string (caller-supplied; never inferred).', {
        code: 'INVALID_WORKER',
        taskId: sourceTaskId,
      });
    }

    // 1. Canonical schedulable-work identity, re-verified live (emission +
    //    admission + child spec + sequence bindings inside).
    const schedulable = this.readCanonicalSchedulableWork({ sourceTaskId, emissionSlot });

    // 2. Canonical admission identity confirm: exact live admission must
    //    carry the same admission identity as the schedulable projection.
    const admission = this.readEmissionAdmission({ sourceTaskId, emissionSlot });
    if (admission.admissionId !== schedulable.admissionId || admission.nextTaskId !== schedulable.nextTaskId) {
      storeFail(`dispatch admission identity drift vs schedulable projection (fail-closed): ${admissionRef(sourceTaskId, emissionSlot)}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }

    // 3. Child nextTaskId confirm: exact child must exist (never auto-created).
    const childId = admission.nextTaskId;
    const child = this.readTask(childId);
    if (child.taskId !== childId || child.taskId !== schedulable.nextTaskId) {
      storeFail(`dispatch child taskId mismatch (fail-closed): ${childId}`, {
        code: ADMISSION_BINDING_MISMATCH,
        taskId: sourceTaskId,
      });
    }

    // 4. Current claim.json read (no auto-repair, no auto-create).
    const currentFound = this.#readCurrentAdmissionClaim(childId);
    if (currentFound.state === 'missing') {
      storeFail(`no claim for dispatch-bound child (fail-closed, claim first): ${childId}`, {
        code: CLAIM_NOT_FOUND,
        taskId: childId,
      });
    }
    const claim = currentFound.record;

    // 5. claim.workerId exact match (no inference, no selection).
    if (claim.workerId !== workerId) {
      storeFail(
        `dispatch worker binding mismatch (fail-closed, no claim mutation): live owner=${claim.workerId} caller=${workerId}.`,
        { code: DISPATCH_BINDING_MISMATCH, taskId: childId },
      );
    }

    // 6. Current claim generation confirm (SOLE fencing authority).
    if (!Number.isInteger(claim.generation) || claim.generation < 1) {
      storeFail(`dispatch claim generation invalid (fail-closed): ${childId}`, {
        code: 'CORRUPT_CLAIM',
        taskId: childId,
      });
    }

    // 7-8. Admission-bound claimToken recompute + persisted exact match.
    let expectedToken;
    try {
      expectedToken = buildAdmissionBoundClaimToken({
        admissionId: admission.admissionId,
        nextTaskId: childId,
        workerId: claim.workerId,
      });
    } catch {
      storeFail(`dispatch child carries a foreign claim (fail-closed, no auto-adoption): ${childId}`, {
        code: CLAIM_ADMISSION_BYPASS_DETECTED,
        taskId: sourceTaskId,
      });
    }
    if (claim.claimToken !== expectedToken) {
      storeFail(`dispatch child carries a foreign claim (fail-closed, no auto-adoption): ${childId}`, {
        code: CLAIM_ADMISSION_BYPASS_DETECTED,
        taskId: sourceTaskId,
      });
    }

    // 9. Child status must be exactly CLAIMED. READY/CREATED never auto-claim;
    //    RESULT_DELIVERED never rewinds into a new envelope.
    if (child.status === TASK_STATUS_RESULT_DELIVERED) {
      storeFail(`dispatch child is terminal (RESULT_DELIVERED); no new dispatch envelope: ${childId}`, {
        code: TASK_TERMINAL,
        taskId: childId,
      });
    }
    if (child.status !== TASK_STATUS_CLAIMED) {
      storeFail(
        `dispatch child is not CLAIMED (task=${childId} status=${child.status}; converge via claimAdmittedTask first, never auto-claim here).`,
        { code: TASK_NOT_CLAIMED, taskId: childId },
      );
    }

    // 10. Current-generation dispatch envelope build (pure builder).
    try {
      return buildClaimBoundDispatchEnvelope({
        admissionId: admission.admissionId,
        nextTaskId: childId,
        workerId: claim.workerId,
        claimGeneration: claim.generation,
      });
    } catch (error) {
      storeFail(`dispatch envelope build failed (fail-closed): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : INVALID_DISPATCH_BINDING,
        taskId: childId,
      });
    }
    return null;
  }

  /**
   * Verify a supplied dispatch envelope against the current live binding.
   * Pure read + recomputation: never mutates, never repairs.
   * - malformed/tampered envelope -> INVALID_DISPATCH_BINDING /
   *   DISPATCH_BINDING_MISMATCH (pure recomputation gate first).
   * - admission/task/worker drift vs live -> DISPATCH_BINDING_MISMATCH.
   * - same bindings but generation/dispatchId behind live ->
   *   STALE_DISPATCH (replayed envelope fenced by current generation).
   * - live READY/CREATED -> TASK_NOT_CLAIMED; live terminal ->
   *   TASK_TERMINAL; missing/foreign claim propagates unchanged.
   * Returns the current live envelope when the supplied envelope is current.
   */
  verifyClaimBoundDispatchEnvelope({ sourceTaskId, emissionSlot = DEFAULT_EMISSION_SLOT, envelope } = {}) {
    assertValidTaskId(sourceTaskId);
    assertValidEmissionSlot(emissionSlot);
    let supplied;
    try {
      supplied = validateClaimBoundDispatchEnvelope(envelope);
    } catch (error) {
      storeFail(`supplied dispatch envelope invalid (fail-closed): ${error?.message}`, {
        code: typeof error?.code === 'string' && error.code ? error.code : INVALID_DISPATCH_BINDING,
        taskId: sourceTaskId,
      });
    }
    const current = this.readClaimBoundDispatchEnvelope({
      sourceTaskId,
      emissionSlot,
      workerId: supplied.workerId,
    });
    if (supplied.admissionId !== current.admissionId || supplied.nextTaskId !== current.nextTaskId) {
      storeFail(
        `supplied dispatch envelope binds a different admission/task than live (fail-closed): supplied admission=${supplied.admissionId} task=${supplied.nextTaskId} live admission=${current.admissionId} task=${current.nextTaskId}.`,
        { code: DISPATCH_BINDING_MISMATCH, taskId: sourceTaskId },
      );
    }
    if (supplied.workerId !== current.workerId) {
      storeFail(
        `supplied dispatch envelope binds a different worker than live (fail-closed): supplied=${supplied.workerId} live=${current.workerId}.`,
        { code: DISPATCH_BINDING_MISMATCH, taskId: sourceTaskId },
      );
    }
    if (supplied.claimGeneration !== current.claimGeneration || supplied.dispatchId !== current.dispatchId) {
      storeFail(
        `stale dispatch envelope: supplied generation=${supplied.claimGeneration} dispatchId=${supplied.dispatchId} vs current generation=${current.claimGeneration} dispatchId=${current.dispatchId} (fail-closed, no rewind).`,
        { code: STALE_DISPATCH, taskId: sourceTaskId },
      );
    }
    return current;
  }
}
