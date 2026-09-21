// Bounded composition owner:
// GREENHUB-COORDINATION-SHARED-CONTROL-TOWER-DISPOSITION-RETURN-GF09.
// Surface: scripts/coordination/*control-tower-disposition-return* (this module
// + its proof spec + the real-execution proof harness) + the operator-facing
// `coordination:disposition` composition inside the existing operator-cli.mjs
// + the read-only findRelayIssue/findComments extension of the existing GitHub
// relay transport. No store.mjs mutation, no new durable artifact, no new
// durable directory, no new JSON domain, and no new authority family: this
// module composes EXISTING canonical authorities and reads ONE non-canonical
// shared decision projection.
//
// State transition added here:
//   PENDING_DISPOSITION(taskId)@N                          [GF-07/GF-08 durable]
//     -> SHARED_CONTROL_TOWER_DECISION_AVAILABLE(taskId)   [non-canonical read]
//     -> <existing disposition state>(taskId)@N+1          [existing local authority]
//
// Contract summary:
//   performControlTowerDispositionReturn() != authorControlTowerVerdict()
//     != executeTask() != invokeExecutor() != materialization != ACK
//     != CONSUMED != successor emission != publication.
//   The shared Control Tower decision surface (a GitHub issue comment on the
//   existing GF-08 relay issue) is NON-CANONICAL. The Control Tower authors the
//   verdict there; this module only VALIDATES and ADOPTS it through the EXISTING
//   local disposition authority (store.writeDisposition). It never invents a
//   semantic verdict, never advances a disposition generation without a
//   validated shared decision, never invokes an executor, never reruns the
//   source task, never emits a successor, and never performs a Git operation.
//   GitHub deletion/failure/staleness leaves canonical truth unchanged.
//
// Shared decision identity:
//   decisionId = `ctdecision_<sha256(canonical decision document)[:32]>`
//   identity is derived by LOCAL code from the exact decision document content
//   (clock/pid/hostname/random/transport metadata never participate), so:
//     - the same exact decision replays to the same identity (idempotent),
//     - a different document is a different identity,
//     - two decisions with the same recomputed identity must carry identical
//       canonical bytes (any drift fails closed).
//
// Canonical adoption:
//   Only `store.writeDisposition` (the existing generation/fencing authority)
//   writes canonical bytes. The adopted generation N+1 is byte-deterministic:
//   state/refs/decidedAt/token come from the shared decision; the only
//   locally-added bytes are the two provenance refs
//   `shared-decision:<decisionId>` and `shared-decision-binding:<decisionHash>`.
//   A replay after adoption converges through the existing same-generation
//   first-wins fencing (generation N+1 already exists -> duplicate) or through
//   lineage detection (generation N+1 evidence already carries the decisionId).
//
// Conflict / stale policy (fail closed, no last-writer-wins):
//   - a decision bound to a different resultId/resultBinding fails closed,
//   - two distinct decisions binding the SAME current disposition generation
//     fail closed,
//   - any decision that was never adopted and can no longer be applied (stale
//     generation, drifted observed state, foreign/future generation) fails
//     closed even when another decision is adoptable: no decision is silently
//     ignored,
//   - a decision whose observed dispositionRef/state is stale fails closed
//     unless its exact identity is recorded as adopted lineage in a later
//     canonical generation (then it is an exact replay),
//   - an existing generation that already carries a DIFFERENT shared decision
//     fails closed: a later canonical disposition is never overwritten by an
//     older shared decision.
//
// Failure policy (transport unavailable / gh missing / issue absent):
//   the canonical result and the current disposition remain untouched; no
//   executor retry exists; no verdict is authored. The return reports
//   RETURN_PENDING (or RETURN_NOT_CONFIGURED when no transport binding exists)
//   with zero canonical writes.
//
// Secret policy:
//   only bounded decision document fields are read from the shared surface.
//   Environment variables, tokens, credential values, coordination-home dumps,
//   raw logs, and arbitrary file content never enter a projection; transport
//   failure detail is redacted and bounded before it appears in any output.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here or in the store):
//   automatic DROP/WATCH/CHANGE or ADOPTED/REJECTED/SUPERSEDED invention,
//   successor task generation, next-task execution, materialization, ACK,
//   CONSUMED advancement, cursor advancement, READY scanning, daemon,
//   scheduler, polling loop, cron/watchdog, retry/backoff, mutation-capable
//   executors, Google Drive/Notion coordination, production deployment, and any
//   change to existing disposition semantics.

import { createHash } from 'node:crypto';
import {
  deriveControlTowerResultIntake,
  MAX_CONTROL_TOWER_RESULT_INTAKE_ID_LENGTH,
} from './control-tower-result-intake.mjs';
import {
  CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
  ControlTowerResultRelayTransportError,
  redactControlTowerRelayText,
} from './control-tower-result-relay.mjs';
import {
  assertLegalDispositionTransition,
  DISPOSITION_STATES,
  dispositionRef,
  isIsoDateTime,
  MAX_CONTROL_TOWER_FIELD_LENGTH,
  MAX_DISPOSITION_REF_LENGTH,
} from './disposition.mjs';
import { TASK_ID_PATTERN } from './task-envelope.mjs';

export const CONTROL_TOWER_DISPOSITION_RETURN_SCHEMA_VERSION = '1';
export const CONTROL_TOWER_DISPOSITION_DECISION_SCHEMA_VERSION = '1';
export const CONTROL_TOWER_DISPOSITION_DECISION_ID_PREFIX = 'ctdecision_';
export const CONTROL_TOWER_DISPOSITION_DECISION_MARKER_VERSION = 'v1';

// Return statuses (projection/transport meanings ONLY, never canonical task
// lifecycle states and never a semantic verdict).
export const CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED = 'RETURNED';
export const CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY = 'EXACT_REPLAY';
export const CONTROL_TOWER_DISPOSITION_RETURN_STATUS_PENDING = 'RETURN_PENDING';

// Canonical shared decision document shape. Required fields must all be present;
// optional fields may be omitted. Unknown fields fail closed.
export const CONTROL_TOWER_DISPOSITION_DECISION_REQUIRED_FIELDS = Object.freeze([
  'schemaVersion',
  'taskId',
  'resultId',
  'resultBinding',
  'dispositionRef',
  'dispositionState',
  'targetDispositionState',
  'controlTowerId',
  'controlTowerToken',
  'decidedAt',
]);

export const CONTROL_TOWER_DISPOSITION_DECISION_OPTIONAL_FIELDS = Object.freeze([
  'policyRefs',
  'proofRefs',
  'evidenceRefs',
  'userDecision',
]);

export const CONTROL_TOWER_DISPOSITION_DECISION_USER_DECISION_FIELDS = Object.freeze([
  'decisionRequestId',
  'questionVersion',
  'requiredAuthority',
  'decisionRecordRef',
]);

export const MAX_CONTROL_TOWER_DISPOSITION_DECISION_JSON_BYTES = 16 * 1024;
export const MAX_CONTROL_TOWER_DISPOSITION_DECISION_BODY_LENGTH = 32 * 1024;
export const MAX_CONTROL_TOWER_DISPOSITION_DECISION_COMMENTS = 100;
export const MAX_CONTROL_TOWER_DISPOSITION_RETURN_FAILURE_LENGTH = 300;
export const MAX_CONTROL_TOWER_DISPOSITION_QUESTION_VERSION_LENGTH = 64;

// Return-native meanings ONLY. Canonical authority errors (task/result/claim/
// authority binding, disposition fencing) propagate their EXISTING codes
// UNCHANGED (never re-coded, never repaired).
export const CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION =
  'CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION';
export const INVALID_CONTROL_TOWER_DISPOSITION_RETURN_STORE =
  'INVALID_CONTROL_TOWER_DISPOSITION_RETURN_STORE';
export const INVALID_CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT =
  'INVALID_CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT';
export const CONTROL_TOWER_DISPOSITION_RETURN_DISPOSITION_NOT_FOUND =
  'CONTROL_TOWER_DISPOSITION_RETURN_DISPOSITION_NOT_FOUND';
export const CONTROL_TOWER_DISPOSITION_RETURN_BINDING_MISMATCH =
  'CONTROL_TOWER_DISPOSITION_RETURN_BINDING_MISMATCH';
export const CONTROL_TOWER_DISPOSITION_RETURN_DECISION_CONFLICT =
  'CONTROL_TOWER_DISPOSITION_RETURN_DECISION_CONFLICT';
export const CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE =
  'CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE';
export const CONTROL_TOWER_DISPOSITION_RETURN_SURFACE_AMBIGUOUS =
  'CONTROL_TOWER_DISPOSITION_RETURN_SURFACE_AMBIGUOUS';
export const CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT_UNAVAILABLE =
  'CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT_UNAVAILABLE';
export const CONTROL_TOWER_DISPOSITION_RETURN_NOT_CONFIGURED =
  'CONTROL_TOWER_DISPOSITION_RETURN_NOT_CONFIGURED';

export class ControlTowerDispositionReturnError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ControlTowerDispositionReturnError';
    this.code = details.code ?? CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION;
    this.taskId = details.taskId ?? null;
  }
}

// Transport failures are the ONLY catchable return errors: they converge to
// RETURN_PENDING because canonical truth is unaffected. Integrity/binding
// failures are ControlTowerDispositionReturnError instances and fail closed.
export class ControlTowerDispositionReturnTransportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ControlTowerDispositionReturnTransportError';
    this.code = details.code ?? CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT_UNAVAILABLE;
    this.taskId = details.taskId ?? null;
  }
}

function fail(message, details = {}) {
  throw new ControlTowerDispositionReturnError(message, details);
}

function isTransportError(error) {
  return (
    error instanceof ControlTowerResultRelayTransportError ||
    error instanceof ControlTowerDispositionReturnTransportError
  );
}

function assertValidTaskId(taskId, code = CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, { code });
  }
  return taskId;
}

function assertNonEmptyBoundedString(value, fieldName, maxLength, taskId, code) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${fieldName} must be a non-empty string.`, { code, taskId });
  }
  if (value.length > maxLength) {
    fail(`${fieldName} exceeds ${maxLength} chars.`, { code, taskId });
  }
  return value;
}

function assertRefStringArray(value, fieldName, taskId) {
  if (!Array.isArray(value)) {
    fail(`${fieldName} must be an array of reference strings.`, { taskId });
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      fail(`${fieldName} entries must be non-empty reference strings.`, { taskId });
    }
    if (entry.length > MAX_DISPOSITION_REF_LENGTH) {
      fail(
        `${fieldName} entry exceeds ${MAX_DISPOSITION_REF_LENGTH} chars: reference-first contract requires short refs, not embedded bodies.`,
        { code: 'CONTEXT_BUDGET_EXCEEDED', taskId },
      );
    }
    if (entry.includes('\n\n\n')) {
      fail(`${fieldName} entry looks like an embedded dump, not a reference.`, {
        code: 'CONTEXT_BUDGET_EXCEEDED',
        taskId,
      });
    }
  }
}

/**
 * Deterministic shared decision projection marker for ONE task. The document
 * itself (not the marker) carries resultId/resultBinding, so a decision bound to
 * a stale result is still discovered and fails closed instead of being hidden.
 */
export function buildControlTowerDispositionDecisionMarker({ taskId } = {}) {
  assertValidTaskId(taskId);
  return `<!-- greenhub-control-tower-decision:${CONTROL_TOWER_DISPOSITION_DECISION_MARKER_VERSION}:${taskId} -->`;
}

function parseDispositionRefGeneration(dispositionRefValue, taskId) {
  if (typeof dispositionRefValue !== 'string' || !dispositionRefValue.trim()) {
    fail('dispositionRef must be a non-empty "<taskId>@<generation>" string.', { taskId });
  }
  const separator = dispositionRefValue.lastIndexOf('@');
  if (separator <= 0) {
    fail(`dispositionRef must be "<taskId>@<generation>" (got ${JSON.stringify(dispositionRefValue)}).`, {
      taskId,
    });
  }
  const refTaskId = dispositionRefValue.slice(0, separator);
  const rawGeneration = dispositionRefValue.slice(separator + 1);
  if (refTaskId !== taskId) {
    fail(
      `dispositionRef is not bound to this task (fail-closed): expected "${taskId}@<generation>" got ${JSON.stringify(dispositionRefValue)}.`,
      { taskId },
    );
  }
  if (!/^[1-9][0-9]*$/.test(rawGeneration)) {
    fail(`dispositionRef generation must be an integer >= 1 (got ${JSON.stringify(rawGeneration)}).`, {
      taskId,
    });
  }
  return Number(rawGeneration);
}

function canonicalUserDecision(userDecision, taskId) {
  if (userDecision === undefined) return undefined;
  if (userDecision === null || typeof userDecision !== 'object' || Array.isArray(userDecision)) {
    fail('userDecision must be an object when present in a shared decision.', { taskId });
  }
  for (const key of Object.keys(userDecision)) {
    if (!CONTROL_TOWER_DISPOSITION_DECISION_USER_DECISION_FIELDS.includes(key)) {
      fail(
        `userDecision accepts exactly (${CONTROL_TOWER_DISPOSITION_DECISION_USER_DECISION_FIELDS.join(', ')}); received unknown field "${key}".`,
        { taskId },
      );
    }
  }
  assertNonEmptyBoundedString(
    userDecision.decisionRequestId,
    'userDecision.decisionRequestId',
    MAX_CONTROL_TOWER_FIELD_LENGTH,
    taskId,
  );
  assertNonEmptyBoundedString(
    userDecision.questionVersion,
    'userDecision.questionVersion',
    MAX_CONTROL_TOWER_DISPOSITION_QUESTION_VERSION_LENGTH,
    taskId,
  );
  assertNonEmptyBoundedString(
    userDecision.requiredAuthority,
    'userDecision.requiredAuthority',
    MAX_CONTROL_TOWER_FIELD_LENGTH,
    taskId,
  );
  if (userDecision.decisionRecordRef !== undefined) {
    assertNonEmptyBoundedString(
      userDecision.decisionRecordRef,
      'userDecision.decisionRecordRef',
      MAX_DISPOSITION_REF_LENGTH,
      taskId,
    );
  }
  return Object.freeze({
    decisionRequestId: userDecision.decisionRequestId,
    questionVersion: userDecision.questionVersion,
    requiredAuthority: userDecision.requiredAuthority,
    ...(userDecision.decisionRecordRef === undefined
      ? {}
      : { decisionRecordRef: userDecision.decisionRecordRef }),
  });
}

function canonicalDecisionDocument(record, taskId) {
  return {
    schemaVersion: CONTROL_TOWER_DISPOSITION_DECISION_SCHEMA_VERSION,
    taskId,
    resultId: record.resultId,
    resultBinding: record.resultBinding,
    dispositionRef: record.dispositionRef,
    dispositionState: record.dispositionState,
    targetDispositionState: record.targetDispositionState,
    controlTowerId: record.controlTowerId,
    controlTowerToken: record.controlTowerToken,
    decidedAt: record.decidedAt,
    policyRefs: [...(record.policyRefs ?? [])],
    proofRefs: [...(record.proofRefs ?? [])],
    evidenceRefs: [...(record.evidenceRefs ?? [])],
    ...(record.userDecision === undefined ? {} : { userDecision: record.userDecision }),
  };
}

/**
 * Deterministic decision identity from the exact canonical decision document
 * content only. Returns `{ decisionId, decisionHash }`; clock/pid/hostname/
 * random/transport metadata never participate.
 */
export function computeControlTowerDispositionDecisionIdentity(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    fail('decision document must be a plain object for identity computation.');
  }
  const taskId = assertValidTaskId(record.taskId);
  const json = JSON.stringify(canonicalDecisionDocument(record, taskId));
  const decisionHash = `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`;
  return Object.freeze({
    decisionId: `${CONTROL_TOWER_DISPOSITION_DECISION_ID_PREFIX}${decisionHash.slice(7, 39)}`,
    decisionHash,
  });
}

/**
 * Validate one shared Control Tower decision document. Returns a frozen
 * canonical copy carrying the recomputed `decisionId`/`decisionHash`.
 * Fail-closed, no repair: exact key set, bounded fields, legal disposition
 * states, deterministic identity, bounded JSON size.
 */
export function validateControlTowerDispositionDecision(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    fail('shared decision document must be a plain object.');
  }
  if (Object.getOwnPropertySymbols(record).length > 0) {
    fail('shared decision document must not carry symbol keys.');
  }
  const allowed = new Set([
    ...CONTROL_TOWER_DISPOSITION_DECISION_REQUIRED_FIELDS,
    ...CONTROL_TOWER_DISPOSITION_DECISION_OPTIONAL_FIELDS,
  ]);
  for (const key of Object.getOwnPropertyNames(record)) {
    if (!allowed.has(key)) {
      fail(
        `shared decision document accepts exactly (${[
          ...CONTROL_TOWER_DISPOSITION_DECISION_REQUIRED_FIELDS,
          ...CONTROL_TOWER_DISPOSITION_DECISION_OPTIONAL_FIELDS,
        ].join(', ')}); received unknown field "${key}".`,
      );
    }
  }
  for (const key of CONTROL_TOWER_DISPOSITION_DECISION_REQUIRED_FIELDS) {
    if (!Object.hasOwn(record, key)) {
      fail(`shared decision document is missing required field "${key}".`);
    }
  }
  if (record.schemaVersion !== CONTROL_TOWER_DISPOSITION_DECISION_SCHEMA_VERSION) {
    fail(
      `shared decision schemaVersion must be ${JSON.stringify(CONTROL_TOWER_DISPOSITION_DECISION_SCHEMA_VERSION)}.`,
      { code: 'INVALID_SCHEMA_VERSION' },
    );
  }
  const taskId = assertValidTaskId(record.taskId);
  assertNonEmptyBoundedString(
    record.resultId,
    'resultId',
    MAX_CONTROL_TOWER_RESULT_INTAKE_ID_LENGTH,
    taskId,
  );
  if (
    record.resultId.includes('/') ||
    record.resultId.includes('\\') ||
    record.resultId.includes('..')
  ) {
    fail('resultId must not contain path separators or "..".', { taskId });
  }
  if (typeof record.resultBinding !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(record.resultBinding)) {
    fail('resultBinding must be a stable content hash of form "sha256:<64 hex>".', { taskId });
  }
  parseDispositionRefGeneration(record.dispositionRef, taskId);
  if (!DISPOSITION_STATES.includes(record.dispositionState)) {
    fail(
      `dispositionState must be one of ${DISPOSITION_STATES.join(', ')} (got ${JSON.stringify(record.dispositionState)}).`,
      { taskId },
    );
  }
  if (!DISPOSITION_STATES.includes(record.targetDispositionState)) {
    fail(
      `targetDispositionState must be one of ${DISPOSITION_STATES.join(', ')} (got ${JSON.stringify(record.targetDispositionState)}).`,
      { taskId },
    );
  }
  assertNonEmptyBoundedString(
    record.controlTowerId,
    'controlTowerId',
    MAX_CONTROL_TOWER_FIELD_LENGTH,
    taskId,
  );
  assertNonEmptyBoundedString(
    record.controlTowerToken,
    'controlTowerToken',
    MAX_CONTROL_TOWER_FIELD_LENGTH,
    taskId,
  );
  if (!isIsoDateTime(record.decidedAt)) {
    fail('decidedAt must be an ISO date-time string.', { taskId });
  }
  const policyRefs = record.policyRefs ?? [];
  const proofRefs = record.proofRefs ?? [];
  const evidenceRefs = record.evidenceRefs ?? [];
  assertRefStringArray(policyRefs, 'policyRefs', taskId);
  assertRefStringArray(proofRefs, 'proofRefs', taskId);
  assertRefStringArray(evidenceRefs, 'evidenceRefs', taskId);
  const userDecision = canonicalUserDecision(record.userDecision, taskId);
  const canonical = Object.freeze(
    canonicalDecisionDocument(
      {
        resultId: record.resultId,
        resultBinding: record.resultBinding,
        dispositionRef: record.dispositionRef,
        dispositionState: record.dispositionState,
        targetDispositionState: record.targetDispositionState,
        controlTowerId: record.controlTowerId,
        controlTowerToken: record.controlTowerToken,
        decidedAt: record.decidedAt,
        policyRefs,
        proofRefs,
        evidenceRefs,
        ...(userDecision === undefined ? {} : { userDecision }),
      },
      taskId,
    ),
  );
  const json = JSON.stringify(canonical);
  if (json.length > MAX_CONTROL_TOWER_DISPOSITION_DECISION_JSON_BYTES) {
    fail(
      `shared decision document JSON is ${json.length} bytes (> ${MAX_CONTROL_TOWER_DISPOSITION_DECISION_JSON_BYTES}): reference-first, no embedded dumps.`,
      { code: 'CONTEXT_BUDGET_EXCEEDED', taskId },
    );
  }
  return Object.freeze({
    ...canonical,
    ...computeControlTowerDispositionDecisionIdentity(canonical),
  });
}

/**
 * Extract the machine-readable decision document out of one shared decision
 * comment body. Returns the parsed plain object or null when the body does not
 * carry a JSON block. Never repairs and never validates binding semantics.
 */
export function extractControlTowerDispositionDecision(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(/```json\r?\n([\s\S]*?)```/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

/**
 * Render the exact shared comment body for one decision document: deterministic
 * marker first, bounded human summary, and the machine-readable JSON block. This
 * is a FORMAT helper for the verdict author / proof harness only; the adoption
 * path never renders or authors a decision.
 */
export function renderControlTowerDispositionDecisionBody(decision, { marker } = {}) {
  if (decision === null || typeof decision !== 'object' || Array.isArray(decision)) {
    fail('decision document must be a plain object for rendering.');
  }
  const taskId = assertValidTaskId(decision.taskId);
  const expectedMarker = marker ?? buildControlTowerDispositionDecisionMarker({ taskId });
  const canonical = canonicalDecisionDocument(decision, taskId);
  const lines = [
    expectedMarker,
    '',
    '### Greenhub Control Tower Disposition Decision',
    '',
    'Canonical coordination truth remains in the local Coordination Store; this comment is a non-canonical Control Tower decision projection.',
    '',
    `- taskId: ${taskId}`,
    `- resultId: ${canonical.resultId}`,
    `- resultBinding: ${canonical.resultBinding}`,
    `- dispositionRef: ${canonical.dispositionRef}`,
    `- dispositionState: ${canonical.dispositionState}`,
    `- targetDispositionState: ${canonical.targetDispositionState}`,
    `- decidedAt: ${canonical.decidedAt}`,
    '',
    '```json',
    JSON.stringify(canonical, null, 2),
    '```',
  ];
  const body = lines.join('\n');
  if (body.length > MAX_CONTROL_TOWER_DISPOSITION_DECISION_BODY_LENGTH) {
    fail(
      `shared decision comment body is ${body.length} chars (> ${MAX_CONTROL_TOWER_DISPOSITION_DECISION_BODY_LENGTH}): reference-first, no embedded dumps.`,
      { code: 'CONTEXT_BUDGET_EXCEEDED', taskId },
    );
  }
  return body;
}

function assertReturnStoreCapabilities(store, taskId) {
  if (
    !store ||
    typeof store.readTask !== 'function' ||
    typeof store.readResult !== 'function' ||
    typeof store.readClaim !== 'function' ||
    typeof store.readCurrentDisposition !== 'function' ||
    typeof store.readDispositionGeneration !== 'function'
  ) {
    fail(
      'control tower disposition return requires a caller-supplied store exposing readTask / readResult / readClaim / readCurrentDisposition / readDispositionGeneration (composition only).',
      { code: INVALID_CONTROL_TOWER_DISPOSITION_RETURN_STORE, taskId },
    );
  }
}

function assertReturnTransport(transport, taskId) {
  if (
    !transport ||
    typeof transport.findRelayIssue !== 'function' ||
    typeof transport.findComments !== 'function'
  ) {
    fail(
      'control tower disposition return requires a caller-supplied transport exposing the read-only findRelayIssue / findComments shared-surface methods (composition only; the operator CLI supplies the configured GitHub transport).',
      { code: INVALID_CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT, taskId },
    );
  }
}

/**
 * READ-ONLY shared surface read: locate the existing GF-08 relay issue (never
 * created here) and parse every decision comment carrying this task's
 * deterministic decision marker. Transport failures propagate as transport
 * errors; a marker-bearing comment without a valid document fails closed.
 */
export async function readSharedControlTowerDispositionDecisions({ transport, taskId } = {}) {
  assertValidTaskId(taskId, INVALID_CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT);
  assertReturnTransport(transport, taskId);
  const marker = buildControlTowerDispositionDecisionMarker({ taskId });
  const issue = await transport.findRelayIssue({ title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE });
  if (issue === null || issue === undefined) {
    return Object.freeze({ surface: null, marker, decisions: Object.freeze([]) });
  }
  if (
    typeof issue !== 'object' ||
    Array.isArray(issue) ||
    !Number.isInteger(issue.issueNumber) ||
    issue.issueNumber < 1
  ) {
    fail('shared surface issue lookup returned an invalid issue identity (fail-closed).', {
      code: INVALID_CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT,
      taskId,
    });
  }
  if (Number.isInteger(issue.duplicateIssueCount) && issue.duplicateIssueCount > 1) {
    fail(
      `multiple relay issues (${issue.duplicateIssueCount}) carry the exact shared surface title (fail-closed): the decision surface is ambiguous.`,
      { code: CONTROL_TOWER_DISPOSITION_RETURN_SURFACE_AMBIGUOUS, taskId },
    );
  }
  const comments = await transport.findComments({ issueNumber: issue.issueNumber, marker });
  if (!Array.isArray(comments)) {
    fail('shared surface comment lookup returned a non-array payload (fail-closed).', {
      code: INVALID_CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT,
      taskId,
    });
  }
  if (comments.length > MAX_CONTROL_TOWER_DISPOSITION_DECISION_COMMENTS) {
    fail(
      `shared surface carries ${comments.length} decision comments (> ${MAX_CONTROL_TOWER_DISPOSITION_DECISION_COMMENTS}); refusing an unbounded decision set.`,
      { code: 'CONTEXT_BUDGET_EXCEEDED', taskId },
    );
  }
  const decisions = [];
  for (const entry of comments) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('shared surface returned a non-object decision comment (fail-closed).', { taskId });
    }
    if (typeof entry.body !== 'string' || !entry.body.includes(marker)) {
      fail(
        'shared surface returned a comment that does not carry this task\'s decision marker (fail-closed).',
        { taskId },
      );
    }
    const raw = extractControlTowerDispositionDecision(entry.body);
    if (raw === null) {
      fail(
        `a shared decision comment carries the deterministic marker but not a valid decision document (fail-closed, no repair): comment ${String(entry.commentId)}.`,
        { code: CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION, taskId },
      );
    }
    const decision = validateControlTowerDispositionDecision(raw);
    decisions.push(
      Object.freeze({
        decision,
        source: Object.freeze({
          commentId: Number.isInteger(entry.commentId) ? entry.commentId : null,
          url: typeof entry.url === 'string' ? entry.url : null,
          createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
        }),
      }),
    );
  }
  return Object.freeze({
    surface: Object.freeze({
      issueNumber: issue.issueNumber,
      url: typeof issue.url === 'string' ? issue.url : null,
    }),
    marker,
    decisions: Object.freeze(decisions),
  });
}

function generationCarriesDecision(record, decisionId, decisionHash, taskId) {
  const refs = record.evidenceRefs ?? [];
  const idRef = `shared-decision:${decisionId}`;
  if (!refs.includes(idRef)) return false;
  const bindingRef = `shared-decision-binding:${decisionHash}`;
  if (!refs.includes(bindingRef)) {
    fail(
      `canonical generation ${record.dispositionGeneration} carries this decision identity but not its content binding (fail-closed): ${taskId}.`,
      { code: CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION, taskId },
    );
  }
  return true;
}

function buildReturnWriteInput({ taskId, intake, decision, targetGeneration }) {
  return Object.freeze({
    taskId,
    dispositionGeneration: targetGeneration,
    resultId: intake.resultId,
    controlTowerToken: decision.controlTowerToken,
    controlTowerId: decision.controlTowerId,
    state: decision.targetDispositionState,
    policyRefs: Object.freeze([...decision.policyRefs]),
    proofRefs: Object.freeze([...decision.proofRefs]),
    evidenceRefs: Object.freeze([
      ...decision.evidenceRefs,
      `shared-decision:${decision.decisionId}`,
      `shared-decision-binding:${decision.decisionHash}`,
    ]),
    decidedAt: decision.decidedAt,
    ...(decision.userDecision === undefined ? {} : { userDecision: decision.userDecision }),
  });
}

/**
 * PURE selection/validation over already-parsed shared decisions and the
 * canonical current disposition. Zero writes, zero transport calls.
 *
 * Returns one of:
 *   { status: 'PENDING' }                       no shared decision exists yet,
 *   { status: 'ADOPTABLE', ... writeInput }     exactly one legal next generation,
 *   { status: 'EXACT_REPLAY', ... }             the exact decision already adopted.
 * Throws ControlTowerDispositionReturnError on any binding/conflict/stale rule.
 */
export function selectControlTowerDispositionReturn({
  store,
  taskId,
  intake,
  current,
  decisions,
} = {}) {
  assertReturnStoreCapabilities(store, taskId);
  assertValidTaskId(taskId);
  if (!Array.isArray(decisions)) {
    fail('decisions must be an array of parsed shared decisions.', { taskId });
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    fail('the canonical current disposition must be a plain record (fail-closed).', { taskId });
  }
  const currentGeneration = current.dispositionGeneration;
  const currentState = current.state;

  // Bind every decision to the exact canonical result and group exact duplicates
  // by deterministic identity. Distinct identities for the same generation are
  // a conflict; no last-writer-wins exists.
  const groups = new Map();
  for (const entry of decisions) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('shared decision entry must be a plain object (fail-closed).', { taskId });
    }
    const decision = entry.decision;
    if (decision === null || typeof decision !== 'object' || Array.isArray(decision)) {
      fail('shared decision entry must carry a validated decision document.', { taskId });
    }
    if (
      decision.taskId !== taskId ||
      decision.resultId !== intake.resultId ||
      decision.resultBinding !== intake.resultBinding
    ) {
      fail(
        `shared decision does not bind the delivered canonical result (fail-closed): expected task/result ${taskId}/${intake.resultId} binding ${intake.resultBinding}, got ${decision.taskId}/${decision.resultId} binding ${decision.resultBinding}.`,
        { code: CONTROL_TOWER_DISPOSITION_RETURN_BINDING_MISMATCH, taskId },
      );
    }
    const refGeneration = parseDispositionRefGeneration(decision.dispositionRef, taskId);
    if (refGeneration > currentGeneration) {
      fail(
        `shared decision references generation ${refGeneration} ahead of the canonical current generation ${currentGeneration} (fail-closed).`,
        { code: CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE, taskId },
      );
    }
    if (!groups.has(decision.decisionId)) {
      groups.set(decision.decisionId, {
        decision,
        refGeneration,
        sources: [entry.source ?? null],
      });
    } else {
      const group = groups.get(decision.decisionId);
      if (group.decision.decisionHash !== decision.decisionHash) {
        fail(
          `conflicting same-identity shared decision (fail-closed, no last-writer-wins): ${decision.decisionId}.`,
          { code: CONTROL_TOWER_DISPOSITION_RETURN_DECISION_CONFLICT, taskId },
        );
      }
      group.sources.push(entry.source ?? null);
    }
  }

  if (groups.size === 0) {
    return Object.freeze({
      status: 'PENDING',
      reason: 'NO_SHARED_DECISION',
      observedDisposition: Object.freeze({
        dispositionRef: dispositionRef(taskId, currentGeneration),
        dispositionGeneration: currentGeneration,
        state: currentState,
      }),
    });
  }

  // Classify every decision group: current-generation, adopted lineage (its
  // decisionId is recorded in some later canonical generation), or stale. A
  // stale decision (never adopted, cannot be applied, not lineage) fails closed
  // EVEN when another decision is adoptable: the shared surface must be
  // unambiguous, and no decision is ever silently ignored.
  const currentGroups = [];
  const lineage = [];
  const stale = [];
  for (const group of groups.values()) {
    if (group.refGeneration === currentGeneration) {
      currentGroups.push(group);
      continue;
    }
    let adoptedGeneration = null;
    for (
      let generation = group.refGeneration + 1;
      generation <= currentGeneration;
      generation += 1
    ) {
      let record;
      try {
        record = store.readDispositionGeneration(taskId, generation);
      } catch (error) {
        fail(
          `canonical generation ${generation} could not be read for lineage validation (fail-closed): ${error?.message}`,
          { code: error?.code ?? CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION, taskId },
        );
      }
      if (
        generationCarriesDecision(
          record,
          group.decision.decisionId,
          group.decision.decisionHash,
          taskId,
        )
      ) {
        adoptedGeneration = generation;
        break;
      }
    }
    if (adoptedGeneration === null) stale.push(group);
    else lineage.push({ group, adoptedGeneration });
  }

  if (currentGroups.length > 1) {
    fail(
      `conflicting shared decisions target the same canonical generation ${currentGeneration} (fail-closed, no last-writer-wins): ${currentGroups
        .map((group) => group.decision.decisionId)
        .sort()
        .join(', ')}.`,
      { code: CONTROL_TOWER_DISPOSITION_RETURN_DECISION_CONFLICT, taskId },
    );
  }
  if (stale.length > 0) {
    fail(
      `shared decision is stale (fail-closed, canonical state is never rewound or overwritten, and no decision is silently ignored): canonical generation ${currentGeneration} state ${currentState}; stale decision(s) ${stale
        .map((group) => `${group.decision.decisionId}@${group.refGeneration}`)
        .sort()
        .join(', ')}.`,
      { code: CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE, taskId },
    );
  }

  if (currentGroups.length === 1) {
    const group = currentGroups[0];
    const decision = group.decision;
    if (decision.dispositionState !== currentState) {
      fail(
        `shared decision observed disposition state ${decision.dispositionState} at ${decision.dispositionRef} but canonical state is ${currentState} (fail-closed): stale decision.`,
        { code: CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE, taskId },
      );
    }
    try {
      assertLegalDispositionTransition(currentState, decision.targetDispositionState);
    } catch (error) {
      fail(error.message, {
        code: typeof error?.code === 'string' && error.code ? error.code : 'DISPOSITION_ILLEGAL_TRANSITION',
        taskId,
      });
    }
    const targetGeneration = currentGeneration + 1;
    const writeInput = Object.freeze({
      ...buildReturnWriteInput({ taskId, intake, decision, targetGeneration }),
      supersedes: currentGeneration,
    });
    return Object.freeze({
      status: 'ADOPTABLE',
      decision,
      source: group.sources[0] ?? null,
      duplicateSourceCount: group.sources.length,
      observedDisposition: Object.freeze({
        dispositionRef: dispositionRef(taskId, currentGeneration),
        dispositionGeneration: currentGeneration,
        state: currentState,
      }),
      targetGeneration,
      targetState: decision.targetDispositionState,
      writeInput,
    });
  }

  // No adoptable decision, but the surface carries only adopted lineage: the
  // exact decision already recorded at the current generation converges as an
  // exact replay (zero writes); otherwise the most recent consumed decision is
  // reported as already adopted.
  if (lineage.length > 0) {
    const direct = lineage.filter((entry) => entry.adoptedGeneration === currentGeneration);
    if (direct.length > 1) {
      fail(
        `multiple shared decisions claim the canonical generation ${currentGeneration} (fail-closed): ${direct
          .map((entry) => entry.group.decision.decisionId)
          .sort()
          .join(', ')}.`,
        { code: CONTROL_TOWER_DISPOSITION_RETURN_DECISION_CONFLICT, taskId },
      );
    }
    const chosen =
      direct.length === 1
        ? direct[0]
        : [...lineage].sort((left, right) => right.group.refGeneration - left.group.refGeneration)[0];
    const adoptedRecord = store.readDispositionGeneration(taskId, chosen.adoptedGeneration);
    return Object.freeze({
      status: 'EXACT_REPLAY',
      decision: chosen.group.decision,
      source: chosen.group.sources[0] ?? null,
      duplicateSourceCount: chosen.group.sources.length,
      observedDisposition: Object.freeze({
        dispositionRef: dispositionRef(taskId, currentGeneration),
        dispositionGeneration: currentGeneration,
        state: currentState,
      }),
      returnedDisposition: Object.freeze({
        dispositionRef: dispositionRef(taskId, adoptedRecord.dispositionGeneration),
        dispositionGeneration: adoptedRecord.dispositionGeneration,
        state: adoptedRecord.state,
        decidedAt: adoptedRecord.decidedAt,
      }),
    });
  }

  fail(
    `shared decision is stale (fail-closed, canonical state is never rewound or overwritten): canonical generation ${currentGeneration} state ${currentState}; decision(s) ${[...groups.values()]
      .map((group) => `${group.decision.decisionId}@${group.refGeneration}`)
      .sort()
      .join(', ')}.`,
    { code: CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE, taskId },
  );
}

function readCurrentDispositionRequired(store, taskId) {
  try {
    return store.readCurrentDisposition(taskId);
  } catch (error) {
    if (error?.code === 'DISPOSITION_NOT_FOUND') {
      fail(
        `task ${taskId} has a delivered canonical result but no Control Tower disposition pointer yet (fail-closed): run \`pnpm coordination:return ${taskId}\` first.`,
        { code: CONTROL_TOWER_DISPOSITION_RETURN_DISPOSITION_NOT_FOUND, taskId },
      );
    }
    throw error;
  }
}

function prepareReturnInputs({ store, taskId, authority } = {}) {
  assertReturnStoreCapabilities(store, taskId);
  const intake = deriveControlTowerResultIntake({ store, taskId, authority });
  const current = readCurrentDispositionRequired(store, taskId);
  return { intake, current };
}

/**
 * Derive the frozen disposition-return state for ONE delivered canonical result
 * WITHOUT writing anything: canonical result/authority binding, current
 * disposition, the shared decision set, and the exact selection outcome.
 * Transport failures propagate as transport errors (callers converge to
 * RETURN_PENDING) and every other violation fails closed.
 */
export async function deriveControlTowerDispositionReturn({
  store,
  taskId,
  authority,
  transport,
} = {}) {
  const { intake, current } = prepareReturnInputs({ store, taskId, authority });
  const read = await readSharedControlTowerDispositionDecisions({ transport, taskId });
  const selected = selectControlTowerDispositionReturn({
    store,
    taskId,
    intake,
    current,
    decisions: read.decisions,
  });
  return Object.freeze({
    intake,
    current,
    surface: read.surface,
    marker: read.marker,
    decisions: read.decisions,
    selected,
  });
}

function buildReturnProjection({
  status,
  taskId,
  intake,
  current,
  surface,
  selected,
  returnedDisposition,
  canonicalWrites,
  failureCode,
  failureMessage,
}) {
  return Object.freeze({
    schemaVersion: CONTROL_TOWER_DISPOSITION_RETURN_SCHEMA_VERSION,
    projection: 'control-tower-disposition-return',
    status,
    taskId,
    authorityKind: intake.authorityKind,
    authorityId: intake.authorityId,
    sourceTaskId: intake.sourceTaskId,
    emissionSlot: intake.emissionSlot,
    resultId: intake.resultId,
    resultBinding: intake.resultBinding,
    surface: surface ?? null,
    decision:
      selected?.decision === undefined || selected?.decision === null
        ? null
        : Object.freeze({
            decisionId: selected.decision.decisionId,
            decisionHash: selected.decision.decisionHash,
            dispositionRef: selected.decision.dispositionRef,
            dispositionState: selected.decision.dispositionState,
            targetDispositionState: selected.decision.targetDispositionState,
            decidedAt: selected.decision.decidedAt,
            controlTowerId: selected.decision.controlTowerId,
          }),
    decisionSource: selected?.source ?? null,
    duplicateDecisionSourceCount: selected?.duplicateSourceCount ?? 0,
    observedDisposition: Object.freeze({
      dispositionRef: dispositionRef(taskId, current.dispositionGeneration),
      dispositionGeneration: current.dispositionGeneration,
      state: current.state,
    }),
    returnedDisposition: returnedDisposition ?? null,
    canonicalWrites,
    executorInvocations: 0,
    manualCopyPasteRequired: false,
    failureCode: failureCode ?? null,
    failureMessage: failureMessage ?? null,
  });
}

function transportFailureCode(error) {
  // The concrete shared-surface transport belongs to the GF-08 relay module;
  // its transport failures are normalized to the return-native code so the
  // RETURN_PENDING contract stays stable for the disposition command.
  if (error instanceof ControlTowerResultRelayTransportError) {
    return CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT_UNAVAILABLE;
  }
  return typeof error?.code === 'string' && error.code
    ? error.code
    : CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT_UNAVAILABLE;
}

function pendingReturnProjection({ intake, current, error }) {
  return buildReturnProjection({
    status: CONTROL_TOWER_DISPOSITION_RETURN_STATUS_PENDING,
    taskId: intake.taskId,
    intake,
    current,
    surface: null,
    selected: null,
    returnedDisposition: null,
    canonicalWrites: 0,
    failureCode: transportFailureCode(error),
    failureMessage: redactControlTowerRelayText(
      error?.message ?? error,
      MAX_CONTROL_TOWER_DISPOSITION_RETURN_FAILURE_LENGTH,
    ),
  });
}

/**
 * Perform (or converge) the shared Control Tower disposition return for ONE
 * already delivered canonical result:
 *
 *   PENDING_DISPOSITION(taskId)@N
 *     -> shared Control Tower decision available   [non-canonical read]
 *     -> <target state>(taskId)@N+1                [existing disposition authority]
 *
 * The canonical store is written ONLY through store.writeDisposition, exactly
 * once per validated decision. TRANSPORT failure converges to RETURN_PENDING
 * with zero canonical change; exact replays converge with zero durable byte
 * changes; stale/conflicting decisions fail closed with zero writes.
 */
export async function performControlTowerDispositionReturn({
  store,
  taskId,
  authority,
  transport,
} = {}) {
  assertReturnStoreCapabilities(store, taskId);
  if (!store || typeof store.writeDisposition !== 'function') {
    fail(
      'control tower disposition return requires a caller-supplied store exposing writeDisposition (the EXISTING Control Tower disposition authority).',
      { code: INVALID_CONTROL_TOWER_DISPOSITION_RETURN_STORE, taskId },
    );
  }
  const { intake, current } = prepareReturnInputs({ store, taskId, authority });

  let read;
  try {
    read = await readSharedControlTowerDispositionDecisions({ transport, taskId });
  } catch (error) {
    if (isTransportError(error)) return pendingReturnProjection({ intake, current, error });
    throw error;
  }
  const selected = selectControlTowerDispositionReturn({
    store,
    taskId,
    intake,
    current,
    decisions: read.decisions,
  });

  if (selected.status === 'PENDING') {
    return buildReturnProjection({
      status: CONTROL_TOWER_DISPOSITION_RETURN_STATUS_PENDING,
      taskId,
      intake,
      current,
      surface: read.surface,
      selected: null,
      returnedDisposition: null,
      canonicalWrites: 0,
      failureCode: null,
      failureMessage: null,
    });
  }

  if (selected.status === 'EXACT_REPLAY') {
    return buildReturnProjection({
      status: CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY,
      taskId,
      intake,
      current,
      surface: read.surface,
      selected,
      returnedDisposition: selected.returnedDisposition,
      canonicalWrites: 0,
      failureCode: null,
      failureMessage: null,
    });
  }

  // ADOPTABLE: the ONE canonical write. The candidate is byte-deterministic
  // from the validated shared decision, so an identical crash/replay converges
  // through the existing same-generation first-wins fencing.
  const written = store.writeDisposition(selected.writeInput);
  let returnedRecord;
  try {
    returnedRecord = store.readCurrentDisposition(taskId);
  } catch (error) {
    fail(
      `canonical disposition read-back failed after the shared decision write (fail-closed): ${error?.message}`,
      { code: error?.code ?? CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION, taskId },
    );
  }
  if (
    returnedRecord.dispositionGeneration !== selected.targetGeneration ||
    returnedRecord.state !== selected.targetState ||
    !generationCarriesDecision(
      returnedRecord,
      selected.decision.decisionId,
      selected.decision.decisionHash,
      taskId,
    )
  ) {
    fail(
      `canonical disposition failed to converge to the validated shared decision (fail-closed): expected generation ${selected.targetGeneration} state ${selected.targetState}.`,
      { code: CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION, taskId },
    );
  }
  return buildReturnProjection({
    status:
      written.duplicate === true
        ? CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY
        : CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED,
    taskId,
    intake,
    current,
    surface: read.surface,
    selected,
    returnedDisposition: Object.freeze({
      dispositionRef: dispositionRef(taskId, returnedRecord.dispositionGeneration),
      dispositionGeneration: returnedRecord.dispositionGeneration,
      state: returnedRecord.state,
      decidedAt: returnedRecord.decidedAt,
    }),
    canonicalWrites: written.duplicate === true ? 0 : 1,
    failureCode: null,
    failureMessage: null,
  });
}
