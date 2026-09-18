// Bounded mutation owner: GREENHUB-COORDINATION-DURABLE-CORE-01.
// Task Envelope v1 + Claim/Lease record + Result Envelope v1.
// Reference-first contract: envelopes carry refs, never embedded SSOT/history dumps.
// Cursor/disposition (syncCursor/consumed/acknowledged/canonical disposition)
// is intentionally NOT modelled here: REPORT_DELIVERED != REPORT_CANONICALLY_ADOPTED.

export const TASK_SCHEMA_VERSION = '1';
export const CLAIM_SCHEMA_VERSION = '1';
export const RESULT_SCHEMA_VERSION = '1';

export const TASK_STATUS_CREATED = 'CREATED';
export const TASK_STATUS_READY = 'READY';
export const TASK_STATUS_CLAIMED = 'CLAIMED';
export const TASK_STATUS_RESULT_DELIVERED = 'RESULT_DELIVERED';

export const TASK_STATUSES = Object.freeze([
  TASK_STATUS_CREATED,
  TASK_STATUS_READY,
  TASK_STATUS_CLAIMED,
  TASK_STATUS_RESULT_DELIVERED,
]);

export const TASK_KIND_READ_ONLY = 'READ_ONLY';
export const TASK_KIND_BOUNDED_MUTATION = 'BOUNDED_MUTATION';
export const TASK_KINDS = Object.freeze([TASK_KIND_READ_ONLY, TASK_KIND_BOUNDED_MUTATION]);

export const RESULT_STATUS_SUCCEEDED = 'SUCCEEDED';
export const RESULT_STATUS_FAILED = 'FAILED';
export const RESULT_STATUS_BLOCKED = 'BLOCKED';
export const RESULT_STATUSES = Object.freeze([
  RESULT_STATUS_SUCCEEDED,
  RESULT_STATUS_FAILED,
  RESULT_STATUS_BLOCKED,
]);

export const TASK_ID_PATTERN = /^[A-Z0-9][A-Z0-9-_]{2,127}$/;

// Inline-embed fields that must never appear in a task envelope. They indicate
// chat-history / docs-dump / past-result / full-SSOT / unrelated-state embedding.
export const BLOCKED_INLINE_FIELDS = Object.freeze([
  'chatHistory',
  'transcript',
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
  'consumed',
  'acknowledged',
  'canonicalDisposition',
]);

export const MAX_ENVELOPE_JSON_BYTES = 16 * 1024;
export const MAX_REF_STRING_LENGTH = 512;
export const MAX_SUMMARY_LENGTH = 2000;
export const MAX_FRICTION_ENTRIES = 32;
export const MAX_FRICTION_ENTRY_LENGTH = 512;

export class CoordinationValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CoordinationValidationError';
    this.code = details.code ?? 'INVALID_ENVELOPE';
  }
}

function fail(message, code = 'INVALID_ENVELOPE') {
  throw new CoordinationValidationError(message, { code });
}

export function isIsoDateTime(value) {
  if (typeof value !== 'string' || !value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(
      `taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`,
      'INVALID_TASK_ID',
    );
  }
}

function assertRefStringArray(value, fieldName) {
  if (!Array.isArray(value)) fail(`${fieldName} must be an array of reference strings.`);
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      fail(`${fieldName} entries must be non-empty reference strings.`);
    }
    if (entry.length > MAX_REF_STRING_LENGTH) {
      fail(
        `${fieldName} entry exceeds ${MAX_REF_STRING_LENGTH} chars: reference-first contract requires short refs, not embedded bodies.`,
        'CONTEXT_BUDGET_EXCEEDED',
      );
    }
    if (entry.length > 0 && (entry.includes('\n\n\n') || entry.length > MAX_REF_STRING_LENGTH)) {
      fail(`${fieldName} entry looks like an embedded dump, not a reference.`, 'CONTEXT_BUDGET_EXCEEDED');
    }
  }
}

function assertNoBlockedInlineFields(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return;
  for (const field of BLOCKED_INLINE_FIELDS) {
    if (Object.hasOwn(envelope, field)) {
      fail(
        `task envelope must not embed "${field}": use policyRefs/evidenceRefs/contextRefs instead (reference-first contract).`,
        'CONTEXT_BUDGET_EXCEEDED',
      );
    }
  }
}

/**
 * Context-budget contract: envelopes carry refs, never dumps.
 * Throws CoordinationValidationError with code CONTEXT_BUDGET_EXCEEDED on violation.
 */
export function validateContextBudget(envelope) {
  assertNoBlockedInlineFields(envelope);
  const json = JSON.stringify(envelope ?? null);
  if (json.length > MAX_ENVELOPE_JSON_BYTES) {
    fail(
      `task envelope JSON is ${json.length} bytes (> ${MAX_ENVELOPE_JSON_BYTES}): ` +
        'do not embed chat history, docs dumps, past results, full SSOT copies, or unrelated project state; ' +
        'use policyRefs/evidenceRefs/contextRefs.',
      'CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return { ok: true, bytes: json.length };
}

function assertStringField(value, fieldName, { allowEmpty = false, maxLength = 0 } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    fail(`${fieldName} must be a non-empty string.`);
  }
  if (maxLength > 0 && value.length > maxLength) {
    fail(`${fieldName} exceeds ${maxLength} chars.`, 'CONTEXT_BUDGET_EXCEEDED');
  }
}

/**
 * Validate a Task Envelope v1 object. Returns a frozen canonical copy.
 * Throws CoordinationValidationError on any violation.
 */
export function validateTaskEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail('task envelope must be an object.');
  }
  assertNoBlockedInlineFields(envelope);

  if (envelope.schemaVersion !== TASK_SCHEMA_VERSION) {
    fail(`schemaVersion must be ${JSON.stringify(TASK_SCHEMA_VERSION)}.`, 'INVALID_SCHEMA_VERSION');
  }
  assertValidTaskId(envelope.taskId);

  if (!TASK_KINDS.includes(envelope.taskKind)) {
    fail(`taskKind must be one of ${TASK_KINDS.join(', ')}.`);
  }
  if (!isIsoDateTime(envelope.createdAt)) fail('createdAt must be an ISO date-time string.');
  if (envelope.updatedAt !== undefined && !isIsoDateTime(envelope.updatedAt)) {
    fail('updatedAt must be an ISO date-time string when present.');
  }
  assertStringField(envelope.desiredExitState, 'desiredExitState', { maxLength: 64 });

  assertRefStringArray(envelope.policyRefs ?? fail('policyRefs is required.'), 'policyRefs');
  if (!Array.isArray(envelope.policyRefs) || envelope.policyRefs.length === 0) {
    fail('policyRefs must contain at least one policy reference.');
  }
  assertRefStringArray(envelope.evidenceRefs ?? [], 'evidenceRefs');
  assertRefStringArray(envelope.contextRefs ?? [], 'contextRefs');

  const authority = envelope.authorityRequirement;
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    fail('authorityRequirement must be an object.');
  }
  assertNoBlockedInlineFields(authority);
  if (authority.liveMainHint !== undefined && authority.liveMainHint !== null) {
    assertStringField(authority.liveMainHint, 'authorityRequirement.liveMainHint', { maxLength: 128 });
  }
  if (authority.requiredPolicies !== undefined) {
    assertRefStringArray(authority.requiredPolicies, 'authorityRequirement.requiredPolicies');
  }

  const owned = envelope.ownedSurface;
  if (!Array.isArray(owned) || owned.length === 0) {
    fail('ownedSurface must be a non-empty array of repo-relative path strings.');
  }
  for (const entry of owned) {
    assertStringField(entry, 'ownedSurface[]', { maxLength: MAX_REF_STRING_LENGTH });
    if (entry.startsWith('/') || entry.includes('..')) {
      fail('ownedSurface entries must be repo-relative paths without ".." or leading "/".');
    }
  }

  const boundary = envelope.mutationBoundary;
  if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary)) {
    fail('mutationBoundary must be an object.');
  }
  if (typeof boundary.allowsWrite !== 'boolean') fail('mutationBoundary.allowsWrite must be boolean.');
  if (boundary.maxPaths !== undefined && (!Number.isInteger(boundary.maxPaths) || boundary.maxPaths < 0)) {
    fail('mutationBoundary.maxPaths must be a non-negative integer when present.');
  }
  if (boundary.forbiddenPaths !== undefined) {
    assertRefStringArray(boundary.forbiddenPaths, 'mutationBoundary.forbiddenPaths');
  }
  if (envelope.taskKind === TASK_KIND_READ_ONLY && boundary.allowsWrite === true) {
    fail('READ_ONLY tasks must declare mutationBoundary.allowsWrite=false.');
  }

  if (!TASK_STATUSES.includes(envelope.status)) {
    fail(`status must be one of ${TASK_STATUSES.join(', ')}.`);
  }

  if (envelope.proofRequirement === undefined) fail('proofRequirement is required.');
  if (typeof envelope.proofRequirement === 'string') {
    assertStringField(envelope.proofRequirement, 'proofRequirement', { maxLength: 1024 });
  } else if (Array.isArray(envelope.proofRequirement)) {
    if (envelope.proofRequirement.length === 0) fail('proofRequirement must not be empty.');
    for (const entry of envelope.proofRequirement) {
      assertStringField(entry, 'proofRequirement[]', { maxLength: MAX_REF_STRING_LENGTH });
    }
  } else {
    fail('proofRequirement must be a string or an array of reference strings.');
  }

  validateContextBudget(envelope);
  return Object.freeze({ ...envelope });
}

/**
 * Build a new Task Envelope v1 in CREATED status.
 * Callers transition CREATED -> READY via the store; lifecycle states beyond
 * RESULT_DELIVERED (canonical disposition / cursor) are not representable.
 */
export function buildTaskEnvelope(input, { nowIso } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('task input must be an object.');
  }
  const now = nowIso ?? new Date().toISOString();
  const envelope = {
    // Carry unknown input keys forward so validateTaskEnvelope can reject
    // blocked inline-embed fields instead of silently dropping them.
    ...input,
    schemaVersion: TASK_SCHEMA_VERSION,
    taskId: input.taskId,
    taskKind: input.taskKind,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    desiredExitState: input.desiredExitState,
    policyRefs: input.policyRefs,
    evidenceRefs: input.evidenceRefs ?? [],
    contextRefs: input.contextRefs ?? [],
    authorityRequirement: input.authorityRequirement,
    ownedSurface: input.ownedSurface,
    mutationBoundary: input.mutationBoundary,
    proofRequirement: input.proofRequirement,
    status: TASK_STATUS_CREATED,
  };
  return validateTaskEnvelope(envelope);
}

/** Validate a claim/lease record. Returns a frozen copy. */
export function validateClaimRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('claim record must be an object.');
  if (record.schemaVersion !== CLAIM_SCHEMA_VERSION) {
    fail(`claim schemaVersion must be ${JSON.stringify(CLAIM_SCHEMA_VERSION)}.`, 'INVALID_SCHEMA_VERSION');
  }
  assertValidTaskId(record.taskId);
  assertStringField(record.workerId, 'workerId', { maxLength: 128 });
  assertStringField(record.claimToken, 'claimToken', { maxLength: 128 });
  if (!Number.isInteger(record.generation) || record.generation < 1) {
    fail('claim generation must be an integer >= 1.');
  }
  if (!isIsoDateTime(record.claimedAt)) fail('claimedAt must be an ISO date-time string.');
  if (!isIsoDateTime(record.leaseExpiresAt)) fail('leaseExpiresAt must be an ISO date-time string.');
  if (Date.parse(record.leaseExpiresAt) <= Date.parse(record.claimedAt)) {
    fail('leaseExpiresAt must be after claimedAt.');
  }
  return Object.freeze({ ...record });
}

function assertUsageTelemetry(usage) {
  if (usage === undefined) return;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    fail('usage must be an object when present.');
  }
  for (const field of ['inputTokens', 'outputTokens', 'cachedInputTokens']) {
    const value = usage[field];
    if (value === undefined || value === 'UNKNOWN') continue;
    if (!Number.isInteger(value) || value < 0) {
      fail(`usage.${field} must be a non-negative integer or "UNKNOWN".`);
    }
  }
  for (const field of ['provider', 'model']) {
    if (usage[field] === undefined) continue;
    assertStringField(usage[field], `usage.${field}`, { maxLength: 128 });
  }
  // Never accept fabricated zero-fill as proof: explicit UNKNOWN or absence only.
}

/** Validate a Result Envelope v1 object. Returns a frozen copy. */
export function validateResultEnvelope(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('result record must be an object.');
  if (record.schemaVersion !== RESULT_SCHEMA_VERSION) {
    fail(`result schemaVersion must be ${JSON.stringify(RESULT_SCHEMA_VERSION)}.`, 'INVALID_SCHEMA_VERSION');
  }
  assertStringField(record.resultId, 'resultId', { maxLength: 128 });
  assertValidTaskId(record.taskId);
  assertStringField(record.workerId, 'workerId', { maxLength: 128 });
  assertStringField(record.claimToken, 'claimToken', { maxLength: 128 });
  if (!Number.isInteger(record.claimGeneration) || record.claimGeneration < 1) {
    fail('claimGeneration must be an integer >= 1.');
  }
  if (!RESULT_STATUSES.includes(record.status)) {
    fail(`result status must be one of ${RESULT_STATUSES.join(', ')}.`);
  }
  assertStringField(record.summary, 'summary', { maxLength: MAX_SUMMARY_LENGTH });
  assertRefStringArray(record.proofRefs ?? [], 'proofRefs');
  assertRefStringArray(record.evidenceRefs ?? [], 'evidenceRefs');
  if (!Array.isArray(record.frictionObserved)) fail('frictionObserved must be an array of strings.');
  if (record.frictionObserved.length > MAX_FRICTION_ENTRIES) {
    fail(`frictionObserved exceeds ${MAX_FRICTION_ENTRIES} entries.`, 'CONTEXT_BUDGET_EXCEEDED');
  }
  for (const entry of record.frictionObserved) {
    assertStringField(entry, 'frictionObserved[]', { maxLength: MAX_FRICTION_ENTRY_LENGTH });
  }
  if (!isIsoDateTime(record.deliveredAt)) fail('deliveredAt must be an ISO date-time string.');
  assertUsageTelemetry(record.usage);
  assertNoBlockedInlineFields(record);
  const json = JSON.stringify(record);
  if (json.length > MAX_ENVELOPE_JSON_BYTES) {
    fail('result record exceeds size budget; keep refs short and do not embed dumps.', 'CONTEXT_BUDGET_EXCEEDED');
  }
  return Object.freeze({ ...record });
}
