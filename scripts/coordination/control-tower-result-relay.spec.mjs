// Proof for GREENHUB-COORDINATION-SHARED-CONTROL-TOWER-RESULT-RELAY-GF08.
//
// Closes the last manual transport in the coordination cycle:
//   PENDING_DISPOSITION(taskId)                        [GF-07 durable]
//     -> SHARED_CONTROL_TOWER_RESULT_AVAILABLE(taskId) [non-canonical projection]
// so the Control Tower can read delivered results from a shared surface without
// the user copying/pasting result JSON.
//
// Proved here:
//   A. derive composes the canonical result + existing disposition
//      deterministically with zero durable writes and fails closed on a
//      missing/misbound disposition,
//   B. perform creates exactly ONE deterministic projection comment and
//      replays with zero GitHub mutations and zero canonical byte changes,
//   C. crash window: comment created but process restarted before reporting ->
//      deterministic marker reconciliation converges as EXACT_REPLAY,
//   D. crash window: GitHub unavailable -> RELAY_PENDING with zero canonical
//      change; recovery relays the same logical identity,
//   E. same marker with a different logical identity fails closed (no
//      last-writer-wins) and a malformed marker projection fails closed,
//   F. exact duplicates (concurrent writers) converge read-only; no third
//      comment and no rewrite/delete,
//   G. coordination:run attempts the relay automatically after the GF-07
//      intake; terminal replay has zero executor invocations and zero new
//      GitHub comments,
//   H. run without a configured transport reports RELAY_NOT_CONFIGURED with
//      zero external calls,
//   I. coordination:relay projects an already delivered result without
//      executor/claim/verdict/new semantic artifacts,
//   J. coordination:relay fails closed without a transport and for a task
//      without a disposition pointer,
//   K. the concrete GitHub transport builds deterministic argv-only shell-free
//      `gh` commands and parses read-back,
//   L. transport failure detail is redacted/bounded (no secret leakage),
//   M. relay deletion/failure never changes canonical truth
//      (LOCAL_COORDINATION_TRUTH_INDEPENDENT_OF_RELAY),
//   N. static boundaries: no scheduler/timer/clock/store mutation/fs write in
//      the relay owner, package command, usage, and no repository artifacts.
//
// All runtime state lives in isolated temp directories. No network, no real
// executor process, no real `gh` process: both the executor seam and the relay
// transport seam are caller-supplied functions.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildControlTowerResultRelayId,
  buildControlTowerResultRelayMarker,
  CONTROL_TOWER_RESULT_RELAY_DISPOSITION_NOT_FOUND,
  CONTROL_TOWER_RESULT_RELAY_ISSUE_BODY,
  CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
  CONTROL_TOWER_RESULT_RELAY_PROJECTION_BINDING_MISMATCH,
  CONTROL_TOWER_RESULT_RELAY_PROJECTION_CORRUPT,
  CONTROL_TOWER_RESULT_RELAY_REPOSITORY_INVALID,
  CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY,
  CONTROL_TOWER_RESULT_RELAY_STATUS_NOT_CONFIGURED,
  CONTROL_TOWER_RESULT_RELAY_STATUS_PENDING,
  CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED,
  ControlTowerResultRelayTransportError,
  createGitHubIssueCommentRelayTransport,
  deriveControlTowerResultRelay,
  parseControlTowerResultRelayProjection,
  performControlTowerResultRelay,
  redactControlTowerRelayText,
  resolveConfiguredControlTowerRelayTransport,
} from './control-tower-result-relay.mjs';
import { performControlTowerResultIntake } from './control-tower-result-intake.mjs';
import { computeResultBinding, DISPOSITION_STATE_PENDING } from './disposition.mjs';
import { parseOperatorArgv, runOperatorCli } from './operator-cli.mjs';
import { CoordinationStore } from './store.mjs';
import {
  AUTHORITY_KIND_USER_APPROVED_INTAKE,
  USER_APPROVED_INTAKE_DISPATCH_SLOT,
} from './user-approved-intake.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..');
const OPERATOR_CLI_PATH = join(MODULE_DIRECTORY, 'operator-cli.mjs');
const RELAY_MODULE_PATH = join(MODULE_DIRECTORY, 'control-tower-result-relay.mjs');

function makeHome(prefix = 'greenhub-gf08-test-') {
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

function runCliProcess(args, env) {
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

function sampleTaskSpec(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'GF08_SHARED_CONTROL_TOWER_RESULT_RELAY',
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
    approval: { approvedBy: 'gf08-test-user', approvalRef: `gf08:test:${taskId}` },
    taskSpec: sampleTaskSpec(taskId, overrides),
    recorderId: 'gf08-test-recorder',
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

function claimAndDeliverIntakeTask(store, taskId, { workerId = 'gf08-worker', resultId } = {}) {
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
    proofRefs: ['proof:gf08-synthetic-probe'],
    evidenceRefs: ['evidence:gf08-synthetic-probe'],
    frictionObserved: ['NONE'],
  });
  return claim;
}

function relayReadyTask(store, taskId, { resultId } = {}) {
  const intake = intakeTask(store, taskId);
  claimAndDeliverIntakeTask(store, taskId, { resultId });
  const authority = intakeAuthority(taskId, intake.record.intakeId);
  performControlTowerResultIntake({ store, taskId, authority });
  return authority;
}

function fakeStructuredExecutor(counter, overrides = {}) {
  return async function fakeExecutor(task28Record) {
    counter.calls += 1;
    return {
      schemaVersion: 1,
      dispatchId: task28Record.dispatchId,
      outcome: 'ACCEPTED',
      result: {
        taskId: task28Record.decisionInput.task.taskId,
        status: 'SUCCEEDED',
        summary: 'read-only shared-relay probe completed',
        proofRefs: ['proof:gf08-shared-relay'],
        evidenceRefs: ['evidence:gf08-shared-relay'],
        frictionObserved: ['NONE'],
      },
      ...overrides,
    };
  };
}

/**
 * In-memory shared-surface double for the relay transport seam. It behaves
 * like the real GitHub issue/comment transport: one reusable issue, marker
 * filtered comment lookup, create-once comment projection.
 */
function createFakeRelayTransport(options = {}) {
  const state = {
    issue: options.issue ?? null,
    comments: [...(options.comments ?? [])],
    nextCommentId: options.nextCommentId ?? 1001,
    counters: {
      ensureRelayIssue: 0,
      findProjections: 0,
      createProjection: 0,
      readProjection: 0,
    },
    createdBodies: [],
    mutationCount: 0,
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
    async ensureRelayIssue() {
      state.counters.ensureRelayIssue += 1;
      maybeFail('ensureRelayIssue');
      if (state.issue === null) {
        state.issue = {
          issueNumber: 77,
          url: 'https://example.test/booker-lab/greenhub/issues/77',
          state: 'OPEN',
          created: true,
        };
        state.mutationCount += 1;
      }
      return state.issue;
    },
    async findProjections({ marker }) {
      state.counters.findProjections += 1;
      maybeFail('findProjections');
      return state.comments
        .filter((comment) => comment.body.includes(marker))
        .map((comment) => ({ ...comment }));
    },
    async createProjection({ marker, body }) {
      state.counters.createProjection += 1;
      maybeFail('createProjection');
      const commentId = state.nextCommentId;
      state.nextCommentId += 1;
      const comment = {
        commentId,
        url: `https://example.test/booker-lab/greenhub/issues/77#issuecomment-${commentId}`,
        createdAt: '2026-09-21T00:00:00Z',
        body,
      };
      assert.ok(body.includes(marker));
      state.comments.push(comment);
      state.createdBodies.push(body);
      state.mutationCount += 1;
      if (options.raceDuplicate === true) {
        const duplicateId = state.nextCommentId;
        state.nextCommentId += 1;
        state.comments.push({ ...comment, commentId: duplicateId });
      }
      return comment;
    },
    async readProjection({ commentId }) {
      state.counters.readProjection += 1;
      maybeFail('readProjection');
      const comment = state.comments.find((entry) => entry.commentId === commentId);
      return comment === undefined ? null : { ...comment };
    },
  };
}

function readOptionalDisposition(store, taskId) {
  try {
    return store.readCurrentDisposition(taskId);
  } catch (error) {
    if (error?.code === 'DISPOSITION_NOT_FOUND') return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// A. derive: canonical composition, determinism, zero writes, fail-closed
// ---------------------------------------------------------------------------

test('A. derive composes the canonical result and existing disposition with zero writes', () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-A001';
    const authority = relayReadyTask(store, taskId, { resultId: 'result_gf08_a001' });
    const result = store.readResult(taskId);
    const binding = computeResultBinding(result);
    const before = snapshotHome(home);

    const derived = deriveControlTowerResultRelay({ store, taskId, authority });
    const replay = deriveControlTowerResultRelay({ store, taskId, authority });

    assert.equal(derived.schemaVersion, '1');
    assert.equal(
      derived.relayId,
      buildControlTowerResultRelayId({
        taskId,
        resultId: 'result_gf08_a001',
        resultBinding: binding,
      }),
    );
    assert.equal(
      derived.marker,
      `<!-- greenhub-control-tower-relay:v1:${taskId}:result_gf08_a001 -->`,
    );
    assert.equal(derived.document.schemaVersion, '1');
    assert.equal(derived.document.taskId, taskId);
    assert.equal(derived.document.taskKind, 'READ_ONLY');
    assert.equal(derived.document.resultId, 'result_gf08_a001');
    assert.equal(derived.document.resultBinding, binding);
    assert.equal(derived.document.dispositionRef, `${taskId}@1`);
    assert.equal(derived.document.dispositionState, DISPOSITION_STATE_PENDING);
    assert.equal(derived.document.resultStatus, 'SUCCEEDED');
    assert.equal(derived.document.summary, `synthetic READ_ONLY probe for ${taskId}`);
    assert.deepEqual(derived.document.proofRefs, ['proof:gf08-synthetic-probe']);
    assert.deepEqual(derived.document.evidenceRefs, ['evidence:gf08-synthetic-probe']);
    assert.deepEqual(derived.document.frictionObserved, ['NONE']);
    assert.equal(derived.document.canonicalAuthorityKind, AUTHORITY_KIND_USER_APPROVED_INTAKE);
    assert.equal(derived.document.canonicalAuthorityId, derived.intake.authorityId);
    assert.equal(derived.document.canonicalAuthoritySourceTaskId, taskId);
    assert.equal(derived.document.canonicalAuthorityEmissionSlot, USER_APPROVED_INTAKE_DISPATCH_SLOT);
    assert.equal(derived.document.claimGeneration, 1);
    assert.equal(derived.document.deliveredAt, result.deliveredAt);
    assert.ok(derived.body.includes(derived.marker));
    assert.deepEqual(parseControlTowerResultRelayProjection(derived.body), derived.document);
    assert.deepEqual(replay, derived, 'derive is deterministic');
    assert.deepEqual(snapshotHome(home), before, 'derive performs zero durable writes');
    assert.equal(Object.isFrozen(derived.document), true);

    // No disposition yet -> explicit fail-closed code (run return first).
    const noDispositionTask = 'GF08RELAY-A002';
    const noDispositionIntake = intakeTask(store, noDispositionTask);
    claimAndDeliverIntakeTask(store, noDispositionTask);
    assert.equal(readOptionalDisposition(store, noDispositionTask), null);
    assert.throws(
      () =>
        deriveControlTowerResultRelay({
          store,
          taskId: noDispositionTask,
          authority: intakeAuthority(noDispositionTask, noDispositionIntake.record.intakeId),
        }),
      (error) => error?.code === CONTROL_TOWER_RESULT_RELAY_DISPOSITION_NOT_FOUND,
    );

    // Not delivered -> the existing GF-07 code propagates unchanged.
    const readyTask = 'GF08RELAY-A003';
    const readyIntake = intakeTask(store, readyTask);
    assert.throws(
      () =>
        deriveControlTowerResultRelay({
          store,
          taskId: readyTask,
          authority: intakeAuthority(readyTask, readyIntake.record.intakeId),
        }),
      (error) => error?.code === 'CONTROL_TOWER_RESULT_INTAKE_NOT_DELIVERED',
    );

    // A disposition that does not bind the delivered result fails closed
    // (composition seam double: the durable store itself also fences this).
    const beforeFailClosed = snapshotHome(home);
    const misboundStore = new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'readCurrentDisposition') {
          return () => ({
            ...target.readCurrentDisposition(taskId),
            resultBinding: `sha256:${'0'.repeat(64)}`,
          });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    assert.throws(
      () => deriveControlTowerResultRelay({ store: misboundStore, taskId, authority }),
      (error) => error?.code === 'CONTROL_TOWER_RESULT_RELAY_DISPOSITION_BINDING_MISMATCH',
    );
    assert.deepEqual(snapshotHome(home), beforeFailClosed, 'all fail-closed paths write zero bytes');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// B. perform: one deterministic comment, idempotent replay
// ---------------------------------------------------------------------------

test('B. perform creates exactly one deterministic projection and replays with zero GitHub mutations', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-B001';
    const authority = relayReadyTask(store, taskId);
    const result = store.readResult(taskId);
    const binding = computeResultBinding(result);
    const transport = createFakeRelayTransport();
    const before = snapshotHome(home);

    const first = await performControlTowerResultRelay({ store, taskId, authority, transport });
    assert.equal(first.status, CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED);
    assert.equal(first.duplicateProjectionCount, 0);
    assert.equal(first.issue.issueNumber, 77);
    assert.equal(first.issue.created, true);
    assert.equal(first.comment.commentId, 1001);
    assert.equal(first.document.resultBinding, binding);
    assert.equal(first.canonicalWrites, 0);
    assert.equal(first.executorInvocations, 0);
    assert.equal(transport.state.mutationCount, 2, 'issue create + comment create');
    assert.equal(transport.state.comments.length, 1);
    assert.ok(transport.state.createdBodies[0].includes(first.marker));
    assert.deepEqual(parseControlTowerResultRelayProjection(transport.state.createdBodies[0]), first.document);

    const afterFirst = snapshotHome(home);
    const replay = await performControlTowerResultRelay({ store, taskId, authority, transport });
    assert.equal(replay.status, CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY);
    assert.equal(replay.comment.commentId, first.comment.commentId);
    assert.equal(replay.duplicateProjectionCount, 1);
    assert.equal(transport.state.counters.createProjection, 1, 'no second comment');
    assert.equal(transport.state.counters.ensureRelayIssue, 2);
    assert.deepEqual(snapshotHome(home), afterFirst, 'relay never writes durable bytes');

    // A Control Tower verdict generation later: the projection is a snapshot of
    // the relay identity and is never rewritten (no last-writer-wins).
    store.writeDisposition({
      taskId,
      dispositionGeneration: 2,
      resultId: result.resultId,
      controlTowerToken: 'ct-token-verdict',
      controlTowerId: 'control-tower-1',
      state: 'ADOPTED',
      policyRefs: ['policy:control-tower-verdict'],
      proofRefs: ['proof:verdict'],
      evidenceRefs: ['evidence:verdict'],
    });
    const afterVerdict = snapshotHome(home);
    const replayAfterVerdict = await performControlTowerResultRelay({
      store,
      taskId,
      authority,
      transport,
    });
    assert.equal(replayAfterVerdict.status, CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY);
    assert.equal(transport.state.comments.length, 1, 'the projection snapshot is never rewritten');
    assert.equal(
      parseControlTowerResultRelayProjection(transport.state.comments[0].body).dispositionState,
      DISPOSITION_STATE_PENDING,
      'the projection keeps its relay-time snapshot',
    );
    assert.deepEqual(snapshotHome(home), afterVerdict, 'canonical verdict bytes are untouched');
    assert.equal(store.readCurrentDisposition(taskId).state, 'ADOPTED');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// C. crash window: comment created, process restarted before reporting
// ---------------------------------------------------------------------------

test('C. a comment created before a crash converges through deterministic marker reconciliation', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-C001';
    const authority = relayReadyTask(store, taskId);
    const firstTransport = createFakeRelayTransport();
    const first = await performControlTowerResultRelay({
      store,
      taskId,
      authority,
      transport: firstTransport,
    });
    assert.equal(first.status, CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED);

    // Process restart: a NEW transport instance backed by the same shared
    // surface (the durable comment is the only relay acknowledgement).
    const restartedTransport = createFakeRelayTransport({
      issue: firstTransport.state.issue,
      comments: firstTransport.state.comments,
      nextCommentId: firstTransport.state.nextCommentId,
    });
    const before = snapshotHome(home);
    const recovered = await performControlTowerResultRelay({
      store,
      taskId,
      authority,
      transport: restartedTransport,
    });
    assert.equal(recovered.status, CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY);
    assert.equal(recovered.comment.commentId, first.comment.commentId);
    assert.equal(restartedTransport.state.counters.createProjection, 0);
    assert.deepEqual(recovered.document, first.document);
    assert.deepEqual(snapshotHome(home), before);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// D. crash window: GitHub unavailable -> RELAY_PENDING, recovery relays
// ---------------------------------------------------------------------------

test('D. GitHub unavailable reports RELAY_PENDING with zero canonical change and recovers later', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-D001';
    const authority = relayReadyTask(store, taskId);
    const result = store.readResult(taskId);
    const disposition = store.readCurrentDisposition(taskId);
    const before = snapshotHome(home);

    for (const step of ['ensureRelayIssue', 'findProjections', 'createProjection']) {
      const failing = createFakeRelayTransport({
        failOn: step,
        failMessage: `synthetic GitHub outage during ${step}`,
      });
      const pending = await performControlTowerResultRelay({
        store,
        taskId,
        authority,
        transport: failing,
      });
      assert.equal(pending.status, CONTROL_TOWER_RESULT_RELAY_STATUS_PENDING);
      assert.equal(pending.issue, null);
      assert.equal(pending.comment, null);
      assert.equal(pending.failureCode, 'CONTROL_TOWER_RESULT_RELAY_TRANSPORT_UNAVAILABLE');
      assert.match(pending.failureMessage, /synthetic GitHub outage/);
      assert.deepEqual(snapshotHome(home), before, `failure at ${step} changes zero bytes`);
    }
    assert.equal(JSON.stringify(store.readResult(taskId)), JSON.stringify(result));
    assert.equal(JSON.stringify(store.readCurrentDisposition(taskId)), JSON.stringify(disposition));
    assert.equal(store.readTask(taskId).status, 'RESULT_DELIVERED');

    // Recovery after the transport is available again: same logical identity.
    const recovered = await performControlTowerResultRelay({
      store,
      taskId,
      authority,
      transport: createFakeRelayTransport(),
    });
    assert.equal(recovered.status, CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED);
    assert.equal(recovered.document.resultId, result.resultId);
    assert.deepEqual(snapshotHome(home), before, 'recovery still writes zero canonical bytes');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// E. conflicting/malformed existing projections fail closed
// ---------------------------------------------------------------------------

test('E. same marker with a different logical identity or a corrupt body fails closed', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-E001';
    const authority = relayReadyTask(store, taskId);
    const result = store.readResult(taskId);
    const binding = computeResultBinding(result);
    const marker = buildControlTowerResultRelayMarker({
      taskId,
      resultId: result.resultId,
    });

    // E1: same marker, different resultBinding -> different relay identity.
    const foreignDocument = {
      ...(await performControlTowerResultRelay({
        store,
        taskId,
        authority,
        transport: createFakeRelayTransport(),
      })).document,
      resultBinding: `sha256:${'1'.repeat(64)}`,
      relayId: buildControlTowerResultRelayId({
        taskId,
        resultId: result.resultId,
        resultBinding: `sha256:${'1'.repeat(64)}`,
      }),
    };
    const conflicting = createFakeRelayTransport({
      issue: { issueNumber: 77, url: 'https://example.test/issues/77', state: 'OPEN', created: false },
      comments: [
        {
          commentId: 5001,
          url: 'https://example.test/issues/77#issuecomment-5001',
          createdAt: '2026-09-21T00:00:00Z',
          body: `${marker}\n\n\`\`\`json\n${JSON.stringify(foreignDocument, null, 2)}\n\`\`\`\n`,
        },
      ],
    });
    await assert.rejects(
      () => performControlTowerResultRelay({ store, taskId, authority, transport: conflicting }),
      (error) => error?.code === CONTROL_TOWER_RESULT_RELAY_PROJECTION_BINDING_MISMATCH,
    );
    assert.equal(conflicting.state.counters.createProjection, 0, 'never overwritten, never appended');
    assert.equal(conflicting.state.comments.length, 1);

    // E2: marker present but no parseable relay document.
    const corrupt = createFakeRelayTransport({
      issue: { issueNumber: 77, url: 'https://example.test/issues/77', state: 'OPEN', created: false },
      comments: [
        {
          commentId: 5002,
          url: 'https://example.test/issues/77#issuecomment-5002',
          createdAt: '2026-09-21T00:00:00Z',
          body: `${marker}\n\n(this comment was edited by a human and has no document)`,
        },
      ],
    });
    await assert.rejects(
      () => performControlTowerResultRelay({ store, taskId, authority, transport: corrupt }),
      (error) => error?.code === CONTROL_TOWER_RESULT_RELAY_PROJECTION_CORRUPT,
    );
    assert.equal(corrupt.state.counters.createProjection, 0);
    assert.equal(corrupt.state.comments.length, 1);
    assert.equal(binding, computeResultBinding(store.readResult(taskId)));
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// F. concurrent writers: exact duplicates converge read-only
// ---------------------------------------------------------------------------

test('F. concurrent writers that both created the same projection converge to duplicates without a third comment', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-F001';
    const authority = relayReadyTask(store, taskId);
    const transport = createFakeRelayTransport({ raceDuplicate: true });

    const first = await performControlTowerResultRelay({ store, taskId, authority, transport });
    assert.equal(first.status, CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED);
    assert.equal(transport.state.comments.length, 2, 'the race produced identical duplicates');

    const before = snapshotHome(home);
    const converged = await performControlTowerResultRelay({ store, taskId, authority, transport });
    assert.equal(converged.status, CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY);
    assert.equal(converged.duplicateProjectionCount, 2);
    assert.equal(transport.state.counters.createProjection, 1, 'no third comment');
    assert.equal(transport.state.comments.length, 2, 'no rewrite and no delete');
    assert.deepEqual(snapshotHome(home), before);

    const parsedBodies = transport.state.comments.map((comment) =>
      parseControlTowerResultRelayProjection(comment.body),
    );
    assert.deepEqual(parsedBodies[0], parsedBodies[1], 'both duplicates are the exact same identity');
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// G. coordination:run automatic relay
// ---------------------------------------------------------------------------

test('G. coordination:run attempts the shared relay after the Control Tower intake and replay has zero executor/comments', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-G001';
    intakeTask(store, taskId);
    const counter = { calls: 0 };
    const transport = createFakeRelayTransport();

    const firstOut = captureStream();
    const firstErr = captureStream();
    const firstExit = await runOperatorCli({
      argv: ['run', taskId, '--json'],
      store,
      executor: fakeStructuredExecutor(counter),
      relayTransport: transport,
      stdout: firstOut,
      stderr: firstErr,
    });
    assert.equal(firstErr.text, '', firstErr.text);
    assert.equal(firstExit, 0);
    assert.equal(counter.calls, 1);
    const first = JSON.parse(firstOut.text);
    assert.equal(first.outcome, 'EXECUTED');
    assert.notEqual(first.controlTowerIntake, null);
    assert.equal(first.controlTowerIntake.newlyIntaken, true);
    assert.notEqual(first.controlTowerRelay, null);
    assert.equal(first.controlTowerRelay.status, CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED);
    assert.equal(first.controlTowerRelay.commentId, 1001);
    const canonicalResult = store.readResult(taskId);
    const canonicalBinding = computeResultBinding(canonicalResult);
    assert.equal(
      first.controlTowerRelay.relayId,
      buildControlTowerResultRelayId({
        taskId,
        resultId: canonicalResult.resultId,
        resultBinding: canonicalBinding,
      }),
    );
    const projected = parseControlTowerResultRelayProjection(transport.state.createdBodies[0]);
    assert.equal(projected.resultId, canonicalResult.resultId);
    assert.equal(projected.resultBinding, canonicalBinding);
    assert.equal(projected.dispositionRef, `${taskId}@1`);
    assert.equal(projected.dispositionState, DISPOSITION_STATE_PENDING);
    assert.equal(projected.summary, canonicalResult.summary);
    const sequenceAfterFirst = JSON.stringify(store.readTaskSequence());

    // Terminal replay: zero executor invocations, zero new comments, zero
    // durable byte changes.
    const before = snapshotHome(home);
    const secondOut = captureStream();
    const secondErr = captureStream();
    const secondExit = await runOperatorCli({
      argv: ['run', taskId, '--json'],
      store,
      executor: fakeStructuredExecutor(counter),
      relayTransport: transport,
      stdout: secondOut,
      stderr: secondErr,
    });
    assert.equal(secondErr.text, '');
    assert.equal(secondExit, 0);
    assert.equal(counter.calls, 1, 'terminal replay never re-invokes the executor');
    const second = JSON.parse(secondOut.text);
    assert.equal(second.outcome, 'ALREADY_TERMINAL');
    assert.equal(second.executorInvocations, 0);
    assert.equal(second.controlTowerRelay.status, CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY);
    assert.equal(transport.state.counters.createProjection, 1);
    assert.equal(transport.state.comments.length, 1);
    assert.deepEqual(snapshotHome(home), before, 'replay writes zero durable bytes');
    assert.equal(JSON.stringify(store.readTaskSequence()), sequenceAfterFirst);
    assert.equal(readdirSync(join(home, 'tasks', taskId)).includes('materialization.json'), false);
  } finally {
    removeHome(home);
  }
});

test('H. run without a configured relay transport reports RELAY_NOT_CONFIGURED with zero external calls', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-H001';
    intakeTask(store, taskId);
    const counter = { calls: 0 };
    const out = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['run', taskId, '--json'],
      store,
      env: {},
      executor: fakeStructuredExecutor(counter),
      stdout: out,
      stderr: captureStream(),
    });
    assert.equal(exitCode, 0);
    const projection = JSON.parse(out.text);
    assert.equal(projection.controlTowerIntake.newlyIntaken, true);
    assert.equal(
      projection.controlTowerRelay.status,
      CONTROL_TOWER_RESULT_RELAY_STATUS_NOT_CONFIGURED,
    );
    assert.equal(projection.controlTowerRelay.commentId, null);
    assert.match(projection.controlTowerRelay.failureMessage, /GREENHUB_CONTROL_TOWER_RELAY_REPO/);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// I/J. explicit coordination:relay command
// ---------------------------------------------------------------------------

test('I. coordination:relay projects an existing delivered result without executor/claim/verdict/new artifacts', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-I001';
    relayReadyTask(store, taskId, { resultId: 'result_gf08_i001' });
    const result = store.readResult(taskId);
    const disposition = store.readCurrentDisposition(taskId);
    const sequence = JSON.stringify(store.readTaskSequence());
    const before = snapshotHome(home);
    const transport = createFakeRelayTransport();

    const out = captureStream();
    const err = captureStream();
    const exitCode = await runOperatorCli({
      argv: ['relay', taskId, '--json'],
      store,
      relayTransport: transport,
      stdout: out,
      stderr: err,
    });
    assert.equal(err.text, '', err.text);
    assert.equal(exitCode, 0);
    const projection = JSON.parse(out.text);
    assert.equal(projection.projection, 'operator-control-tower-relay');
    assert.equal(projection.status, CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED);
    assert.equal(projection.newlyRelayed, true);
    assert.equal(projection.exactReplay, false);
    assert.equal(projection.authorityKind, AUTHORITY_KIND_USER_APPROVED_INTAKE);
    assert.equal(projection.disposition.dispositionRef, `${taskId}@1`);
    assert.equal(projection.disposition.dispositionState, DISPOSITION_STATE_PENDING);
    assert.equal(projection.document.resultId, result.resultId);
    assert.equal(projection.document.resultBinding, computeResultBinding(result));
    assert.equal(transport.state.comments.length, 1);

    // Zero canonical writes, zero new semantic artifacts, zero executor.
    assert.deepEqual(snapshotHome(home), before, 'explicit relay writes zero durable bytes');
    assert.equal(JSON.stringify(store.readTaskSequence()), sequence);
    assert.equal(JSON.stringify(store.readResult(taskId)), JSON.stringify(result));
    assert.equal(JSON.stringify(store.readCurrentDisposition(taskId)), JSON.stringify(disposition));
    assert.equal(store.readTask(taskId).status, 'RESULT_DELIVERED');

    // Replay through the literal process path: no executor configuration.
    const replay = await runCliProcess(['relay', taskId, '--json'], {
      ...process.env,
      GREENHUB_COORDINATION_HOME: home,
      GREENHUB_CONTROL_TOWER_RELAY_REPO: '',
    });
    // Without a transport binding the explicit command fails closed; the
    // in-process replay with the same shared surface converges as exact replay.
    assert.equal(replay.code, 1);
    assert.match(replay.stderr, /RELAY_NOT_CONFIGURED/);

    const replayOut = captureStream();
    const replayExit = await runOperatorCli({
      argv: ['relay', taskId, '--json'],
      store,
      relayTransport: transport,
      stdout: replayOut,
      stderr: captureStream(),
    });
    assert.equal(replayExit, 0);
    const replayed = JSON.parse(replayOut.text);
    assert.equal(replayed.status, CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY);
    assert.equal(replayed.exactReplay, true);
    assert.equal(transport.state.counters.createProjection, 1);
    assert.deepEqual(snapshotHome(home), before);
  } finally {
    removeHome(home);
  }
});

test('J. coordination:relay fails closed without a transport and for a task without disposition', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const relayTask = 'GF08RELAY-J001';
    relayReadyTask(store, relayTask);

    const noTransportErr = captureStream();
    const noTransportExit = await runOperatorCli({
      argv: ['relay', relayTask, '--json'],
      store,
      env: {},
      stdout: captureStream(),
      stderr: noTransportErr,
    });
    assert.equal(noTransportExit, 1);
    assert.match(noTransportErr.text, /RELAY_NOT_CONFIGURED/);
    assert.match(noTransportErr.text, /GREENHUB_CONTROL_TOWER_RELAY_REPO/);

    const noDispositionTask = 'GF08RELAY-J002';
    intakeTask(store, noDispositionTask);
    claimAndDeliverIntakeTask(store, noDispositionTask);
    const noDispositionErr = captureStream();
    const noDispositionExit = await runOperatorCli({
      argv: ['relay', noDispositionTask, '--json'],
      store,
      relayTransport: createFakeRelayTransport(),
      stdout: captureStream(),
      stderr: noDispositionErr,
    });
    assert.equal(noDispositionExit, 1);
    assert.match(noDispositionErr.text, new RegExp(CONTROL_TOWER_RESULT_RELAY_DISPOSITION_NOT_FOUND));

    // Argument boundary: relay requires an explicit task id.
    const options = parseOperatorArgv(['relay', relayTask, '--json']);
    assert.equal(options.command, 'relay');
    assert.equal(options.taskId, relayTask);
    assert.equal(options.json, true);
    assert.throws(
      () => parseOperatorArgv(['relay']),
      (error) => error?.code === 'OPERATOR_ARGUMENT_INVALID',
    );
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// K. concrete GitHub transport: deterministic argv-only gh commands
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
    if (args[0] === 'api' && args.includes('-X') && args.includes('POST')) {
      const target = args[1];
      if (target.endsWith('/issues')) {
        if (typeof handlers.issueCreate === 'function') return handlers.issueCreate(args);
        return JSON.stringify(
          handlers.issueCreate ?? { number: 77, html_url: 'https://example.test/issues/77', state: 'OPEN' },
        );
      }
      if (target.endsWith('/comments')) {
        if (typeof handlers.commentCreate === 'function') return handlers.commentCreate(args);
        return JSON.stringify(
          handlers.commentCreate ?? {
            id: 1001,
            html_url: 'https://example.test/issues/77#issuecomment-1001',
            created_at: '2026-09-21T00:00:00Z',
            body: 'created-body',
          },
        );
      }
    }
    if (args[0] === 'api' && args[1].startsWith('repos/') && args[1].includes('/issues/comments/')) {
      if (typeof handlers.commentRead === 'function') return handlers.commentRead(args);
      return JSON.stringify(handlers.commentRead ?? {});
    }
    throw new Error(`unexpected gh invocation: ${args.join(' ')}`);
  };
  return { exec, calls };
}

test('K. the GitHub transport builds deterministic argv-only shell-free gh commands and parses read-back', async () => {
  const marker = '<!-- greenhub-control-tower-relay:v1:GF08RELAY-K001:result_k -->';
  const body = `${marker}\n\n\`\`\`json\n{}\n\`\`\`\n`;
  const comment = {
    id: 1001,
    html_url: 'https://example.test/issues/77#issuecomment-1001',
    created_at: '2026-09-21T00:00:00Z',
    body,
  };
  const stub = createGhExecStub({
    issueList: [
      { number: 78, title: 'Other issue', state: 'OPEN', url: 'https://example.test/issues/78' },
      { number: 77, title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE, state: 'OPEN', url: 'https://example.test/issues/77' },
    ],
    commentList: [[{ id: 999, body: 'unrelated' }, comment]],
    commentCreate: {
      id: 1002,
      html_url: 'https://example.test/issues/77#issuecomment-1002',
      created_at: '2026-09-21T00:00:00Z',
      body,
    },
    commentRead: comment,
  });
  const transport = createGitHubIssueCommentRelayTransport({
    repository: 'booker-lab/greenhub',
    ghPath: 'gh',
    execFileImpl: stub.exec,
  });
  assert.equal(transport.repository, 'booker-lab/greenhub');

  const issue = await transport.ensureRelayIssue({
    title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
    body: CONTROL_TOWER_RESULT_RELAY_ISSUE_BODY,
  });
  assert.equal(issue.issueNumber, 77);
  assert.equal(issue.created, false);
  assert.equal(stub.calls[0].command, 'gh');
  assert.deepEqual(stub.calls[0].args.slice(0, 3), ['issue', 'list', '--repo']);
  assert.equal(stub.calls[0].args.includes('--search'), true);
  assert.equal(stub.calls.some((call) => call.args.includes('POST')), false);

  const projections = await transport.findProjections({ issueNumber: 77, marker });
  assert.equal(projections.length, 1);
  assert.equal(projections[0].commentId, 1001);
  assert.equal(projections[0].body, body);
  const paginateCall = stub.calls.find((call) => call.args[1] === '--paginate');
  assert.deepEqual(paginateCall.args.slice(0, 3), ['api', '--paginate', '--slurp']);

  const created = await transport.createProjection({ issueNumber: 77, marker, body });
  assert.equal(created.commentId, 1002);
  assert.equal(created.body, body);
  const createCall = stub.calls.find(
    (call) => call.args.includes('-X') && call.args.includes('POST') && call.args[1].endsWith('/comments'),
  );
  assert.equal(createCall.args.includes(`body=${body}`), true, 'the projection body is ONE argv element');

  const readBack = await transport.readProjection({ commentId: 1001 });
  assert.equal(readBack.commentId, 1001);
  assert.equal(readBack.body, body);

  // Issue creation when no exact-title issue exists.
  const createStub = createGhExecStub({ issueList: [] });
  const createTransport = createGitHubIssueCommentRelayTransport({
    repository: 'booker-lab/greenhub',
    execFileImpl: createStub.exec,
  });
  const createdIssue = await createTransport.ensureRelayIssue({
    title: CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
    body: CONTROL_TOWER_RESULT_RELAY_ISSUE_BODY,
  });
  assert.equal(createdIssue.issueNumber, 77);
  assert.equal(createdIssue.created, true);
  const issueCreateCall = createStub.calls.find(
    (call) => call.args.includes('-X') && call.args.includes('POST') && call.args[1].endsWith('/issues'),
  );
  assert.equal(issueCreateCall.args.includes(`title=${CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE}`), true);

  // Invalid repository binding fails closed before any process boundary.
  assert.throws(
    () => createGitHubIssueCommentRelayTransport({ repository: 'not a repo' }),
    (error) => error?.code === CONTROL_TOWER_RESULT_RELAY_REPOSITORY_INVALID,
  );
});

test('L. resolveConfiguredControlTowerRelayTransport is explicit and never inferred', () => {
  const stub = createGhExecStub();
  assert.equal(resolveConfiguredControlTowerRelayTransport({ env: {}, execFileImpl: stub.exec }), null);
  assert.equal(
    resolveConfiguredControlTowerRelayTransport({
      env: { GREENHUB_CONTROL_TOWER_RELAY_REPO: 'disabled' },
      execFileImpl: stub.exec,
    }),
    null,
  );
  const transport = resolveConfiguredControlTowerRelayTransport({
    env: {
      GREENHUB_CONTROL_TOWER_RELAY_REPO: 'booker-lab/greenhub',
      GREENHUB_CONTROL_TOWER_RELAY_GH_PATH: 'gh-custom',
    },
    execFileImpl: stub.exec,
  });
  assert.equal(transport.repository, 'booker-lab/greenhub');
  assert.throws(
    () =>
      resolveConfiguredControlTowerRelayTransport({
        env: { GREENHUB_CONTROL_TOWER_RELAY_REPO: 'not-a-repo' },
        execFileImpl: stub.exec,
      }),
    (error) => error?.code === CONTROL_TOWER_RESULT_RELAY_REPOSITORY_INVALID,
  );
});

// ---------------------------------------------------------------------------
// M. secret redaction
// ---------------------------------------------------------------------------

test('M. relay transport failure detail is redacted and bounded', async () => {
  const secret = 'gho_abcdefghijklmnopqrstuvwxyz0123456789';
  assert.equal(redactControlTowerRelayText(`failed with ${secret}`).includes(secret), false);
  assert.match(redactControlTowerRelayText(`failed with ${secret}`), /\[REDACTED\]/);
  assert.equal(redactControlTowerRelayText('line one\nline two').includes('line two'), false);
  assert.ok(redactControlTowerRelayText('x'.repeat(1000)).length <= 310);

  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-M001';
    const authority = relayReadyTask(store, taskId);
    const transport = createFakeRelayTransport({
      failOn: 'findProjections',
      failMessage: `GitHub CLI failed: Bad credentials (${secret})`,
    });
    const pending = await performControlTowerResultRelay({
      store,
      taskId,
      authority,
      transport,
    });
    assert.equal(pending.status, CONTROL_TOWER_RESULT_RELAY_STATUS_PENDING);
    assert.equal(pending.failureMessage.includes(secret), false);
    assert.match(pending.failureMessage, /\[REDACTED\]/);

    // The concrete transport also redacts exec stderr before wrapping.
    const execWithSecret = async () => {
      const error = new Error('gh failed');
      error.stderr = `Bad credentials token=${secret}`;
      throw error;
    };
    const ghTransport = createGitHubIssueCommentRelayTransport({
      repository: 'booker-lab/greenhub',
      execFileImpl: execWithSecret,
    });
    const ghPending = await performControlTowerResultRelay({
      store,
      taskId,
      authority,
      transport: ghTransport,
    });
    assert.equal(ghPending.status, CONTROL_TOWER_RESULT_RELAY_STATUS_PENDING);
    assert.equal(ghPending.failureMessage.includes(secret), false);
    assert.match(ghPending.failureMessage, /\[REDACTED\]/);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// N. canonical truth independence
// ---------------------------------------------------------------------------

test('N. relay deletion and failure never change canonical truth (LOCAL_COORDINATION_TRUTH_INDEPENDENT_OF_RELAY)', async () => {
  const home = makeHome();
  try {
    const store = new CoordinationStore({ dir: home });
    const taskId = 'GF08RELAY-N001';
    const authority = relayReadyTask(store, taskId);
    const transport = createFakeRelayTransport();
    const first = await performControlTowerResultRelay({ store, taskId, authority, transport });
    assert.equal(first.status, CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED);
    const canonicalBefore = snapshotHome(home);

    // Relay surface deleted entirely: canonical bytes must be identical and a
    // replay must recreate the projection from canonical truth.
    transport.state.comments.length = 0;
    transport.state.issue = null;
    assert.deepEqual(snapshotHome(home), canonicalBefore);
    const recreated = await performControlTowerResultRelay({
      store,
      taskId,
      authority,
      transport,
    });
    assert.equal(recreated.status, CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED);
    assert.deepEqual(recreated.document, first.document, 'recreated from canonical truth only');
    assert.deepEqual(snapshotHome(home), canonicalBefore);

    // Relay surface failing: canonical bytes must be identical.
    const failing = createFakeRelayTransport({ failOn: 'ensureRelayIssue' });
    const pending = await performControlTowerResultRelay({
      store,
      taskId,
      authority,
      transport: failing,
    });
    assert.equal(pending.status, CONTROL_TOWER_RESULT_RELAY_STATUS_PENDING);
    assert.deepEqual(snapshotHome(home), canonicalBefore);

    // No canonical task lifecycle state beyond RESULT_DELIVERED exists, and no
    // semantic artifact (result/disposition generation/claim) changed.
    assert.equal(store.readTask(taskId).status, 'RESULT_DELIVERED');
    assert.equal(readdirSync(join(home, 'tasks', taskId, 'disposition', 'generations')).length, 1);
  } finally {
    removeHome(home);
  }
});

// ---------------------------------------------------------------------------
// O. static boundaries and operator surface
// ---------------------------------------------------------------------------

test('O. the relay owner stays scheduler/timer/clock/fs/store-mutation-free and package.json exposes coordination:relay', async () => {
  const source = readFileSync(RELAY_MODULE_PATH, 'utf8');
  assert.doesNotMatch(source, /setInterval|setTimeout|setImmediate/);
  assert.doesNotMatch(source, /while\s*\(\s*true\s*\)/);
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now/);
  assert.doesNotMatch(source, /node:fs|node:worker_threads|node:net|node:http/);
  assert.doesNotMatch(
    source,
    /\b(?:beginDisposition|writeDisposition|deliverResult|createTask|markReady|claimTask|claimAdmittedTask|emitNextTask|admitEmittedTask|materializeAdoption|ackAdoption|markConsumed|persistDispatchAttempt|intakeUserApprovedReadOnlyTask)\s*\(/,
  );
  assert.doesNotMatch(source, /\bgit\s+(?:ls-remote|fetch|push|rev-parse|checkout|reset)/);
  assert.ok(source.includes('shell: false'), 'the gh process boundary is explicitly shell-free');

  const operatorSource = readFileSync(OPERATOR_CLI_PATH, 'utf8');
  assert.ok(operatorSource.includes('performControlTowerResultRelay('));
  assert.ok(operatorSource.includes("options.command === 'relay'"));

  const packageJson = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['coordination:relay'],
    'node scripts/coordination/operator-cli.mjs relay',
  );

  const usageOut = captureStream();
  assert.equal(
    await runOperatorCli({ argv: ['--help'], stdout: usageOut, stderr: captureStream() }),
    0,
  );
  assert.match(usageOut.text, /coordination:relay/);

  // No runtime artifact may appear inside the repository worktree.
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'tasks')), false);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'disposition')), false);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'executor-result-receipts')), false);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'coordination')), false);
  assert.equal(existsSync(join(REPOSITORY_ROOT, 'relay')), false);
});
