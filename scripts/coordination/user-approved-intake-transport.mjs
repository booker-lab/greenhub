// Bounded read+composition owner:
// GREENHUB-COORDINATION-USER-APPROVED-READONLY-INTAKE-GF06 (transport bridge).
// Surface: scripts/coordination/*user-approved-intake-transport* (this module)
// + composition of EXISTING public store primitives ONLY
// (readDispatchAttempt / verifyUserApprovedIntakeClaimBoundDispatchEnvelope /
// readTask) and the EXISTING frozen Task 19/20 validators. The frozen
// predecessor modules (dispatch-transport-contract.mjs, dispatch-attempt.mjs,
// claim-bound-dispatch-envelope.mjs) are imported verbatim and never modified.
//
// Contract summary:
//   prepareUserApprovedIntakeDispatchTransportRequest() is the user-approved
//   intake twin of the Task 20 transport preparation. It uses the SAME
//   deterministic immutable request shape and the SAME frozen validators, but
//   revalidates the live claim binding against the user-approved intake
//   authority instead of an emission admission. The generic authority binding
//   slot carries the canonical intake authority id; the two authority sources
//   are never merged and this module never creates either authority.
//
// Explicitly OUT OF SCOPE: concrete transport adapters, OpenCode invocation,
// scheduler, READY scan, queue polling, daemon, cron, worker selection, retry,
// backoff, ACK persistence, task/claim/admission/emission mutation.

import {
  TASK_ID_PATTERN,
  TASK_STATUS_CLAIMED,
  TASK_STATUS_RESULT_DELIVERED,
  validateTaskEnvelope,
} from './task-envelope.mjs';
import {
  DISPATCH_ATTEMPT_ID_PATTERN,
  envelopeFromDispatchAttemptRecord,
  validateDispatchAttemptRecord,
} from './dispatch-attempt.mjs';
import {
  DispatchTransportValidationError,
  CORRUPT_TRANSPORT_REQUEST,
  TRANSPORT_REQUEST_SCHEMA_VERSION,
  validateTransportRequest,
} from './dispatch-transport-contract.mjs';
import { validateClaimBoundDispatchEnvelope } from './claim-bound-dispatch-envelope.mjs';
import { USER_APPROVED_INTAKE_DISPATCH_SLOT } from './user-approved-intake.mjs';

function fail(message, code = CORRUPT_TRANSPORT_REQUEST) {
  throw new DispatchTransportValidationError(message, { code });
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(
      `taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`,
      CORRUPT_TRANSPORT_REQUEST,
    );
  }
}

function assertValidDispatchIdValue(dispatchId) {
  if (typeof dispatchId !== 'string' || !DISPATCH_ATTEMPT_ID_PATTERN.test(dispatchId)) {
    fail('dispatchId must be `dsp_<64 lowercase hex>` (Task 19 dispatch identity family).', CORRUPT_TRANSPORT_REQUEST);
  }
}

/**
 * Prepare the deterministic immutable transport request for one EXISTING
 * durable intake-bound dispatch attempt. The ONLY intake transport entry point.
 *
 * Required order (fail-closed, zero adapter involvement):
 * 1. store.readDispatchAttempt({ sourceTaskId: taskId, dispatchId })
 * 2. strict Task 19 record validation + intake provenance slot check
 * 3. envelopeFromDispatchAttemptRecord(record)
 * 4. store.verifyUserApprovedIntakeClaimBoundDispatchEnvelope({ taskId, envelope })
 * 5. CURRENT live envelope exact binding re-check against the durable record
 * 6. store.readTask(record.nextTaskId) + exact taskId binding
 * 7. child CLAIMED gate (RESULT_DELIVERED -> TASK_TERMINAL;
 *    READY/CREATED/other -> TASK_NOT_CLAIMED)
 * 8. deterministic frozen request build + the frozen Task 20 validation.
 *
 * Existing store error codes propagate UNCHANGED (never remapped).
 */
export function prepareUserApprovedIntakeDispatchTransportRequest({ store, taskId, dispatchId } = {}) {
  assertValidTaskId(taskId);
  assertValidDispatchIdValue(dispatchId);
  if (
    !store ||
    typeof store.readDispatchAttempt !== 'function' ||
    typeof store.verifyUserApprovedIntakeClaimBoundDispatchEnvelope !== 'function' ||
    typeof store.readTask !== 'function'
  ) {
    fail(
      'intake transport preparation requires a store exposing readDispatchAttempt / verifyUserApprovedIntakeClaimBoundDispatchEnvelope / readTask (composition only).',
      CORRUPT_TRANSPORT_REQUEST,
    );
  }

  // 1. EXISTING durable attempt is mandatory: the only entry point.
  const record = store.readDispatchAttempt({ sourceTaskId: taskId, dispatchId });

  // 2. Strict Task 19 validation (fail-closed, no repair).
  const validatedRecord = validateDispatchAttemptRecord(record);
  if (validatedRecord.sourceTaskId !== taskId || validatedRecord.dispatchId !== dispatchId) {
    fail(
      `intake transport preparation path/record binding mismatch (fail-closed): ${taskId}@${dispatchId}.`,
      'DISPATCH_ATTEMPT_BINDING_MISMATCH',
    );
  }
  if (validatedRecord.emissionSlot !== USER_APPROVED_INTAKE_DISPATCH_SLOT) {
    fail(
      `intake transport preparation requires the intake provenance slot ${JSON.stringify(USER_APPROVED_INTAKE_DISPATCH_SLOT)} (got ${JSON.stringify(validatedRecord.emissionSlot)}).`,
      'DISPATCH_ATTEMPT_BINDING_MISMATCH',
    );
  }

  // 3. Task 19 envelope restore + Task 18 shape validation (pure, no I/O).
  const envelope = envelopeFromDispatchAttemptRecord(validatedRecord);
  validateClaimBoundDispatchEnvelope(envelope);

  // 4. CURRENT live envelope revalidation against the intake authority.
  const live = store.verifyUserApprovedIntakeClaimBoundDispatchEnvelope({ taskId, envelope });

  // 5. Exact durable-vs-live binding re-check (defense in depth).
  if (
    live.dispatchId !== validatedRecord.dispatchId ||
    live.admissionId !== validatedRecord.admissionId ||
    live.nextTaskId !== validatedRecord.nextTaskId ||
    live.workerId !== validatedRecord.workerId ||
    live.claimGeneration !== validatedRecord.claimGeneration
  ) {
    fail(
      'intake transport preparation live binding drift vs durable attempt (fail-closed): CURRENT live envelope differs from the durable record.',
      'DISPATCH_BINDING_MISMATCH',
    );
  }

  // 6. Exact child Task Envelope read.
  const child = store.readTask(validatedRecord.nextTaskId);
  if (child.taskId !== validatedRecord.nextTaskId) {
    fail(
      `intake transport preparation task binding mismatch (fail-closed): attempt nextTaskId=${validatedRecord.nextTaskId} read taskId=${child.taskId}.`,
      'DISPATCH_ATTEMPT_BINDING_MISMATCH',
    );
  }

  // 7. Child CLAIMED gate. Existing claim lifecycle meanings are reused.
  if (child.status === TASK_STATUS_RESULT_DELIVERED) {
    fail(`intake transport preparation child is terminal (RESULT_DELIVERED); no transport: ${child.taskId}.`, 'TASK_TERMINAL');
  }
  if (child.status !== TASK_STATUS_CLAIMED) {
    fail(
      `intake transport preparation child is not CLAIMED (task=${child.taskId} status=${child.status}; never transport READY/CREATED).`,
      'TASK_NOT_CLAIMED',
    );
  }

  // 8. Deterministic immutable request: fixed key order, frozen, timestamp-free.
  const validatedChild = validateTaskEnvelope(child);
  const request = {
    schemaVersion: TRANSPORT_REQUEST_SCHEMA_VERSION,
    dispatchId: validatedRecord.dispatchId,
    sourceTaskId: validatedRecord.sourceTaskId,
    emissionSlot: validatedRecord.emissionSlot,
    admissionId: validatedRecord.admissionId,
    nextTaskId: validatedRecord.nextTaskId,
    workerId: validatedRecord.workerId,
    claimGeneration: validatedRecord.claimGeneration,
    task: validatedChild,
  };
  return validateTransportRequest(request);
}
