// Proof for PM-01-MUTATION-ADMISSION-PARALLEL-OVERLAP.
// Mutation-execution admission + parallel overlap gate ONLY:
//   decides whether one BOUNDED_MUTATION task may start mutation now, from
//   caller-observed canonical/live git state plus a caller-projected active
//   mutator list.
//
// Explicitly NOT implemented here (and asserted absent):
//   executor invocation, OpenCode mutation, operator-cli changes, dispatch,
//   scheduler, queue polling, cron/daemon, retry/backoff infrastructure, worker
//   registry, agent/executor selection, automatic task generation, publication,
//   production deployment, new durable registry / centralized state.
//   evaluateMutationExecutionAdmission() != executeMutation() != dispatch() !=
//   schedule() != publish().
//   No git, no store, no network, no clock: pure decision only.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BLOCKED_CANONICAL_MIRROR_UNHEALTHY,
  BLOCKED_LIVE_MAIN_MISMATCH,
  BLOCKED_MUTATION_BOUNDARY,
  BLOCKED_SURFACE_ISOLATION_UNPROVEN,
  evaluateMutationExecutionAdmission,
  MUTATION_ADMISSION_DECISIONS,
  MUTATION_ADMITTED,
  MutationAdmissionValidationError,
  normalizeOwnedSurfacePath,
  ownedSurfacePathsOverlap,
  SEMANTIC_OVERLAP_NON_OVERLAPPING,
  SEMANTIC_OVERLAP_OVERLAPPING,
  SEMANTIC_OVERLAP_UNKNOWN,
  SERIALIZE_PATH_COLLISION,
  SERIALIZE_SEMANTIC_OVERLAP,
  SERIALIZE_UNKNOWN_OVERLAP,
  UNSUPPORTED_TASK_KIND,
  validateMutationAdmissionDecision,
} from './mutation-execution-admission.mjs';
import { buildTaskEnvelope } from './task-envelope.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

const LIVE_MAIN_SHA = '9ad3fe99e35df378a0fdf0182222af04bfcb1c45';
const OTHER_SHA = 'bdeadbeefdeadbeefdeadbeefdeadbeefdeadbee';
const TASK_ID = 'PM01-ADMISSION-TASK';
const OWNED_PATH = 'scripts/coordination/mutation-execution-admission.mjs';

function sampleTaskInput(overrides = {}) {
  return {
    taskId: TASK_ID,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'MUTATION_EXECUTION_ADMISSION_PROVED',
    policyRefs: [
      'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
    ],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: { liveMainHint: null, requiredPolicies: ['AGENTS.md'] },
    ownedSurface: [OWNED_PATH],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['mutation-execution-admission-proof'],
    ...overrides,
  };
}

function sampleTask(overrides = {}) {
  return buildTaskEnvelope(sampleTaskInput(overrides));
}

function activeMutator(overrides = {}) {
  return {
    taskId: 'PM01-ACTIVE-MUTATOR',
    taskKind: 'BOUNDED_MUTATION',
    ownedSurface: ['apps/api/src/payments'],
    activityStatus: 'CLAIMED',
    ...overrides,
  };
}

function admissionInput(overrides = {}) {
  return {
    task: sampleTask(),
    liveMainSha: LIVE_MAIN_SHA,
    canonicalMainSha: LIVE_MAIN_SHA,
    canonicalHeadSha: LIVE_MAIN_SHA,
    canonicalWorktreeClean: true,
    activeMutators: [],
    semanticOverlapStatus: SEMANTIC_OVERLAP_NON_OVERLAPPING,
    surfaceIsolationProven: true,
    ...overrides,
  };
}

function isValidationError(code) {
  return (error) => error instanceof MutationAdmissionValidationError && error.code === code;
}

// ---------------------------------------------------------------------------
// 1-3. TASK KIND + MUTATION BOUNDARY GATES.
// ---------------------------------------------------------------------------

test('S1. BOUNDED_MUTATION on clean exact live main with proven isolation admits', () => {
  const decision = evaluateMutationExecutionAdmission(admissionInput());
  assert.equal(decision.status, MUTATION_ADMITTED);
  assert.equal(decision.admitted, true);
  assert.equal(decision.taskId, TASK_ID);
  assert.deepEqual([...decision.ownedSurface], [OWNED_PATH]);
  assert.equal(decision.pathCollisionCount, 0);
  assert.deepEqual([...decision.collidingMutators], []);
  assert.equal(decision.semanticOverlapStatus, SEMANTIC_OVERLAP_NON_OVERLAPPING);
  assert.equal(decision.canonicalWorktreeClean, true);
  assert.equal(decision.surfaceIsolationProven, true);
  assert.equal(MUTATION_ADMISSION_DECISIONS.includes(decision.status), true);
  assert.match(decision.reason, /admission passed/);
});

test('S2. READ_ONLY task is unsupported and its intake semantics are untouched', () => {
  const decision = evaluateMutationExecutionAdmission(
    admissionInput({
      task: sampleTask({ taskKind: 'READ_ONLY', mutationBoundary: { allowsWrite: false } }),
    }),
  );
  assert.equal(decision.status, UNSUPPORTED_TASK_KIND);
  assert.equal(decision.admitted, false);
  assert.deepEqual([...decision.ownedSurface], []);
  assert.match(decision.reason, /BOUNDED_MUTATION/);
});

test('S3. BOUNDED_MUTATION with allowsWrite=false is blocked at the boundary gate', () => {
  const decision = evaluateMutationExecutionAdmission(
    admissionInput({ task: sampleTask({ mutationBoundary: { allowsWrite: false } }) }),
  );
  assert.equal(decision.status, BLOCKED_MUTATION_BOUNDARY);
  assert.equal(decision.admitted, false);
});

// ---------------------------------------------------------------------------
// 4-6. PHYSICAL OWNED-SURFACE COLLISION RULES.
// ---------------------------------------------------------------------------

test('S4. same-file overlap with an active mutator serializes with recorded collision', () => {
  const decision = evaluateMutationExecutionAdmission(
    admissionInput({
      activeMutators: [activeMutator({ taskId: 'PM01-ACTIVE-SAME', ownedSurface: [OWNED_PATH] })],
    }),
  );
  assert.equal(decision.status, SERIALIZE_PATH_COLLISION);
  assert.equal(decision.admitted, false);
  assert.equal(decision.pathCollisionCount, 1);
  assert.equal(decision.collidingMutators.length, 1);
  assert.deepEqual(decision.collidingMutators[0], {
    taskId: 'PM01-ACTIVE-SAME',
    activePath: OWNED_PATH,
    ownedPath: OWNED_PATH,
  });
});

test('S5. directory/descendant ownership collides in both directions', () => {
  const ownedDirectory = evaluateMutationExecutionAdmission(
    admissionInput({
      task: sampleTask({ ownedSurface: ['apps/api/src/payments'] }),
      activeMutators: [
        activeMutator({
          taskId: 'PM01-ACTIVE-CHILD',
          ownedSurface: ['apps/api/src/payments/foo.ts'],
        }),
      ],
    }),
  );
  assert.equal(ownedDirectory.status, SERIALIZE_PATH_COLLISION);

  const ownedChild = evaluateMutationExecutionAdmission(
    admissionInput({
      task: sampleTask({ ownedSurface: ['apps/api/src/payments/foo.ts'] }),
      activeMutators: [
        activeMutator({ taskId: 'PM01-ACTIVE-PARENT', ownedSurface: ['apps/api/src/payments/'] }),
      ],
    }),
  );
  assert.equal(ownedChild.status, SERIALIZE_PATH_COLLISION);
  assert.equal(ownedChild.collidingMutators[0].activePath, 'apps/api/src/payments');

  assert.equal(
    ownedSurfacePathsOverlap('apps/api/src/payments', 'apps/api/src/payments/foo.ts'),
    true,
  );
  assert.equal(
    ownedSurfacePathsOverlap('apps/api/src/payments/foo.ts', 'apps/api/src/payments'),
    true,
  );
  assert.equal(ownedSurfacePathsOverlap('apps/api/src/payments', 'apps/api/src/payments'), true);
});

test('S6. disjoint sibling paths and segment-boundary prefixes do not collide', () => {
  const disjointFiles = evaluateMutationExecutionAdmission(
    admissionInput({
      task: sampleTask({ ownedSurface: ['scripts/coordination/foo.mjs'] }),
      activeMutators: [
        activeMutator({
          taskId: 'PM01-ACTIVE-DISJOINT',
          ownedSurface: ['scripts/coordination/bar.mjs'],
        }),
      ],
    }),
  );
  assert.equal(disjointFiles.status, MUTATION_ADMITTED);
  assert.equal(disjointFiles.pathCollisionCount, 0);

  const segmentBoundary = evaluateMutationExecutionAdmission(
    admissionInput({
      task: sampleTask({ ownedSurface: ['scripts/coordination'] }),
      activeMutators: [
        activeMutator({
          taskId: 'PM01-ACTIVE-PREFIX',
          ownedSurface: ['scripts/coordination2/bar.mjs'],
        }),
      ],
    }),
  );
  assert.equal(segmentBoundary.status, MUTATION_ADMITTED);

  assert.equal(
    ownedSurfacePathsOverlap('scripts/coordination/foo.mjs', 'scripts/coordination/bar.mjs'),
    false,
  );
  assert.equal(
    ownedSurfacePathsOverlap('scripts/coordination', 'scripts/coordination2/bar.mjs'),
    false,
  );
});

// ---------------------------------------------------------------------------
// 7-8. SEMANTIC OVERLAP GATE: never inferred from path disjointness.
// ---------------------------------------------------------------------------

test('S7. explicit semantic OVERLAPPING serializes even with fully disjoint paths', () => {
  const decision = evaluateMutationExecutionAdmission(
    admissionInput({
      task: sampleTask({ ownedSurface: ['scripts/coordination/foo.mjs'] }),
      activeMutators: [
        activeMutator({ taskId: 'PM01-ACTIVE-FAR', ownedSurface: ['apps/driver/src/tracking'] }),
      ],
      semanticOverlapStatus: SEMANTIC_OVERLAP_OVERLAPPING,
    }),
  );
  assert.equal(decision.status, SERIALIZE_SEMANTIC_OVERLAP);
  assert.equal(decision.admitted, false);
  assert.equal(decision.semanticOverlapStatus, SEMANTIC_OVERLAP_OVERLAPPING);
});

test('S8. semantic UNKNOWN / missing / unrecognized statuses fail closed as unknown overlap', () => {
  const unknown = evaluateMutationExecutionAdmission(
    admissionInput({ semanticOverlapStatus: SEMANTIC_OVERLAP_UNKNOWN }),
  );
  assert.equal(unknown.status, SERIALIZE_UNKNOWN_OVERLAP);
  assert.equal(unknown.semanticOverlapStatus, SEMANTIC_OVERLAP_UNKNOWN);

  const missing = evaluateMutationExecutionAdmission(
    admissionInput({ semanticOverlapStatus: undefined }),
  );
  assert.equal(missing.status, SERIALIZE_UNKNOWN_OVERLAP);
  assert.equal(missing.semanticOverlapStatus, SEMANTIC_OVERLAP_UNKNOWN);

  const garbage = evaluateMutationExecutionAdmission(
    admissionInput({ semanticOverlapStatus: 'probably-fine' }),
  );
  assert.equal(garbage.status, SERIALIZE_UNKNOWN_OVERLAP);
  assert.equal(garbage.semanticOverlapStatus, SEMANTIC_OVERLAP_UNKNOWN);

  // Path disjointness alone never promotes the semantic status.
  const disjointButUnknown = evaluateMutationExecutionAdmission(
    admissionInput({
      task: sampleTask({ ownedSurface: ['scripts/coordination/foo.mjs'] }),
      activeMutators: [
        activeMutator({ taskId: 'PM01-ACTIVE-FAR', ownedSurface: ['apps/driver/src/tracking'] }),
      ],
      semanticOverlapStatus: SEMANTIC_OVERLAP_UNKNOWN,
    }),
  );
  assert.equal(disjointButUnknown.status, SERIALIZE_UNKNOWN_OVERLAP);
});

// ---------------------------------------------------------------------------
// 9-11. CANONICAL MIRROR HEALTH + EXACT LIVE-MAIN + ISOLATION PROOF.
// ---------------------------------------------------------------------------

test('S9. dirty canonical mirror blocks before any parallelism judgement', () => {
  const dirty = evaluateMutationExecutionAdmission(
    admissionInput({
      canonicalWorktreeClean: false,
      activeMutators: [activeMutator({ taskId: 'PM01-ACTIVE', ownedSurface: [OWNED_PATH] })],
    }),
  );
  assert.equal(dirty.status, BLOCKED_CANONICAL_MIRROR_UNHEALTHY);
  assert.equal(dirty.admitted, false);

  const nonBoolean = evaluateMutationExecutionAdmission(
    admissionInput({ canonicalWorktreeClean: 'true' }),
  );
  assert.equal(nonBoolean.status, BLOCKED_CANONICAL_MIRROR_UNHEALTHY);
  assert.equal(nonBoolean.canonicalWorktreeClean, false);
});

test('S10. canonical main != live main blocks; HEAD != canonical main is mirror-unhealthy', () => {
  // Healthy mirror at an older main: HEAD == canonical main != current live main.
  const staleMirror = evaluateMutationExecutionAdmission(
    admissionInput({ canonicalMainSha: OTHER_SHA, canonicalHeadSha: OTHER_SHA }),
  );
  assert.equal(staleMirror.status, BLOCKED_LIVE_MAIN_MISMATCH);
  assert.equal(staleMirror.admitted, false);

  const wrongHead = evaluateMutationExecutionAdmission(
    admissionInput({ canonicalHeadSha: OTHER_SHA }),
  );
  assert.equal(wrongHead.status, BLOCKED_CANONICAL_MIRROR_UNHEALTHY);
  assert.equal(wrongHead.admitted, false);
});

test('S11. unproven physical surface isolation blocks parallel admission', () => {
  const unproven = evaluateMutationExecutionAdmission(
    admissionInput({ surfaceIsolationProven: false }),
  );
  assert.equal(unproven.status, BLOCKED_SURFACE_ISOLATION_UNPROVEN);
  assert.equal(unproven.admitted, false);

  const missing = evaluateMutationExecutionAdmission(
    admissionInput({ surfaceIsolationProven: undefined }),
  );
  assert.equal(missing.status, BLOCKED_SURFACE_ISOLATION_UNPROVEN);
  assert.equal(missing.surfaceIsolationProven, false);
});

// ---------------------------------------------------------------------------
// 12. NON-CANONICAL PATHS FAIL CLOSED (no silent repair).
// ---------------------------------------------------------------------------

test('S12. non-canonical paths fail closed instead of being normalized silently', () => {
  for (const badPath of [
    '',
    '   ',
    ' scripts/coordination/foo.mjs',
    'scripts/coordination/foo.mjs ',
    'scripts\\coordination\\foo.mjs',
    'scripts//coordination/foo.mjs',
    'scripts/./coordination/foo.mjs',
    'scripts/../coordination/foo.mjs',
    '/scripts/coordination/foo.mjs',
    'C:/scripts/coordination/foo.mjs',
    '~/scripts/coordination/foo.mjs',
    'scripts/coordination/*.mjs',
    'scripts/coordination/foo?.mjs',
    'scripts/coordination/[foo].mjs',
    'scripts/coordination/\u0000foo.mjs',
    '.',
    './',
  ]) {
    assert.throws(
      () => normalizeOwnedSurfacePath(badPath),
      isValidationError('INVALID_OWNED_SURFACE_PATH'),
      `expected fail-closed normalization for ${JSON.stringify(badPath)}`,
    );
  }

  // Canonical ./ prefix and trailing separator are unambiguous and normalized.
  assert.equal(
    normalizeOwnedSurfacePath('./scripts/coordination/foo.mjs'),
    'scripts/coordination/foo.mjs',
  );
  assert.equal(normalizeOwnedSurfacePath('scripts/coordination/'), 'scripts/coordination');
  assert.equal(
    normalizeOwnedSurfacePath('scripts/coordination/foo.mjs'),
    'scripts/coordination/foo.mjs',
  );

  // Candidate task with a non-canonical owned path: fail closed, never admitted.
  assert.throws(
    () =>
      evaluateMutationExecutionAdmission(
        admissionInput({ task: sampleTask({ ownedSurface: ['scripts\\coordination\\foo.mjs'] }) }),
      ),
    isValidationError('INVALID_OWNED_SURFACE_PATH'),
  );

  // Task Envelope v1 already rejects absolute / ".." ownership: still fail closed.
  assert.throws(
    () => sampleTask({ ownedSurface: ['../outside'] }),
    (error) => error?.name === 'CoordinationValidationError',
  );

  // An active mutator with a non-canonical path is unprovable -> unknown overlap.
  const unprovable = evaluateMutationExecutionAdmission(
    admissionInput({
      activeMutators: [
        activeMutator({
          taskId: 'PM01-ACTIVE-BADPATH',
          ownedSurface: ['scripts\\coordination\\x.mjs'],
        }),
      ],
    }),
  );
  assert.equal(unprovable.status, SERIALIZE_UNKNOWN_OVERLAP);
});

// ---------------------------------------------------------------------------
// 13-14. MULTIPLE ACTIVE MUTATORS: one collision serializes, unrelated admits.
// ---------------------------------------------------------------------------

test('S13. any single colliding mutator among many serializes', () => {
  const decision = evaluateMutationExecutionAdmission(
    admissionInput({
      activeMutators: [
        activeMutator({ taskId: 'PM01-ACTIVE-1', ownedSurface: ['docs/notes/'] }),
        activeMutator({ taskId: 'PM01-ACTIVE-2', ownedSurface: [OWNED_PATH] }),
        activeMutator({ taskId: 'PM01-ACTIVE-3', ownedSurface: ['scripts/git/'] }),
      ],
    }),
  );
  assert.equal(decision.status, SERIALIZE_PATH_COLLISION);
  assert.equal(decision.pathCollisionCount, 1);
  assert.deepEqual(
    decision.collidingMutators.map((entry) => entry.taskId),
    ['PM01-ACTIVE-2'],
  );
  assert.equal(decision.activeMutatorCount, 3);
});

test('S14. unrelated active mutators (plus self and READ_ONLY entries) admit', () => {
  const decision = evaluateMutationExecutionAdmission(
    admissionInput({
      activeMutators: [
        activeMutator({
          taskId: 'PM01-ACTIVE-UNRELATED',
          ownedSurface: ['scripts/git/publication-transport.mjs'],
        }),
        activeMutator({ taskId: TASK_ID, ownedSurface: [OWNED_PATH] }),
        activeMutator({
          taskId: 'PM01-READONLY',
          taskKind: 'READ_ONLY',
          ownedSurface: [OWNED_PATH],
        }),
      ],
    }),
  );
  assert.equal(decision.status, MUTATION_ADMITTED);
  assert.equal(decision.activeMutatorCount, 3);
  assert.equal(decision.pathCollisionCount, 0);
});

// ---------------------------------------------------------------------------
// 15. FIXED GATE PRECEDENCE (fail-closed ordering).
// ---------------------------------------------------------------------------

test('S15. gate precedence is fixed: kind > boundary > mirror > live main > isolation > path > semantic', () => {
  const collide = [activeMutator({ taskId: 'PM01-ACTIVE', ownedSurface: [OWNED_PATH] })];

  assert.equal(
    evaluateMutationExecutionAdmission(
      admissionInput({
        task: sampleTask({ taskKind: 'READ_ONLY', mutationBoundary: { allowsWrite: false } }),
        canonicalWorktreeClean: false,
        activeMutators: collide,
      }),
    ).status,
    UNSUPPORTED_TASK_KIND,
  );
  assert.equal(
    evaluateMutationExecutionAdmission(
      admissionInput({
        task: sampleTask({ mutationBoundary: { allowsWrite: false } }),
        canonicalWorktreeClean: false,
        activeMutators: collide,
      }),
    ).status,
    BLOCKED_MUTATION_BOUNDARY,
  );
  assert.equal(
    evaluateMutationExecutionAdmission(
      admissionInput({ canonicalWorktreeClean: false, activeMutators: collide }),
    ).status,
    BLOCKED_CANONICAL_MIRROR_UNHEALTHY,
  );
  assert.equal(
    evaluateMutationExecutionAdmission(
      admissionInput({
        canonicalMainSha: OTHER_SHA,
        canonicalHeadSha: OTHER_SHA,
        activeMutators: collide,
      }),
    ).status,
    BLOCKED_LIVE_MAIN_MISMATCH,
  );
  assert.equal(
    evaluateMutationExecutionAdmission(
      admissionInput({ surfaceIsolationProven: false, activeMutators: collide }),
    ).status,
    BLOCKED_SURFACE_ISOLATION_UNPROVEN,
  );
  assert.equal(
    evaluateMutationExecutionAdmission(
      admissionInput({
        activeMutators: collide,
        semanticOverlapStatus: SEMANTIC_OVERLAP_OVERLAPPING,
      }),
    ).status,
    SERIALIZE_PATH_COLLISION,
  );
});

// ---------------------------------------------------------------------------
// 16. ACTIVE-MUTATOR PROJECTION STRICTNESS: unprovable entries fail closed.
// ---------------------------------------------------------------------------

test('S16. unprovable active-mutator entries serialize as unknown, collision still wins', () => {
  for (const badMutator of [
    null,
    'not-an-object',
    activeMutator({ taskId: '' }),
    activeMutator({ taskKind: 'MAYBE_MUTATION' }),
    activeMutator({ taskKind: undefined }),
    activeMutator({ activityStatus: '' }),
    activeMutator({ activityStatus: undefined }),
    activeMutator({ ownedSurface: [] }),
    activeMutator({ ownedSurface: undefined }),
  ]) {
    const decision = evaluateMutationExecutionAdmission(
      admissionInput({ activeMutators: [badMutator] }),
    );
    assert.equal(
      decision.status,
      SERIALIZE_UNKNOWN_OVERLAP,
      `expected unknown overlap for ${JSON.stringify(badMutator)}`,
    );
  }

  const collisionWins = evaluateMutationExecutionAdmission(
    admissionInput({
      activeMutators: [
        activeMutator({ taskKind: undefined }),
        activeMutator({ taskId: 'PM01-ACTIVE-HIT', ownedSurface: [OWNED_PATH] }),
      ],
    }),
  );
  assert.equal(collisionWins.status, SERIALIZE_PATH_COLLISION);
  assert.equal(collisionWins.collidingMutators[0].taskId, 'PM01-ACTIVE-HIT');
});

// ---------------------------------------------------------------------------
// 17-19. CONSERVATIVE COMPARISON, DETERMINISM, DECISION INTEGRITY, INPUT GATES.
// ---------------------------------------------------------------------------

test('S17. case-variant paths collide conservatively (case-insensitive checkouts)', () => {
  const decision = evaluateMutationExecutionAdmission(
    admissionInput({
      task: sampleTask({ ownedSurface: ['scripts/coordination/Foo.mjs'] }),
      activeMutators: [
        activeMutator({
          taskId: 'PM01-ACTIVE-CASE',
          ownedSurface: ['scripts/coordination/foo.mjs'],
        }),
      ],
    }),
  );
  assert.equal(decision.status, SERIALIZE_PATH_COLLISION);
});

test('S18. decisions are deterministic, frozen, and validate against tampering', () => {
  const first = evaluateMutationExecutionAdmission(admissionInput());
  const second = evaluateMutationExecutionAdmission(admissionInput());
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.ownedSurface), true);
  assert.equal(validateMutationAdmissionDecision(first).status, MUTATION_ADMITTED);

  assert.throws(
    () => validateMutationAdmissionDecision({ ...first, admitted: false }),
    isValidationError('INVALID_MUTATION_ADMISSION_DECISION'),
  );
  assert.throws(
    () => validateMutationAdmissionDecision({ ...first, status: SERIALIZE_PATH_COLLISION }),
    isValidationError('INVALID_MUTATION_ADMISSION_DECISION'),
  );
  assert.throws(
    () => validateMutationAdmissionDecision({ ...first, ownedSurface: ['../outside'] }),
    isValidationError('INVALID_MUTATION_ADMISSION_DECISION'),
  );
  assert.throws(
    () => validateMutationAdmissionDecision({ ...first, liveMainSha: 'not-a-sha' }),
    isValidationError('INVALID_MUTATION_ADMISSION_DECISION'),
  );
});

test('S19. malformed admission inputs and oversized projections fail closed', () => {
  assert.throws(
    () => evaluateMutationExecutionAdmission(null),
    isValidationError('INVALID_MUTATION_ADMISSION_INPUT'),
  );
  assert.throws(
    () => evaluateMutationExecutionAdmission(admissionInput({ task: { taskId: TASK_ID } })),
    isValidationError('INVALID_TASK_ENVELOPE'),
  );
  assert.throws(
    () => evaluateMutationExecutionAdmission(admissionInput({ activeMutators: undefined })),
    isValidationError('INVALID_ACTIVE_MUTATORS'),
  );
  assert.throws(
    () => evaluateMutationExecutionAdmission(admissionInput({ liveMainSha: 'nope' })),
    isValidationError('INVALID_LIVE_MAIN_SHA'),
  );
  assert.throws(
    () => evaluateMutationExecutionAdmission(admissionInput({ canonicalMainSha: 'nope' })),
    isValidationError('INVALID_CANONICAL_MIRROR_SHA'),
  );
  assert.throws(
    () => evaluateMutationExecutionAdmission(admissionInput({ canonicalHeadSha: 'nope' })),
    isValidationError('INVALID_CANONICAL_MIRROR_SHA'),
  );

  const oversized = evaluateMutationExecutionAdmission(
    admissionInput({
      activeMutators: Array.from({ length: 257 }, (_, index) =>
        activeMutator({ taskId: `PM01-ACTIVE-PROJECTION-${index}`, ownedSurface: ['docs/notes'] }),
      ),
    }),
  );
  assert.equal(oversized.status, SERIALIZE_UNKNOWN_OVERLAP);
});

// ---------------------------------------------------------------------------
// 20. SOURCE BOUNDARY: pure, no store/git/executor/scheduler/timers.
// ---------------------------------------------------------------------------

test('S20. module source reuses Task Envelope v1 and owns no runtime authority', () => {
  const moduleSource = readFileSync(
    join(MODULE_DIRECTORY, 'mutation-execution-admission.mjs'),
    'utf8',
  );
  for (const forbiddenToken of [
    'node:child_process',
    'execFileSync',
    'spawn(',
    'writeFileSync',
    'mkdirSync',
    'rmSync',
    'Date.now',
    'new Date(',
    'setTimeout',
    'setInterval',
    'randomUUID',
    "from './store.mjs'",
    "from './operator-cli.mjs'",
    "from './opencode-cli-executor-adapter.mjs'",
    "from '../git/publication-admission.mjs'",
  ]) {
    assert.equal(
      moduleSource.includes(forbiddenToken),
      false,
      `mutation admission must not contain ${forbiddenToken}`,
    );
  }
  for (const reusedContract of [
    'task-envelope.mjs',
    'validateTaskEnvelope',
    'TASK_KIND_BOUNDED_MUTATION',
  ]) {
    assert.equal(
      moduleSource.includes(reusedContract),
      true,
      `mutation admission must reuse ${reusedContract}`,
    );
  }
});
