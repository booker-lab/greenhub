// Bounded mutation owner: PM-01-MUTATION-ADMISSION-PARALLEL-OVERLAP.
// Surface: scripts/coordination/mutation-execution-admission.mjs
//          + scripts/coordination/mutation-execution-admission.spec.mjs ONLY.
//
// Purpose: decide deterministically whether one BOUNDED_MUTATION task may start
// mutation now, from caller-observed canonical/live git state plus a
// caller-supplied active-mutator projection.
//
// PURE decision primitive. Explicitly OUT OF SCOPE (must NOT be implemented
// here): executor invocation, OpenCode mutation, operator-cli changes, dispatch,
// scheduler, queue polling, cron/daemon, retry/backoff infrastructure, worker /
// agent / executor registry or selection, automatic task generation,
// publication, production deployment, and any new durable registry or
// centralized state. Active mutators are a caller projection reconstructed from
// the existing coordination durable state (claim/activity); this module never
// reads the store, never persists anything, and never mutates any state.
//
// Contract summary:
//   mutationExecutionAdmission() != executeMutation() != dispatch() !=
//   schedule() != publish().
//   Semantic overlap is NEVER inferred from path disjointness: only an explicit
//   caller-supplied NON_OVERLAPPING status passes the semantic gate.
//   Gate order is fixed and fail-closed: task kind -> mutation boundary ->
//   canonical mirror health -> exact live-main binding -> proven physical
//   surface isolation -> active-mutator owned-surface collision -> semantic
//   overlap. Ambiguous or non-canonical input fails closed with a
//   BLOCKED_*/SERIALIZE_* status or a MutationAdmissionValidationError;
//   nothing is auto-repaired.
//   Path ownership is judged on normalized repo-relative paths: equality or
//   directory/descendant containment collides, and non-canonical input
//   (absolute path, drive letter, backslash separator, "." / ".." segment,
//   empty segment, wildcard, control character, surrounding whitespace)
//   fails closed instead of being silently repaired.

import {
  CoordinationValidationError,
  TASK_ID_PATTERN,
  TASK_KIND_BOUNDED_MUTATION,
  TASK_KIND_READ_ONLY,
  validateTaskEnvelope,
} from './task-envelope.mjs';

export const MUTATION_ADMISSION_SCHEMA_VERSION = '1';

export const MUTATION_ADMITTED = 'MUTATION_ADMITTED';
export const SERIALIZE_PATH_COLLISION = 'SERIALIZE_PATH_COLLISION';
export const SERIALIZE_SEMANTIC_OVERLAP = 'SERIALIZE_SEMANTIC_OVERLAP';
export const SERIALIZE_UNKNOWN_OVERLAP = 'SERIALIZE_UNKNOWN_OVERLAP';
export const BLOCKED_CANONICAL_MIRROR_UNHEALTHY = 'BLOCKED_CANONICAL_MIRROR_UNHEALTHY';
export const BLOCKED_LIVE_MAIN_MISMATCH = 'BLOCKED_LIVE_MAIN_MISMATCH';
export const BLOCKED_SURFACE_ISOLATION_UNPROVEN = 'BLOCKED_SURFACE_ISOLATION_UNPROVEN';
export const BLOCKED_MUTATION_BOUNDARY = 'BLOCKED_MUTATION_BOUNDARY';
export const UNSUPPORTED_TASK_KIND = 'UNSUPPORTED_TASK_KIND';

export const MUTATION_ADMISSION_DECISIONS = Object.freeze([
  MUTATION_ADMITTED,
  SERIALIZE_PATH_COLLISION,
  SERIALIZE_SEMANTIC_OVERLAP,
  SERIALIZE_UNKNOWN_OVERLAP,
  BLOCKED_CANONICAL_MIRROR_UNHEALTHY,
  BLOCKED_LIVE_MAIN_MISMATCH,
  BLOCKED_SURFACE_ISOLATION_UNPROVEN,
  BLOCKED_MUTATION_BOUNDARY,
  UNSUPPORTED_TASK_KIND,
]);

export const SEMANTIC_OVERLAP_NON_OVERLAPPING = 'NON_OVERLAPPING';
export const SEMANTIC_OVERLAP_OVERLAPPING = 'OVERLAPPING';
export const SEMANTIC_OVERLAP_UNKNOWN = 'UNKNOWN';
export const SEMANTIC_OVERLAP_STATUSES = Object.freeze([
  SEMANTIC_OVERLAP_NON_OVERLAPPING,
  SEMANTIC_OVERLAP_OVERLAPPING,
  SEMANTIC_OVERLAP_UNKNOWN,
]);

export const MAX_MUTATION_ADMISSION_REASON_LENGTH = 512;
export const MAX_MUTATION_ADMISSION_JSON_BYTES = 16 * 1024;
export const MAX_ACTIVE_MUTATOR_ENTRIES = 256;
export const MAX_COLLIDING_MUTATOR_ENTRIES = 16;

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const WILDCARD_PATTERN = /[*?[\]{}]/;
const DRIVE_LETTER_PATTERN = /^[A-Za-z]:/;

function hasControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

const REASON_BY_DECISION = Object.freeze({
  [MUTATION_ADMITTED]:
    'admission passed: canonical mirror healthy, exact live-main binding, no active-mutator owned-surface ' +
    'collision, explicit NON_OVERLAPPING semantics, and physical mutation-surface isolation proven.',
  [SERIALIZE_PATH_COLLISION]:
    'ownedSurface collides with at least one active mutator (same path, directory/descendant containment, or ' +
    'case-insensitive equivalence): serialize or re-split before mutating.',
  [SERIALIZE_SEMANTIC_OVERLAP]:
    'semantic overlap status is explicitly OVERLAPPING: serialize or re-split; path disjointness never overrides ' +
    'semantic ownership.',
  [SERIALIZE_UNKNOWN_OVERLAP]:
    'semantic or active-mutator overlap is UNKNOWN/unprovable: parallel mutation is prohibited until an explicit ' +
    'NON_OVERLAPPING decision exists.',
  [BLOCKED_CANONICAL_MIRROR_UNHEALTHY]:
    'canonical mirror is unhealthy (dirty worktree or HEAD not at canonical main): classify/recover before starting ' +
    'a new mutating task.',
  [BLOCKED_LIVE_MAIN_MISMATCH]:
    'canonical main does not equal the current live main: re-read live main and reconcile the canonical mirror ' +
    'before mutating.',
  [BLOCKED_SURFACE_ISOLATION_UNPROVEN]:
    'physical mutation-surface independence is not proven: serialize instead of creating branch/worktree ' +
    'parallelism.',
  [BLOCKED_MUTATION_BOUNDARY]:
    'task is not writable (mutationBoundary.allowsWrite !== true) or owns no usable surface: no mutation may start.',
  [UNSUPPORTED_TASK_KIND]:
    'only BOUNDED_MUTATION tasks are admitted for mutation execution; READ_ONLY intake semantics are unchanged.',
});

export class MutationAdmissionValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MutationAdmissionValidationError';
    this.code = details.code ?? 'INVALID_MUTATION_ADMISSION';
  }
}

function fail(message, code = 'INVALID_MUTATION_ADMISSION') {
  throw new MutationAdmissionValidationError(message, { code });
}

function assertCommitSha(value, fieldName, code) {
  if (typeof value !== 'string' || !COMMIT_SHA_PATTERN.test(value.toLowerCase())) {
    fail(`${fieldName} must be an exact 40-hex commit SHA (got ${JSON.stringify(value)}).`, code);
  }
  return value.toLowerCase();
}

/**
 * Normalize one repo-relative owned-surface path, or fail closed.
 * Never repairs ambiguous input: absolute paths, drive letters, home-relative
 * paths, backslash separators, empty segments, "." / ".." segments, trailing /
 * leading whitespace, wildcard patterns, and control characters are rejected.
 * A leading "./" prefix and trailing "/" are canonicalized (not ambiguous);
 * `.` / `..` may thus only appear as a rejected segment. Comparison callers use
 * case-insensitive containment because case-insensitive checkouts (win32)
 * cannot prove two case-variant paths are physically independent.
 */
export function normalizeOwnedSurfacePath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    fail('ownedSurface path must be a non-empty string.', 'INVALID_OWNED_SURFACE_PATH');
  }
  if (rawPath !== rawPath.trim()) {
    fail(
      `ownedSurface path must not carry surrounding whitespace (got ${JSON.stringify(rawPath)}).`,
      'INVALID_OWNED_SURFACE_PATH',
    );
  }
  if (rawPath.includes('\\')) {
    fail(
      `ownedSurface path must use "/" as its only separator (got ${JSON.stringify(rawPath)}).`,
      'INVALID_OWNED_SURFACE_PATH',
    );
  }
  if (hasControlCharacter(rawPath)) {
    fail('ownedSurface path must not contain control characters.', 'INVALID_OWNED_SURFACE_PATH');
  }
  if (WILDCARD_PATTERN.test(rawPath)) {
    fail(
      `ownedSurface path must be a literal path, not a pattern (got ${JSON.stringify(rawPath)}).`,
      'INVALID_OWNED_SURFACE_PATH',
    );
  }
  if (rawPath.startsWith('/') || DRIVE_LETTER_PATTERN.test(rawPath) || rawPath.startsWith('~')) {
    fail(
      `ownedSurface path must be repo-relative, not absolute/home-relative (got ${JSON.stringify(rawPath)}).`,
      'INVALID_OWNED_SURFACE_PATH',
    );
  }
  let normalized = rawPath;
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  if (normalized.length === 0) {
    fail(
      'ownedSurface path must not resolve to the repository root.',
      'INVALID_OWNED_SURFACE_PATH',
    );
  }
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      fail(
        `ownedSurface path segment ${JSON.stringify(segment)} is not a canonical repo-relative segment ` +
          `(got ${JSON.stringify(rawPath)}).`,
        'INVALID_OWNED_SURFACE_PATH',
      );
    }
  }
  return segments.join('/');
}

/**
 * True when the two owned paths physically collide: identical path, or one owns
 * a directory that contains the other's path (either direction). Comparison is
 * case-insensitive on purpose: a case-insensitive checkout cannot prove two
 * case-variant paths are physically independent, so it must serialize.
 */
export function ownedSurfacePathsOverlap(leftRaw, rightRaw) {
  const left = normalizeOwnedSurfacePath(leftRaw).toLowerCase();
  const right = normalizeOwnedSurfacePath(rightRaw).toLowerCase();
  if (left === right) return true;
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function validateTaskEnvelopeFailClosed(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    fail('task must be a Task Envelope v1 object.', 'INVALID_TASK_ENVELOPE');
  }
  try {
    return validateTaskEnvelope(task);
  } catch (error) {
    if (error instanceof CoordinationValidationError) {
      fail(`task envelope is invalid (fail-closed): ${error.message}`, 'INVALID_TASK_ENVELOPE');
    }
    throw error;
  }
}

function normalizeSemanticOverlapStatus(value) {
  return SEMANTIC_OVERLAP_STATUSES.includes(value) ? value : SEMANTIC_OVERLAP_UNKNOWN;
}

function collisionKey(entry) {
  return `${entry.taskId}\u0000${entry.activePath}\u0000${entry.ownedPath}`;
}

/**
 * Caller-supplied active-mutator projection vs candidate ownedSurface.
 * - the candidate task itself is never a parallel mutator (self entries are skipped);
 * - READ_ONLY mutators cannot collide (READ_ONLY parallelism is unchanged);
 * - a concrete collision always wins over unknown entries (both serialize);
 * - an unidentifiable / non-BOUNDED_MUTATION / path-less / non-canonical entry is
 *   unknown overlap: non-overlap cannot be proven, so mutation is prohibited;
 * - no registry is created and no state is read: the projection is pure input.
 */
function evaluateActiveMutatorCollisions({ taskId, ownedSurface, activeMutators }) {
  if (activeMutators.length > MAX_ACTIVE_MUTATOR_ENTRIES) {
    return { status: SERIALIZE_UNKNOWN_OVERLAP, collidingMutators: [], pathCollisionCount: 0 };
  }
  const collisionMap = new Map();
  let unknown = false;
  for (const mutator of activeMutators) {
    if (!mutator || typeof mutator !== 'object' || Array.isArray(mutator)) {
      unknown = true;
      continue;
    }
    if (typeof mutator.taskId !== 'string' || !mutator.taskId.trim()) {
      unknown = true;
      continue;
    }
    if (mutator.taskId === taskId) continue;
    if (mutator.taskKind === TASK_KIND_READ_ONLY) continue;
    if (mutator.taskKind !== TASK_KIND_BOUNDED_MUTATION) {
      unknown = true;
      continue;
    }
    if (typeof mutator.activityStatus !== 'string' || !mutator.activityStatus.trim()) {
      unknown = true;
      continue;
    }
    if (!Array.isArray(mutator.ownedSurface) || mutator.ownedSurface.length === 0) {
      unknown = true;
      continue;
    }
    let activePaths;
    try {
      activePaths = mutator.ownedSurface.map(normalizeOwnedSurfacePath);
    } catch {
      unknown = true;
      continue;
    }
    for (const activePath of activePaths) {
      for (const ownedPath of ownedSurface) {
        if (ownedSurfacePathsOverlap(ownedPath, activePath)) {
          const entry = { taskId: mutator.taskId, activePath, ownedPath };
          collisionMap.set(collisionKey(entry), entry);
        }
      }
    }
  }
  if (collisionMap.size > 0) {
    const sorted = [...collisionMap.values()].sort(
      (left, right) =>
        left.taskId.localeCompare(right.taskId) ||
        left.activePath.localeCompare(right.activePath) ||
        left.ownedPath.localeCompare(right.ownedPath),
    );
    return {
      status: SERIALIZE_PATH_COLLISION,
      collidingMutators: sorted.slice(0, MAX_COLLIDING_MUTATOR_ENTRIES),
      pathCollisionCount: sorted.length,
    };
  }
  if (unknown) {
    return { status: SERIALIZE_UNKNOWN_OVERLAP, collidingMutators: [], pathCollisionCount: 0 };
  }
  return { status: null, collidingMutators: [], pathCollisionCount: 0 };
}

function buildDecision({
  status,
  task,
  liveMainSha,
  canonicalMainSha,
  canonicalHeadSha,
  canonicalWorktreeClean,
  surfaceIsolationProven,
  semanticOverlapStatus,
  ownedSurface,
  activeMutatorCount,
  collidingMutators,
  pathCollisionCount,
}) {
  return validateMutationAdmissionDecision({
    schemaVersion: MUTATION_ADMISSION_SCHEMA_VERSION,
    status,
    admitted: status === MUTATION_ADMITTED,
    taskId: task.taskId,
    taskKind: task.taskKind,
    liveMainSha,
    canonicalMainSha,
    canonicalHeadSha,
    canonicalWorktreeClean,
    surfaceIsolationProven,
    semanticOverlapStatus,
    ownedSurface,
    activeMutatorCount,
    pathCollisionCount,
    collidingMutators,
    reason: REASON_BY_DECISION[status],
  });
}

function assertNormalizedDecisionPath(path, where) {
  let normalized;
  try {
    normalized = normalizeOwnedSurfacePath(path);
  } catch (error) {
    fail(
      `mutation admission decision ${where} is not a canonical path: ${error?.message}`,
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  if (normalized !== path) {
    fail(
      `mutation admission decision ${where} must store normalized paths.`,
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
}

/** Validate a decision record produced by evaluateMutationExecutionAdmission. */
export function validateMutationAdmissionDecision(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('mutation admission decision must be an object.', 'INVALID_MUTATION_ADMISSION_DECISION');
  }
  if (record.schemaVersion !== MUTATION_ADMISSION_SCHEMA_VERSION) {
    fail(
      `mutation admission schemaVersion must be ${JSON.stringify(MUTATION_ADMISSION_SCHEMA_VERSION)}.`,
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  if (!MUTATION_ADMISSION_DECISIONS.includes(record.status)) {
    fail(
      `unknown mutation admission status ${JSON.stringify(record.status)}.`,
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  if (
    typeof record.admitted !== 'boolean' ||
    record.admitted !== (record.status === MUTATION_ADMITTED)
  ) {
    fail(
      'mutation admission "admitted" must match the decision status.',
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  if (typeof record.taskId !== 'string' || !TASK_ID_PATTERN.test(record.taskId)) {
    fail(
      'mutation admission taskId must match the Task Envelope v1 task id contract.',
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  if (typeof record.taskKind !== 'string' || !record.taskKind.trim()) {
    fail(
      'mutation admission taskKind must be a non-empty string.',
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  for (const field of ['liveMainSha', 'canonicalMainSha', 'canonicalHeadSha']) {
    if (typeof record[field] !== 'string' || !COMMIT_SHA_PATTERN.test(record[field])) {
      fail(
        `mutation admission ${field} must be an exact 40-hex commit SHA.`,
        'INVALID_MUTATION_ADMISSION_DECISION',
      );
    }
  }
  for (const field of ['canonicalWorktreeClean', 'surfaceIsolationProven']) {
    if (typeof record[field] !== 'boolean') {
      fail(`mutation admission ${field} must be boolean.`, 'INVALID_MUTATION_ADMISSION_DECISION');
    }
  }
  if (!SEMANTIC_OVERLAP_STATUSES.includes(record.semanticOverlapStatus)) {
    fail(
      'mutation admission semanticOverlapStatus must be a known status.',
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  if (!Array.isArray(record.ownedSurface)) {
    fail(
      'mutation admission ownedSurface must be an array.',
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  for (const path of record.ownedSurface) {
    assertNormalizedDecisionPath(path, 'ownedSurface entry');
  }
  if (!Number.isInteger(record.activeMutatorCount) || record.activeMutatorCount < 0) {
    fail(
      'mutation admission activeMutatorCount must be a non-negative integer.',
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  if (!Number.isInteger(record.pathCollisionCount) || record.pathCollisionCount < 0) {
    fail(
      'mutation admission pathCollisionCount must be a non-negative integer.',
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  if (
    !Array.isArray(record.collidingMutators) ||
    record.collidingMutators.length > MAX_COLLIDING_MUTATOR_ENTRIES
  ) {
    fail(
      `mutation admission collidingMutators must be an array of at most ${MAX_COLLIDING_MUTATOR_ENTRIES} entries.`,
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  if (record.collidingMutators.length > record.pathCollisionCount) {
    fail(
      'mutation admission collidingMutators exceeds pathCollisionCount.',
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  for (const entry of record.collidingMutators) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(
        'mutation admission collidingMutators entries must be objects.',
        'INVALID_MUTATION_ADMISSION_DECISION',
      );
    }
    if (typeof entry.taskId !== 'string' || !entry.taskId.trim()) {
      fail(
        'mutation admission colliding mutator taskId must be a non-empty string.',
        'INVALID_MUTATION_ADMISSION_DECISION',
      );
    }
    assertNormalizedDecisionPath(entry.activePath, 'colliding activePath');
    assertNormalizedDecisionPath(entry.ownedPath, 'colliding ownedPath');
  }
  if (record.status === SERIALIZE_PATH_COLLISION) {
    if (record.pathCollisionCount < 1 || record.collidingMutators.length < 1) {
      fail(
        'SERIALIZE_PATH_COLLISION requires at least one recorded collision.',
        'INVALID_MUTATION_ADMISSION_DECISION',
      );
    }
  } else if (record.pathCollisionCount !== 0 || record.collidingMutators.length !== 0) {
    fail(
      'non-path-collision decisions must not record collisions.',
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  if (
    typeof record.reason !== 'string' ||
    record.reason.length === 0 ||
    record.reason.length > MAX_MUTATION_ADMISSION_REASON_LENGTH
  ) {
    fail(
      'mutation admission reason must be a bounded non-empty string.',
      'INVALID_MUTATION_ADMISSION_DECISION',
    );
  }
  const json = JSON.stringify(record);
  if (json.length > MAX_MUTATION_ADMISSION_JSON_BYTES) {
    fail(
      `mutation admission decision JSON is ${json.length} bytes (> ${MAX_MUTATION_ADMISSION_JSON_BYTES}): keep bounded refs, never embedded bodies.`,
      'CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return Object.freeze({
    ...record,
    ownedSurface: Object.freeze([...record.ownedSurface]),
    collidingMutators: Object.freeze(
      record.collidingMutators.map((entry) => Object.freeze({ ...entry })),
    ),
  });
}

/**
 * Pure mutation-execution admission decision for one BOUNDED_MUTATION task.
 *
 * Caller-supplied observations (never observed or persisted here):
 *   task                      Task Envelope v1 (existing schema, reused verbatim)
 *   liveMainSha               exact live main SHA (independent current read)
 *   canonicalMainSha          canonical mirror main ref SHA
 *   canonicalHeadSha          canonical mirror HEAD SHA
 *   canonicalWorktreeClean    canonical mirror worktree cleanliness
 *   activeMutators            caller projection from existing durable state
 *   semanticOverlapStatus     NON_OVERLAPPING | OVERLAPPING | UNKNOWN
 *   surfaceIsolationProven    deterministic proof of physical surface independence
 *
 * @returns {Readonly<object>} frozen decision record (see MUTATION_ADMISSION_DECISIONS)
 */
export function evaluateMutationExecutionAdmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('mutation admission input must be an object.', 'INVALID_MUTATION_ADMISSION_INPUT');
  }
  const task = validateTaskEnvelopeFailClosed(input.task);
  const liveMainSha = assertCommitSha(input.liveMainSha, 'liveMainSha', 'INVALID_LIVE_MAIN_SHA');
  const canonicalMainSha = assertCommitSha(
    input.canonicalMainSha,
    'canonicalMainSha',
    'INVALID_CANONICAL_MIRROR_SHA',
  );
  const canonicalHeadSha = assertCommitSha(
    input.canonicalHeadSha,
    'canonicalHeadSha',
    'INVALID_CANONICAL_MIRROR_SHA',
  );
  if (!Array.isArray(input.activeMutators)) {
    fail(
      'activeMutators must be an array (caller-projected active mutators; pass [] when none are active).',
      'INVALID_ACTIVE_MUTATORS',
    );
  }
  const canonicalWorktreeClean = input.canonicalWorktreeClean === true;
  const surfaceIsolationProven = input.surfaceIsolationProven === true;
  const semanticOverlapStatus = normalizeSemanticOverlapStatus(input.semanticOverlapStatus);
  const base = {
    task,
    liveMainSha,
    canonicalMainSha,
    canonicalHeadSha,
    canonicalWorktreeClean,
    surfaceIsolationProven,
    semanticOverlapStatus,
    activeMutatorCount: input.activeMutators.length,
  };

  if (task.taskKind !== TASK_KIND_BOUNDED_MUTATION) {
    return buildDecision({
      ...base,
      status: UNSUPPORTED_TASK_KIND,
      ownedSurface: [],
      collidingMutators: [],
      pathCollisionCount: 0,
    });
  }
  if (task.mutationBoundary.allowsWrite !== true) {
    return buildDecision({
      ...base,
      status: BLOCKED_MUTATION_BOUNDARY,
      ownedSurface: [],
      collidingMutators: [],
      pathCollisionCount: 0,
    });
  }
  const ownedSurface = task.ownedSurface.map(normalizeOwnedSurfacePath);

  if (canonicalWorktreeClean !== true || canonicalHeadSha !== canonicalMainSha) {
    return buildDecision({
      ...base,
      status: BLOCKED_CANONICAL_MIRROR_UNHEALTHY,
      ownedSurface,
      collidingMutators: [],
      pathCollisionCount: 0,
    });
  }
  if (canonicalMainSha !== liveMainSha) {
    return buildDecision({
      ...base,
      status: BLOCKED_LIVE_MAIN_MISMATCH,
      ownedSurface,
      collidingMutators: [],
      pathCollisionCount: 0,
    });
  }
  if (surfaceIsolationProven !== true) {
    return buildDecision({
      ...base,
      status: BLOCKED_SURFACE_ISOLATION_UNPROVEN,
      ownedSurface,
      collidingMutators: [],
      pathCollisionCount: 0,
    });
  }
  const collisions = evaluateActiveMutatorCollisions({
    taskId: task.taskId,
    ownedSurface,
    activeMutators: input.activeMutators,
  });
  if (collisions.status === SERIALIZE_PATH_COLLISION) {
    return buildDecision({
      ...base,
      status: SERIALIZE_PATH_COLLISION,
      ownedSurface,
      collidingMutators: collisions.collidingMutators,
      pathCollisionCount: collisions.pathCollisionCount,
    });
  }
  if (collisions.status === SERIALIZE_UNKNOWN_OVERLAP) {
    return buildDecision({
      ...base,
      status: SERIALIZE_UNKNOWN_OVERLAP,
      ownedSurface,
      collidingMutators: [],
      pathCollisionCount: 0,
    });
  }
  if (semanticOverlapStatus === SEMANTIC_OVERLAP_OVERLAPPING) {
    return buildDecision({
      ...base,
      status: SERIALIZE_SEMANTIC_OVERLAP,
      ownedSurface,
      collidingMutators: [],
      pathCollisionCount: 0,
    });
  }
  if (semanticOverlapStatus === SEMANTIC_OVERLAP_UNKNOWN) {
    return buildDecision({
      ...base,
      status: SERIALIZE_UNKNOWN_OVERLAP,
      ownedSurface,
      collidingMutators: [],
      pathCollisionCount: 0,
    });
  }
  return buildDecision({
    ...base,
    status: MUTATION_ADMITTED,
    ownedSurface,
    collidingMutators: [],
    pathCollisionCount: 0,
  });
}
