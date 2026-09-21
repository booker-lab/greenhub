// Proof for GREENHUB-COORDINATION-TERMINAL-RECONCILIATION-GF04.
// Boundary ONLY:
//   CLAIMED -> RESULT_DELIVERED
//     -> publication truth recomputation when the claimed result requires
//        repository mutation
//     -> derived terminal reconciliation verdict.
//
// Explicitly NOT implemented here (and asserted absent):
//   publication registry, merged-SHA registry, durable Git mirror, terminal
//   scheduler, reconciliation queue/daemon/polling, retry/backoff/resend,
//   automatic publication/merge/push/deploy, branch/ref lifecycle, checkout
//   occupation, new durable occurrence/terminal family, new fencing generation,
//   worker/executor registry, successor task creation, actual executor
//   invocation (OpenCode / Codex / Astra).
// All runtime state lives in isolated temp directories. No network required.
// Git fixtures are real local repositories driven by read-only comparison; the
// proof never performs a real remote publication.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DISPOSITION_STATE_ADOPTED } from './disposition.mjs';
import { DEFAULT_EMISSION_SLOT } from './next-task-emission.mjs';
import {
  COMPLETE_ALREADY_PUBLISHED,
  decidePreMerge,
  decidePrePublication,
  PRE_MERGE_PHASE,
  PRE_PR_PHASE,
  PUBLICATION_ALLOWED,
  SEMANTIC_OWNER_REVIEW_REQUIRED,
  SUPERSEDED_ALREADY_PUBLISHED,
} from '../git/publication-admission.mjs';
import {
  BLOCKED_TERMINAL_RECONCILIATION_FIELDS,
  CORRUPT_TERMINAL_RECONCILIATION,
  INVALID_TERMINAL_RECONCILIATION_INPUT,
  INVALID_TERMINAL_RECONCILIATION_STORE,
  MAX_TERMINAL_RECONCILIATION_JSON_BYTES,
  readGitPublicationEvidence,
  reconcileTerminalResult,
  TERMINAL_RECONCILIATION_BINDING_MISMATCH,
  TERMINAL_RECONCILIATION_EVIDENCE_INVALID,
  TERMINAL_RECONCILIATION_OCCURRENCE_NOT_TERMINAL,
  TERMINAL_RECONCILIATION_PUBLICATION_CONFLICT,
  TERMINAL_RECONCILIATION_PUBLICATION_STATUSES,
  TERMINAL_RECONCILIATION_PUBLICATION_UNKNOWN,
  TERMINAL_RECONCILIATION_PUBLISHED_STATUSES,
  TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL,
  TERMINAL_RECONCILIATION_READ_ONLY_TERMINAL,
  TERMINAL_RECONCILIATION_RECORD_FIELDS,
  TERMINAL_RECONCILIATION_RESULT_DELIVERED_NOT_PUBLISHED,
  TERMINAL_RECONCILIATION_SCHEMA_VERSION,
  TERMINAL_RECONCILIATION_VERDICTS,
  TerminalReconciliationError,
  validateTerminalReconciliationVerdict,
} from './terminal-reconciliation.mjs';
import { CoordinationStore } from './store.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STORE_MODULE_URL = pathToFileURL(join(MODULE_DIRECTORY, 'store.mjs')).href;
const RECONCILIATION_MODULE_URL = pathToFileURL(
  join(MODULE_DIRECTORY, 'terminal-reconciliation.mjs'),
).href;

const OWNED_PATH = 'owned.txt';
const UNRELATED_PATH = 'unrelated.txt';

function makeHome(prefix = 'greenhub-gf04-home-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeGitRepo(prefix = 'greenhub-gf04-git-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const run = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  run('init', '-b', 'main');
  run('config', 'user.email', 'gf04@example.test');
  run('config', 'user.name', 'GF04 Proof');
  run('config', 'commit.gpgsign', 'false');
  run('config', 'core.autocrlf', 'false');
  writeFileSync(join(dir, 'base.txt'), 'base\n', 'utf8');
  run('add', 'base.txt');
  run('commit', '-m', 'base');
  return { dir, run };
}

function writeAndCommit(repo, relPath, content, message) {
  const full = join(repo.dir, ...relPath.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  repo.run('add', '--', relPath);
  repo.run('commit', '-m', message);
  return repo.run('rev-parse', 'HEAD');
}

function createCandidateBranch(repo, branch, relPath, content, message = 'candidate change') {
  const previous = repo.run('branch', '--show-current');
  repo.run('switch', '-c', branch);
  const sha = writeAndCommit(repo, relPath, content, message);
  repo.run('switch', previous);
  return sha;
}

function mergeCandidateBranch(repo, branch, { squash = false } = {}) {
  if (squash) {
    repo.run('merge', '--squash', branch);
    repo.run('commit', '-m', 'squash merge candidate');
  } else {
    repo.run('merge', '--no-ff', '-m', 'merge candidate', branch);
  }
  return repo.run('rev-parse', 'HEAD');
}

function gitState(repo) {
  return {
    refs: repo.run('for-each-ref', '--format=%(refname) %(objectname)'),
    count: repo.run('rev-list', '--all', '--count'),
    status: repo.run('status', '--porcelain=v1'),
  };
}

function removeDirectory(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function sampleTaskInput(taskId, overrides = {}) {
  return {
    taskId,
    taskKind: 'BOUNDED_MUTATION',
    desiredExitState: 'TERMINAL_RECONCILIATION_PROVED',
    policyRefs: [
      'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
    ],
    evidenceRefs: ['git:live-main-read'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: [OWNED_PATH],
    mutationBoundary: { allowsWrite: true, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['terminal-reconciliation-proof'],
    ...overrides,
  };
}

function controllableClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  return {
    get now() {
      return now;
    },
    advance(ms) {
      now += ms;
    },
    provider() {
      return now;
    },
  };
}

function sampleResult(claim, overrides = {}) {
  return {
    taskId: claim.taskId,
    resultId: 'result-0001',
    workerId: claim.workerId,
    claimToken: claim.claimToken,
    claimGeneration: claim.generation,
    status: 'SUCCEEDED',
    summary: 'bounded executor output',
    proofRefs: ['store:read-back'],
    evidenceRefs: ['test:temp-home'],
    frictionObserved: ['NONE'],
    ...overrides,
  };
}

function ctParams(overrides = {}) {
  return {
    controlTowerToken: 'ct-token-001',
    controlTowerId: 'control-tower-1',
    policyRefs: ['policy:control-tower-verdict'],
    proofRefs: ['proof:result-readback'],
    evidenceRefs: ['evidence:result-binding'],
    ...overrides,
  };
}

function matParams(overrides = {}) {
  return {
    materializerId: 'control-tower-1',
    policyRefs: ['policy:canonical-adoption'],
    proofRefs: ['proof:adopted-readback'],
    evidenceRefs: ['evidence:disposition-adopted'],
    ...overrides,
  };
}

function driveToAdmitted(store, clock, sourceTaskId, childTaskId, childOverrides = {}) {
  store.createTask(sampleTaskInput(sourceTaskId, { ownedSurface: [UNRELATED_PATH] }));
  store.markReady(sourceTaskId);
  const sourceClaim = store.claimTask({
    taskId: sourceTaskId,
    workerId: 'worker-source',
    leaseDurationMs: 60_000,
  });
  store.deliverResult(sampleResult(sourceClaim, { resultId: 'result-source' }));
  clock.advance(1000);
  store.beginDisposition({ taskId: sourceTaskId, resultId: 'result-source', ...ctParams() });
  clock.advance(1000);
  store.writeDisposition({
    taskId: sourceTaskId,
    dispositionGeneration: 2,
    resultId: 'result-source',
    ...ctParams({ controlTowerToken: 'ct-token-002' }),
    state: DISPOSITION_STATE_ADOPTED,
  });
  clock.advance(1000);
  store.materializeAdoption({ taskId: sourceTaskId, ...matParams() });
  clock.advance(1000);
  store.ackAdoption({ taskId: sourceTaskId, acknowledgerId: 'control-tower-1' });
  clock.advance(1000);
  store.markConsumed({ taskId: sourceTaskId, consumerId: 'control-tower-1' });
  clock.advance(1000);
  store.emitNextTask({
    sourceTaskId,
    nextTaskSpec: sampleTaskInput(childTaskId, childOverrides),
    emitterId: 'control-tower-1',
  });
  clock.advance(1000);
  const admitted = store.admitEmittedTask({ sourceTaskId, admitterId: 'control-tower-1' });
  clock.advance(1000);
  return admitted;
}

function driveToTerminal(
  store,
  clock,
  { sourceTaskId, childTaskId, childOverrides = {}, resultOverrides = {}, resultId },
) {
  driveToAdmitted(store, clock, sourceTaskId, childTaskId, childOverrides);
  const claimed = store.claimAdmittedTask({ sourceTaskId, workerId: 'worker-a' });
  const finalResultId = resultId ?? `result-${childTaskId.toLowerCase()}`;
  store.deliverResult(sampleResult(claimed.claim, { resultId: finalResultId, ...resultOverrides }));
  clock.advance(1000);
  return { claimed, resultId: finalResultId };
}

function snapshotHome(home) {
  const out = {};
  const recurse = (directory) => {
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
        recurse(full);
      } else if (entry.isFile()) {
        out[full.slice(home.length + 1)] = readFileSync(full, 'utf8');
      }
    }
  };
  recurse(home);
  return out;
}

const NEVER_CALLED = async () => {
  throw new Error('evidence reader must not be called');
};

function runChildProcess({ code, env = {} }) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exitPromise = new Promise((resolveResult, rejectResult) => {
    child.once('error', rejectResult);
    child.once('close', (exitCode) => {
      const line = stdout
        .split('\n')
        .reverse()
        .find((entry) => entry.trim().length > 0);
      resolveResult({
        exitCode,
        stdout,
        stderr,
        parsed: line ? JSON.parse(line) : null,
      });
    });
  });
  return { exitPromise };
}

function reconcileWorkerCode({ home, sourceTaskId, repositoryRoot, liveMainRef, candidateRef }) {
  return [
    'try {',
    `  const { CoordinationStore } = await import(${JSON.stringify(STORE_MODULE_URL)});`,
    `  const { reconcileTerminalResult } = await import(${JSON.stringify(RECONCILIATION_MODULE_URL)});`,
    `  const store = new CoordinationStore({ dir: ${JSON.stringify(home)} });`,
    `  const verdict = await reconcileTerminalResult({ store, sourceTaskId: ${JSON.stringify(sourceTaskId)}, repositoryRoot: ${JSON.stringify(repositoryRoot)}, liveMainRef: ${JSON.stringify(liveMainRef)}, candidateRef: ${JSON.stringify(candidateRef)} });`,
    '  console.log(JSON.stringify({ ok: true, verdict }));',
    '} catch (error) {',
    '  console.log(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }));',
    '}',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// U. CONTRACT: verdict vocabulary, exact shape, fail-closed validation.
// ---------------------------------------------------------------------------

test('U1. verdict vocabulary is exactly the five derived terminal classes', () => {
  assert.deepEqual(
    [...TERMINAL_RECONCILIATION_VERDICTS],
    [
      'READ_ONLY_TERMINAL',
      'PUBLISHED_TERMINAL',
      'RESULT_DELIVERED_NOT_PUBLISHED',
      'PUBLICATION_UNKNOWN',
      'PUBLICATION_CONFLICT',
    ],
  );
  assert.equal(TERMINAL_RECONCILIATION_SCHEMA_VERSION, '1');
  assert.deepEqual(
    [...TERMINAL_RECONCILIATION_PUBLISHED_STATUSES],
    [COMPLETE_ALREADY_PUBLISHED, SUPERSEDED_ALREADY_PUBLISHED],
  );
  assert.equal(TERMINAL_RECONCILIATION_PUBLICATION_STATUSES.includes(PUBLICATION_ALLOWED), true);
  assert.deepEqual(
    [...TERMINAL_RECONCILIATION_RECORD_FIELDS],
    [
      'schemaVersion',
      'verdict',
      'sourceTaskId',
      'emissionSlot',
      'occurrenceId',
      'occurrenceState',
      'taskId',
      'taskKind',
      'resultId',
      'resultStatus',
      'mutationClaimed',
      'ownedPaths',
      'liveMainRef',
      'liveMainSha',
      'candidateRef',
      'candidateSha',
      'publicationStatus',
      'remainingDelta',
    ],
  );
});

test('U2. verdict validator enforces verdict-specific evidence invariants', () => {
  const base = {
    schemaVersion: '1',
    verdict: 'PUBLISHED_TERMINAL',
    sourceTaskId: 'GF04-U2-SRC',
    emissionSlot: 'next',
    occurrenceId: `occ_${'a'.repeat(64)}`,
    occurrenceState: 'TERMINAL',
    taskId: 'GF04-U2-CHILD',
    taskKind: 'BOUNDED_MUTATION',
    resultId: 'result-gf04-u2',
    resultStatus: 'SUCCEEDED',
    mutationClaimed: true,
    ownedPaths: [OWNED_PATH],
    liveMainRef: 'main',
    liveMainSha: 'b'.repeat(40),
    candidateRef: 'candidate',
    candidateSha: 'c'.repeat(40),
    publicationStatus: SUPERSEDED_ALREADY_PUBLISHED,
    remainingDelta: [],
  };
  const frozen = validateTerminalReconciliationVerdict(base);
  assert.equal(frozen.verdict, 'PUBLISHED_TERMINAL');
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.ownedPaths), true);

  const cases = [
    [{ verdict: 'NOT_A_VERDICT' }, /verdict must be one of/],
    [{ occurrenceState: 'CLAIMED' }, /occurrenceState must be TERMINAL/],
    [{ mutationClaimed: false }, /must carry mutationClaimed=true/],
    [
      { mutationClaimed: false, resultStatus: 'FAILED' },
      /PUBLISHED_TERMINAL requires mutationClaimed=true/,
    ],
    [{ remainingDelta: [OWNED_PATH] }, /zero remaining owned delta/],
    [{ publicationStatus: PUBLICATION_ALLOWED }, /PUBLISHED_TERMINAL requires publicationStatus/],
    [{ candidateSha: null }, /requires complete publication evidence/],
    [{ remainingDelta: ['not-owned.txt'] }, /not one of the task owned paths/],
    [{ resultStatus: 'FAILED' }, /only a SUCCEEDED result may claim/],
    [{ taskKind: 'READ_ONLY' }, /only a BOUNDED_MUTATION task may claim/],
    [{ retry: true }, /must not contain "retry"/],
  ];
  for (const [override, expected] of cases) {
    assert.throws(() => validateTerminalReconciliationVerdict({ ...base, ...override }), expected);
  }
  assert.throws(
    () => validateTerminalReconciliationVerdict({ ...base, extraField: true }),
    /must carry exactly/,
  );

  const readOnly = {
    ...base,
    verdict: 'READ_ONLY_TERMINAL',
    taskKind: 'READ_ONLY',
    resultStatus: 'FAILED',
    mutationClaimed: false,
    liveMainRef: null,
    liveMainSha: null,
    candidateRef: null,
    candidateSha: null,
    publicationStatus: null,
  };
  assert.equal(validateTerminalReconciliationVerdict(readOnly).verdict, 'READ_ONLY_TERMINAL');
  assert.throws(
    () => validateTerminalReconciliationVerdict({ ...readOnly, remainingDelta: [OWNED_PATH] }),
    /must not carry publication evidence or remaining delta/,
  );

  const unknown = {
    ...base,
    verdict: 'PUBLICATION_UNKNOWN',
    liveMainRef: 'main',
    liveMainSha: null,
    candidateRef: null,
    candidateSha: null,
    publicationStatus: null,
  };
  assert.equal(validateTerminalReconciliationVerdict(unknown).verdict, 'PUBLICATION_UNKNOWN');
  assert.throws(
    () =>
      validateTerminalReconciliationVerdict({ ...unknown, publicationStatus: PUBLICATION_ALLOWED }),
    /must not carry a publication status or remaining delta/,
  );

  const conflict = {
    ...base,
    verdict: 'PUBLICATION_CONFLICT',
    publicationStatus: SEMANTIC_OWNER_REVIEW_REQUIRED,
    remainingDelta: [OWNED_PATH],
  };
  assert.equal(validateTerminalReconciliationVerdict(conflict).verdict, 'PUBLICATION_CONFLICT');

  assert.equal(BLOCKED_TERMINAL_RECONCILIATION_FIELDS.includes('retry'), true);
  assert.equal(BLOCKED_TERMINAL_RECONCILIATION_FIELDS.includes('gitMirror'), true);
  assert.equal(typeof CORRUPT_TERMINAL_RECONCILIATION, 'string');
  assert.equal(MAX_TERMINAL_RECONCILIATION_JSON_BYTES, 16 * 1024);
});

test('U3. readGitPublicationEvidence resolves refs/blobs read-only and never fabricates', () => {
  const repo = makeGitRepo();
  try {
    createCandidateBranch(repo, 'candidate', OWNED_PATH, 'candidate content\n');
    const evidence = readGitPublicationEvidence({
      repositoryRoot: repo.dir,
      liveMainRef: 'main',
      candidateRef: 'candidate',
      ownedPaths: [OWNED_PATH, 'absent.txt'],
    });
    assert.equal(evidence.liveMainSha, repo.run('rev-parse', 'main'));
    assert.equal(evidence.candidateSha, repo.run('rev-parse', 'candidate'));
    assert.equal(evidence.liveMainBlobs[OWNED_PATH], null);
    assert.equal(typeof evidence.candidateBlobs[OWNED_PATH], 'string');
    assert.equal(evidence.liveMainBlobs['absent.txt'], null);
    assert.equal(evidence.candidateBlobs['absent.txt'], null);

    const missing = readGitPublicationEvidence({
      repositoryRoot: repo.dir,
      liveMainRef: 'refs/heads/does-not-exist',
      candidateRef: 'candidate',
      ownedPaths: [OWNED_PATH],
    });
    assert.equal(missing.liveMainSha, null);
    assert.equal(missing.liveMainBlobs, null);
    assert.deepEqual(gitState(repo).status, '');
  } finally {
    removeDirectory(repo.dir);
  }
});

// ---------------------------------------------------------------------------
// A. READ_ONLY terminal and fail-closed attribution.
// ---------------------------------------------------------------------------

test('A1. READ_ONLY result converges terminal with zero Git reads and zero durable writes', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-A1-SRC',
      childTaskId: 'GF04-A1-CHILD',
      childOverrides: { taskKind: 'READ_ONLY', mutationBoundary: { allowsWrite: false } },
      resultOverrides: { status: 'SUCCEEDED' },
    });
    const before = snapshotHome(home);
    const verdict = await reconcileTerminalResult({
      store,
      sourceTaskId: 'GF04-A1-SRC',
      readEvidence: NEVER_CALLED,
    });
    assert.equal(verdict.verdict, TERMINAL_RECONCILIATION_READ_ONLY_TERMINAL);
    assert.equal(verdict.mutationClaimed, false);
    assert.equal(verdict.taskKind, 'READ_ONLY');
    assert.equal(verdict.resultStatus, 'SUCCEEDED');
    assert.equal(verdict.liveMainRef, null);
    assert.equal(verdict.liveMainSha, null);
    assert.equal(verdict.candidateRef, null);
    assert.equal(verdict.candidateSha, null);
    assert.equal(verdict.publicationStatus, null);
    assert.deepEqual([...verdict.remainingDelta], []);
    assert.deepEqual(snapshotHome(home), before, 'reconciliation must be zero-write');
    assert.equal(
      JSON.stringify(store.readRunnableOccurrence({ sourceTaskId: 'GF04-A1-SRC' })).includes(
        'occurrenceId',
      ),
      true,
    );
    assert.equal(
      store.readRunnableOccurrence({ sourceTaskId: 'GF04-A1-SRC' }).occurrenceState,
      'TERMINAL',
    );
  } finally {
    removeDirectory(home);
  }
});

test('A2. non-SUCCEEDED mutation results claim no mutation candidate', async () => {
  for (const status of ['FAILED', 'BLOCKED']) {
    const home = makeHome();
    try {
      const clock = controllableClock();
      const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
      driveToTerminal(store, clock, {
        sourceTaskId: `GF04-A2-${status}-SRC`,
        childTaskId: `GF04-A2-${status}-CHILD`,
        resultOverrides: { status },
      });
      const verdict = await reconcileTerminalResult({
        store,
        sourceTaskId: `GF04-A2-${status}-SRC`,
        readEvidence: NEVER_CALLED,
      });
      assert.equal(verdict.verdict, TERMINAL_RECONCILIATION_READ_ONLY_TERMINAL);
      assert.equal(verdict.mutationClaimed, false);
      assert.equal(verdict.resultStatus, status);
    } finally {
      removeDirectory(home);
    }
  }
});

test('A3. non-terminal occurrences fail closed without advancing or repairing', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToAdmitted(store, clock, 'GF04-A3-SRC', 'GF04-A3-CHILD');
    const runnable = store.readRunnableOccurrence({ sourceTaskId: 'GF04-A3-SRC' });
    assert.equal(runnable.occurrenceState, 'RUNNABLE');
    await assert.rejects(
      () =>
        reconcileTerminalResult({ store, sourceTaskId: 'GF04-A3-SRC', readEvidence: NEVER_CALLED }),
      (error) =>
        error instanceof TerminalReconciliationError &&
        error.code === TERMINAL_RECONCILIATION_OCCURRENCE_NOT_TERMINAL,
    );
    store.claimAdmittedTask({ sourceTaskId: 'GF04-A3-SRC', workerId: 'worker-a' });
    await assert.rejects(
      () =>
        reconcileTerminalResult({ store, sourceTaskId: 'GF04-A3-SRC', readEvidence: NEVER_CALLED }),
      (error) => error.code === TERMINAL_RECONCILIATION_OCCURRENCE_NOT_TERMINAL,
    );
    assert.equal(store.readTask('GF04-A3-CHILD').status, 'CLAIMED');
  } finally {
    removeDirectory(home);
  }
});

test('A4. store capability and input validation fail closed before any read', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-A4-SRC',
      childTaskId: 'GF04-A4-CHILD',
      resultOverrides: { status: 'FAILED' },
    });
    await assert.rejects(
      () => reconcileTerminalResult({ store: { readTask: () => {} }, sourceTaskId: 'GF04-A4-SRC' }),
      (error) => error.code === INVALID_TERMINAL_RECONCILIATION_STORE,
    );
    await assert.rejects(
      () => reconcileTerminalResult({ store, sourceTaskId: 'bad id!' }),
      (error) => error.code === INVALID_TERMINAL_RECONCILIATION_INPUT,
    );
    await assert.rejects(
      () =>
        reconcileTerminalResult({ store, sourceTaskId: 'GF04-A4-SRC', emissionSlot: 'bad slot!' }),
      (error) => error.code === INVALID_TERMINAL_RECONCILIATION_INPUT,
    );
    await assert.rejects(
      () => reconcileTerminalResult({ store, sourceTaskId: 'GF04-A4-SRC', readEvidence: 42 }),
      (error) => error.code === INVALID_TERMINAL_RECONCILIATION_INPUT,
    );
  } finally {
    removeDirectory(home);
  }
});

test('A5. tampered canonical result breaks the admission-bound attribution and fails closed', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-A5-SRC',
      childTaskId: 'GF04-A5-CHILD',
      resultOverrides: { status: 'FAILED' },
    });
    const resultPath = join(home, 'tasks', 'GF04-A5-CHILD', 'result.json');
    const tampered = JSON.parse(readFileSync(resultPath, 'utf8'));
    tampered.claimToken = 'acm_tampered_token';
    writeFileSync(resultPath, JSON.stringify(tampered, null, 2), 'utf8');
    await assert.rejects(
      () =>
        reconcileTerminalResult({ store, sourceTaskId: 'GF04-A5-SRC', readEvidence: NEVER_CALLED }),
      (error) => error.code === TERMINAL_RECONCILIATION_BINDING_MISMATCH,
    );
    assert.equal(
      JSON.parse(readFileSync(resultPath, 'utf8')).claimToken,
      'acm_tampered_token',
      'no repair',
    );
  } finally {
    removeDirectory(home);
  }
});

// ---------------------------------------------------------------------------
// P. PUBLICATION PROVENANCE: direct Git recomputation for mutation claims.
// ---------------------------------------------------------------------------

async function mutationScenario({
  sourceTaskId,
  candidateContent = 'candidate content\n',
  publish,
  candidateRef = 'candidate',
  deleteCandidate = false,
  mainMoves = null,
  ownedPath = OWNED_PATH,
} = {}) {
  const home = makeHome();
  const repo = makeGitRepo();
  const candidateSha = createCandidateBranch(repo, candidateRef, ownedPath, candidateContent);
  if (publish === 'merge') mergeCandidateBranch(repo, candidateRef);
  if (publish === 'squash') mergeCandidateBranch(repo, candidateRef, { squash: true });
  if (mainMoves !== null) writeAndCommit(repo, UNRELATED_PATH, mainMoves, 'unrelated main move');
  if (deleteCandidate) repo.run('branch', '-D', candidateRef);
  const clock = controllableClock();
  const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
  const childTaskId = `${sourceTaskId}-CHILD`;
  driveToTerminal(store, clock, {
    sourceTaskId,
    childTaskId,
    childOverrides: { ownedSurface: [ownedPath] },
  });
  const verdict = await reconcileTerminalResult({
    store,
    sourceTaskId,
    repositoryRoot: repo.dir,
    liveMainRef: 'main',
    candidateRef,
  });
  return { home, repo, store, verdict, candidateSha, childTaskId };
}

test('P1. unmerged candidate yields RESULT_DELIVERED_NOT_PUBLISHED with the exact remaining delta', async () => {
  const scenario = await mutationScenario({ sourceTaskId: 'GF04-P1-SRC' });
  try {
    const { verdict } = scenario;
    assert.equal(verdict.verdict, TERMINAL_RECONCILIATION_RESULT_DELIVERED_NOT_PUBLISHED);
    assert.equal(verdict.mutationClaimed, true);
    assert.equal(verdict.publicationStatus, PUBLICATION_ALLOWED);
    assert.deepEqual([...verdict.remainingDelta], [OWNED_PATH]);
    assert.equal(verdict.liveMainSha, scenario.repo.run('rev-parse', 'main'));
    assert.equal(verdict.candidateSha, scenario.candidateSha);
    assert.equal(verdict.candidateSha !== verdict.liveMainSha, true);
  } finally {
    removeDirectory(scenario.home);
    removeDirectory(scenario.repo.dir);
  }
});

test('P2. merged candidate yields PUBLISHED_TERMINAL from direct Git evidence', async () => {
  const scenario = await mutationScenario({ sourceTaskId: 'GF04-P2-SRC', publish: 'merge' });
  try {
    const { verdict } = scenario;
    assert.equal(verdict.verdict, TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL);
    assert.equal(verdict.publicationStatus, SUPERSEDED_ALREADY_PUBLISHED);
    assert.deepEqual([...verdict.remainingDelta], []);
    assert.equal(verdict.candidateSha !== verdict.liveMainSha, true);
  } finally {
    removeDirectory(scenario.home);
    removeDirectory(scenario.repo.dir);
  }
});

test('P3. squash/rebase publication (candidate SHA != merge SHA) is proven by owned-blob equality', async () => {
  const scenario = await mutationScenario({ sourceTaskId: 'GF04-P3-SRC', publish: 'squash' });
  try {
    const { verdict } = scenario;
    assert.equal(verdict.verdict, TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL);
    assert.equal(verdict.publicationStatus, SUPERSEDED_ALREADY_PUBLISHED);
    assert.equal(
      verdict.candidateSha,
      scenario.candidateSha,
      'the pre-merge candidate SHA is preserved as provenance',
    );
    assert.equal(verdict.liveMainSha !== verdict.candidateSha, true);
    assert.deepEqual([...verdict.remainingDelta], []);
  } finally {
    removeDirectory(scenario.home);
    removeDirectory(scenario.repo.dir);
  }
});

test('P4. missing candidate ref yields PUBLICATION_UNKNOWN (fail closed, no retry permission)', async () => {
  const scenario = await mutationScenario({ sourceTaskId: 'GF04-P4-SRC', deleteCandidate: true });
  try {
    assert.equal(scenario.verdict.verdict, TERMINAL_RECONCILIATION_PUBLICATION_UNKNOWN);
    assert.equal(scenario.verdict.publicationStatus, null);
    assert.deepEqual([...scenario.verdict.remainingDelta], []);
  } finally {
    removeDirectory(scenario.home);
    removeDirectory(scenario.repo.dir);
  }
});

test('P5. no Git inputs for a mutation claim yields PUBLICATION_UNKNOWN without evidence reads', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-P5-SRC',
      childTaskId: 'GF04-P5-CHILD',
    });
    const verdict = await reconcileTerminalResult({
      store,
      sourceTaskId: 'GF04-P5-SRC',
      readEvidence: NEVER_CALLED,
    });
    assert.equal(verdict.verdict, TERMINAL_RECONCILIATION_PUBLICATION_UNKNOWN);
    assert.equal(verdict.liveMainRef, null);
    assert.equal(verdict.candidateRef, null);
  } finally {
    removeDirectory(home);
  }
});

test('P6. comparing live main with itself is circular and yields PUBLICATION_UNKNOWN', async () => {
  const scenario = await mutationScenario({ sourceTaskId: 'GF04-P6-SRC' });
  try {
    const verdict = await reconcileTerminalResult({
      store: scenario.store,
      sourceTaskId: 'GF04-P6-SRC',
      repositoryRoot: scenario.repo.dir,
      liveMainRef: 'main',
      candidateRef: 'main',
    });
    assert.equal(verdict.verdict, TERMINAL_RECONCILIATION_PUBLICATION_UNKNOWN);
  } finally {
    removeDirectory(scenario.home);
    removeDirectory(scenario.repo.dir);
  }
});

test('P7. evidence read failure yields PUBLICATION_UNKNOWN and malformed evidence fails closed', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-P7-SRC',
      childTaskId: 'GF04-P7-CHILD',
    });
    const common = {
      store,
      sourceTaskId: 'GF04-P7-SRC',
      repositoryRoot: 'C:/nonexistent-gf04-repo',
      liveMainRef: 'main',
      candidateRef: 'candidate',
    };
    const unknown = await reconcileTerminalResult({
      ...common,
      readEvidence: async () => {
        throw new Error('git unavailable');
      },
    });
    assert.equal(unknown.verdict, TERMINAL_RECONCILIATION_PUBLICATION_UNKNOWN);
    await assert.rejects(
      () =>
        reconcileTerminalResult({ ...common, readEvidence: async () => 'not an evidence object' }),
      (error) => error.code === TERMINAL_RECONCILIATION_EVIDENCE_INVALID,
    );
    await assert.rejects(
      () =>
        reconcileTerminalResult({
          ...common,
          readEvidence: async () => ({
            liveMainSha: 'short',
            candidateSha: null,
            liveMainBlobs: null,
            candidateBlobs: null,
          }),
        }),
      (error) => error.code === TERMINAL_RECONCILIATION_EVIDENCE_INVALID,
    );
  } finally {
    removeDirectory(home);
  }
});

test('P8. unresolvable comparison yields PUBLICATION_CONFLICT via the reused gate', async () => {
  const home = makeHome();
  try {
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-P8-SRC',
      childTaskId: 'GF04-P8-CHILD',
    });
    const verdict = await reconcileTerminalResult({
      store,
      sourceTaskId: 'GF04-P8-SRC',
      repositoryRoot: 'C:/nonexistent-gf04-repo',
      liveMainRef: 'main',
      candidateRef: 'candidate',
      readEvidence: async () => ({
        liveMainSha: '1'.repeat(40),
        candidateSha: '2'.repeat(40),
        liveMainBlobs: {},
        candidateBlobs: {},
      }),
    });
    assert.equal(verdict.verdict, TERMINAL_RECONCILIATION_PUBLICATION_CONFLICT);
    assert.equal(verdict.publicationStatus, SEMANTIC_OWNER_REVIEW_REQUIRED);
  } finally {
    removeDirectory(home);
  }
});

test('P9. unrelated main movement never invalidates an already-published delta', async () => {
  const scenario = await mutationScenario({
    sourceTaskId: 'GF04-P9-SRC',
    publish: 'merge',
    mainMoves: 'unrelated movement\n',
  });
  try {
    assert.equal(scenario.verdict.verdict, TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL);
    assert.deepEqual([...scenario.verdict.remainingDelta], []);
  } finally {
    removeDirectory(scenario.home);
    removeDirectory(scenario.repo.dir);
  }
});

test('P10. divergence on an owned path keeps RESULT_DELIVERED_NOT_PUBLISHED', async () => {
  const home = makeHome();
  const repo = makeGitRepo();
  try {
    createCandidateBranch(repo, 'candidate', OWNED_PATH, 'candidate content\n');
    writeAndCommit(repo, OWNED_PATH, 'different main content\n', 'someone else changed owned path');
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-P10-SRC',
      childTaskId: 'GF04-P10-CHILD',
      childOverrides: { ownedSurface: [OWNED_PATH] },
    });
    const verdict = await reconcileTerminalResult({
      store,
      sourceTaskId: 'GF04-P10-SRC',
      repositoryRoot: repo.dir,
      liveMainRef: 'main',
      candidateRef: 'candidate',
    });
    assert.equal(verdict.verdict, TERMINAL_RECONCILIATION_RESULT_DELIVERED_NOT_PUBLISHED);
    assert.deepEqual([...verdict.remainingDelta], [OWNED_PATH]);
  } finally {
    removeDirectory(home);
    removeDirectory(repo.dir);
  }
});

test('P11. zero-delta candidate already satisfies the effective-delta check', async () => {
  const home = makeHome();
  const repo = makeGitRepo();
  try {
    createCandidateBranch(repo, 'candidate', UNRELATED_PATH, 'candidate unrelated delta\n');
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-P11-SRC',
      childTaskId: 'GF04-P11-CHILD',
      childOverrides: { ownedSurface: [OWNED_PATH] },
    });
    const verdict = await reconcileTerminalResult({
      store,
      sourceTaskId: 'GF04-P11-SRC',
      repositoryRoot: repo.dir,
      liveMainRef: 'main',
      candidateRef: 'candidate',
    });
    assert.equal(verdict.verdict, TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL);
    assert.equal(verdict.publicationStatus, SUPERSEDED_ALREADY_PUBLISHED);
  } finally {
    removeDirectory(home);
    removeDirectory(repo.dir);
  }
});

test('P12. after publication, the canonical admission gate refuses duplicate publication', async () => {
  const scenario = await mutationScenario({ sourceTaskId: 'GF04-P12-SRC', publish: 'merge' });
  try {
    const prePublication = decidePrePublication({
      repositoryRoot: scenario.repo.dir,
      liveMainRef: 'main',
      candidateRef: 'candidate',
      ownedPaths: [OWNED_PATH],
    });
    assert.equal(prePublication.status, COMPLETE_ALREADY_PUBLISHED);
    const preMerge = decidePreMerge({
      repositoryRoot: scenario.repo.dir,
      liveMainRef: 'main',
      candidateRef: 'candidate',
      ownedPaths: [OWNED_PATH],
    });
    assert.equal(preMerge.status, SUPERSEDED_ALREADY_PUBLISHED);
    const first = scenario.verdict;
    const replay = await reconcileTerminalResult({
      store: scenario.store,
      sourceTaskId: 'GF04-P12-SRC',
      repositoryRoot: scenario.repo.dir,
      liveMainRef: 'main',
      candidateRef: 'candidate',
    });
    assert.equal(JSON.stringify(replay), JSON.stringify(first));
  } finally {
    removeDirectory(scenario.home);
    removeDirectory(scenario.repo.dir);
  }
});

// ---------------------------------------------------------------------------
// X. CRASH / RESTART: fresh-process convergence over the same durable bytes.
// ---------------------------------------------------------------------------

test('X1. RESULT_DELIVERED crash replay reuses the same result and the same verdict', {
  timeout: 120_000,
}, async () => {
  const home = makeHome();
  const repo = makeGitRepo();
  try {
    createCandidateBranch(repo, 'candidate', OWNED_PATH, 'candidate content\n');
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-X1-SRC',
      childTaskId: 'GF04-X1-CHILD',
      childOverrides: { ownedSurface: [OWNED_PATH] },
    });
    const before = snapshotHome(home);
    const inProcess = await reconcileTerminalResult({
      store,
      sourceTaskId: 'GF04-X1-SRC',
      repositoryRoot: repo.dir,
      liveMainRef: 'main',
      candidateRef: 'candidate',
    });
    const child = runChildProcess({
      code: reconcileWorkerCode({
        home,
        sourceTaskId: 'GF04-X1-SRC',
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
      }),
    });
    const result = await child.exitPromise;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.parsed.ok, true, result.stderr);
    assert.equal(JSON.stringify(result.parsed.verdict), JSON.stringify(inProcess));
    assert.deepEqual(snapshotHome(home), before, 'no durable byte change across processes');
  } finally {
    removeDirectory(home);
    removeDirectory(repo.dir);
  }
});

test('X2. candidate-created pre-publication crash: no duplicate publication, converges after merge', {
  timeout: 120_000,
}, async () => {
  const home = makeHome();
  const repo = makeGitRepo();
  try {
    const candidateSha = createCandidateBranch(
      repo,
      'candidate',
      OWNED_PATH,
      'candidate content\n',
    );
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-X2-SRC',
      childTaskId: 'GF04-X2-CHILD',
      childOverrides: { ownedSurface: [OWNED_PATH] },
    });
    const before = snapshotHome(home);
    const beforeGit = gitState(repo);
    const crashed = await runChildProcess({
      code: reconcileWorkerCode({
        home,
        sourceTaskId: 'GF04-X2-SRC',
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
      }),
    }).exitPromise;
    assert.equal(
      crashed.parsed.verdict.verdict,
      TERMINAL_RECONCILIATION_RESULT_DELIVERED_NOT_PUBLISHED,
    );
    assert.equal(crashed.parsed.verdict.candidateSha, candidateSha);
    assert.deepEqual(gitState(repo), beforeGit, 'reconciliation never mutates Git');
    assert.deepEqual(snapshotHome(home), before, 'reconciliation never mutates durable state');
    assert.equal(
      decidePrePublication({
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
        ownedPaths: [OWNED_PATH],
      }).status,
      PUBLICATION_ALLOWED,
    );

    mergeCandidateBranch(repo, 'candidate');
    const recovered = await runChildProcess({
      code: reconcileWorkerCode({
        home,
        sourceTaskId: 'GF04-X2-SRC',
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
      }),
    }).exitPromise;
    assert.equal(recovered.parsed.verdict.verdict, TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL);
    assert.equal(
      decidePreMerge({
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
        ownedPaths: [OWNED_PATH],
      }).status,
      SUPERSEDED_ALREADY_PUBLISHED,
    );
    assert.deepEqual(snapshotHome(home), before, 'no duplicate durable terminal family');
  } finally {
    removeDirectory(home);
    removeDirectory(repo.dir);
  }
});

test('X3. PR-created crash: the candidate ref is rediscovered after restart', {
  timeout: 120_000,
}, async () => {
  const home = makeHome();
  const repo = makeGitRepo();
  try {
    const candidateSha = createCandidateBranch(
      repo,
      'candidate',
      OWNED_PATH,
      'candidate content\n',
    );
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-X3-SRC',
      childTaskId: 'GF04-X3-CHILD',
      childOverrides: { ownedSurface: [OWNED_PATH] },
    });
    const first = await runChildProcess({
      code: reconcileWorkerCode({
        home,
        sourceTaskId: 'GF04-X3-SRC',
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
      }),
    }).exitPromise;
    assert.equal(
      first.parsed.verdict.verdict,
      TERMINAL_RECONCILIATION_RESULT_DELIVERED_NOT_PUBLISHED,
    );
    const second = await runChildProcess({
      code: reconcileWorkerCode({
        home,
        sourceTaskId: 'GF04-X3-SRC',
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
      }),
    }).exitPromise;
    assert.equal(JSON.stringify(second.parsed.verdict), JSON.stringify(first.parsed.verdict));
    assert.equal(second.parsed.verdict.candidateSha, candidateSha);

    mergeCandidateBranch(repo, 'candidate');
    const third = await runChildProcess({
      code: reconcileWorkerCode({
        home,
        sourceTaskId: 'GF04-X3-SRC',
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
      }),
    }).exitPromise;
    assert.equal(third.parsed.verdict.verdict, TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL);
  } finally {
    removeDirectory(home);
    removeDirectory(repo.dir);
  }
});

test('X4. merge-before-convergence crash: fresh read recovers publication, retired candidate fails closed', {
  timeout: 120_000,
}, async () => {
  const home = makeHome();
  const repo = makeGitRepo();
  try {
    createCandidateBranch(repo, 'candidate', OWNED_PATH, 'candidate content\n');
    mergeCandidateBranch(repo, 'candidate', { squash: true });
    writeAndCommit(repo, UNRELATED_PATH, 'later main movement\n', 'later unrelated move');
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-X4-SRC',
      childTaskId: 'GF04-X4-CHILD',
      childOverrides: { ownedSurface: [OWNED_PATH] },
    });
    const recovered = await runChildProcess({
      code: reconcileWorkerCode({
        home,
        sourceTaskId: 'GF04-X4-SRC',
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
      }),
    }).exitPromise;
    assert.equal(recovered.parsed.verdict.verdict, TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL);

    repo.run('branch', '-D', 'candidate');
    const retired = await runChildProcess({
      code: reconcileWorkerCode({
        home,
        sourceTaskId: 'GF04-X4-SRC',
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
      }),
    }).exitPromise;
    assert.equal(retired.parsed.verdict.verdict, TERMINAL_RECONCILIATION_PUBLICATION_UNKNOWN);
  } finally {
    removeDirectory(home);
    removeDirectory(repo.dir);
  }
});

test('X5. terminal convergence replay is byte-stable with no new durable family', {
  timeout: 120_000,
}, async () => {
  const home = makeHome();
  const repo = makeGitRepo();
  try {
    createCandidateBranch(repo, 'candidate', OWNED_PATH, 'candidate content\n');
    mergeCandidateBranch(repo, 'candidate');
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-X5-SRC',
      childTaskId: 'GF04-X5-CHILD',
      childOverrides: { ownedSurface: [OWNED_PATH] },
    });
    const before = snapshotHome(home);
    const occurrenceBefore = JSON.stringify(
      store.readRunnableOccurrence({ sourceTaskId: 'GF04-X5-SRC' }),
    );
    const worker = () =>
      runChildProcess({
        code: reconcileWorkerCode({
          home,
          sourceTaskId: 'GF04-X5-SRC',
          repositoryRoot: repo.dir,
          liveMainRef: 'main',
          candidateRef: 'candidate',
        }),
      }).exitPromise;
    const first = await worker();
    const second = await worker();
    assert.equal(first.parsed.verdict.verdict, TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL);
    assert.equal(JSON.stringify(second.parsed.verdict), JSON.stringify(first.parsed.verdict));
    assert.deepEqual(snapshotHome(home), before, 'no new durable family, no duplicate terminal');
    assert.equal(
      Object.keys(snapshotHome(home)).some((path) => path.toLowerCase().includes('reconcil')),
      false,
    );
    assert.equal(
      JSON.stringify(store.readRunnableOccurrence({ sourceTaskId: 'GF04-X5-SRC' })),
      occurrenceBefore,
    );
  } finally {
    removeDirectory(home);
    removeDirectory(repo.dir);
  }
});

// ---------------------------------------------------------------------------
// BOUNDARY. derived-only, no durable family, no duplicate publication authority.
// ---------------------------------------------------------------------------

test('B1. exports, source boundary, and store non-ownership', () => {
  const moduleSource = readFileSync(join(MODULE_DIRECTORY, 'terminal-reconciliation.mjs'), 'utf8');
  for (const forbiddenToken of [
    'node:child_process',
    'execFileSync',
    'spawn(',
    'writeFileSync',
    'mkdirSync',
    'renameSync',
    'unlinkSync',
    'rmSync',
    'Date.now',
    'new Date(',
    'setTimeout',
    'setInterval',
    'randomUUID',
  ]) {
    assert.equal(
      moduleSource.includes(forbiddenToken),
      false,
      `terminal reconciliation must not contain ${forbiddenToken}`,
    );
  }
  for (const reusedAuthority of [
    'evaluatePublicationAdmission',
    'readOwnedBlobs',
    'resolveRef',
    'buildAdmissionBoundClaimToken',
    'readRunnableOccurrence',
    'readTask',
    'readResult',
  ]) {
    assert.equal(
      moduleSource.includes(reusedAuthority),
      true,
      `terminal reconciliation must reuse ${reusedAuthority}`,
    );
  }
  assert.equal(moduleSource.includes('publication-admission.mjs'), true);

  const store = new CoordinationStore({ dir: makeHome() });
  try {
    assert.equal(store.reconcileTerminalResult, undefined);
    assert.equal(CoordinationStore.prototype.reconcileTerminalResult, undefined);
  } finally {
    rmSync(store.home, { recursive: true, force: true });
  }
});

test('B2. reconciliation never rewrites GF-03 occurrence/claim/result authority', async () => {
  const home = makeHome();
  const repo = makeGitRepo();
  try {
    createCandidateBranch(repo, 'candidate', OWNED_PATH, 'candidate content\n');
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-B2-SRC',
      childTaskId: 'GF04-B2-CHILD',
      childOverrides: { ownedSurface: [OWNED_PATH] },
    });
    const before = snapshotHome(home);
    for (let round = 0; round < 3; round += 1) {
      const verdict = await reconcileTerminalResult({
        store,
        sourceTaskId: 'GF04-B2-SRC',
        repositoryRoot: repo.dir,
        liveMainRef: 'main',
        candidateRef: 'candidate',
      });
      assert.equal(typeof verdict.occurrenceId, 'string');
      assert.equal(verdict.occurrenceState, 'TERMINAL');
    }
    assert.deepEqual(snapshotHome(home), before);
  } finally {
    removeDirectory(home);
    removeDirectory(repo.dir);
  }
});

test('B3. no automatic publication/retry surface exists in the verdict', async () => {
  const home = makeHome();
  const repo = makeGitRepo();
  try {
    createCandidateBranch(repo, 'candidate', OWNED_PATH, 'candidate content\n');
    const clock = controllableClock();
    const store = new CoordinationStore({ dir: home, nowProvider: () => clock.provider() });
    driveToTerminal(store, clock, {
      sourceTaskId: 'GF04-B3-SRC',
      childTaskId: 'GF04-B3-CHILD',
      childOverrides: { ownedSurface: [OWNED_PATH] },
    });
    const verdict = await reconcileTerminalResult({
      store,
      sourceTaskId: 'GF04-B3-SRC',
      repositoryRoot: repo.dir,
      liveMainRef: 'main',
      candidateRef: 'candidate',
    });
    const keys = Object.keys(verdict);
    assert.deepEqual(keys, [...TERMINAL_RECONCILIATION_RECORD_FIELDS]);
    for (const forbidden of [
      'publish',
      'retry',
      'merge',
      'deploy',
      'scheduler',
      'queue',
      'branch',
    ]) {
      assert.equal(keys.includes(forbidden), false);
    }
    assert.equal(DEFAULT_EMISSION_SLOT, 'next');
    assert.equal(PRE_PR_PHASE, 'PRE_PR');
    assert.equal(PRE_MERGE_PHASE, 'PRE_MERGE');
    assert.equal(existsSync(join(home, 'reconciliation')), false);
  } finally {
    removeDirectory(home);
    removeDirectory(repo.dir);
  }
});
