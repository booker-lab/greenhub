// Bounded canonical-result-delivery composition owner:
// GREENHUB-COORDINATION-CANONICAL-RESULT-DELIVERY-FROM-RECEIPT-34.
// Surface: scripts/coordination/*executor-result-delivery* (this module) ONLY.
// No store.mjs mutation, no new durable artifact, no new durable directory, and
// no new JSON domain: this module composes EXISTING canonical authorities.
//
// State transition added here:
//   DURABLY_RECORDED_EXECUTOR_RESULT_RECEIPT(dispatchId)   [Task 33]
//     -> RESULT_DELIVERED(taskId)                          [this Task]
//
// Contract summary:
//   deliverExecutorResultReceipt() != executeTask() != invokeExecutor()
//     != persistExecutorResultReceipt() != persistExecutorInvocationOutcome()
//     != invokeExecutorInvocationAdapter() != acknowledgeDispatch()
//     != acceptExecutorDispatchDecision() != beginDisposition().
//   RESULT_DELIVERED != ADOPTED != ACK != disposition != materialization
//     != consumption cursor advancement != successor permission
//     != task succeeded proof != mutation proof
//     != global exactly-once executor invocation.
//   Entry is EXACTLY one path:
//     (dispatchId, store)
//       1. store capability gate [readExecutorResultReceipt /
//          readExecutorInvocationAttempt / readTask / readResult /
//          deliverResult ONLY; no other capability is required, consulted,
//          or read]
//       2. dispatchId identity validation [Task 33 executor-result-receipt
//          identity family verbatim; invalid identity fails closed before any
//          durable read]
//       3. store.readExecutorResultReceipt(dispatchId) [durable-first:
//          dispatchId is the ONLY lookup key; missing receipt fails closed
//          WITHOUT fabricating one and WITHOUT re-invoking any executor]
//       4. Task 33 receipt exact validation via
//          validateExecutorResultReceiptRecord VERBATIM
//       5. store.readExecutorInvocationAttempt(dispatchId) [durable Task 28
//          dispatch/claim authority; missing fails closed] + Task 24
//          validateReceiverDecisionRecord VERBATIM
//       6. receipt.taskId exact binding against the durable dispatch
//          authority's nextTaskId [fail-closed binding mismatch]
//       7. current task lifecycle read: CLAIMED -> deliver; RESULT_DELIVERED
//          -> read-only canonical convergence; anything else -> fail closed
//       8. exact canonical Result envelope construction from the SIX
//          executor-authored receipt fields ONLY (taskId, status, summary,
//          proofRefs, evidenceRefs, frictionObserved; status is passed
//          through VERBATIM, never recomputed from exit code or invocation
//          outcome; usage is never fabricated) plus coordination-owned
//          authority values ONLY (workerId / claimGeneration from the durable
//          Task 28 record, claimToken from the existing admission-bound claim
//          token authority, resultId from the deterministic dispatch-bound
//          one-to-one rule, deliveredAt from the existing store.deliverResult
//          clock authority)
//       9. store.deliverResult(envelope) [EXISTING canonical Result authority
//          VERBATIM: current live claim/fencing verification, duplicate and
//          terminal first-wins semantics, exclusive-create, task transition]
//      10. exact canonical read-back via store.readResult(taskId) and
//          authored-field convergence/conflict verification
//      11. task.status == RESULT_DELIVERED confirmation
//      12. durable receipt re-read: the Task 33 receipt bytes stay the
//          authoritative immutable executor evidence and must be unchanged
//   Replay / idempotency: an identical canonical Result for the same
//   dispatchId is an idempotent convergence (newlyDelivered false,
//   exactReplay true) with zero executor invocations, zero receipt writes,
//   zero receipt byte changes, zero new canonical results, zero claim
//   generation changes, and zero duplicate task transitions. An already
//   delivered DIFFERENT canonical Result fails closed
//   (EXECUTOR_RESULT_DELIVERY_CONFLICT) and the first canonical result is
//   preserved: never overwrite, never merge, never repair-by-delete, never
//   last-writer-wins.
//   Fail-closed cases (canonical Result is NEVER created, the executor is
//   NEVER re-invoked, no receipt is fabricated, no claim is auto-reacquired,
//   and no retry is scheduled): receipt missing, receipt corrupt, receipt
//   schema invalid, dispatchId binding mismatch, taskId binding mismatch,
//   durable dispatch authority missing/corrupt, authoritative claim missing,
//   claim token mismatch, stale claimGeneration, wrong worker binding,
//   deterministic result identity conflict, task lifecycle that does not
//   allow delivery, and the Task 32-outcome-without-Task-33-receipt state
//   (receipt remains the ONLY delivery input; the Task 32 outcome is never
//   converted into a delivery).
//
// Authority split (never mixed, never re-authored):
//   A. Executor-authored evidence: taskId, status, summary, proofRefs,
//      evidenceRefs, frictionObserved — taken from the immutable Task 33
//      receipt ONLY, never reinterpreted, never corrected, never extended.
//   B. Coordination-owned canonical authority: workerId, claimGeneration
//      (SOLE fencing generation), claimToken (existing admission-bound claim
//      token authority), canonical result identity, delivery timing — taken
//      from existing durable coordination state ONLY. The executor receipt
//      never authors any of these, and the entry accepts NO executor object,
//      NO stdout/stderr, NO process exit code, and NO worker-provided claim
//      fields.
//   resultId deterministic one-to-one rule: `result_<dispatchId>` — a stable
//   composition of the existing durable Task 19 dispatch identity ONLY. No
//   random UUID, no wall clock, no PID, no hostname, and no process-local
//   counter is ever result identity authority: the same dispatchId always
//   converges on the same canonical result identity.
//
// Concurrency boundary (never overclaimed): store.deliverResult remains the
// SOLE canonical Result writer and the SOLE live claim/fencing authority.
// This module adds no new lock, no new lease, no new generation, and no new
// exactly-once claim. Concurrent deliveries for the same dispatchId converge
// through the existing deliverResult duplicate/terminal semantics; a
// divergent canonical result fails closed instead of winning.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   Codex process invocation, executor retry, pre-invocation lock, executor
//   lease, global exactly-once process execution, mutation-capable executor,
//   repository mutation by executor, RUNNING task status, new task status,
//   ACK protocol, sender acknowledgment, receiver acknowledgment, disposition
//   decision, result adoption/rejection, materialization, consumption cursor
//   advancement, scheduler, READY scan, polling, daemon, successor task
//   creation, new fencing generation, production deployment.

import { buildAdmissionBoundClaimToken } from './admission-bound-claim.mjs';
import {
  CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
} from './dispatch-executor-invocation-attempt.mjs';
import { validateReceiverDecisionRecord } from './dispatch-receiver-decision.mjs';
import {
  CORRUPT_EXECUTOR_RESULT_RECEIPT,
  assertValidExecutorResultReceiptDispatchId,
  validateExecutorResultReceiptRecord,
} from './executor-result-receipt.mjs';
import {
  RESULT_SCHEMA_VERSION,
  TASK_STATUS_CLAIMED,
  TASK_STATUS_RESULT_DELIVERED,
} from './task-envelope.mjs';

// The deterministic canonical result identity prefix. The result id is
// `result_<dispatchId>`: a stable one-to-one composition of the existing
// durable Task 19 dispatch identity ONLY (no random / clock / pid / hostname /
// process-local counter ever participates).
export const EXECUTOR_RESULT_DELIVERY_RESULT_ID_PREFIX = 'result_';

// Minimal immutable result shapes. newlyDelivered / exactReplay are
// delivery-local outcomes only, never durable state and never a new task
// lifecycle status. result is the exact canonical delivered/enveloped Result
// read back from the existing authority.
export const EXECUTOR_RESULT_DELIVERY_NEW_FIELDS = Object.freeze([
  'dispatchId',
  'taskId',
  'resultId',
  'newlyDelivered',
  'result',
]);
export const EXECUTOR_RESULT_DELIVERY_REPLAY_FIELDS = Object.freeze([
  'dispatchId',
  'taskId',
  'resultId',
  'newlyDelivered',
  'exactReplay',
  'result',
]);

// The authored canonical Result fields this layer composes and verifies for
// convergence. deliveredAt is intentionally excluded: delivery timing is
// owned by the existing store.deliverResult clock authority, and replay must
// converge without rewriting it. usage is never authored here (a Task 33
// receipt carries no usage and a missing usage is never fabricated).
export const EXECUTOR_RESULT_DELIVERY_AUTHORED_RESULT_FIELDS = Object.freeze([
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

// Delivery-native meanings ONLY. Missing Task 33 receipt, missing durable Task
// 28 dispatch authority, receipt/task binding mismatch, non-deliverable task
// lifecycle, and already-delivered canonical result conflict get explicit
// delivery codes; corrupt/invalid predecessor records and live claim/fencing
// failures reuse the existing Task 33 / 28 / 24 / store codes propagated
// UNCHANGED. No delivery-specific ACK, disposition, retry, materialization,
// cursor, or generation authority exists.
export const CORRUPT_EXECUTOR_RESULT_DELIVERY = 'CORRUPT_EXECUTOR_RESULT_DELIVERY';
export const INVALID_EXECUTOR_RESULT_DELIVERY_STORE = 'INVALID_EXECUTOR_RESULT_DELIVERY_STORE';
export const INVALID_EXECUTOR_RESULT_DELIVERY_DISPATCH_ID =
  'INVALID_EXECUTOR_RESULT_DELIVERY_DISPATCH_ID';
export const EXECUTOR_RESULT_RECEIPT_NOT_FOUND = 'EXECUTOR_RESULT_RECEIPT_NOT_FOUND';
export const EXECUTOR_RESULT_DELIVERY_DISPATCH_AUTHORITY_NOT_FOUND =
  'EXECUTOR_RESULT_DELIVERY_DISPATCH_AUTHORITY_NOT_FOUND';
export const EXECUTOR_RESULT_DELIVERY_TASK_BINDING_MISMATCH =
  'EXECUTOR_RESULT_DELIVERY_TASK_BINDING_MISMATCH';
export const EXECUTOR_RESULT_DELIVERY_TASK_STATE_NOT_DELIVERABLE =
  'EXECUTOR_RESULT_DELIVERY_TASK_STATE_NOT_DELIVERABLE';
export const EXECUTOR_RESULT_DELIVERY_CONFLICT = 'EXECUTOR_RESULT_DELIVERY_CONFLICT';

export class ExecutorResultDeliveryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ExecutorResultDeliveryError';
    this.code = details.code ?? CORRUPT_EXECUTOR_RESULT_DELIVERY;
  }
}

function fail(message, code = CORRUPT_EXECUTOR_RESULT_DELIVERY) {
  throw new ExecutorResultDeliveryError(message, { code });
}

export function assertValidExecutorResultDeliveryDispatchId(dispatchId) {
  try {
    assertValidExecutorResultReceiptDispatchId(dispatchId);
  } catch (error) {
    fail(error.message, INVALID_EXECUTOR_RESULT_DELIVERY_DISPATCH_ID);
  }
  return dispatchId;
}

/**
 * Deterministic canonical result identity for one durable dispatchId:
 * `result_<dispatchId>`, a stable one-to-one rule composed ONLY of the
 * existing durable Task 19 dispatch identity. The same dispatchId always
 * converges on the same result identity in any process under any clock skew;
 * no random UUID / wall clock / PID / hostname / process-local counter
 * participates.
 */
export function buildExecutorResultId(dispatchId) {
  assertValidExecutorResultDeliveryDispatchId(dispatchId);
  return `${EXECUTOR_RESULT_DELIVERY_RESULT_ID_PREFIX}${dispatchId}`;
}

function assertDeliveryStoreCapabilities(store) {
  if (
    !store ||
    typeof store.readExecutorResultReceipt !== 'function' ||
    typeof store.readExecutorInvocationAttempt !== 'function' ||
    typeof store.readTask !== 'function' ||
    typeof store.readResult !== 'function' ||
    typeof store.deliverResult !== 'function'
  ) {
    fail(
      'executor result delivery requires a caller-supplied store exposing readExecutorResultReceipt / readExecutorInvocationAttempt / readTask / readResult / deliverResult (composition only; the caller supplies the store explicitly).',
      INVALID_EXECUTOR_RESULT_DELIVERY_STORE,
    );
  }
}

async function readCanonicalReceipt(store, dispatchId) {
  const observed = await store.readExecutorResultReceipt(dispatchId);
  if (observed === null || observed === undefined) {
    fail(
      `no durable executor result receipt exists for ${dispatchId}; delivery is impossible without the immutable Task 33 receipt and no receipt is ever fabricated or re-invoked here.`,
      EXECUTOR_RESULT_RECEIPT_NOT_FOUND,
    );
  }
  let canonical;
  try {
    canonical = validateExecutorResultReceiptRecord(observed);
  } catch (error) {
    fail(
      `durable executor result receipt is invalid (fail-closed, no repair): ${error?.message}`,
      typeof error?.code === 'string' && error.code
        ? error.code
        : CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  if (canonical.dispatchId !== dispatchId) {
    fail(
      `executor result receipt store key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${canonical.dispatchId}.`,
      CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  return canonical;
}

async function readValidatedDispatchAuthority(store, dispatchId) {
  const observed = await store.readExecutorInvocationAttempt(dispatchId);
  if (observed === null || observed === undefined) {
    fail(
      `no durable executor invocation attempt (dispatch/claim authority) exists for ${dispatchId}; the receipt cannot be bound to a canonical task and delivery fails closed.`,
      EXECUTOR_RESULT_DELIVERY_DISPATCH_AUTHORITY_NOT_FOUND,
    );
  }
  let decision;
  try {
    decision = validateReceiverDecisionRecord(observed);
  } catch (error) {
    fail(
      `durable executor invocation attempt is invalid (fail-closed, no repair): ${error?.message}`,
      typeof error?.code === 'string' && error.code
        ? error.code
        : CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
    );
  }
  if (decision.dispatchId !== dispatchId) {
    fail(
      `executor invocation attempt store key/binding mismatch (fail-closed): looked up ${dispatchId} but the record carries ${decision.dispatchId}.`,
      CORRUPT_EXECUTOR_INVOCATION_ATTEMPT,
    );
  }
  return decision;
}

function buildCanonicalExecutorResultEnvelope({ dispatchId, receipt, decisionInput }) {
  // Coordination-owned claim token authority: the existing admission-bound
  // claim token builder over the durable admission binding and the durable
  // worker id ONLY. The executor receipt never authors a claim token.
  let claimToken;
  try {
    claimToken = buildAdmissionBoundClaimToken({
      admissionId: decisionInput.admissionId,
      nextTaskId: decisionInput.nextTaskId,
      workerId: decisionInput.workerId,
    });
  } catch (error) {
    fail(
      `canonical claim token authority could not be derived from the durable dispatch binding (fail-closed): ${error?.message}`,
      typeof error?.code === 'string' && error.code ? error.code : CORRUPT_EXECUTOR_RESULT_DELIVERY,
    );
  }
  return Object.freeze({
    schemaVersion: RESULT_SCHEMA_VERSION,
    resultId: buildExecutorResultId(dispatchId),
    taskId: receipt.taskId,
    workerId: decisionInput.workerId,
    claimToken,
    claimGeneration: decisionInput.claimGeneration,
    status: receipt.status,
    summary: receipt.summary,
    proofRefs: receipt.proofRefs,
    evidenceRefs: receipt.evidenceRefs,
    frictionObserved: receipt.frictionObserved,
  });
}

function projectAuthoredResultFields(record) {
  const projected = {};
  for (const field of EXECUTOR_RESULT_DELIVERY_AUTHORED_RESULT_FIELDS) {
    projected[field] = record[field];
  }
  return projected;
}

function assertCanonicalResultConvergence(stored, expected, dispatchId) {
  const expectedKeys = [
    ...EXECUTOR_RESULT_DELIVERY_AUTHORED_RESULT_FIELDS,
    'deliveredAt',
  ];
  const keys = Object.keys(stored);
  const exactKeySet =
    keys.length === expectedKeys.length && expectedKeys.every((field) => keys.includes(field));
  if (!exactKeySet) {
    fail(
      `canonical result shape conflict (fail-closed): dispatchId ${dispatchId} already carries a canonical result with a different field set (${keys.join(', ')}); the first canonical result is preserved and never overwritten, merged, or repaired.`,
      EXECUTOR_RESULT_DELIVERY_CONFLICT,
    );
  }
  if (
    JSON.stringify(projectAuthoredResultFields(stored)) !==
    JSON.stringify(projectAuthoredResultFields(expected))
  ) {
    fail(
      `canonical result conflict (fail-closed): dispatchId ${dispatchId} already carries a different canonical result; the first canonical result is preserved and never overwritten, merged, or repaired.`,
      EXECUTOR_RESULT_DELIVERY_CONFLICT,
    );
  }
  return stored;
}

async function assertReceiptUnchanged(store, dispatchId, canonicalReceipt) {
  const observed = await store.readExecutorResultReceipt(dispatchId);
  if (observed === null || observed === undefined) {
    fail(
      `durable executor result receipt disappeared during delivery (fail-closed): ${dispatchId}`,
      CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  let canonical;
  try {
    canonical = validateExecutorResultReceiptRecord(observed);
  } catch (error) {
    fail(
      `durable executor result receipt drifted during delivery (fail-closed, no repair): ${error?.message}`,
      typeof error?.code === 'string' && error.code
        ? error.code
        : CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  if (canonical.dispatchId !== dispatchId) {
    fail(
      `durable executor result receipt key/binding drifted during delivery (fail-closed): ${dispatchId}`,
      CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  if (JSON.stringify(canonical) !== JSON.stringify(canonicalReceipt)) {
    fail(
      `durable executor result receipt bytes changed during delivery (fail-closed, no repair): ${dispatchId}`,
      CORRUPT_EXECUTOR_RESULT_RECEIPT,
    );
  }
  return canonical;
}

/**
 * Deliver the canonical Result for ONE durably recorded Task 33 executor
 * result receipt:
 *
 *   DURABLY_RECORDED_EXECUTOR_RESULT_RECEIPT(dispatchId)
 *     -> RESULT_DELIVERED(taskId)
 *
 * The entry composes EXISTING canonical authorities only:
 *   - the immutable Task 33 receipt is the ONLY executor evidence source,
 *   - the durable Task 28 invocation attempt is the ONLY dispatch/claim
 *     binding source (workerId, claimGeneration),
 *   - the existing admission-bound claim token builder is the ONLY claim
 *     token authority,
 *   - `result_<dispatchId>` is the deterministic result identity,
 *   - `store.deliverResult` is the ONLY canonical Result writer and the ONLY
 *     live claim/fencing authority,
 *   - the store clock is the ONLY delivery timing authority.
 *
 * Contract (durable-first, fail-closed, no repair, no overwrite):
 * 1. `store` must expose readExecutorResultReceipt / readExecutorInvocationAttempt
 *    / readTask / readResult / deliverResult; otherwise
 *    INVALID_EXECUTOR_RESULT_DELIVERY_STORE and nothing is read or written.
 * 2. dispatchId is validated before any durable read; invalid identity fails
 *    closed with INVALID_EXECUTOR_RESULT_DELIVERY_DISPATCH_ID.
 * 3. A missing durable Task 33 receipt fails closed
 *    (EXECUTOR_RESULT_RECEIPT_NOT_FOUND): no receipt is fabricated, no
 *    executor is re-invoked, and a Task 32 outcome alone never becomes a
 *    delivery.
 * 4. The receipt is re-validated verbatim (Task 33 validator); corrupt or
 *    invalid receipts fail closed with their existing codes.
 * 5. The durable Task 28 dispatch authority is mandatory and re-validated
 *    verbatim (Task 24 validator); missing fails closed
 *    (EXECUTOR_RESULT_DELIVERY_DISPATCH_AUTHORITY_NOT_FOUND).
 * 6. receipt.taskId must equal the durable dispatch authority nextTaskId;
 *    mismatch fails closed
 *    (EXECUTOR_RESULT_DELIVERY_TASK_BINDING_MISMATCH).
 * 7. Task lifecycle: CLAIMED delivers; RESULT_DELIVERED converges read-only
 *    by exact authored-field comparison (identical -> idempotent replay,
 *    different -> EXECUTOR_RESULT_DELIVERY_CONFLICT with the first canonical
 *    result preserved); any other status fails closed
 *    (EXECUTOR_RESULT_DELIVERY_TASK_STATE_NOT_DELIVERABLE).
 * 8. The canonical envelope carries the six receipt evidence fields verbatim
 *    and coordination-owned authority values only; NO usage is fabricated.
 * 9. store.deliverResult performs the live claim/fencing verification,
 *    duplicate/terminal first-wins semantics, exclusive-create, and the
 *    CLAIMED -> RESULT_DELIVERED transition. Its fail-closed codes (for
 *    example STALE_CLAIM for a stale generation, wrong worker binding,
 *    claim token mismatch, or a missing claim) propagate UNCHANGED.
 * 10. The delivered canonical result is read back exactly and verified by
 *     authored-field convergence; then task.status must be
 *     RESULT_DELIVERED; then the Task 33 receipt is re-read and must be
 *     byte/semantic unchanged.
 *
 * No executor process, no stdout/stderr, no exit code, and no worker-provided
 * claim field participates. No disposition, ACK, materialization, or cursor
 * mutation exists here.
 */
export async function deliverExecutorResultReceipt({ dispatchId, store } = {}) {
  // 1. Caller-supplied durable store primitives only: no registry, no
  //    auto-detection, no transport, no executor.
  assertDeliveryStoreCapabilities(store);

  // 2. dispatchId identity validation before any durable read.
  assertValidExecutorResultDeliveryDispatchId(dispatchId);

  // 3. Durable-first: the immutable Task 33 receipt is the ONLY evidence
  //    source. Missing receipt fails closed without any fabrication.
  const canonicalReceipt = await readCanonicalReceipt(store, dispatchId);

  // 4. Durable Task 28 dispatch/claim binding authority.
  const decision = await readValidatedDispatchAuthority(store, dispatchId);
  const decisionInput = decision.decisionInput;

  // 5. receipt.taskId must bind to the durable dispatch authority task.
  const taskId = decisionInput.nextTaskId;
  if (canonicalReceipt.taskId !== taskId) {
    fail(
      `receipt taskId ${canonicalReceipt.taskId} does not bind to the durable dispatch authority task ${taskId} (fail-closed, no repair).`,
      EXECUTOR_RESULT_DELIVERY_TASK_BINDING_MISMATCH,
    );
  }

  // 6. The exact canonical envelope: six receipt evidence fields verbatim +
  //    coordination-owned authority values only (no usage, no caller fields).
  const envelope = buildCanonicalExecutorResultEnvelope({
    dispatchId,
    receipt: canonicalReceipt,
    decisionInput,
  });

  // 7. Current task lifecycle authority.
  const task = await store.readTask(taskId);
  if (task.taskId !== taskId) {
    fail(
      `task read returned a different task identity (fail-closed): expected ${taskId} got ${String(task.taskId)}.`,
      EXECUTOR_RESULT_DELIVERY_TASK_BINDING_MISMATCH,
    );
  }

  if (task.status === TASK_STATUS_RESULT_DELIVERED) {
    // 8a. Already delivered: exact authored-field convergence ONLY. No
    //     deliverResult call, no write, no claim/fencing requirement, no
    //     timing rewrite. Divergence fails closed with the first canonical
    //     result preserved.
    const stored = await store.readResult(taskId);
    const converged = assertCanonicalResultConvergence(stored, envelope, dispatchId);
    await assertReceiptUnchanged(store, dispatchId, canonicalReceipt);
    return Object.freeze({
      dispatchId,
      taskId,
      resultId: envelope.resultId,
      newlyDelivered: false,
      exactReplay: true,
      result: converged,
    });
  }

  if (task.status !== TASK_STATUS_CLAIMED) {
    // 8b. READY / CREATED (or any other non-CLAIMED, non-terminal) status
    //     never delivers: the canonical claim/fencing authority requires a
    //     current CLAIMED lifecycle and this layer never auto-claims.
    fail(
      `task lifecycle does not allow delivery (task=${taskId} status=${task.status}): only CLAIMED delivers and RESULT_DELIVERED converges read-only.`,
      EXECUTOR_RESULT_DELIVERY_TASK_STATE_NOT_DELIVERABLE,
    );
  }

  // 9. EXISTING canonical Result authority: live claim/fencing verification,
  //    duplicate/terminal first-wins semantics, exclusive-create, and the
  //    CLAIMED -> RESULT_DELIVERED transition. deliveredAt is intentionally
  //    omitted: the store clock is the canonical timing authority.
  const delivery = await store.deliverResult(envelope);

  // 10. Exact canonical read-back + authored-field convergence.
  const stored = await store.readResult(taskId);
  const converged = assertCanonicalResultConvergence(stored, envelope, dispatchId);

  // 11. Task lifecycle must now be terminal RESULT_DELIVERED.
  const deliveredTask = await store.readTask(taskId);
  if (deliveredTask.status !== TASK_STATUS_RESULT_DELIVERED) {
    fail(
      `task did not reach RESULT_DELIVERED after canonical delivery (task=${taskId} status=${deliveredTask.status}); no repair is attempted.`,
      EXECUTOR_RESULT_DELIVERY_TASK_STATE_NOT_DELIVERABLE,
    );
  }

  // 12. The Task 33 receipt remains the immutable executor evidence and must
  //     be unchanged after canonical Result creation.
  await assertReceiptUnchanged(store, dispatchId, canonicalReceipt);

  if (delivery && delivery.duplicate === true) {
    return Object.freeze({
      dispatchId,
      taskId,
      resultId: envelope.resultId,
      newlyDelivered: false,
      exactReplay: true,
      result: converged,
    });
  }
  return Object.freeze({
    dispatchId,
    taskId,
    resultId: envelope.resultId,
    newlyDelivered: true,
    result: converged,
  });
}
