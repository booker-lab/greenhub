// Real-execution proof harness for
// GREENHUB-COORDINATION-SHARED-CONTROL-TOWER-DISPOSITION-RETURN-GF09.
//
// Runs the REAL shared-surface loop through the existing operator CLI process
// path with the REAL GitHub CLI/API transport on the REAL GF-08 relay issue, in
// an isolated coordination home OUTSIDE the repository:
//
//   synthetic user-approved READ_ONLY task -> canonical synthetic delivery
//     -> RESULT_DELIVERED
//     -> GF-07 automatic Control Tower result intake
//        (generation 1 PENDING_DISPOSITION)
//     -> GF-08 relay: the delivered result is projected to the shared GitHub
//        relay issue (non-canonical)
//     -> the Control Tower reads the relayed document FROM the shared surface
//        (independent GitHub API read-back; no local result body is reused)
//     -> the Control Tower authors ONE shared disposition decision comment on
//        the same issue (the harness plays the Control Tower authoring role)
//     -> `coordination:disposition` reads the decision from the shared surface,
//        validates the exact task/result/resultBinding/disposition-generation
//        binding, and adopts exactly ONE canonical disposition generation
//     -> replay converges as EXACT_REPLAY with zero durable byte changes
//     -> a stale decision fails closed with zero canonical change
//     -> an unavailable GitHub surface leaves canonical truth unchanged
//
// The proof requires NO user copy/paste of the result or verdict body between
// the Control Tower and OpenCode: both sides are transported by the shared
// GitHub surface. NO OpenCode executor is invoked anywhere in this harness
// (the probe result is delivered synthetically through the canonical store;
// the disposition path structurally cannot invoke an executor).
//
// Repository worktree bytes, refs, worktrees, stash, and remote main are
// compared before/after to prove the harness mutated nothing.
//
// The relay projection and decision comments created by this harness are real
// non-canonical projections of a synthetic probe: they are intentionally left
// in place (the relay surface is durable, not a test fixture to delete).
//
// Usage:
//   node scripts/coordination/real-control-tower-disposition-return.mjs
//     [--relay-repo <OWNER/NAME>] [--task-id <TASK_ID>] [--gh <PATH>]
//
// This harness is NOT a spec: it is never auto-discovered by
// `node --test scripts/coordination/*.spec.mjs` because it requires an
// authenticated `gh` CLI and network access. It always prints one JSON report
// to stdout.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildControlTowerDispositionDecisionMarker,
  extractControlTowerDispositionDecision,
  renderControlTowerDispositionDecisionBody,
  validateControlTowerDispositionDecision,
} from './control-tower-disposition-return.mjs';
import {
  CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
  createGitHubIssueCommentRelayTransport,
  parseControlTowerResultRelayProjection,
} from './control-tower-result-relay.mjs';
import { computeResultBinding, DISPOSITION_STATE_PENDING } from './disposition.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_ID_PATTERN } from './task-envelope.mjs';
import {
  AUTHORITY_KIND_USER_APPROVED_INTAKE,
  USER_APPROVED_INTAKE_DISPATCH_SLOT,
} from './user-approved-intake.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..');
const OPERATOR_CLI_PATH = join(MODULE_DIRECTORY, 'operator-cli.mjs');
const DEFAULT_RELAY_REPOSITORY = 'booker-lab/greenhub';

class HarnessBlocked extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarnessBlocked';
    this.code = code;
  }
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function captureRepositoryState() {
  return {
    head: git(['rev-parse', 'HEAD']).trim(),
    refs: git(['for-each-ref', '--format=%(refname) %(objectname)']),
    status: git(['status', '--porcelain=v1', '--untracked-files=all']),
    stash: git(['stash', 'list']),
    worktrees: git(['worktree', 'list', '--porcelain']),
    remoteMain: git(['ls-remote', 'origin', 'refs/heads/main']).trim(),
    probeFileHashes: {
      'package.json': sha256File(join(REPOSITORY_ROOT, 'package.json')),
      'scripts/coordination/control-tower-disposition-return.mjs': sha256File(
        join(REPOSITORY_ROOT, 'scripts/coordination/control-tower-disposition-return.mjs'),
      ),
      'scripts/coordination/operator-cli.mjs': sha256File(
        join(REPOSITORY_ROOT, 'scripts/coordination/operator-cli.mjs'),
      ),
    },
  };
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
        out[full.slice(home.length + 1)] = readFileSync(full, 'utf8');
      }
    }
  };
  walk(home);
  return out;
}

function sampleProbeTaskInput(taskId) {
  return {
    taskId,
    taskKind: 'READ_ONLY',
    desiredExitState: 'GF09_SHARED_CONTROL_TOWER_DISPOSITION_RETURN',
    policyRefs: [
      'docs/specs/ops/greenhub-branch-recurrence-prevention-and-control-tower-closure-policy.md',
    ],
    evidenceRefs: ['read:package.json'],
    contextRefs: ['docs/PROJECT_MAP.md#scripts'],
    authorityRequirement: {
      liveMainHint: null,
      requiredPolicies: ['AGENTS.md'],
    },
    ownedSurface: ['scripts/coordination/'],
    mutationBoundary: { allowsWrite: false, forbiddenPaths: ['apps/api/'] },
    proofRequirement: ['read:package.json', 'report:package-json-name-and-private-flag'],
  };
}

function runChildProcess(args, env) {
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

function parseOptions(argv) {
  let relayRepository = process.env.GREENHUB_CONTROL_TOWER_RELAY_REPO ?? DEFAULT_RELAY_REPOSITORY;
  let taskId = null;
  let ghPath = process.env.GREENHUB_CONTROL_TOWER_RELAY_GH_PATH ?? 'gh';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };
    if (argument === '--relay-repo') relayRepository = next();
    else if (argument === '--task-id') taskId = next();
    else if (argument === '--gh') ghPath = next();
    else if (argument === '--help' || argument === '-h') {
      return { help: true };
    } else {
      throw new HarnessBlocked('HARNESS_ARGUMENT_INVALID', `unknown option: ${argument}`);
    }
  }
  if (
    typeof relayRepository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(relayRepository)
  ) {
    throw new HarnessBlocked(
      'BLOCKED_RELAY_REPOSITORY_INVALID',
      `relay repository must be an explicit owner/name GitHub repository (got ${JSON.stringify(relayRepository)})`,
    );
  }
  if (taskId !== null && (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId))) {
    throw new HarnessBlocked(
      'HARNESS_ARGUMENT_INVALID',
      `--task-id must match ${String(TASK_ID_PATTERN)}`,
    );
  }
  if (typeof ghPath !== 'string' || !ghPath.trim()) {
    throw new HarnessBlocked('HARNESS_ARGUMENT_INVALID', '--gh must be a non-empty path/name');
  }
  return { help: false, relayRepository, taskId, ghPath };
}

function renderUsage() {
  return [
    'usage:',
    '  node scripts/coordination/real-control-tower-disposition-return.mjs',
    '    [--relay-repo <OWNER/NAME>] [--task-id <TASK_ID>] [--gh <PATH>]',
    '',
    'requires an authenticated gh CLI and network access.',
    'always prints ONE JSON report to stdout.',
    '',
  ].join('\n');
}

function assertGhAvailable(ghPath) {
  try {
    const version = execFileSync(ghPath, ['--version'], { encoding: 'utf8' }).trim();
    const auth = execFileSync(ghPath, ['auth', 'status'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { version, authenticated: true, auth: auth.trim().split('\n')[0] ?? '' };
  } catch (error) {
    throw new HarnessBlocked(
      'BLOCKED_GITHUB_UNAVAILABLE',
      `gh CLI is unavailable or unauthenticated (${String(error?.message ?? error)})`,
    );
  }
}

function postComment(GH, relayRepository, issueNumber, body) {
  const stdout = execFileSync(
    GH,
    [
      'api',
      `repos/${relayRepository}/issues/${issueNumber}/comments`,
      '-X',
      'POST',
      '-f',
      `body=${body}`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const created = JSON.parse(stdout);
  return {
    commentId: created.id,
    url: created.html_url,
  };
}

const report = {
  harness: 'real-control-tower-disposition-return',
  status: null,
  gh: null,
  relayRepository: null,
  isolatedCoordinationHome: null,
  isolatedCoordinationHomeRemoved: false,
  repositoryBefore: null,
  repositoryAfter: null,
  repositoryUnchanged: null,
  realOpenCodeInvocations: 0,
};

async function main(options) {
  const GH = options.ghPath;
  report.gh = assertGhAvailable(GH);
  report.relayRepository = options.relayRepository;

  const taskId =
    options.taskId ??
    `GF09-REALPROBE-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new HarnessBlocked('HARNESS_ARGUMENT_INVALID', `derived task id is invalid: ${taskId}`);
  }

  const home = mkdtempSync(join(tmpdir(), 'greenhub-gf09-real-proof-'));
  report.isolatedCoordinationHome = home;
  const store = new CoordinationStore({ dir: home });
  report.repositoryBefore = captureRepositoryState();

  // --- 1. synthetic user-approved READ_ONLY task + canonical synthetic delivery
  const intake = store.intakeUserApprovedReadOnlyTask({
    userApproved: true,
    approval: {
      approvedBy: 'gf09-real-proof',
      approvalRef: 'gf09:real-control-tower-disposition-return',
    },
    taskSpec: sampleProbeTaskInput(taskId),
    recorderId: 'gf09-real-proof-harness',
  });
  assert.equal(store.readTask(taskId).status, 'READY');
  const claimed = store.claimUserApprovedIntakeTask({
    taskId,
    workerId: 'gf09-real-proof-worker',
    leaseDurationMs: 60_000,
  });
  store.deliverResult({
    taskId,
    resultId: `result_${taskId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    workerId: claimed.claim.workerId,
    claimToken: claimed.claim.claimToken,
    claimGeneration: claimed.claim.generation,
    status: 'SUCCEEDED',
    summary: `synthetic GF-09 real-probe result for ${taskId}`,
    proofRefs: ['proof:gf09-real-probe'],
    evidenceRefs: ['evidence:gf09-real-probe'],
    frictionObserved: ['NONE'],
  });

  // --- 2. GF-07 automatic intake through the literal process path ------------
  const childEnv = {
    ...process.env,
    GREENHUB_COORDINATION_HOME: home,
    GREENHUB_CONTROL_TOWER_RELAY_REPO: options.relayRepository,
    GREENHUB_CONTROL_TOWER_RELAY_GH_PATH: GH,
    GREENHUB_OPENCODE_CLI_PATH: '',
    GREENHUB_OPENCODE_MODEL: '',
  };
  const returned = await runChildProcess(['return', taskId, '--json'], childEnv);
  assert.equal(returned.code, 0, `return stderr: ${returned.stderr}`);
  const returnProjection = JSON.parse(returned.stdout);
  assert.equal(returnProjection.newlyIntaken, true);
  assert.equal(returnProjection.disposition.dispositionRef, `${taskId}@1`);
  assert.equal(returnProjection.disposition.state, DISPOSITION_STATE_PENDING);

  // --- 3. GF-08 relay through the literal process path -----------------------
  const relayed = await runChildProcess(['relay', taskId, '--json'], childEnv);
  assert.equal(relayed.code, 0, `relay stderr: ${relayed.stderr}`);
  const relayProjection = JSON.parse(relayed.stdout);
  assert.equal(relayProjection.status, 'RELAYED');
  assert.ok(Number.isInteger(relayProjection.issue.issueNumber));
  assert.ok(Number.isInteger(relayProjection.comment.commentId));
  const issueNumber = relayProjection.issue.issueNumber;

  // --- 4. Control Tower reads the relayed document FROM the shared surface ---
  const surfaceTransport = createGitHubIssueCommentRelayTransport({
    repository: options.relayRepository,
    ghPath: GH,
  });
  const relayedComment = await surfaceTransport.readProjection({
    commentId: relayProjection.comment.commentId,
  });
  assert.notEqual(relayedComment.body, null, 'the relay comment must be readable from GitHub');
  const sharedDocument = parseControlTowerResultRelayProjection(relayedComment.body);
  assert.notEqual(sharedDocument, null, 'the shared surface must carry the relay document');
  assert.equal(sharedDocument.taskId, taskId);
  assert.equal(sharedDocument.dispositionRef, `${taskId}@1`);
  assert.equal(sharedDocument.dispositionState, DISPOSITION_STATE_PENDING);
  assert.equal(sharedDocument.resultBinding, computeResultBinding(store.readResult(taskId)));

  // --- 5. the Control Tower authors ONE shared disposition decision ----------
  // The verdict (ADOPTED for this synthetic READ_ONLY probe) is authored here by
  // the Control Tower role; the local adoption code only validates/adopts it.
  const decisionDocument = {
    schemaVersion: '1',
    taskId,
    resultId: sharedDocument.resultId,
    resultBinding: sharedDocument.resultBinding,
    dispositionRef: sharedDocument.dispositionRef,
    dispositionState: sharedDocument.dispositionState,
    targetDispositionState: 'ADOPTED',
    controlTowerId: 'control-tower',
    controlTowerToken: 'ct-shared-decision-real-probe',
    decidedAt: new Date().toISOString(),
    policyRefs: [...sharedDocument.proofRefs],
    proofRefs: ['proof:gf09-real-probe'],
    evidenceRefs: [`relay:${relayProjection.relayId}`],
  };
  const decisionBody = renderControlTowerDispositionDecisionBody(decisionDocument);
  const decisionComment = postComment(GH, options.relayRepository, issueNumber, decisionBody);
  const expectedDecision = validateControlTowerDispositionDecision(
    extractControlTowerDispositionDecision(decisionBody),
  );

  // The adoption path must see exactly this decision through the shared surface.
  const decisionMarker = buildControlTowerDispositionDecisionMarker({ taskId });
  const sharedDecisions = await surfaceTransport.findComments({
    issueNumber,
    marker: decisionMarker,
  });
  assert.equal(sharedDecisions.length, 1);
  assert.equal(sharedDecisions[0].commentId, decisionComment.commentId);

  // --- 6. local canonical adoption through the literal process path ----------
  const beforeAdoption = snapshotHome(home);
  const adopted = await runChildProcess(['disposition', taskId, '--json'], childEnv);
  assert.equal(adopted.code, 0, `disposition stderr: ${adopted.stderr}`);
  const adoptedProjection = JSON.parse(adopted.stdout);
  assert.equal(adoptedProjection.status, 'RETURNED');
  assert.equal(adoptedProjection.canonicalWrites, 1);
  assert.equal(adoptedProjection.executorInvocations, 0);
  assert.equal(adoptedProjection.manualCopyPasteRequired, false);
  assert.equal(adoptedProjection.decision.decisionId, expectedDecision.decisionId);
  assert.equal(adoptedProjection.returnedDisposition.dispositionRef, `${taskId}@2`);
  assert.equal(adoptedProjection.returnedDisposition.state, 'ADOPTED');
  assert.notDeepEqual(snapshotHome(home), beforeAdoption, 'adoption writes the canonical generation');

  const canonical = store.readCurrentDisposition(taskId);
  assert.equal(canonical.dispositionGeneration, 2);
  assert.equal(canonical.state, 'ADOPTED');
  assert.ok(canonical.evidenceRefs.includes(`shared-decision:${expectedDecision.decisionId}`));
  assert.equal(canonical.resultBinding, sharedDocument.resultBinding);

  // --- 7. restart/replay: zero further canonical writes, zero executor -------
  const afterAdoption = snapshotHome(home);
  const generationFilesAfterAdoption = readdirSync(
    join(home, 'tasks', taskId, 'disposition', 'generations'),
  ).sort();
  assert.deepEqual(generationFilesAfterAdoption, ['1.json', '2.json']);

  const replayed = await runChildProcess(['disposition', taskId, '--json'], childEnv);
  assert.equal(replayed.code, 0, `replay stderr: ${replayed.stderr}`);
  const replayProjection = JSON.parse(replayed.stdout);
  assert.equal(replayProjection.status, 'EXACT_REPLAY');
  assert.equal(replayProjection.canonicalWrites, 0);
  assert.equal(replayProjection.executorInvocations, 0);
  assert.equal(replayProjection.decision.decisionId, expectedDecision.decisionId);
  assert.deepEqual(snapshotHome(home), afterAdoption, 'replay writes zero durable bytes');

  // --- 8. stale decision fails closed with zero canonical change -------------
  const staleDocument = {
    ...decisionDocument,
    targetDispositionState: 'REJECTED',
    decidedAt: new Date(Date.now() + 1000).toISOString(),
  };
  const staleComment = postComment(
    GH,
    options.relayRepository,
    issueNumber,
    renderControlTowerDispositionDecisionBody(staleDocument),
  );
  const staleResult = await runChildProcess(['disposition', taskId, '--json'], childEnv);
  assert.equal(staleResult.code, 1, 'a stale shared decision must fail closed');
  assert.match(staleResult.stderr, /CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE/);
  assert.deepEqual(snapshotHome(home), afterAdoption, 'stale decision changes zero canonical bytes');
  assert.equal(store.readCurrentDisposition(taskId).state, 'ADOPTED');

  // --- 9. unavailable GitHub leaves canonical truth unchanged ----------------
  const unavailableEnv = {
    ...childEnv,
    GREENHUB_CONTROL_TOWER_RELAY_GH_PATH: join(home, 'no-such-gh-executable'),
  };
  const unavailable = await runChildProcess(['disposition', taskId, '--json'], unavailableEnv);
  assert.equal(unavailable.code, 1, 'an unavailable shared surface reports RETURN_PENDING');
  const unavailableProjection = JSON.parse(unavailable.stdout);
  assert.equal(unavailableProjection.status, 'RETURN_PENDING');
  assert.equal(unavailableProjection.canonicalWrites, 0);
  assert.equal(
    unavailableProjection.failureCode,
    'CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT_UNAVAILABLE',
  );
  assert.deepEqual(
    snapshotHome(home),
    afterAdoption,
    'transport failure changes zero canonical bytes',
  );

  report.cycle = {
    taskId,
    intakeId: intake.record.intakeId,
    authorityKind: AUTHORITY_KIND_USER_APPROVED_INTAKE,
    emissionSlot: USER_APPROVED_INTAKE_DISPATCH_SLOT,
    resultId: sharedDocument.resultId,
    resultBinding: sharedDocument.resultBinding,
    sourceDispositionRef: `${taskId}@1`,
    sourceDispositionState: DISPOSITION_STATE_PENDING,
    relayIssueNumber: issueNumber,
    relayCommentId: relayProjection.comment.commentId,
    decisionCommentId: decisionComment.commentId,
    staleDecisionCommentId: staleComment.commentId,
    sharedDecisionId: expectedDecision.decisionId,
    requestedDisposition: 'ADOPTED',
    resultingCanonicalDispositionRef: `${taskId}@2`,
    resultingCanonicalDispositionState: 'ADOPTED',
    manualCopyPasteRequired: false,
    adoptionStatus: adoptedProjection.status,
    replayStatus: replayProjection.status,
    replayExecutorInvocations: replayProjection.executorInvocations,
    canonicalWrites: adoptedProjection.canonicalWrites + replayProjection.canonicalWrites,
    finalGenerationFiles: generationFilesAfterAdoption,
    staleDecisionFailClosed: true,
    unavailableSurfaceStatus: unavailableProjection.status,
    unavailableSurfaceCanonicalWrites: 0,
    canonicalBytesUnchangedOnReplayStaleAndFailure: true,
    totalRealOpenCodeInvocations: 0,
  };

  report.repositoryAfter = captureRepositoryState();
  assert.deepEqual(
    {
      head: report.repositoryAfter.head,
      refs: report.repositoryAfter.refs,
      status: report.repositoryAfter.status,
      stash: report.repositoryAfter.stash,
      worktrees: report.repositoryAfter.worktrees,
      remoteMain: report.repositoryAfter.remoteMain,
      probeFileHashes: report.repositoryAfter.probeFileHashes,
    },
    {
      head: report.repositoryBefore.head,
      refs: report.repositoryBefore.refs,
      status: report.repositoryBefore.status,
      stash: report.repositoryBefore.stash,
      worktrees: report.repositoryBefore.worktrees,
      remoteMain: report.repositoryBefore.remoteMain,
      probeFileHashes: report.repositoryBefore.probeFileHashes,
    },
    'the real proof must not change repository or remote state',
  );
  report.repositoryUnchanged = true;
  report.status = 'COMPLETE';

  rmSync(home, { recursive: true, force: true });
  report.isolatedCoordinationHomeRemoved = true;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(renderUsage());
    process.exitCode = 0;
  } else {
    process.exitCode = await main(options);
  }
} catch (error) {
  report.status = error instanceof HarnessBlocked ? error.code : 'FAILED';
  report.detail = String(error?.message ?? error);
  if (!(error instanceof HarnessBlocked)) {
    report.cause = { name: error?.name ?? null, code: error?.code ?? null };
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
}
