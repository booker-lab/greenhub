// Bounded composition owner:
// GREENHUB-COORDINATION-SHARED-CONTROL-TOWER-RESULT-RELAY-GF08
// + the read-only shared-surface lookup extension for
//   GREENHUB-COORDINATION-SHARED-CONTROL-TOWER-DISPOSITION-RETURN-GF09
//   (findRelayIssue / findComments ONLY: both are read-only, create nothing,
//   author no verdict, and never write durable coordination bytes).
// Surface: scripts/coordination/*control-tower-result-relay* (this module + its
// proof spec) + the operator-facing `coordination:relay` composition and the
// automatic post-intake relay step inside the existing `coordination:run` ONLY
// (+ the bounded relay section of the real-execution proof harness). No
// store.mjs mutation, no new durable artifact, no new durable directory, no new
// JSON domain, and no new authority family: this module composes EXISTING
// canonical authorities and adds ONE non-canonical external projection.
//
// State transition added here:
//   PENDING_DISPOSITION(taskId)                          [GF-07 durable]
//     -> SHARED_CONTROL_TOWER_RESULT_AVAILABLE(taskId)   [non-canonical projection]
//
// Contract summary:
//   CANONICAL AUTHORITY REMAINS THE LOCAL COORDINATION STORE. The GitHub relay
//   is ONLY a non-canonical projection. No task lifecycle authority, claim
//   authority, result authority, disposition authority, DROP/WATCH/CHANGE
//   authority, verdict authority, publication authority, successor emission
//   authority, or user semantic decision authority moves to GitHub.
//   Required invariant: LOCAL_COORDINATION_TRUTH_INDEPENDENT_OF_RELAY.
//   SHARED_CONTROL_TOWER_RESULT_AVAILABLE is NOT a durable canonical task
//   state: it only means the external projection is readable. This module must
//   never write durable coordination bytes, never invoke an executor, never
//   author a verdict, never advance a disposition generation, and never emit a
//   successor.
//
// Reused canonical authorities (never re-authored):
//   - the GF-07 derived Control Tower intake envelope
//     (deriveControlTowerResultIntake) is the ONLY source of task/result/claim/
//     authority binding; this module re-reads it read-only before projecting,
//   - the canonical current disposition pointer (store.readCurrentDisposition,
//     PENDING or later) is the projected disposition provenance,
//   - the EXISTING result content binding (intake.resultBinding).
//
// Relay identity / idempotency:
//   logical relay identity = (taskId, resultId, resultBinding)
//     -> relayId = `ctrlrelay_<sha256(taskId \0 resultId \0 resultBinding)[:32]>`
//   deterministic marker  = `<!-- greenhub-control-tower-relay:v1:TASK_ID:RESULT_ID -->`
//   The marker is stable across crash/replay and is used to find one existing
//   projection comment after a crash. The projection document is byte-
//   deterministic (no clock, pid, hostname, or random participates), so a
//   replay recomputes the exact same bytes and converges to the existing
//   comment instead of creating a second semantic result.
//
// Crash recovery:
//   A. PENDING_DISPOSITION durable, relay not attempted -> replay projects.
//   B. GitHub comment created, process crashed before reporting -> replay finds
//      the deterministic marker and converges as EXACT_REPLAY (no second
//      comment, no local acknowledgement exists to lose).
//   C. already relayed -> GitHub mutation count 0; identity replay.
//   D. same marker but a different logidal identity (resultBinding/resultId
//      drift) -> FAIL CLOSED; last-writer-wins is never used.
//   Race duplicates (both writers created a comment): all exact-identity
//   duplicates converge read-only to the oldest comment; any non-matching or
//   malformed projection fails closed and nothing is rewritten.
//
// Failure policy (GitHub unavailable / auth unavailable / CLI missing):
//   the canonical result and PENDING_DISPOSITION remain untouched; no result is
//   lost; no executor retry exists; no verdict is authored; no publication
//   rollback occurs. The relay reports the explicit projection status
//   RELAY_PENDING (or RELAY_NOT_CONFIGURED when no transport is configured)
//   WITHOUT creating any new canonical task lifecycle state.
//
// Secret policy:
//   The projection carries only bounded canonical result fields (summary,
//   refs, friction) plus provenance identifiers. Environment variables, tokens,
//   credential values, coordination-home dumps, raw logs, and arbitrary file
//   content are never projected. Transport failure detail is redacted and
//   bounded before it appears in any projection output.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here or in the store):
//   automatic Control Tower verdicts (DROP/WATCH/CHANGE/ADOPTED/REJECTED/
//   SUPERSEDED/BLOCKED/Pilot GO), scheduler, daemon, polling loop, watchdog,
//   cron, retry/backoff, Google Drive / Notion / Slack / email integration,
//   repository Result Inbox files, materialization/ACK/CONSUMED/cursor/
//   successor emission, executor invocation, mutation capability, production
//   deploy, semantic authority relocation to GitHub.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { deriveControlTowerResultIntake } from './control-tower-result-intake.mjs';
import { DISPOSITION_STATES } from './disposition.mjs';
import { TASK_ID_PATTERN } from './task-envelope.mjs';

const execFileAsync = promisify(execFile);

export const CONTROL_TOWER_RESULT_RELAY_SCHEMA_VERSION = '1';
export const CONTROL_TOWER_RESULT_RELAY_ID_PREFIX = 'ctrlrelay_';
export const CONTROL_TOWER_RESULT_RELAY_MARKER_VERSION = 'v1';
export const CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE = 'Greenhub Control Tower Result Relay';

// Fixed, bounded, non-secret issue header for the ONE dedicated relay issue.
// The issue is reused by exact title; it is created only when it does not exist.
export const CONTROL_TOWER_RESULT_RELAY_ISSUE_BODY = Object.freeze(
  [
    'NON-CANONICAL PROJECTION ONLY.',
    '',
    'Canonical coordination truth lives in the local Coordination Store. This',
    'issue/comment surface is a readable projection of already delivered',
    'canonical results for the Control Tower. Deleting, duplicating, or failing',
    'this surface must never change canonical coordination state, and no task',
    'lifecycle, result, disposition, verdict, publication, or successor',
    'authority exists here.',
    '',
    'Each comment below is ONE delivered canonical result projection with a',
    'deterministic marker and a bounded machine-readable document.',
  ].join('\n'),
);

// Projection statuses (transport/readability meanings ONLY, never canonical
// task lifecycle states).
export const CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED = 'RELAYED';
export const CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY = 'EXACT_REPLAY';
export const CONTROL_TOWER_RESULT_RELAY_STATUS_PENDING = 'RELAY_PENDING';
export const CONTROL_TOWER_RESULT_RELAY_STATUS_NOT_CONFIGURED = 'RELAY_NOT_CONFIGURED';

// Explicit external-surface configuration. Relay is an external service
// mutation: it is enabled only by an explicit repository binding, never
// inferred from a git remote, cwd, or the task payload.
export const CONTROL_TOWER_RELAY_REPO_ENV_KEY = 'GREENHUB_CONTROL_TOWER_RELAY_REPO';
export const CONTROL_TOWER_RELAY_GH_PATH_ENV_KEY = 'GREENHUB_CONTROL_TOWER_RELAY_GH_PATH';
export const DEFAULT_CONTROL_TOWER_RELAY_GH_PATH = 'gh';

export const MAX_CONTROL_TOWER_RESULT_RELAY_JSON_BYTES = 24 * 1024;
export const MAX_CONTROL_TOWER_RESULT_RELAY_BODY_LENGTH = 32 * 1024;
export const MAX_CONTROL_TOWER_RESULT_RELAY_FAILURE_LENGTH = 300;
export const MAX_CONTROL_TOWER_RESULT_RELAY_ISSUE_LIST = 100;

// Relay-native meanings ONLY. Fail-closed integrity/binding violations use
// these codes; canonical authority errors propagate their EXISTING store/GF-07
// codes UNCHANGED (never re-coded, never repaired).
export const CORRUPT_CONTROL_TOWER_RESULT_RELAY = 'CORRUPT_CONTROL_TOWER_RESULT_RELAY';
export const INVALID_CONTROL_TOWER_RESULT_RELAY_STORE =
  'INVALID_CONTROL_TOWER_RESULT_RELAY_STORE';
export const INVALID_CONTROL_TOWER_RESULT_RELAY_TRANSPORT =
  'INVALID_CONTROL_TOWER_RESULT_RELAY_TRANSPORT';
export const CONTROL_TOWER_RESULT_RELAY_DISPOSITION_NOT_FOUND =
  'CONTROL_TOWER_RESULT_RELAY_DISPOSITION_NOT_FOUND';
export const CONTROL_TOWER_RESULT_RELAY_DISPOSITION_BINDING_MISMATCH =
  'CONTROL_TOWER_RESULT_RELAY_DISPOSITION_BINDING_MISMATCH';
export const CONTROL_TOWER_RESULT_RELAY_PROJECTION_BINDING_MISMATCH =
  'CONTROL_TOWER_RESULT_RELAY_PROJECTION_BINDING_MISMATCH';
export const CONTROL_TOWER_RESULT_RELAY_PROJECTION_CORRUPT =
  'CONTROL_TOWER_RESULT_RELAY_PROJECTION_CORRUPT';
export const CONTROL_TOWER_RESULT_RELAY_REPOSITORY_INVALID =
  'CONTROL_TOWER_RESULT_RELAY_REPOSITORY_INVALID';
export const CONTROL_TOWER_RESULT_RELAY_TRANSPORT_UNAVAILABLE =
  'CONTROL_TOWER_RESULT_RELAY_TRANSPORT_UNAVAILABLE';

// Exact projection document shape, in fixed order.
export const CONTROL_TOWER_RESULT_RELAY_DOCUMENT_FIELDS = Object.freeze([
  'schemaVersion',
  'relayId',
  'taskId',
  'taskKind',
  'resultId',
  'resultBinding',
  'dispositionRef',
  'dispositionState',
  'resultStatus',
  'summary',
  'proofRefs',
  'evidenceRefs',
  'frictionObserved',
  'canonicalAuthorityKind',
  'canonicalAuthorityId',
  'canonicalAuthoritySourceTaskId',
  'canonicalAuthorityEmissionSlot',
  'claimGeneration',
  'deliveredAt',
]);

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RESULT_ID_MAX_LENGTH = 128;

const SECRET_PATTERNS = Object.freeze([
  /\bgh[opusr]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
]);

export class ControlTowerResultRelayError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ControlTowerResultRelayError';
    this.code = details.code ?? CORRUPT_CONTROL_TOWER_RESULT_RELAY;
    this.taskId = details.taskId ?? null;
  }
}

// Transport failures are the ONLY catchable relay errors: they converge to
// RELAY_PENDING because canonical truth is unaffected. Integrity/binding
// failures are ControlTowerResultRelayError instances and always fail closed.
export class ControlTowerResultRelayTransportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ControlTowerResultRelayTransportError';
    this.code = details.code ?? CONTROL_TOWER_RESULT_RELAY_TRANSPORT_UNAVAILABLE;
    this.taskId = details.taskId ?? null;
  }
}

function fail(message, details = {}) {
  throw new ControlTowerResultRelayError(message, details);
}

function failTransport(message, details = {}) {
  throw new ControlTowerResultRelayTransportError(message, details);
}

function assertValidTaskId(taskId, code = CORRUPT_CONTROL_TOWER_RESULT_RELAY) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, { code });
  }
  return taskId;
}

function assertValidResultId(resultId, taskId) {
  if (
    typeof resultId !== 'string' ||
    !resultId.trim() ||
    resultId.length > RESULT_ID_MAX_LENGTH
  ) {
    fail('resultId must be a non-empty bounded string for relay identity.', { taskId });
  }
  if (resultId.includes('/') || resultId.includes('\\') || resultId.includes('..')) {
    fail('resultId must not contain path separators or "..".', { taskId });
  }
  return resultId;
}

/**
 * Redact credential-looking substrings from any text that may be echoed into a
 * projection/report. Bounded single-line, control-character free.
 */
export function redactControlTowerRelayText(value, maxLength = MAX_CONTROL_TOWER_RESULT_RELAY_FAILURE_LENGTH) {
  let text = typeof value === 'string' ? value : String(value ?? '');
  text = text.split(/\r?\n/, 1)[0] ?? '';
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[REDACTED]');
  }
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}...`;
  return text;
}

/**
 * Deterministic logical relay identity: `ctrlrelay_<sha256(taskId \0 resultId
 * \0 resultBinding)[:32]>`. Identity participates in the marker-independent
 * document comparison and in replay convergence; clock/pid/hostname/random
 * never participate.
 */
export function buildControlTowerResultRelayId({ taskId, resultId, resultBinding }) {
  assertValidTaskId(taskId);
  assertValidResultId(resultId, taskId);
  if (typeof resultBinding !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(resultBinding)) {
    fail('resultBinding must be a stable content hash of form "sha256:<64 hex>".', { taskId });
  }
  const digest = createHash('sha256')
    .update(taskId, 'utf8')
    .update('\0', 'utf8')
    .update(resultId, 'utf8')
    .update('\0', 'utf8')
    .update(resultBinding, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `${CONTROL_TOWER_RESULT_RELAY_ID_PREFIX}${digest}`;
}

/** Deterministic projection marker for one (taskId, resultId) pair. */
export function buildControlTowerResultRelayMarker({ taskId, resultId }) {
  assertValidTaskId(taskId);
  assertValidResultId(resultId, taskId);
  return `<!-- greenhub-control-tower-relay:${CONTROL_TOWER_RESULT_RELAY_MARKER_VERSION}:${taskId}:${resultId} -->`;
}

function assertRelayStoreCapabilities(store, taskId) {
  if (
    !store ||
    typeof store.readTask !== 'function' ||
    typeof store.readResult !== 'function' ||
    typeof store.readClaim !== 'function' ||
    typeof store.readCurrentDisposition !== 'function'
  ) {
    fail(
      'control tower result relay requires a caller-supplied store exposing readTask / readResult / readClaim / readCurrentDisposition (composition only; reads are the only store interaction).',
      { code: INVALID_CONTROL_TOWER_RESULT_RELAY_STORE, taskId },
    );
  }
}

function assertDispositionBindsResult(disposition, intake, taskId) {
  if (
    disposition === null ||
    typeof disposition !== 'object' ||
    Array.isArray(disposition)
  ) {
    fail('the current disposition pointer is not a plain record (fail-closed, no repair).', {
      code: CORRUPT_CONTROL_TOWER_RESULT_RELAY,
      taskId,
    });
  }
  if (!DISPOSITION_STATES.includes(disposition.state)) {
    fail(`disposition state must be one of ${DISPOSITION_STATES.join(', ')}.`, {
      code: CORRUPT_CONTROL_TOWER_RESULT_RELAY,
      taskId,
    });
  }
  if (!Number.isInteger(disposition.dispositionGeneration) || disposition.dispositionGeneration < 1) {
    fail('dispositionGeneration must be an integer >= 1.', {
      code: CORRUPT_CONTROL_TOWER_RESULT_RELAY,
      taskId,
    });
  }
  if (
    disposition.resultId !== intake.resultId ||
    disposition.resultBinding !== intake.resultBinding ||
    disposition.claimGeneration !== intake.claimGeneration
  ) {
    fail(
      `the existing disposition does not bind to the delivered canonical result (fail-closed): disposition ${disposition.dispositionGeneration} is not the projected result ${intake.resultId}.`,
      { code: CONTROL_TOWER_RESULT_RELAY_DISPOSITION_BINDING_MISMATCH, taskId },
    );
  }
  return disposition;
}

function validateRelayDocument(document) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    fail('control tower relay document must be a plain object.', {
      code: CORRUPT_CONTROL_TOWER_RESULT_RELAY,
    });
  }
  const keys = Object.keys(document);
  if (keys.length !== CONTROL_TOWER_RESULT_RELAY_DOCUMENT_FIELDS.length) {
    fail(
      `control tower relay document must carry exactly ${CONTROL_TOWER_RESULT_RELAY_DOCUMENT_FIELDS.length} fields (${CONTROL_TOWER_RESULT_RELAY_DOCUMENT_FIELDS.join(', ')}).`,
      { code: CORRUPT_CONTROL_TOWER_RESULT_RELAY },
    );
  }
  for (let index = 0; index < CONTROL_TOWER_RESULT_RELAY_DOCUMENT_FIELDS.length; index += 1) {
    if (keys[index] !== CONTROL_TOWER_RESULT_RELAY_DOCUMENT_FIELDS[index]) {
      fail(
        `control tower relay document key order/shape mismatch at position ${index}: expected "${CONTROL_TOWER_RESULT_RELAY_DOCUMENT_FIELDS[index]}" got "${keys[index]}".`,
        { code: CORRUPT_CONTROL_TOWER_RESULT_RELAY },
      );
    }
  }
  if (document.schemaVersion !== CONTROL_TOWER_RESULT_RELAY_SCHEMA_VERSION) {
    fail(
      `control tower relay schemaVersion must be ${JSON.stringify(CONTROL_TOWER_RESULT_RELAY_SCHEMA_VERSION)}.`,
      { code: 'INVALID_SCHEMA_VERSION' },
    );
  }
  const taskId = assertValidTaskId(document.taskId);
  assertValidResultId(document.resultId, taskId);
  const expectedRelayId = buildControlTowerResultRelayId({
    taskId,
    resultId: document.resultId,
    resultBinding: document.resultBinding,
  });
  if (document.relayId !== expectedRelayId) {
    fail(`relayId mismatch (expected ${expectedRelayId}).`, {
      code: CONTROL_TOWER_RESULT_RELAY_PROJECTION_BINDING_MISMATCH,
      taskId,
    });
  }
  const json = JSON.stringify(document);
  if (json.length > MAX_CONTROL_TOWER_RESULT_RELAY_JSON_BYTES) {
    fail(
      `control tower relay document JSON is ${json.length} bytes (> ${MAX_CONTROL_TOWER_RESULT_RELAY_JSON_BYTES}): reference-first, no embedded dumps.`,
      { code: 'CONTEXT_BUDGET_EXCEEDED', taskId },
    );
  }
  return Object.freeze({ ...document });
}

/**
 * Derive the frozen non-canonical relay projection document for ONE already
 * delivered canonical result whose disposition is PENDING or later. Pure read:
 * zero durable writes, zero executor invocations, zero GitHub calls.
 *
 * Fail-closed cases (no document is returned):
 *   - any GF-07 intake derivation failure (task/result/claim/authority binding
 *     errors propagate their existing codes UNCHANGED),
 *   - no current disposition yet (run `coordination:return` first),
 *   - the current disposition does not bind the delivered result.
 */
export function deriveControlTowerResultRelay({ store, taskId, authority } = {}) {
  assertRelayStoreCapabilities(store, taskId);
  assertValidTaskId(taskId);
  const intake = deriveControlTowerResultIntake({ store, taskId, authority });
  let disposition;
  try {
    disposition = store.readCurrentDisposition(taskId);
  } catch (error) {
    if (error?.code === 'DISPOSITION_NOT_FOUND') {
      fail(
        `task ${taskId} has a delivered canonical result but no Control Tower disposition pointer yet (fail-closed): run \`pnpm coordination:return ${taskId}\` first.`,
        { code: CONTROL_TOWER_RESULT_RELAY_DISPOSITION_NOT_FOUND, taskId },
      );
    }
    throw error;
  }
  assertDispositionBindsResult(disposition, intake, taskId);

  const relayId = buildControlTowerResultRelayId({
    taskId,
    resultId: intake.resultId,
    resultBinding: intake.resultBinding,
  });
  const document = validateRelayDocument({
    schemaVersion: CONTROL_TOWER_RESULT_RELAY_SCHEMA_VERSION,
    relayId,
    taskId,
    taskKind: intake.taskKind,
    resultId: intake.resultId,
    resultBinding: intake.resultBinding,
    dispositionRef: `${taskId}@${disposition.dispositionGeneration}`,
    dispositionState: disposition.state,
    resultStatus: intake.result.status,
    summary: intake.result.summary,
    proofRefs: intake.result.proofRefs ?? [],
    evidenceRefs: intake.result.evidenceRefs ?? [],
    frictionObserved: intake.result.frictionObserved ?? [],
    canonicalAuthorityKind: intake.authorityKind,
    canonicalAuthorityId: intake.authorityId,
    canonicalAuthoritySourceTaskId: intake.sourceTaskId,
    canonicalAuthorityEmissionSlot: intake.emissionSlot,
    claimGeneration: intake.claimGeneration,
    deliveredAt: intake.result.deliveredAt,
  });
  const marker = buildControlTowerResultRelayMarker({
    taskId,
    resultId: intake.resultId,
  });
  const body = renderControlTowerResultRelayBody(document, { marker });
  return Object.freeze({
    schemaVersion: CONTROL_TOWER_RESULT_RELAY_SCHEMA_VERSION,
    projection: 'control-tower-result-relay-document',
    marker,
    relayId,
    document,
    body,
    intake,
    disposition,
  });
}

/**
 * Render the exact GitHub comment body for one relay document: deterministic
 * marker first, bounded human summary, and the machine-readable JSON block
 * (the only part parsed back during reconciliation).
 */
export function renderControlTowerResultRelayBody(document, { marker } = {}) {
  const expectedMarker = marker ?? buildControlTowerResultRelayMarker(document);
  const lines = [
    expectedMarker,
    '',
    '### Greenhub Control Tower Result Relay',
    '',
    'Canonical coordination truth remains in the local Coordination Store; this comment is a non-canonical projection only.',
    '',
    `- taskId: ${document.taskId}`,
    `- resultId: ${document.resultId}`,
    `- resultBinding: ${document.resultBinding}`,
    `- dispositionRef: ${document.dispositionRef}`,
    `- dispositionState: ${document.dispositionState}`,
    `- resultStatus: ${document.resultStatus}`,
    `- canonicalAuthority: ${document.canonicalAuthorityKind} ${document.canonicalAuthorityId}`,
    `- deliveredAt: ${document.deliveredAt}`,
    '',
    '```json',
    JSON.stringify(document, null, 2),
    '```',
  ];
  const body = lines.join('\n');
  if (body.length > MAX_CONTROL_TOWER_RESULT_RELAY_BODY_LENGTH) {
    fail(
      `control tower relay comment body is ${body.length} chars (> ${MAX_CONTROL_TOWER_RESULT_RELAY_BODY_LENGTH}): reference-first, no embedded dumps.`,
      { code: 'CONTEXT_BUDGET_EXCEEDED', taskId: document.taskId },
    );
  }
  return body;
}

/**
 * Parse the machine-readable document out of one relay projection body.
 * Returns a frozen document, or null when the body does not carry a valid
 * relay document. Never repairs.
 */
export function parseControlTowerResultRelayProjection(body) {
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
  const keys = Object.keys(parsed);
  if (keys.length !== CONTROL_TOWER_RESULT_RELAY_DOCUMENT_FIELDS.length) return null;
  for (let index = 0; index < CONTROL_TOWER_RESULT_RELAY_DOCUMENT_FIELDS.length; index += 1) {
    if (keys[index] !== CONTROL_TOWER_RESULT_RELAY_DOCUMENT_FIELDS[index]) return null;
  }
  const expectedRelayId = (() => {
    try {
      return buildControlTowerResultRelayId({
        taskId: parsed.taskId,
        resultId: parsed.resultId,
        resultBinding: parsed.resultBinding,
      });
    } catch {
      return null;
    }
  })();
  if (expectedRelayId === null || parsed.relayId !== expectedRelayId) return null;
  return Object.freeze({ ...parsed });
}

function assertRelayTransport(transport, taskId) {
  if (
    !transport ||
    typeof transport.ensureRelayIssue !== 'function' ||
    typeof transport.findProjections !== 'function' ||
    typeof transport.createProjection !== 'function'
  ) {
    fail(
      'control tower result relay requires a caller-supplied transport exposing ensureRelayIssue / findProjections / createProjection (composition only; the operator CLI supplies the configured GitHub transport).',
      { code: INVALID_CONTROL_TOWER_RESULT_RELAY_TRANSPORT, taskId },
    );
  }
}

function relayPendingProjection({ derived, error }) {
  return Object.freeze({
    schemaVersion: CONTROL_TOWER_RESULT_RELAY_SCHEMA_VERSION,
    projection: 'control-tower-result-relay',
    status: CONTROL_TOWER_RESULT_RELAY_STATUS_PENDING,
    taskId: derived.document.taskId,
    relayId: derived.relayId,
    marker: derived.marker,
    issue: null,
    comment: null,
    duplicateProjectionCount: 0,
    failureCode:
      typeof error?.code === 'string' && error.code
        ? error.code
        : CONTROL_TOWER_RESULT_RELAY_TRANSPORT_UNAVAILABLE,
    failureMessage: redactControlTowerRelayText(error?.message ?? error),
    canonicalWrites: 0,
    executorInvocations: 0,
    document: derived.document,
  });
}

function normalizeProjectionComment(entry, taskId) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    fail('relay transport returned a non-object projection comment (fail-closed).', {
      code: CONTROL_TOWER_RESULT_RELAY_PROJECTION_CORRUPT,
      taskId,
    });
  }
  return entry;
}

/**
 * Perform (or converge) the shared Control Tower result relay for ONE already
 * delivered canonical result:
 *
 *   PENDING_DISPOSITION(taskId)
 *     -> SHARED_CONTROL_TOWER_RESULT_AVAILABLE(taskId)   [non-canonical]
 *
 * The canonical store is read-only here. The deterministic marker is searched
 * first; an exact-identity projection converges read-only (zero GitHub
 * mutations), a conflicting projection fails closed, and a missing projection
 * is created exactly once. Transport failures converge to RELAY_PENDING with
 * zero canonical change.
 *
 * Returns a frozen projection:
 *   status RELAYED       -> a new comment was created now,
 *   status EXACT_REPLAY  -> the same logical relay already existed; 0 mutations,
 *   status RELAY_PENDING -> transport unavailable; canonical truth unchanged.
 */
export async function performControlTowerResultRelay({
  store,
  taskId,
  authority,
  transport,
} = {}) {
  const derived = deriveControlTowerResultRelay({ store, taskId, authority });
  assertRelayTransport(transport, taskId);

  let issue;
  let existing;
  try {
    issue = await transport.ensureRelayIssue({
      title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
      body: CONTROL_TOWER_RESULT_RELAY_ISSUE_BODY,
    });
    if (
      issue === null ||
      typeof issue !== 'object' ||
      !Number.isInteger(issue.issueNumber) ||
      issue.issueNumber < 1
    ) {
      failTransport('relay transport returned an invalid relay issue identity.', {
        taskId,
      });
    }
    existing = await transport.findProjections({
      issueNumber: issue.issueNumber,
      marker: derived.marker,
    });
  } catch (error) {
    if (error instanceof ControlTowerResultRelayError) throw error;
    if (error instanceof ControlTowerResultRelayTransportError) {
      return relayPendingProjection({ derived, error });
    }
    throw error;
  }
  if (!Array.isArray(existing)) {
    fail('relay transport returned a non-array projection list (fail-closed).', {
      code: CONTROL_TOWER_RESULT_RELAY_PROJECTION_CORRUPT,
      taskId,
    });
  }

  // Deterministic reconciliation: every comment carrying this marker must be
  // the SAME logical relay identity. Any drift or malformed projection fails
  // closed; nothing is overwritten or deleted (no last-writer-wins).
  const matches = [];
  for (const rawEntry of existing) {
    const entry = normalizeProjectionComment(rawEntry, taskId);
    const document = parseControlTowerResultRelayProjection(entry.body);
    if (document === null) {
      fail(
        `an existing relay projection carries the deterministic marker but not a valid relay document (fail-closed, no repair): comment ${String(entry.commentId)}.`,
        { code: CONTROL_TOWER_RESULT_RELAY_PROJECTION_CORRUPT, taskId },
      );
    }
    if (document.relayId !== derived.relayId) {
      fail(
        `an existing relay projection carries the same marker but a different logical relay identity (fail-closed, no last-writer-wins): expected ${derived.relayId} got ${document.relayId}.`,
        { code: CONTROL_TOWER_RESULT_RELAY_PROJECTION_BINDING_MISMATCH, taskId },
      );
    }
    matches.push({ entry, document });
  }
  const issueProjection = Object.freeze({
    issueNumber: issue.issueNumber,
    url: typeof issue.url === 'string' ? issue.url : null,
    created: issue.created === true,
  });

  if (matches.length > 0) {
    const first = matches[0];
    return Object.freeze({
      schemaVersion: CONTROL_TOWER_RESULT_RELAY_SCHEMA_VERSION,
      projection: 'control-tower-result-relay',
      status: CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY,
      taskId,
      relayId: derived.relayId,
      marker: derived.marker,
      issue: issueProjection,
      comment: Object.freeze({
        commentId: first.entry.commentId ?? null,
        url: typeof first.entry.url === 'string' ? first.entry.url : null,
        createdAt: typeof first.entry.createdAt === 'string' ? first.entry.createdAt : null,
      }),
      duplicateProjectionCount: matches.length,
      failureCode: null,
      failureMessage: null,
      canonicalWrites: 0,
      executorInvocations: 0,
      document: derived.document,
    });
  }

  let created;
  try {
    created = await transport.createProjection({
      issueNumber: issue.issueNumber,
      marker: derived.marker,
      body: derived.body,
    });
  } catch (error) {
    if (error instanceof ControlTowerResultRelayError) throw error;
    if (error instanceof ControlTowerResultRelayTransportError) {
      return relayPendingProjection({ derived, error });
    }
    throw error;
  }
  if (
    created === null ||
    typeof created !== 'object' ||
    Array.isArray(created) ||
    typeof created.body !== 'string'
  ) {
    return relayPendingProjection({
      derived,
      error: new ControlTowerResultRelayTransportError(
        'relay transport did not confirm the created projection body.',
        { taskId },
      ),
    });
  }
  const createdDocument = parseControlTowerResultRelayProjection(created.body);
  if (createdDocument === null || createdDocument.relayId !== derived.relayId) {
    fail(
      'the created relay projection read-back does not match the derived document (fail-closed).',
      { code: CONTROL_TOWER_RESULT_RELAY_PROJECTION_BINDING_MISMATCH, taskId },
    );
  }
  return Object.freeze({
    schemaVersion: CONTROL_TOWER_RESULT_RELAY_SCHEMA_VERSION,
    projection: 'control-tower-result-relay',
    status: CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED,
    taskId,
    relayId: derived.relayId,
    marker: derived.marker,
    issue: issueProjection,
    comment: Object.freeze({
      commentId: created.commentId ?? null,
      url: typeof created.url === 'string' ? created.url : null,
      createdAt: typeof created.createdAt === 'string' ? created.createdAt : null,
    }),
    duplicateProjectionCount: 0,
    failureCode: null,
    failureMessage: null,
    canonicalWrites: 0,
    executorInvocations: 0,
    document: derived.document,
  });
}

function assertValidRelayRepository(repository) {
  if (typeof repository !== 'string' || !repository.trim() || !REPOSITORY_PATTERN.test(repository)) {
    fail(
      `relay repository must be an explicit "owner/name" GitHub repository (got ${JSON.stringify(repository)}).`,
      { code: CONTROL_TOWER_RESULT_RELAY_REPOSITORY_INVALID },
    );
  }
  return repository;
}

function parseJsonOutput(stdout, context, taskId = null) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    failTransport(`GitHub CLI ${context} returned non-JSON output: ${error?.message}`, { taskId });
  }
  return null;
}

function flattenCommentPages(parsed) {
  if (!Array.isArray(parsed)) return [];
  const entries = [];
  for (const page of parsed) {
    if (Array.isArray(page)) entries.push(...page);
    else if (page !== null && page !== undefined) entries.push(page);
  }
  return entries;
}

/**
 * Concrete GitHub issue-comment transport for the relay project the canonical
 * result. ONE dedicated issue is reused by exact title; each logical relay is
 * one comment. The transport never touches the repository worktree and never
 * performs Git operations: it only runs the `gh` CLI (argv-only, shell-free).
 *
 * The implementation is injectable (`execFileImpl`) for focused proofs; the
 * default uses `child_process.execFile`.
 */
export function createGitHubIssueCommentRelayTransport({
  repository,
  ghPath = DEFAULT_CONTROL_TOWER_RELAY_GH_PATH,
  execFileImpl,
} = {}) {
  const targetRepository = assertValidRelayRepository(repository);
  if (typeof ghPath !== 'string' || !ghPath.trim()) {
    fail('relay gh path must be a non-empty executable path/name.', {
      code: INVALID_CONTROL_TOWER_RESULT_RELAY_TRANSPORT,
    });
  }
  const exec = execFileImpl ?? execFileAsync;

  async function runGh(args, context, taskId = null) {
    let result;
    try {
      result = await exec(ghPath, args, {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      const detail = redactControlTowerRelayText(
        error?.stderr || error?.message || String(error),
      );
      failTransport(`GitHub CLI ${context} failed: ${detail}`, { taskId });
    }
    const stdout = typeof result === 'string' ? result : result?.stdout;
    if (typeof stdout !== 'string') {
      failTransport(`GitHub CLI ${context} returned no stdout.`, { taskId });
    }
    return stdout;
  }

  async function searchExactIssuesByTitle(title) {
    const searchOut = await runGh(
      [
        'issue',
        'list',
        '--repo',
        targetRepository,
        '--state',
        'all',
        '--limit',
        String(MAX_CONTROL_TOWER_RESULT_RELAY_ISSUE_LIST),
        '--search',
        `in:title ${title}`,
        '--json',
        'number,title,state,url',
      ],
      'issue search',
    );
    const issues = parseJsonOutput(searchOut, 'issue search');
    if (!Array.isArray(issues)) {
      failTransport('GitHub CLI issue search returned a non-array payload.');
    }
    return issues
      .filter(
        (entry) =>
          entry !== null &&
          typeof entry === 'object' &&
          entry.title === title &&
          Number.isInteger(entry.number) &&
          entry.number > 0,
      )
      .sort((left, right) => {
        const leftOpen = left.state === 'OPEN' ? 0 : 1;
        const rightOpen = right.state === 'OPEN' ? 0 : 1;
        if (leftOpen !== rightOpen) return leftOpen - rightOpen;
        return left.number - right.number;
      });
  }

  async function findCommentsByMarker({ issueNumber, marker }) {
    if (!Number.isInteger(issueNumber) || issueNumber < 1) {
      failTransport('comment lookup requires a valid issue number.');
    }
    const stdout = await runGh(
      [
        'api',
        '--paginate',
        '--slurp',
        `repos/${targetRepository}/issues/${issueNumber}/comments?per_page=100`,
      ],
      'comment list',
    );
    const pages = parseJsonOutput(stdout, 'comment list');
    const comments = flattenCommentPages(pages);
    return comments
      .filter(
        (entry) =>
          entry !== null &&
          typeof entry === 'object' &&
          typeof entry.body === 'string' &&
          entry.body.includes(marker),
      )
      .map((entry) => ({
        commentId: Number.isInteger(entry.id) ? entry.id : null,
        url: typeof entry.html_url === 'string' ? entry.html_url : null,
        createdAt: typeof entry.created_at === 'string' ? entry.created_at : null,
        body: entry.body,
      }))
      .sort((left, right) => (left.commentId ?? 0) - (right.commentId ?? 0));
  }

  return Object.freeze({
    repository: targetRepository,

    /**
     * READ-ONLY exact-title relay issue lookup. Returns null when no exact-title
     * issue exists (it never creates one) and carries `duplicateIssueCount` so
     * callers can fail closed on an ambiguous shared surface.
     */
    async findRelayIssue({ title }) {
      const exact = await searchExactIssuesByTitle(title);
      if (exact.length === 0) return null;
      const winner = exact[0];
      return {
        issueNumber: winner.number,
        url: typeof winner.url === 'string' ? winner.url : null,
        state: winner.state ?? null,
        duplicateIssueCount: exact.length,
      };
    },

    async ensureRelayIssue({ title, body }) {
      const exact = await searchExactIssuesByTitle(title);
      if (exact.length > 0) {
        const winner = exact[0];
        return {
          issueNumber: winner.number,
          url: typeof winner.url === 'string' ? winner.url : null,
          state: winner.state ?? null,
          created: false,
          duplicateIssueCount: exact.length,
        };
      }
      const createdOut = await runGh(
        [
          'api',
          `repos/${targetRepository}/issues`,
          '-X',
          'POST',
          '-f',
          `title=${title}`,
          '-f',
          `body=${body}`,
        ],
        'issue create',
      );
      const created = parseJsonOutput(createdOut, 'issue create');
      if (
        created === null ||
        typeof created !== 'object' ||
        !Number.isInteger(created.number) ||
        created.number < 1
      ) {
        failTransport('GitHub CLI issue create did not return an issue number.');
      }
      return {
        issueNumber: created.number,
        url: typeof created.html_url === 'string' ? created.html_url : null,
        state: created.state ?? null,
        created: true,
        duplicateIssueCount: 0,
      };
    },

    async findProjections({ issueNumber, marker }) {
      return findCommentsByMarker({ issueNumber, marker });
    },

    /**
     * READ-ONLY marker-filtered comment lookup over the shared surface. Shared
     * by the relay projection reconciliation (findProjections) and the GF-09
     * shared decision read; create nothing, rewrite nothing, delete nothing.
     */
    async findComments({ issueNumber, marker }) {
      return findCommentsByMarker({ issueNumber, marker });
    },

    async createProjection({ issueNumber, marker, body }) {
      if (!Number.isInteger(issueNumber) || issueNumber < 1) {
        failTransport('createProjection requires a valid issue number.');
      }
      if (typeof body !== 'string' || !body.includes(marker)) {
        fail('refusing to create a projection whose body does not carry its deterministic marker.', {
          code: CONTROL_TOWER_RESULT_RELAY_PROJECTION_CORRUPT,
        });
      }
      const stdout = await runGh(
        [
          'api',
          `repos/${targetRepository}/issues/${issueNumber}/comments`,
          '-X',
          'POST',
          '-f',
          `body=${body}`,
        ],
        'comment create',
      );
      const created = parseJsonOutput(stdout, 'comment create');
      if (created === null || typeof created !== 'object') {
        failTransport('GitHub CLI comment create returned an invalid payload.');
      }
      return {
        commentId: Number.isInteger(created.id) ? created.id : null,
        url: typeof created.html_url === 'string' ? created.html_url : null,
        createdAt: typeof created.created_at === 'string' ? created.created_at : null,
        body: typeof created.body === 'string' ? created.body : null,
      };
    },

    async readProjection({ commentId }) {
      if (!Number.isInteger(commentId) || commentId < 1) {
        failTransport('readProjection requires a valid comment id.');
      }
      const stdout = await runGh(
        ['api', `repos/${targetRepository}/issues/comments/${commentId}`],
        'comment read',
      );
      const comment = parseJsonOutput(stdout, 'comment read');
      if (comment === null || typeof comment !== 'object') {
        failTransport('GitHub CLI comment read returned an invalid payload.');
      }
      return {
        commentId: Number.isInteger(comment.id) ? comment.id : null,
        url: typeof comment.html_url === 'string' ? comment.html_url : null,
        createdAt: typeof comment.created_at === 'string' ? comment.created_at : null,
        body: typeof comment.body === 'string' ? comment.body : null,
      };
    },
  });
}

/**
 * Resolve the configured relay transport from an explicit environment binding.
 * Returns null (= relay disabled / not configured) when the repository binding
 * is absent or explicitly "disabled". This is an external-service mutation:
 * it is never inferred and never enabled implicitly.
 */
export function resolveConfiguredControlTowerRelayTransport({
  env = process.env,
  execFileImpl,
} = {}) {
  const rawRepo = typeof env?.[CONTROL_TOWER_RELAY_REPO_ENV_KEY] === 'string'
    ? env[CONTROL_TOWER_RELAY_REPO_ENV_KEY].trim()
    : '';
  if (!rawRepo || rawRepo.toLowerCase() === 'disabled') return null;
  const rawGhPath = typeof env?.[CONTROL_TOWER_RELAY_GH_PATH_ENV_KEY] === 'string'
    ? env[CONTROL_TOWER_RELAY_GH_PATH_ENV_KEY].trim()
    : '';
  return createGitHubIssueCommentRelayTransport({
    repository: rawRepo,
    ghPath: rawGhPath || DEFAULT_CONTROL_TOWER_RELAY_GH_PATH,
    execFileImpl,
  });
}
