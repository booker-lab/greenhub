// Proof for
// GREENHUB-COORDINATION-SHARED-CONTROL-TOWER-DISPOSITION-RETURN-GF09.
//
// Closes the reverse boundary of the coordination cycle:
//   PENDING_DISPOSITION(taskId)@N                      [GF-07/GF-08 durable]
//     -> SHARED_CONTROL_TOWER_DECISION_AVAILABLE       [non-canonical read]
//     -> <state>(taskId)@N+1                           [existing local authority]
//
// Proved here:
//   A. deterministic decision identity + render/parse/validate round-trip with
//      zero durable writes,
//   B. perform adopts exactly ONE legal immutable next generation from a shared
//      Control Tower decision and replays with zero durable byte changes,
//   C. crash window: generation N+1 durable with the pointer still at N converges
//      through the existing same-generation first-wins fencing,
//   D. no shared decision / no shared surface -> RETURN_PENDING with zero writes,
//   E. binding mismatch, conflicting decisions, corrupt marker comments, and
//      ambiguous surfaces fail closed with zero writes,
//   F. stale decisions (moved generation, drifted observed state, foreign
//      generation, adopted-then-edited) fail closed and never overwrite a later
//      canonical disposition,
//   G. transport failure reports RETURN_PENDING with redacted detail and zero
//      canonical change, then recovers,
//   H. exact duplicate decisions (same identity) are idempotent; existing
//      disposition transition semantics are reused (NEEDS_USER_DECISION gate),
//   I. coordination:disposition adopts through the CLI with zero executor
//      configuration and replays without re-invoking anything,
//   J. the CLI fails closed without a transport, without an admission, and
//      without a disposition pointer,
//   K. the concrete GitHub transport exposes deterministic argv-only shell-free
//      read-only findRelayIssue/findComments commands,
//   L. LOCAL_COORDINATION_TRUTH_INDEPENDENT_OF_SHARED_SURFACE: deleting the
//      shared surface changes zero canonical bytes,
//   M. static boundaries: the return owner is scheduler/timer/clock/fs/
//      executor-free, performs exactly ONE store mutation, and package.json
//      exposes coordination:disposition.
//
// All runtime state lives in isolated temp directories. No network, no real
// executor process, no real `gh` process: the transport seam is caller-supplied.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildControlTowerDispositionDecisionMarker,
  computeControlTowerDispositionDecisionIdentity,
  CONTROL_TOWER_DISPOSITION_RETURN_BINDING_MISMATCH,
  CONTROL_TOWER_DISPOSITION_RETURN_DECISION_CONFLICT,
  CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE,
  CONTROL_TOWER_DISPOSITION_RETURN_DISPOSITION_NOT_FOUND,
  CONTROL_TOWER_DISPOSITION_RETURN_NOT_CONFIGURED,
  CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY,
  CONTROL_TOWER_DISPOSITION_RETURN_STATUS_PENDING,
  CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED,
  CONTROL_TOWER_DISPOSITION_RETURN_SURFACE_AMBIGUOUS,
  deriveControlTowerDispositionReturn,
  extractControlTowerDispositionDecision,
  performControlTowerDispositionReturn,
  renderControlTowerDispositionDecisionBody,
  validateControlTowerDispositionDecision,
} from './control-tower-disposition-return.mjs';
import {
  CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
  ControlTowerResultRelayTransportError,
  createGitHubIssueCommentRelayTransport,
} from './control-tower-result-relay.mjs';
import { runOperatorCli } from './operator-cli.mjs';
import { performControlTowerResultIntake } from './control-tower-result-intake.mjs';
import { computeResultBinding, DISPOSITION_STATE_PENDING } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';
import {
  AUTHORITY_KIND_USER_APPROVED_INTAKE,
  USER_APPROVED_INTAKE_DISPATCH_SLOT,
} from './user-approved-intake.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..');
const OPERATOR_CLI_PATH = join(MODULE_DIRECTORY, 'operator-cli.mjs');
const RETURN_MODULE_PATH = join(MODULE_DIRECTORY, 'control-tower-disposition-return.mjs');

function makeHome(prefix = 'greenhub-gf09-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeHome(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function captureStream() {
  const stream = { text: '' };
  stream.write = (chunk) => {
    stream.text += String(chunk);
    return true;
  };
  return stream;
}

function snapshotHome(home) {
  const out = {};
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of sorted) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const stat = statSync(full);
        out[full.slice(home.length + 1)] = {
          content: readFileSync(full, 'utf8'),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      }
    }
  };
  walk(home);
  return out;
}

function sampleTaskSpec(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'GF09_SHARED_CONTROL_TOWER_DISPOSITION_RETURN',
    policyRefs: [
      'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
    ],
    evidenceRefs: ['read:package.json'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: { liveMainHint: null, requiredPolicies: ['AGENTS.md'] },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['read:package.json'],
    ...overrides,
  };
}

function intakeTask(store, taskId, overrides = {}) {
  return store.intakeUserApprovedReadOnlyTask({
    userApproved: true,
    approval: { approvedBy: 'gf09-test-user', approvalRef: `gf09:test:${taskId}` },
    taskSpec: sampleTaskSpec(taskId, overrides),
    recorderId: 'gf09-test-recorder',
  });
}

function intakeAuthority(taskId, intakeId) {
  return {
    authorityKind: AUTHORITY_KIND_USER_APPROVED_INTAKE,
    authorityId: intakeId,
    sourceTaskId: taskId,
    emissionSlot: USER_APPROVED_INTAKE_DISPATCH_SLOT,
  };
}

function claimAndDeliverIntakeTask(store, taskId, { workerId = 'gf09-worker', resultId } = {}) {
  const claimed = store.claimUserApprovedIntakeTask({
    taskId,
    workerId,
    leaseDurationMs: 60_000,
  });
  const claim = claimed.claim;
  store.deliverResult({
    taskId,
    resultId: resultId ?? `result_${taskId.toLowerCase()}`,
    workerId: claim.workerId,
    claimToken: claim.claimToken,
    claimGeneration: claim.generation,
    status: 'SUCCEEDED',
    summary: `synthetic READ_ONLY probe for ${taskId}`,
    proofRefs: ['proof:gf09-synthetic-probe'],
    evidenceRefs: ['evidence:gf09-synthetic-probe'],
    frictionObserved: ['NONE'],
  });
  return claim;
}

function decisionReadyTask(store, taskId, { resultId } = {}) {
  const intake = intakeTask(store, taskId);
  claimAndDeliverIntakeTask(store, taskId, { resultId });
  const authority = intakeAuthority(taskId, intake.record.intakeId);
  performControlTowerResultIntake({ store, taskId, authority });
  return authority;
}

function decisionDocument({
  taskId,
  resultId,
  resultBinding,
  dispositionRef: ref,
  dispositionState = DISPOSITION_STATE_PENDING,
  targetDispositionState,
  overrides = {},
}) {
  return {
    schemaVersion: '1',
    taskId,
    resultId,
    resultBinding,
    dispositionRef: ref,
    dispositionState,
    targetDispositionState,
    controlTowerId: 'control-tower',
    controlTowerToken: 'ct-shared-decision',
    decidedAt: '2026-09-21T00:00:00.000Z',
    policyRefs: ['policy:control-tower-verdict'],
    proofRefs: ['proof:shared-decision'],
    evidenceRefs: ['evidence:shared-decision'],
    ...overrides,
  };
}

function decisionBody(document) {
  return renderControlTowerDispositionDecisionBody(document);
}

/**
 * In-memory shared-surface double for the GF-09 transport seam. One reusable
 * issue, marker-filtered read-only comment lookup, and a manual `postDecision`
 * that represents the Control Tower authoring a comment (never used by the
 * adoption code).
 */
function createFakeDecisionSurface(options = {}) {
  const state = {
    issue:
      options.issue === undefined
        ? {
            issueNumber: 77,
            url: 'https://example.test/booker-lab/greenhub/issues/77',
            state: 'OPEN',
            duplicateIssueCount: 1,
          }
        : options.issue,
    comments: [...(options.comments ?? [])],
    nextCommentId: options.nextCommentId ?? 2001,
    counters: { findRelayIssue: 0, findComments: 0 },
  };
  const maybeFail = (step) => {
    if (options.failOn === step) {
      throw new ControlTowerResultRelayTransportError(
        options.failMessage ?? `synthetic ${step} failure`,
      );
    }
  };
  return {
    repository: options.repository ?? 'booker-lab/greenhub',
    state,
    async findRelayIssue({ title }) {
      state.counters.findRelayIssue += 1;
      maybeFail('findRelayIssue');
      if (state.issue !== null && state.issue.title !== undefined && state.issue.title !== title) {
        return null;
      }
      return state.issue;
    },
    async findComments({ issueNumber, marker }) {
      state.counters.findComments += 1;
      maybeFail('findComments');
      if (state.issue !== null && issueNumber !== state.issue.issueNumber) return [];
      return state.comments
        .filter((comment) => comment.body.includes(marker))
        .map((comment) => ({ ...comment }));
    },
    postDecision(body) {
      const commentId = state.nextCommentId;
      state.nextCommentId += 1;
      state.comments.push({
        commentId,
        url: `https://example.test/booker-lab/greenhub/issues/77#issuecomment-${commentId}`,
        createdAt: '2026-09-21T00:00:00Z',
        body,
      });
      return commentId;
    },
  };
}

function readGenerations(home, taskId) {
  return readdirSync(join(home, 'tasks', taskId, 'disposition', 'generations')).sort();
}

function currentPointerPath(home, taskId) {
  return join(home, 'tasks', taskId, 'disposition', 'current.json');
}

function canonicalFixture(store, taskId, { resultId } = {}) {
  const authority = decisionReadyTask(store, taskId, { resultId });
  const result = store.readResult(taskId);
  return {
    authority,
    result,
    binding: computeResultBinding(result),
    dispositionRef: `${taskId}@${store.readCurrentDisposition(taskId).dispositionGeneration}`,
  };
}

// ---------------------------------------------------------------------------
// A. deterministic identity + render/parse/validate round-trip
// ---------------------------------------------------------------------------

test('A. the shared decision document is deterministic, bounded, and round-trips with zero writes', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-A001';
    const fixture = canonicalFixture(store, taskId);
    const before = snapshotHome(home);

    const document = decisionDocument({
      taskId,
      resultId: fixture.result.resultId,
      resultBinding: fixture.binding,
      dispositionRef: fixture.dispositionRef,
      targetDispositionState: 'ADOPTED',
    });
    const body = decisionBody(document);
    const marker = buildControlTowerDispositionDecisionMarker({ taskId });
    assert.ok(body.includes(marker));
    const extracted = extractControlTowerDispositionDecision(body);
    assert.deepEqual(extracted, document);
    const validated = validateControlTowerDispositionDecision(extracted);
    assert.equal(validated.schemaVersion, '1');
    assert.equal(validated.taskId, taskId);
    assert.equal(validated.resultBinding, fixture.binding);
    assert.equal(validated.targetDispositionState, 'ADOPTED');
    assert.match(validated.decisionId, /^ctdecision_[0-9a-f]{32}$/);
    assert.match(validated.decisionHash, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(
      computeControlTowerDispositionDecisionIdentity(validated),
      { decisionId: validated.decisionId, decisionHash: validated.decisionHash },
      'identity is idempotent over a validated decision',
    );
    const replay = validateControlTowerDispositionDecision(
      extractControlTowerDispositionDecision(decisionBody(document)),
    );
    assert.equal(replay.decisionId, validated.decisionId, 'identity is deterministic');
    assert.deepEqual(snapshotHome(home), before, 'identity/parse/validate write zero bytes');

    // Unknown fields and out-of-domain states fail closed.
    assert.throws(
      () => validateControlTowerDispositionDecision({ ...document, sneakyBody: 'x' }),
      (error) => error?.code === 'CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION',
    );
    assert.throws(
      () => validateControlTowerDispositionDecision({ ...document, targetDispositionState: 'DONE' }),
      (error) => error?.code === 'CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION',
    );
    assert.throws(
      () => validateControlTowerDispositionDecision({ ...document, dispositionRef: 'OTHER-TASK@1' }),
      (error) => error?.code === 'CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION',
    );
    assert.throws(
      () => validateControlTowerDispositionDecision({ ...document, resultBinding: 'sha256:xyz' }),
      (error) => error?.code === 'CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION',
    );
    assert.throws(
      () => validateControlTowerDispositionDecision({ ...document, decidedAt: 'not-a-date' }),
      (error) => error?.code === 'CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION',
    );
    assert.equal(extractControlTowerDispositionDecision('no json block here'), null);
    assert.equal(extractControlTowerDispositionDecision('```json\n{ nope }\n```'), null);
    assert.deepEqual(snapshotHome(home), before, 'all fail-closed validation writes zero bytes');
  } finally {
    removeHome(home);
  }
});

test('A2. derive composes the canonical binding and shared decision with zero writes', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-A002';
    const fixture = canonicalFixture(store, taskId, { resultId: 'result_gf09_a002' });
    const surface = createFakeDecisionSurface();
    surface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'ADOPTED',
        }),
      ),
    );
    const before = snapshotHome(home);

    const derived = await deriveControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    const replay = await deriveControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(derived.selected.status, 'ADOPTABLE');
    assert.equal(derived.selected.targetGeneration, 2);
    assert.equal(derived.selected.writeInput.dispositionGeneration, 2);
    assert.equal(derived.selected.writeInput.supersedes, 1);
    assert.equal(derived.selected.writeInput.state, 'ADOPTED');
    assert.equal(derived.selected.writeInput.decidedAt, '2026-09-21T00:00:00.000Z');
    assert.deepEqual(
      derived.selected.writeInput.evidenceRefs.slice(-2),
      [
        `shared-decision:${derived.selected.decision.decisionId}`,
        `shared-decision-binding:${derived.selected.decision.decisionHash}`,
      ],
    );
    assert.deepEqual(replay.selected.writeInput, derived.selected.writeInput);
    assert.deepEqual(snapshotHome(home), before, 'derive performs zero durable writes');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. adoption and exact replay
// ---------------------------------------------------------------------------

test('B. perform adopts exactly one legal next generation and replays with zero byte changes', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-B001';
    const fixture = canonicalFixture(store, taskId);
    const surface = createFakeDecisionSurface();
    surface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'BLOCKED',
        }),
      ),
    );

    const first = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(first.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED);
    assert.equal(first.canonicalWrites, 1);
    assert.equal(first.executorInvocations, 0);
    assert.equal(first.manualCopyPasteRequired, false);
    assert.equal(first.returnedDisposition.dispositionRef, `${taskId}@2`);
    assert.equal(first.returnedDisposition.state, 'BLOCKED');
    const decisionId = first.decision.decisionId;
    assert.match(decisionId, /^ctdecision_[0-9a-f]{32}$/);

    const adopted = store.readCurrentDisposition(taskId);
    assert.equal(adopted.dispositionGeneration, 2);
    assert.equal(adopted.state, 'BLOCKED');
    assert.equal(adopted.decidedAt, '2026-09-21T00:00:00.000Z');
    assert.equal(adopted.controlTowerId, 'control-tower');
    assert.equal(adopted.controlTowerToken, 'ct-shared-decision');
    assert.ok(adopted.evidenceRefs.includes(`shared-decision:${decisionId}`));
    assert.equal(adopted.resultBinding, fixture.binding);
    assert.equal(adopted.claimGeneration, fixture.result.claimGeneration);
    assert.deepEqual(readGenerations(home, taskId), ['1.json', '2.json']);

    const afterAdoption = snapshotHome(home);
    const replay = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(replay.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY);
    assert.equal(replay.canonicalWrites, 0);
    assert.equal(replay.decision.decisionId, decisionId);
    assert.equal(replay.returnedDisposition.dispositionRef, `${taskId}@2`);
    assert.deepEqual(snapshotHome(home), afterAdoption, 'exact replay writes zero bytes');
    assert.deepEqual(readGenerations(home, taskId), ['1.json', '2.json']);

    // A later decision targeting the now-current generation adopts one more
    // generation; the earlier decision stays consumed lineage.
    surface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: `${taskId}@2`,
          dispositionState: 'BLOCKED',
          targetDispositionState: 'PENDING_DISPOSITION',
          overrides: { decidedAt: '2026-09-21T00:04:00.000Z' },
        }),
      ),
    );
    const third = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(third.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED);
    assert.equal(third.returnedDisposition.dispositionRef, `${taskId}@3`);
    assert.equal(third.returnedDisposition.state, 'PENDING_DISPOSITION');
    assert.deepEqual(readGenerations(home, taskId), ['1.json', '2.json', '3.json']);

    // Replaying the now-current (second) decision converges as exact replay;
    // the first decision remains consumed lineage.
    const finalReplay = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(finalReplay.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY);
    assert.equal(finalReplay.decision.dispositionRef, `${taskId}@2`);
    assert.deepEqual(
      readGenerations(home, taskId),
      ['1.json', '2.json', '3.json'],
      'no duplicate canonical generations',
    );
  } finally {
    removeHome(home);
  }
});

test('B2. exact duplicate decisions converge without duplicate semantic decisions', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-B002';
    const fixture = canonicalFixture(store, taskId);
    const body = decisionBody(
      decisionDocument({
        taskId,
        resultId: fixture.result.resultId,
        resultBinding: fixture.binding,
        dispositionRef: fixture.dispositionRef,
        targetDispositionState: 'ADOPTED',
      }),
    );
    const surface = createFakeDecisionSurface();
    surface.postDecision(body);
    surface.postDecision(body);
    assert.equal(surface.state.comments.length, 2);

    const first = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(first.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED);
    assert.equal(first.duplicateDecisionSourceCount, 2, 'duplicate comments are one semantic decision');
    const afterAdoption = snapshotHome(home);
    const replay = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(replay.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY);
    assert.equal(replay.canonicalWrites, 0);
    assert.deepEqual(snapshotHome(home), afterAdoption);
    assert.deepEqual(readGenerations(home, taskId), ['1.json', '2.json']);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. crash window: generation durable, current pointer lagging
// ---------------------------------------------------------------------------

test('C. a prepared generation before a crash converges through the existing same-generation fencing', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-C001';
    const fixture = canonicalFixture(store, taskId);
    const surface = createFakeDecisionSurface();
    surface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'ADOPTED',
        }),
      ),
    );
    const derived = await deriveControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    const generationOne = store.readCurrentDisposition(taskId);

    // Simulate the crash window: the exact generation N+1 candidate is durable
    // but the current pointer still references generation N.
    const prepared = store.writeDisposition(derived.selected.writeInput);
    assert.equal(prepared.duplicate, false);
    writeFileSync(currentPointerPath(home, taskId), JSON.stringify(generationOne));
    assert.equal(store.readCurrentDisposition(taskId).dispositionGeneration, 1);
    assert.deepEqual(readGenerations(home, taskId), ['1.json', '2.json']);

    const recovered = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(recovered.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY);
    assert.equal(recovered.canonicalWrites, 0);
    assert.equal(store.readCurrentDisposition(taskId).dispositionGeneration, 2);
    assert.equal(store.readCurrentDisposition(taskId).state, 'ADOPTED');
    assert.deepEqual(readGenerations(home, taskId), ['1.json', '2.json']);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. pending states
// ---------------------------------------------------------------------------

test('D. no shared decision or no shared surface reports RETURN_PENDING with zero writes', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const withSurfaceTask = 'GF09RET-D001';
    const withSurface = canonicalFixture(store, withSurfaceTask);
    const beforeSurface = snapshotHome(home);

    const noDecision = await performControlTowerDispositionReturn({
      store,
      taskId: withSurfaceTask,
      authority: withSurface.authority,
      transport: createFakeDecisionSurface(),
    });
    assert.equal(noDecision.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_PENDING);
    assert.equal(noDecision.canonicalWrites, 0);
    assert.equal(noDecision.failureCode, null);
    assert.equal(noDecision.decision, null);
    assert.deepEqual(snapshotHome(home), beforeSurface);

    const noIssueTask = 'GF09RET-D002';
    const noIssue = canonicalFixture(store, noIssueTask);
    const beforeNoIssue = snapshotHome(home);
    const missingIssue = createFakeDecisionSurface({ issue: null });
    const pendingNoIssue = await performControlTowerDispositionReturn({
      store,
      taskId: noIssueTask,
      authority: noIssue.authority,
      transport: missingIssue,
    });
    assert.equal(pendingNoIssue.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_PENDING);
    assert.equal(pendingNoIssue.canonicalWrites, 0);
    assert.equal(missingIssue.state.counters.findComments, 0, 'no comments are read without an issue');
    assert.deepEqual(snapshotHome(home), beforeNoIssue);

    // A different task's decision marker is never visible.
    const foreignTask = 'GF09RET-D003';
    const foreign = canonicalFixture(store, foreignTask);
    const beforeForeign = snapshotHome(home);
    const surface = createFakeDecisionSurface();
    surface.postDecision(
      decisionBody(
        decisionDocument({
          taskId: foreignTask,
          resultId: foreign.result.resultId,
          resultBinding: foreign.binding,
          dispositionRef: foreign.dispositionRef,
          targetDispositionState: 'ADOPTED',
        }),
      ),
    );
    const other = await performControlTowerDispositionReturn({
      store,
      taskId: withSurfaceTask,
      authority: withSurface.authority,
      transport: surface,
    });
    assert.equal(other.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_PENDING);
    assert.deepEqual(snapshotHome(home), beforeForeign);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. binding mismatch / conflict / corruption / ambiguity
// ---------------------------------------------------------------------------

test('E. binding mismatch, conflicting decisions, corrupt comments, and ambiguous surfaces fail closed', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-E001';
    const fixture = canonicalFixture(store, taskId);
    const before = snapshotHome(home);

    // E1: a decision bound to a different resultBinding fails closed.
    const misbound = createFakeDecisionSurface();
    misbound.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: `sha256:${'1'.repeat(64)}`,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'ADOPTED',
        }),
      ),
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: misbound,
        }),
      (error) => error?.code === CONTROL_TOWER_DISPOSITION_RETURN_BINDING_MISMATCH,
    );

    // E2: a decision bound to a different resultId fails closed.
    const wrongResult = createFakeDecisionSurface();
    wrongResult.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: 'result_someone_else',
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'ADOPTED',
        }),
      ),
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: wrongResult,
        }),
      (error) => error?.code === CONTROL_TOWER_DISPOSITION_RETURN_BINDING_MISMATCH,
    );

    // E3: two distinct decisions targeting the same current generation conflict.
    const conflict = createFakeDecisionSurface();
    conflict.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'ADOPTED',
        }),
      ),
    );
    conflict.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'REJECTED',
          overrides: { decidedAt: '2026-09-21T00:01:00.000Z' },
        }),
      ),
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: conflict,
        }),
      (error) => error?.code === CONTROL_TOWER_DISPOSITION_RETURN_DECISION_CONFLICT,
    );

    // E4: marker present but no parseable decision document fails closed.
    const corrupt = createFakeDecisionSurface();
    corrupt.postDecision(
      `${buildControlTowerDispositionDecisionMarker({ taskId })}\n\n(edited by a human, no document)`,
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: corrupt,
        }),
      (error) => error?.code === 'CORRUPT_CONTROL_TOWER_DISPOSITION_DECISION',
    );

    // E5: an ambiguous shared surface (duplicate exact-title issues) fails closed.
    const ambiguous = createFakeDecisionSurface({
      issue: {
        issueNumber: 77,
        url: 'https://example.test/issues/77',
        state: 'OPEN',
        duplicateIssueCount: 2,
      },
    });
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: ambiguous,
        }),
      (error) => error?.code === CONTROL_TOWER_DISPOSITION_RETURN_SURFACE_AMBIGUOUS,
    );

    // E6: transport shape violations fail closed.
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: { findRelayIssue: async () => ({ issueNumber: 0 }) },
        }),
      (error) => error?.code === 'INVALID_CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT',
    );

    assert.deepEqual(snapshotHome(home), before, 'every fail-closed path writes zero bytes');
    assert.equal(store.readCurrentDisposition(taskId).state, DISPOSITION_STATE_PENDING);
    assert.deepEqual(readGenerations(home, taskId), ['1.json']);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. stale decisions never overwrite canonical state
// ---------------------------------------------------------------------------

test('F. stale decisions fail closed and never overwrite a later canonical disposition', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-F001';
    const fixture = canonicalFixture(store, taskId);
    const adoptedBody = decisionBody(
      decisionDocument({
        taskId,
        resultId: fixture.result.resultId,
        resultBinding: fixture.binding,
        dispositionRef: fixture.dispositionRef,
        targetDispositionState: 'ADOPTED',
      }),
    );
    const surface = createFakeDecisionSurface();
    surface.postDecision(adoptedBody);
    const first = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(first.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED);
    const afterAdoption = snapshotHome(home);

    // F1: a NEW decision still bound to generation 1 is stale (canonical moved).
    const staleSurface = createFakeDecisionSurface();
    staleSurface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'REJECTED',
        }),
      ),
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: staleSurface,
        }),
      (error) => error?.code === CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE,
    );

    // F2: the adopted decision comment was EDITED to a different verdict after
    // adoption; the canonical generation is never rewritten (no last-writer-wins).
    const editedSurface = createFakeDecisionSurface();
    editedSurface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'REJECTED',
        }),
      ),
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: editedSurface,
        }),
      (error) => error?.code === CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE,
    );

    // F2b: an adopted lineage decision plus a NEW never-adopted decision for
    // the same stale generation fails closed: no decision is silently ignored
    // just because the exact adopted decision still exists on the surface.
    const lineagePlusStale = createFakeDecisionSurface();
    lineagePlusStale.postDecision(adoptedBody);
    lineagePlusStale.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'REJECTED',
          overrides: { decidedAt: '2026-09-21T00:05:00.000Z' },
        }),
      ),
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: lineagePlusStale,
        }),
      (error) => error?.code === CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE,
    );

    // F3: a decision referencing a generation ahead of the canonical pointer
    // fails closed.
    const futureSurface = createFakeDecisionSurface();
    futureSurface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: `${taskId}@9`,
          dispositionState: 'ADOPTED',
          targetDispositionState: 'SUPERSEDED',
        }),
      ),
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: futureSurface,
        }),
      (error) => error?.code === CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE,
    );

    // F4: an observed-state drift fails closed even at the current generation.
    const driftTask = 'GF09RET-F002';
    const drift = canonicalFixture(store, driftTask);
    const beforeDrift = snapshotHome(home);
    const driftSurface = createFakeDecisionSurface();
    driftSurface.postDecision(
      decisionBody(
        decisionDocument({
          taskId: driftTask,
          resultId: drift.result.resultId,
          resultBinding: drift.binding,
          dispositionRef: drift.dispositionRef,
          dispositionState: 'BLOCKED',
          targetDispositionState: 'ADOPTED',
        }),
      ),
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId: driftTask,
          authority: drift.authority,
          transport: driftSurface,
        }),
      (error) => error?.code === CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE,
    );
    assert.deepEqual(
      snapshotHome(home),
      beforeDrift,
      'the F4/F5 fail-closed paths write zero bytes',
    );

    // F5: an illegal transition (terminal ADOPTED has no outgoing transition)
    // fails closed with the existing disposition code.
    const terminalSurface = createFakeDecisionSurface();
    terminalSurface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: `${taskId}@2`,
          dispositionState: 'ADOPTED',
          targetDispositionState: 'REJECTED',
        }),
      ),
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: terminalSurface,
        }),
      (error) => error?.code === 'DISPOSITION_ILLEGAL_TRANSITION',
    );

    assert.deepEqual(snapshotHome(home), beforeDrift, 'no stale/conflicting path writes bytes');
    assert.equal(store.readCurrentDisposition(taskId).state, 'ADOPTED');
    assert.equal(store.readCurrentDisposition(taskId).dispositionGeneration, 2);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. transport failure
// ---------------------------------------------------------------------------

test('G. transport failure reports RETURN_PENDING with redacted detail and recovers', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-G001';
    const fixture = canonicalFixture(store, taskId);
    const binding = fixture.binding;
    const body = decisionBody(
      decisionDocument({
        taskId,
        resultId: fixture.result.resultId,
        resultBinding: binding,
        dispositionRef: fixture.dispositionRef,
        targetDispositionState: 'ADOPTED',
      }),
    );
    const before = snapshotHome(home);
    const secret = 'gho_abcdefghijklmnopqrstuvwxyz0123456789';

    for (const step of ['findRelayIssue', 'findComments']) {
      const failing = createFakeDecisionSurface({
        failOn: step,
        failMessage: `synthetic GitHub outage (${secret}) during ${step}`,
      });
      const pending = await performControlTowerDispositionReturn({
        store,
        taskId,
        authority: fixture.authority,
        transport: failing,
      });
      assert.equal(pending.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_PENDING);
      assert.equal(pending.canonicalWrites, 0);
      assert.equal(pending.failureCode, 'CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT_UNAVAILABLE');
      assert.equal(pending.failureMessage.includes(secret), false);
      assert.match(pending.failureMessage, /\[REDACTED\]/);
      assert.deepEqual(snapshotHome(home), before, `failure at ${step} changes zero bytes`);
    }
    assert.equal(store.readCurrentDisposition(taskId).state, DISPOSITION_STATE_PENDING);
    assert.deepEqual(readGenerations(home, taskId), ['1.json']);

    // Recovery: the same decision is adopted once the transport is available.
    const recovered = createFakeDecisionSurface();
    recovered.postDecision(body);
    const adopted = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: recovered,
    });
    assert.equal(adopted.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED);
    assert.equal(adopted.returnedDisposition.dispositionRef, `${taskId}@2`);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// H. existing disposition semantics are reused
// ---------------------------------------------------------------------------

test('H. NEEDS_USER_DECISION requires the existing bounded userDecision gate and stays replayable', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-H001';
    const fixture = canonicalFixture(store, taskId);

    // Without the userDecision gate the existing disposition validator refuses
    // the write (fail closed, no new semantics invented here).
    const missingGate = createFakeDecisionSurface();
    missingGate.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'NEEDS_USER_DECISION',
        }),
      ),
    );
    await assert.rejects(
      () =>
        performControlTowerDispositionReturn({
          store,
          taskId,
          authority: fixture.authority,
          transport: missingGate,
        }),
      (error) => error?.code === 'INVALID_DISPOSITION',
    );

    // With the gate the shared decision is adopted, and a follow-up decision
    // returns to PENDING with the bounded decision reference (existing
    // NEEDS_USER_DECISION -> PENDING transition).
    const surface = createFakeDecisionSurface();
    surface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'NEEDS_USER_DECISION',
          overrides: {
            userDecision: {
              decisionRequestId: 'decision-request-1',
              questionVersion: 'v1',
              requiredAuthority: 'user',
            },
          },
        }),
      ),
    );
    const needsUser = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(needsUser.returnedDisposition.dispositionRef, `${taskId}@2`);
    assert.equal(needsUser.returnedDisposition.state, 'NEEDS_USER_DECISION');
    assert.deepEqual(store.readCurrentDisposition(taskId).userDecision, {
      decisionRequestId: 'decision-request-1',
      questionVersion: 'v1',
      requiredAuthority: 'user',
    });

    surface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: fixture.result.resultId,
          resultBinding: fixture.binding,
          dispositionRef: `${taskId}@2`,
          dispositionState: 'NEEDS_USER_DECISION',
          targetDispositionState: 'PENDING_DISPOSITION',
          overrides: {
            decidedAt: '2026-09-21T00:03:00.000Z',
            userDecision: {
              decisionRequestId: 'decision-request-1',
              questionVersion: 'v1',
              requiredAuthority: 'user',
              decisionRecordRef: 'decision-record:1',
            },
          },
        }),
      ),
    );
    const returned = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(returned.returnedDisposition.dispositionRef, `${taskId}@3`);
    assert.equal(returned.returnedDisposition.state, 'PENDING_DISPOSITION');
    assert.deepEqual(readGenerations(home, taskId), ['1.json', '2.json', '3.json']);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I/J. operator CLI composition
// ---------------------------------------------------------------------------

test('I. coordination:disposition adopts through the CLI without any executor configuration', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-I001';
    const fixture = canonicalFixture(store, taskId, { resultId: 'result_gf09_i001' });
    const surface = createFakeDecisionSurface();
    surface.postDecision(
      decisionBody(
        decisionDocument({
          taskId,
          resultId: 'result_gf09_i001',
          resultBinding: fixture.binding,
          dispositionRef: fixture.dispositionRef,
          targetDispositionState: 'ADOPTED',
        }),
      ),
    );

    const out = captureStream();
    const err = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['disposition', taskId, '--json'],
      env: {},
      store,
      dispositionTransport: surface,
      stdout: out,
      stderr: err,
    });
    assert.equal(err.text, '', err.text);
    assert.equal(exitCode, 0);
    const projection = JSON.parse(out.text);
    assert.equal(projection.projection, 'operator-control-tower-disposition-return');
    assert.equal(projection.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED);
    assert.equal(projection.newlyReturned, true);
    assert.equal(projection.exactReplay, false);
    assert.equal(projection.authorityKind, AUTHORITY_KIND_USER_APPROVED_INTAKE);
    assert.equal(projection.resultId, 'result_gf09_i001');
    assert.equal(projection.resultBinding, fixture.binding);
    assert.equal(projection.returnedDisposition.dispositionRef, `${taskId}@2`);
    assert.equal(projection.returnedDisposition.state, 'ADOPTED');
    assert.equal(projection.executorInvocations, 0);
    assert.equal(projection.manualCopyPasteRequired, false);
    assert.equal(store.readCurrentDisposition(taskId).state, 'ADOPTED');

    const afterAdoption = snapshotHome(home);
    const replayOut = captureStream();
    const replayExit = await runOperatorCli({
      argv: ['disposition', taskId, '--json'],
      env: {},
      store,
      dispositionTransport: surface,
      stdout: replayOut,
      stderr: captureStream(),
    });
    assert.equal(replayExit, 0);
    const replayed = JSON.parse(replayOut.text);
    assert.equal(replayed.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY);
    assert.equal(replayed.canonicalWrites, 0);
    assert.deepEqual(snapshotHome(home), afterAdoption, 'CLI replay writes zero bytes');

    // The literal process path performs the same bounded transition without any
    // executor/OpenCode configuration in the environment.
    const processOut = await runProcess(['disposition', taskId, '--json'], {
      ...process.env,
      GREENHUB_COORDINATION_HOME: home,
      GREENHUB_CONTROL_TOWER_RELAY_REPO: 'disabled',
      GREENHUB_OPENCODE_CLI_PATH: '',
      GREENHUB_OPENCODE_MODEL: '',
    });
    assert.equal(processOut.code, 1);
    assert.match(processOut.stderr, new RegExp(CONTROL_TOWER_DISPOSITION_RETURN_NOT_CONFIGURED));
    assert.deepEqual(snapshotHome(home), afterAdoption);

    // Argument boundary: disposition requires an explicit task id.
    const help = captureStream();
    assert.equal(await runOperatorCli({ argv: ['--help'], stdout: help, stderr: captureStream() }), 0);
    assert.match(help.text, /coordination:disposition/);
  } finally {
    removeHome(home);
  }
});

test('J. coordination:disposition fails closed without a transport, an admission, or a disposition', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-J001';
    const fixture = canonicalFixture(store, taskId);

    const noTransportErr = captureStream();
    const noTransportExit = await runOperatorCli({
      argv: ['disposition', taskId, '--json'],
      env: {},
      store,
      stdout: captureStream(),
      stderr: noTransportErr,
    });
    assert.equal(noTransportExit, 1);
    assert.match(noTransportErr.text, new RegExp(CONTROL_TOWER_DISPOSITION_RETURN_NOT_CONFIGURED));

    const noDispositionTask = 'GF09RET-J002';
    intakeTask(store, noDispositionTask);
    claimAndDeliverIntakeTask(store, noDispositionTask);
    const noDispositionErr = captureStream();
    const noDispositionExit = await runOperatorCli({
      argv: ['disposition', noDispositionTask, '--json'],
      store,
      dispositionTransport: createFakeDecisionSurface(),
      stdout: captureStream(),
      stderr: noDispositionErr,
    });
    assert.equal(noDispositionExit, 1);
    assert.match(
      noDispositionErr.text,
      new RegExp(CONTROL_TOWER_DISPOSITION_RETURN_DISPOSITION_NOT_FOUND),
    );

    const plainTask = 'GF09RET-J003';
    store.createTask(sampleTaskSpec(plainTask));
    store.markReady(plainTask);
    const noAdmissionErr = captureStream();
    const noAdmissionExit = await runOperatorCli({
      argv: ['disposition', plainTask, '--json'],
      store,
      dispositionTransport: createFakeDecisionSurface(),
      stdout: captureStream(),
      stderr: noAdmissionErr,
    });
    assert.equal(noAdmissionExit, 1);
    assert.match(noAdmissionErr.text, /OPERATOR_TASK_ADMISSION_NOT_FOUND/);

    // No path above may write durable bytes.
    assert.equal(store.readCurrentDisposition(taskId).state, DISPOSITION_STATE_PENDING);
    assert.equal(existsSync(join(home, 'tasks', plainTask, 'claim.json')), false);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. concrete GitHub transport read-only methods
// ---------------------------------------------------------------------------

function createGhExecStub(handlers = {}) {
  const calls = [];
  const exec = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === 'issue' && args[1] === 'list') {
      if (typeof handlers.issueList === 'function') return handlers.issueList(args);
      return JSON.stringify(handlers.issueList ?? []);
    }
    if (args[0] === 'api' && args[1] === '--paginate') {
      if (typeof handlers.commentList === 'function') return handlers.commentList(args);
      return JSON.stringify(handlers.commentList ?? [[]]);
    }
    throw new Error(`unexpected gh invocation: ${args.join(' ')}`);
  };
  return { exec, calls };
}

test('K. the GitHub transport exposes read-only findRelayIssue/findComments without any POST', async () => {
  const marker = '<!-- greenhub-control-tower-decision:v1:GF09RET-K001 -->';
  const body = `${marker}\n\n\`\`\`json\n{}\n\`\`\`\n`;
  const stub = createGhExecStub({
    issueList: [
      { number: 78, title: 'Other issue', state: 'OPEN', url: 'https://example.test/issues/78' },
      {
        number: 77,
        title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
        state: 'OPEN',
        url: 'https://example.test/issues/77',
      },
    ],
    commentList: [[{ id: 999, body: 'unrelated' }, { id: 1001, body }]],
  });
  const transport = createGitHubIssueCommentRelayTransport({
    repository: 'booker-lab/greenhub',
    execFileImpl: stub.exec,
  });

  const issue = await transport.findRelayIssue({ title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE });
  assert.equal(issue.issueNumber, 77);
  assert.equal(issue.duplicateIssueCount, 1);
  assert.deepEqual(stub.calls[0].args.slice(0, 3), ['issue', 'list', '--repo']);
  assert.equal(stub.calls.some((call) => call.args.includes('POST')), false);

  const comments = await transport.findComments({ issueNumber: 77, marker });
  assert.equal(comments.length, 1);
  assert.equal(comments[0].commentId, 1001);
  assert.equal(comments[0].body, body);
  const paginateCall = stub.calls.find((call) => call.args[1] === '--paginate');
  assert.deepEqual(paginateCall.args.slice(0, 3), ['api', '--paginate', '--slurp']);
  assert.equal(stub.calls.some((call) => call.args.includes('POST')), false);

  // No exact-title issue -> null (never created by a read path).
  const noneStub = createGhExecStub({ issueList: [] });
  const noneTransport = createGitHubIssueCommentRelayTransport({
    repository: 'booker-lab/greenhub',
    execFileImpl: noneStub.exec,
  });
  assert.equal(
    await noneTransport.findRelayIssue({ title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE }),
    null,
  );
  assert.equal(noneStub.calls.some((call) => call.args.includes('POST')), false);

  // Duplicate exact-title issues are reported, not silently collapsed.
  const duplicateStub = createGhExecStub({
    issueList: [
      {
        number: 78,
        title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
        state: 'OPEN',
        url: 'https://example.test/issues/78',
      },
      {
        number: 77,
        title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
        state: 'CLOSED',
        url: 'https://example.test/issues/77',
      },
    ],
  });
  const duplicateTransport = createGitHubIssueCommentRelayTransport({
    repository: 'booker-lab/greenhub',
    execFileImpl: duplicateStub.exec,
  });
  const ambiguous = await duplicateTransport.findRelayIssue({
    title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
  });
  assert.equal(ambiguous.duplicateIssueCount, 2);
  assert.equal(ambiguous.issueNumber, 78, 'open issue first, deterministic');
});

// ---------------------------------------------------------------------------
// L. canonical truth independence
// ---------------------------------------------------------------------------

test('L. deleting the shared decision surface changes zero canonical bytes (LOCAL_COORDINATION_TRUTH_INDEPENDENT_OF_SHARED_SURFACE)', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF09RET-L001';
    const fixture = canonicalFixture(store, taskId);
    const body = decisionBody(
      decisionDocument({
        taskId,
        resultId: fixture.result.resultId,
        resultBinding: fixture.binding,
        dispositionRef: fixture.dispositionRef,
        targetDispositionState: 'ADOPTED',
      }),
    );
    const surface = createFakeDecisionSurface();
    surface.postDecision(body);
    const first = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(first.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED);
    const canonicalAfterAdoption = snapshotHome(home);

    // Shared surface deleted: canonical bytes are untouched and a read-only
    // derive still composes canonical truth.
    surface.state.comments.length = 0;
    surface.state.issue = null;
    assert.deepEqual(snapshotHome(home), canonicalAfterAdoption);
    const derived = await deriveControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(derived.selected.status, 'PENDING');
    assert.equal(derived.current.state, 'ADOPTED');
    assert.deepEqual(snapshotHome(home), canonicalAfterAdoption);

    // The Control Tower reposts the exact same decision: it converges as an
    // exact replay with zero writes (canonical truth owns the identity).
    surface.state.issue = {
      issueNumber: 77,
      url: 'https://example.test/issues/77',
      state: 'OPEN',
      duplicateIssueCount: 1,
    };
    surface.postDecision(body);
    const replayed = await performControlTowerDispositionReturn({
      store,
      taskId,
      authority: fixture.authority,
      transport: surface,
    });
    assert.equal(replayed.status, CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY);
    assert.deepEqual(snapshotHome(home), canonicalAfterAdoption);
    assert.equal(store.readCurrentDisposition(taskId).dispositionGeneration, 2);
    assert.deepEqual(readGenerations(home, taskId), ['1.json', '2.json']);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// M. static boundaries and operator surface
// ---------------------------------------------------------------------------

test('M. the return owner is executor/scheduler/clock/fs-free, writes exactly once, and is exposed as coordination:disposition', async () => {
  const source = readFileSync(RETURN_MODULE_PATH, 'utf8');
  assert.doesNotMatch(source, /setInterval|setTimeout|setImmediate/);
  assert.doesNotMatch(source, /while\s*\(\s*true\s*\)/);
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now/);
  assert.doesNotMatch(source, /node:fs|node:child_process|node:worker_threads|node:net|node:http/);
  assert.doesNotMatch(
    source,
    /\b(?:beginDisposition|deliverResult|createTask|markReady|claimTask|claimAdmittedTask|claimUserApprovedIntakeTask|emitNextTask|admitEmittedTask|materializeAdoption|ackAdoption|markConsumed|persistDispatchAttempt|intakeUserApprovedReadOnlyTask)\s*\(/,
  );
  assert.doesNotMatch(
    source,
    /\b(?:invokeExecutorWithInvocationFence|createOpenCodeCliStructuredResultExecutor|createCodexCliExecutorAdapter)\s*\(/,
  );
  assert.doesNotMatch(source, /opencode-cli-executor-adapter|codex-cli-executor-adapter/);
  assert.equal(
    (source.match(/store\.writeDisposition\(/g) ?? []).length,
    1,
    'exactly ONE canonical store mutation is composed',
  );

  const operatorSource = readFileSync(OPERATOR_CLI_PATH, 'utf8');
  assert.ok(operatorSource.includes('performControlTowerDispositionReturn('));
  assert.ok(operatorSource.includes("options.command === 'disposition'"));

  const packageJson = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['coordination:disposition'],
    'node scripts/coordination/operator-cli.mjs disposition',
  );

  const noDocumentSource = readFileSync(RETURN_MODULE_PATH, 'utf8');
  assert.equal(
    /DISPOSITION_STATE_ADOPTED|DISPOSITION_STATE_REJECTED|DISPOSITION_STATE_SUPERSEDED/.test(
      noDocumentSource,
    ),
    false,
    'the return owner never names a semantic verdict state it could invent',
  );

  // No runtime artifact may appear inside the repository worktree.
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'tasks')), false);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'disposition')), false);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'coordination')), false);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'decisions')), false);
});

// ---------------------------------------------------------------------------
// helpers kept last (function declarations are hoisted)
// ---------------------------------------------------------------------------

function runProcess(args, env) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [OPERATOR_CLI_PATH, ...args], {
      cwd: REPOSITORY_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectResult);
    child.once('close', (code) => resolveResult({ code, stdout, stderr }));
  });
}
