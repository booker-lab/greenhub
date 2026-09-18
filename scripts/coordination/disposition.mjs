// Bounded mutation owner: GREENHUB-COORDINATION-DISPOSITION-STORE-07.
// Surface: scripts/coordination/** disposition persistence/state/fencing ONLY.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   canonical materialization, ACK/CONSUMED, sync cursor, next-task emission,
//   adapters, Astra integration, OpenCode integration, Control Tower loop,
//   publication automation, 57C.
//
// Disposition is a separate durable domain from RESULT_DELIVERED:
//   REPORT_DELIVERED != REPORT_CANONICALLY_ADOPTED.
// RESULT_DELIVERED means first-wins result durable; disposition is the
// Control Tower verdict pointer that MAY move across immutable generations
// until a future ACK/CONSUMED seal (not implemented here).
//
// Identity: taskId + dispositionGeneration, stable ref `<taskId>@<generation>`.
// Generations are immutable; current pointer moves only via explicitly allowed
// transitions. No terminal-state rewriting, no delete-and-recreate.

import { createHash } from 'node:crypto';
import { TASK_ID_PATTERN } from './task-envelope.mjs';

export const DISPOSITION_SCHEMA_VERSION = '1';

export const DISPOSITION_STATE_PENDING = 'PENDING_DISPOSITION';
export const DISPOSITION_STATE_BLOCKED = 'BLOCKED';
export const DISPOSITION_STATE_NEEDS_USER = 'NEEDS_USER_DECISION';
export const DISPOSITION_STATE_ADOPTED = 'ADOPTED';
export const DISPOSITION_STATE_REJECTED = 'REJECTED';
export const DISPOSITION_STATE_SUPERSEDED = 'SUPERSEDED';

export const DISPOSITION_STATES = Object.freeze([
  DISPOSITION_STATE_PENDING,
  DISPOSITION_STATE_BLOCKED,
  DISPOSITION_STATE_NEEDS_USER,
  DISPOSITION_STATE_ADOPTED,
  DISPOSITION_STATE_REJECTED,
  DISPOSITION_STATE_SUPERSEDED,
]);

// Legal conceptual transitions. Terminal states (ADOPTED/REJECTED/SUPERSEDED)
// have no outgoing transitions in this task: future ACK/CONSUMED sealing will
// own closure policy. This prevents arbitrary terminal-state rewriting.
export const DISPOSITION_ALLOWED_TRANSITIONS = Object.freeze({
  [DISPOSITION_STATE_PENDING]: Object.freeze([
    DISPOSITION_STATE_ADOPTED,
    DISPOSITION_STATE_REJECTED,
    DISPOSITION_STATE_SUPERSEDED,
    DISPOSITION_STATE_BLOCKED,
    DISPOSITION_STATE_NEEDS_USER,
  ]),
  [DISPOSITION_STATE_BLOCKED]: Object.freeze([DISPOSITION_STATE_PENDING]),
  [DISPOSITION_STATE_NEEDS_USER]: Object.freeze([DISPOSITION_STATE_PENDING]),
  [DISPOSITION_STATE_ADOPTED]: Object.freeze([]),
  [DISPOSITION_STATE_REJECTED]: Object.freeze([]),
  [DISPOSITION_STATE_SUPERSEDED]: Object.freeze([]),
});

export const MAX_DISPOSITION_JSON_BYTES = 16 * 1024;
export const MAX_DISPOSITION_REF_LENGTH = 512;
export const MAX_CONTROL_TOWER_FIELD_LENGTH = 128;
export const MAX_QUESTION_VERSION_LENGTH = 64;

// Inline-embed fields that violate reference-first / context-budget.
// Also blocks cursor/ack/materialization/emission fields: this module must
// never model those domains.
export const BLOCKED_DISPOSITION_INLINE_FIELDS = Object.freeze([
  'chatHistory',
  'transcript',
  'chatTranscript',
  'questionTranscript',
  'questionBody',
  'messages',
  'docsDump',
  'docsBody',
  'pastResults',
  'resultsDump',
  'fullSsot',
  'ssot',
  'ssotBody',
  'projectState',
  'projectDump',
  'unrelatedState',
  'promptDump',
  'syncCursor',
  'cursor',
  'consumed',
  'acknowledged',
  'materialization',
  'nextTasks',
  'emission',
]);

export class DispositionValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DispositionValidationError';
    this.code = details.code ?? 'INVALID_DISPOSITION';
  }
}

function fail(message, code = 'INVALID_DISPOSITION') {
  throw new DispositionValidationError(message, { code });
}

export function isIsoDateTime(value) {
  if (typeof value !== 'string' || !value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function assertNonEmptyString(value, fieldName, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${fieldName} must be a non-empty string.`);
  }
  if (maxLength > 0 && value.length > maxLength) {
    fail(`${fieldName} exceeds ${maxLength} chars.`, 'CONTEXT_BUDGET_EXCEEDED');
  }
}

function assertRefStringArray(value, fieldName) {
  if (!Array.isArray(value)) fail(`${fieldName} must be an array of reference strings.`);
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      fail(`${fieldName} entries must be non-empty reference strings.`);
    }
    if (entry.length > MAX_DISPOSITION_REF_LENGTH) {
      fail(
        `${fieldName} entry exceeds ${MAX_DISPOSITION_REF_LENGTH} chars: reference-first contract requires short refs, not embedded bodies.`,
        'CONTEXT_BUDGET_EXCEEDED',
      );
    }
    if (entry.includes('\n\n\n')) {
      fail(`${fieldName} entry looks like an embedded dump, not a reference.`, 'CONTEXT_BUDGET_EXCEEDED');
    }
  }
}

function assertNoBlockedInlineFields(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return;
  for (const field of BLOCKED_DISPOSITION_INLINE_FIELDS) {
    if (Object.hasOwn(record, field)) {
      fail(
        `disposition record must not embed "${field}": use policyRefs/proofRefs/evidenceRefs instead (reference-first contract).`,
        'CONTEXT_BUDGET_EXCEEDED',
      );
    }
  }
  const gate = record.userDecision;
  if (gate && typeof gate === 'object' && !Array.isArray(gate)) {
    for (const field of BLOCKED_DISPOSITION_INLINE_FIELDS) {
      if (Object.hasOwn(gate, field)) {
        fail(
          `disposition userDecision must not embed "${field}": use short refs only.`,
          'CONTEXT_BUDGET_EXCEEDED',
        );
      }
    }
  }
}

export function dispositionRef(taskId, generation) {
  return `${taskId}@${generation}`;
}

/**
 * Deterministic canonical transition id from stable inputs only.
 * No timestamp/randomness may determine it.
 */
export function buildCanonicalTransitionId({ taskId, dispositionGeneration, resultId }) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail('taskId must match task id pattern for canonicalTransitionId.', 'INVALID_TASK_ID');
  }
  if (!Number.isInteger(dispositionGeneration) || dispositionGeneration < 1) {
    fail('dispositionGeneration must be an integer >= 1 for canonicalTransitionId.');
  }
  if (typeof resultId !== 'string' || !resultId.trim()) {
    fail('resultId must be a non-empty string for canonicalTransitionId.');
  }
  const digest = createHash('sha256')
    .update(taskId, 'utf8')
    .update('\0', 'utf8')
    .update(String(dispositionGeneration), 'utf8')
    .update('\0', 'utf8')
    .update(resultId, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `dsp_${digest}`;
}

/**
 * Stable result integrity binding without embedding the whole RESULT.
 * Hash over canonical result fields in fixed order.
 */
export function computeResultBinding(resultRecord) {
  if (!resultRecord || typeof resultRecord !== 'object' || Array.isArray(resultRecord)) {
    fail('result record must be an object for result binding.', 'DISPOSITION_MISSING_RESULT');
  }
  const canonical = {
    schemaVersion: resultRecord.schemaVersion,
    resultId: resultRecord.resultId,
    taskId: resultRecord.taskId,
    workerId: resultRecord.workerId,
    claimToken: resultRecord.claimToken,
    claimGeneration: resultRecord.claimGeneration,
    status: resultRecord.status,
    summary: resultRecord.summary,
    proofRefs: resultRecord.proofRefs ?? [],
    evidenceRefs: resultRecord.evidenceRefs ?? [],
    frictionObserved: resultRecord.frictionObserved ?? [],
    deliveredAt: resultRecord.deliveredAt,
    ...(resultRecord.usage === undefined ? {} : { usage: resultRecord.usage }),
  };
  const json = JSON.stringify(canonical);
  return `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`;
}

function validateUserDecisionGate({ state, dispositionGeneration, userDecision }) {
  if (state === DISPOSITION_STATE_NEEDS_USER) {
    if (!userDecision || typeof userDecision !== 'object' || Array.isArray(userDecision)) {
      fail('userDecision gate is required when state is NEEDS_USER_DECISION.');
    }
    assertNonEmptyString(
      userDecision.decisionRequestId,
      'userDecision.decisionRequestId',
      MAX_CONTROL_TOWER_FIELD_LENGTH,
    );
    assertNonEmptyString(
      userDecision.questionVersion,
      'userDecision.questionVersion',
      MAX_QUESTION_VERSION_LENGTH,
    );
    assertNonEmptyString(
      userDecision.requiredAuthority,
      'userDecision.requiredAuthority',
      MAX_CONTROL_TOWER_FIELD_LENGTH,
    );
    if (userDecision.decisionRecordRef !== undefined) {
      assertNonEmptyString(
        userDecision.decisionRecordRef,
        'userDecision.decisionRecordRef',
        MAX_DISPOSITION_REF_LENGTH,
      );
    }
    const allowed = new Set([
      'decisionRequestId',
      'questionVersion',
      'requiredAuthority',
      'decisionRecordRef',
    ]);
    for (const key of Object.keys(userDecision)) {
      if (!allowed.has(key)) {
        fail(`userDecision contains unexpected field "${key}": keep refs bounded.`);
      }
    }
    return;
  }
  if (state === DISPOSITION_STATE_PENDING && dispositionGeneration > 1) {
    // A resolved authority may return through a new PENDING generation by
    // carrying the decision reference. Optional, but when present it must be
    // bounded refs only (never transcripts).
    if (userDecision === undefined) return;
    if (!userDecision || typeof userDecision !== 'object' || Array.isArray(userDecision)) {
      fail('userDecision must be an object when present on PENDING re-evaluation.');
    }
    assertNonEmptyString(
      userDecision.decisionRequestId,
      'userDecision.decisionRequestId',
      MAX_CONTROL_TOWER_FIELD_LENGTH,
    );
    assertNonEmptyString(
      userDecision.questionVersion,
      'userDecision.questionVersion',
      MAX_QUESTION_VERSION_LENGTH,
    );
    assertNonEmptyString(
      userDecision.requiredAuthority,
      'userDecision.requiredAuthority',
      MAX_CONTROL_TOWER_FIELD_LENGTH,
    );
    if (userDecision.decisionRecordRef !== undefined) {
      assertNonEmptyString(
        userDecision.decisionRecordRef,
        'userDecision.decisionRecordRef',
        MAX_DISPOSITION_REF_LENGTH,
      );
    }
    const allowed = new Set([
      'decisionRequestId',
      'questionVersion',
      'requiredAuthority',
      'decisionRecordRef',
    ]);
    for (const key of Object.keys(userDecision)) {
      if (!allowed.has(key)) {
        fail(`userDecision contains unexpected field "${key}": keep refs bounded.`);
      }
    }
    return;
  }
  if (userDecision !== undefined) {
    fail(`userDecision gate is only allowed for NEEDS_USER_DECISION (and PENDING re-evaluation after it); state=${state}.`);
  }
}

/**
 * Validate a disposition record object. Returns a frozen canonical copy.
 * Throws DispositionValidationError on any violation (fail-closed, no repair).
 */
export function validateDispositionRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('disposition record must be an object.');
  }
  assertNoBlockedInlineFields(record);

  if (record.schemaVersion !== DISPOSITION_SCHEMA_VERSION) {
    fail(
      `disposition schemaVersion must be ${JSON.stringify(DISPOSITION_SCHEMA_VERSION)}.`,
      'INVALID_SCHEMA_VERSION',
    );
  }
  if (typeof record.taskId !== 'string' || !TASK_ID_PATTERN.test(record.taskId)) {
    fail('disposition taskId must match task id pattern.', 'INVALID_TASK_ID');
  }
  if (!Number.isInteger(record.dispositionGeneration) || record.dispositionGeneration < 1) {
    fail('dispositionGeneration must be an integer >= 1.');
  }
  assertNonEmptyString(record.resultId, 'resultId', 128);
  if (record.resultId.includes('/') || record.resultId.includes('\\') || record.resultId.includes('..')) {
    fail('resultId must not contain path separators or "..".');
  }
  if (typeof record.resultBinding !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(record.resultBinding)) {
    fail('resultBinding must be a stable content hash of form "sha256:<64 hex>".');
  }
  if (!Number.isInteger(record.claimGeneration) || record.claimGeneration < 1) {
    fail('claimGeneration (provenance) must be an integer >= 1.');
  }
  assertNonEmptyString(
    record.controlTowerToken,
    'controlTowerToken',
    MAX_CONTROL_TOWER_FIELD_LENGTH,
  );
  assertNonEmptyString(record.controlTowerId, 'controlTowerId', MAX_CONTROL_TOWER_FIELD_LENGTH);
  if (!DISPOSITION_STATES.includes(record.state)) {
    fail(`disposition state must be one of ${DISPOSITION_STATES.join(', ')}.`);
  }
  if (!isIsoDateTime(record.decidedAt)) fail('decidedAt must be an ISO date-time string.');
  assertNonEmptyString(record.canonicalTransitionId, 'canonicalTransitionId', 128);

  const expectedTransitionId = buildCanonicalTransitionId({
    taskId: record.taskId,
    dispositionGeneration: record.dispositionGeneration,
    resultId: record.resultId,
  });
  if (record.canonicalTransitionId !== expectedTransitionId) {
    fail(
      `canonicalTransitionId mismatch (expected ${expectedTransitionId}).`,
      'DISPOSITION_TRANSITION_ID_MISMATCH',
    );
  }

  // Linear history: gen 1 has no supersedes; gen N>1 must supersede N-1.
  if (record.dispositionGeneration === 1) {
    if (record.supersedes !== undefined && record.supersedes !== null) {
      fail('generation 1 must not carry supersedes.');
    }
    if (record.state !== DISPOSITION_STATE_PENDING) {
      fail('generation 1 must be PENDING_DISPOSITION (RESULT_DELIVERED never auto-adopts).');
    }
  } else {
    if (record.supersedes !== record.dispositionGeneration - 1) {
      fail(
        `supersedes must equal previous generation (${record.dispositionGeneration - 1}) for generation ${record.dispositionGeneration}.`,
        'DISPOSITION_GENERATION_GAP',
      );
    }
  }

  assertRefStringArray(record.policyRefs ?? [], 'policyRefs');
  assertRefStringArray(record.proofRefs ?? [], 'proofRefs');
  assertRefStringArray(record.evidenceRefs ?? [], 'evidenceRefs');

  validateUserDecisionGate({
    state: record.state,
    dispositionGeneration: record.dispositionGeneration,
    userDecision: record.userDecision,
  });

  const json = JSON.stringify(record);
  if (json.length > MAX_DISPOSITION_JSON_BYTES) {
    fail(
      `disposition record JSON is ${json.length} bytes (> ${MAX_DISPOSITION_JSON_BYTES}): use bounded refs, never embedded bodies.`,
      'CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return Object.freeze({ ...record });
}

export function assertLegalDispositionTransition(fromState, toState) {
  const allowed = DISPOSITION_ALLOWED_TRANSITIONS[fromState];
  if (!allowed) fail(`unknown disposition state: ${fromState}.`);
  if (!allowed.includes(toState)) {
    const error = new DispositionValidationError(
      `illegal disposition transition: ${fromState} -> ${toState}.`,
      { code: 'DISPOSITION_ILLEGAL_TRANSITION' },
    );
    throw error;
  }
}

/**
 * Build a canonical disposition record (validated, frozen).
 * Caller must supply a resultBinding computed from the canonical result.
 */
export function buildDispositionRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('disposition input must be an object.');
  }
  const record = {
    // Carry unknown keys forward so validation rejects blocked inline fields
    // instead of silently dropping them.
    ...input,
    schemaVersion: DISPOSITION_SCHEMA_VERSION,
    taskId: input.taskId,
    dispositionGeneration: input.dispositionGeneration,
    resultId: input.resultId,
    resultBinding: input.resultBinding,
    claimGeneration: input.claimGeneration,
    controlTowerToken: input.controlTowerToken,
    controlTowerId: input.controlTowerId,
    state: input.state,
    decidedAt: input.decidedAt,
    canonicalTransitionId: buildCanonicalTransitionId({
      taskId: input.taskId,
      dispositionGeneration: input.dispositionGeneration,
      resultId: input.resultId,
    }),
    policyRefs: input.policyRefs ?? [],
    proofRefs: input.proofRefs ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
    ...(input.userDecision === undefined ? {} : { userDecision: input.userDecision }),
  };
  return validateDispositionRecord(record);
}
