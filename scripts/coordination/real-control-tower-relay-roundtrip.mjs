// Real-execution proof harness for
// GREENHUB-COORDINATION-SHARED-CONTROL-TOWER-RESULT-RELAY-GF08.
//
// Runs ONE real READ_ONLY OpenCode execution cycle through the EXISTING
// operator composition with a REAL installed OpenCode process, a REAL model,
// and the REAL GitHub CLI/API transport, in an isolated coordination home
// OUTSIDE the repository:
//
//   GF-06 user-approved READ_ONLY intake -> READY
//     -> REAL OPENCODE execution -> RESULT_DELIVERED
//     -> GF-07 automatic Control Tower result intake
//        (generation 1 PENDING_DISPOSITION)
//     -> GF-08 automatic shared Control Tower result relay
//        (non-canonical GitHub issue comment projection)
//     -> GitHub API read-back: marker / resultId / resultBinding match the
//        canonical result exactly
//     -> exact-replay convergence with zero OpenCode invocations and zero new
//        semantic artifacts
//     -> literal `coordination:relay` process path: zero executor invocations
//
// Repository worktree bytes, refs, worktrees, stash, and remote main are
// compared before/after the real process to prove the probe mutated nothing.
//
// The relay issue/comment created by this harness is a real projection of a
// synthetic READ_ONLY probe: it is intentionally left in place (the relay is a
// durable non-canonical projection surface, not a test fixture to delete).
//
// Usage:
//   node scripts/coordination/real-control-tower-relay-roundtrip.mjs \
//     --opencode <ABSOLUTE_PATH> --model <PROVIDER/MODEL> [--workdir <ABS>]
//     [--relay-repo <OWNER/NAME>] [--task-id <TASK_ID>]
//
// This harness is NOT a spec: it is never auto-discovered by
// `node --test scripts/coordination/*.spec.mjs` because it requires an
// installed OpenCode CLI, valid credentials, an authenticated `gh` CLI, and
// network access. It always prints one JSON report to stdout.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_TOWER_RESULT_RELAY_ISSUE_TITLE,
  CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY,
  CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED,
  createGitHubIssueCommentRelayTransport,
  parseControlTowerResultRelayProjection,
} from './control-tower-result-relay.mjs';
import { computeResultBinding, DISPOSITION_STATE_PENDING } from './disposition.mjs';
import { runOperatorCli } from './operator-cli.mjs';
import { createOpenCodeCliStructuredResultExecutor } from './opencode-cli-executor-adapter.mjs';
import { CoordinationStore } from './store.mjs';
import { TASK_ID_PATTERN } from './task-envelope.mjs';

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

function captureStream() {
  const stream = { text: '' };
  stream.write = (chunk) => {
    stream.text += String(chunk);
    return true;
  };
  return stream;
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
      'scripts/coordination/control-tower-result-relay.mjs': sha256File(
        join(REPOSITORY_ROOT, 'scripts/coordination/control-tower-result-relay.mjs'),
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
    desiredExitState: 'REPORT_PACKAGE_JSON_FACTS',
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
  let opencodePath = process.env.GREENHUB_OPENCODE_CLI_PATH ?? null;
  let model = process.env.GREENHUB_OPENCODE_MODEL ?? null;
  let workdir = REPOSITORY_ROOT;
  let relayRepository = process.env.GREENHUB_CONTROL_TOWER_RELAY_REPO ?? DEFAULT_RELAY_REPOSITORY;
  let taskId = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };
    if (argument === '--opencode') opencodePath = next();
    else if (argument === '--model') model = next();
    else if (argument === '--workdir') workdir = resolve(next());
    else if (argument === '--relay-repo') relayRepository = next();
    else if (argument === '--task-id') taskId = next();
    else if (argument === '--help' || argument === '-h') {
      return { help: true };
    } else {
      throw new HarnessBlocked('HARNESS_ARGUMENT_INVALID', `unknown option: ${argument}`);
    }
  }
  if (typeof opencodePath !== 'string' || !opencodePath.trim()) {
    throw new HarnessBlocked(
      'BLOCKED_OPENCODE_NOT_INSTALLED',
      'no OpenCode executable configured: pass --opencode <ABSOLUTE_PATH> or set GREENHUB_OPENCODE_CLI_PATH',
    );
  }
  if (typeof model !== 'string' || !model.trim()) {
    throw new HarnessBlocked(
      'BLOCKED_OPENCODE_NOT_INSTALLED',
      'no model configured: pass --model <PROVIDER/MODEL> or set GREENHUB_OPENCODE_MODEL',
    );
  }
  if (!existsSync(opencodePath)) {
    throw new HarnessBlocked(
      'BLOCKED_OPENCODE_NOT_INSTALLED',
      `OpenCode executable does not exist: ${opencodePath}`,
    );
  }
  if (typeof relayRepository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(relayRepository)) {
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
  return { help: false, opencodePath, model, workdir, relayRepository, taskId };
}

function renderUsage() {
  return [
    'usage:',
    '  node scripts/coordination/real-control-tower-relay-roundtrip.mjs',
    '    --opencode <ABSOLUTE_PATH> --model <PROVIDER/MODEL> [--workdir <ABSOLUTE_PATH>]',
    '    [--relay-repo <OWNER/NAME>] [--task-id <TASK_ID>]',
    '',
    'requires a real OpenCode installation, valid credentials, an authenticated gh CLI, and network access.',
    'always prints ONE JSON report to stdout.',
    '',
  ].join('\n');
}

function assertGhAvailable() {
  try {
    const version = execFileSync('gh', ['--version'], { encoding: 'utf8' }).trim();
    const auth = execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { version, authenticated: true, auth: auth.trim().split('\n')[0] ?? '' };
  } catch (error) {
    throw new HarnessBlocked(
      'BLOCKED_GITHUB_UNAVAILABLE',
      `gh CLI is unavailable or unauthenticated (${String(error?.message ?? error)})`,
    );
  }
}

const report = {
  harness: 'real-control-tower-relay-roundtrip',
  status: null,
  opencode: null,
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
  report.gh = assertGhAvailable();
  report.relayRepository = options.relayRepository;
  report.opencode = {
    executablePath: options.opencodePath,
    model: options.model,
    workdir: options.workdir,
    version: execFileSync(options.opencodePath, ['--version'], { encoding: 'utf8' }).trim(),
  };

  const taskId =
    options.taskId ??
    `GF08-REALPROBE-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new HarnessBlocked('HARNESS_ARGUMENT_INVALID', `derived task id is invalid: ${taskId}`);
  }

  const home = mkdtempSync(join(tmpdir(), 'greenhub-gf08-real-proof-'));
  report.isolatedCoordinationHome = home;
  const store = new CoordinationStore({ dir: home });

  let processInvocations = 0;
  const adapter = createOpenCodeCliStructuredResultExecutor({
    executablePath: options.opencodePath,
    workdir: options.workdir,
    model: options.model,
  });
  const instrumentedExecutor = async (task28Record) => {
    processInvocations += 1;
    return adapter(task28Record);
  };

  report.repositoryBefore = captureRepositoryState();

  // --- 1. synthetic user-approved READ_ONLY task intake ---------------------
  const intake = store.intakeUserApprovedReadOnlyTask({
    userApproved: true,
    approval: {
      approvedBy: 'gf08-real-proof',
      approvalRef: 'gf08:real-control-tower-relay-roundtrip',
    },
    taskSpec: sampleProbeTaskInput(taskId),
    recorderId: 'gf08-real-proof-harness',
  });
  assert.equal(store.readTask(taskId).status, 'READY');

  // --- 2/3/4/5. real OpenCode execution -> RESULT_DELIVERED -> GF-07 intake
  //     -> GF-08 automatic shared relay (configured transport, no injection) --
  const runEnv = {
    ...process.env,
    GREENHUB_COORDINATION_HOME: home,
    GREENHUB_CONTROL_TOWER_RELAY_REPO: options.relayRepository,
  };
  const stdoutRun = captureStream();
  const stderrRun = captureStream();
  const exitRun = await runOperatorCli({
    argv: ['run', taskId, '--json'],
    env: runEnv,
    store,
    executor: instrumentedExecutor,
    stdout: stdoutRun,
    stderr: stderrRun,
  });
  assert.equal(stderrRun.text, '', `operator run stderr must be empty: ${stderrRun.text}`);
  assert.equal(exitRun, 0, 'operator run must exit 0');
  const runProjection = JSON.parse(stdoutRun.text);
  assert.equal(runProjection.outcome, 'EXECUTED');
  assert.equal(runProjection.executorInvocations, 1);
  assert.equal(processInvocations, 1, 'exactly one real OpenCode process');
  assert.equal(runProjection.taskStatus, 'RESULT_DELIVERED');
  assert.notEqual(runProjection.controlTowerIntake, null);
  assert.equal(runProjection.controlTowerIntake.newlyIntaken, true);
  assert.equal(runProjection.controlTowerIntake.dispositionState, DISPOSITION_STATE_PENDING);
  assert.equal(runProjection.controlTowerIntake.dispositionRef, `${taskId}@1`);
  assert.notEqual(runProjection.controlTowerRelay, null);
  assert.equal(runProjection.controlTowerRelay.status, CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED);
  assert.equal(runProjection.controlTowerRelay.failureCode, null);
  assert.ok(Number.isInteger(runProjection.controlTowerRelay.issueNumber));
  assert.ok(Number.isInteger(runProjection.controlTowerRelay.commentId));

  const canonicalResult = store.readResult(taskId);
  const canonicalBinding = computeResultBinding(canonicalResult);
  const disposition = store.readCurrentDisposition(taskId);
  assert.equal(disposition.state, DISPOSITION_STATE_PENDING);
  assert.equal(disposition.dispositionGeneration, 1);
  assert.equal(disposition.resultId, canonicalResult.resultId);
  assert.equal(disposition.resultBinding, canonicalBinding);

  // --- 6/7. GitHub API read-back through an independent transport instance ---
  const readBackTransport = createGitHubIssueCommentRelayTransport({
    repository: options.relayRepository,
  });
  const comment = await readBackTransport.readProjection({
    commentId: runProjection.controlTowerRelay.commentId,
  });
  assert.notEqual(comment.body, null, 'the relay comment must be readable through the GitHub API');
  const expectedMarker = `<!-- greenhub-control-tower-relay:v1:${taskId}:${canonicalResult.resultId} -->`;
  assert.ok(comment.body.includes(expectedMarker), 'read-back must carry the deterministic marker');
  const readBackDocument = parseControlTowerResultRelayProjection(comment.body);
  assert.notEqual(readBackDocument, null, 'read-back must carry a valid relay document');
  assert.equal(readBackDocument.taskId, taskId);
  assert.equal(readBackDocument.resultId, canonicalResult.resultId);
  assert.equal(readBackDocument.resultBinding, canonicalBinding);
  assert.equal(readBackDocument.dispositionRef, `${taskId}@1`);
  assert.equal(readBackDocument.dispositionState, DISPOSITION_STATE_PENDING);
  assert.equal(readBackDocument.resultStatus, canonicalResult.status);
  assert.equal(readBackDocument.summary, canonicalResult.summary);
  assert.deepEqual(readBackDocument.proofRefs, canonicalResult.proofRefs);
  assert.deepEqual(readBackDocument.evidenceRefs, canonicalResult.evidenceRefs);
  assert.deepEqual(readBackDocument.frictionObserved, canonicalResult.frictionObserved);
  assert.equal(readBackDocument.deliveredAt, canonicalResult.deliveredAt);
  assert.equal(readBackDocument.canonicalAuthorityId, intake.record.intakeId);
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && /^gh[opusr]_[A-Za-z0-9]{16,}$/.test(value)) {
      assert.equal(comment.body.includes(value), false, `relay body must never leak ${name}`);
    }
  }

  // --- 9/10. replay: zero OpenCode invocations, zero new semantic artifacts --
  const homeBeforeReplay = snapshotHome(home);
  const sequenceBeforeReplay = JSON.stringify(store.readTaskSequence());
  const stdoutReplay = captureStream();
  const stderrReplay = captureStream();
  const exitReplay = await runOperatorCli({
    argv: ['run', taskId, '--json'],
    env: runEnv,
    store,
    executor: instrumentedExecutor,
    stdout: stdoutReplay,
    stderr: stderrReplay,
  });
  assert.equal(stderrReplay.text, '', `operator replay stderr must be empty: ${stderrReplay.text}`);
  assert.equal(exitReplay, 0);
  const replayProjection = JSON.parse(stdoutReplay.text);
  assert.equal(replayProjection.outcome, 'ALREADY_TERMINAL');
  assert.equal(replayProjection.executorInvocations, 0);
  assert.equal(processInvocations, 1, 'replay must not invoke OpenCode again');
  assert.equal(
    replayProjection.controlTowerRelay.status,
    CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY,
  );
  assert.equal(replayProjection.controlTowerRelay.commentId, runProjection.controlTowerRelay.commentId);
  assert.deepEqual(snapshotHome(home), homeBeforeReplay, 'replay writes zero durable bytes');
  assert.equal(JSON.stringify(store.readTaskSequence()), sequenceBeforeReplay);
  assert.deepEqual(
    readdirSync(join(home, 'tasks', taskId, 'disposition', 'generations')).sort(),
    ['1.json'],
    'no new disposition generation',
  );

  // --- literal `coordination:relay` process path: no executor configuration --
  const spawnedRelay = await runChildProcess(['relay', taskId, '--json'], {
    ...process.env,
    GREENHUB_COORDINATION_HOME: home,
    GREENHUB_CONTROL_TOWER_RELAY_REPO: options.relayRepository,
  });
  assert.equal(spawnedRelay.code, 0, `spawned relay stderr: ${spawnedRelay.stderr}`);
  const spawnedRelayProjection = JSON.parse(spawnedRelay.stdout);
  assert.equal(
    spawnedRelayProjection.status,
    CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY,
  );
  assert.equal(spawnedRelayProjection.comment.commentId, runProjection.controlTowerRelay.commentId);
  assert.equal(processInvocations, 1, 'the literal relay path never invokes OpenCode');
  assert.deepEqual(snapshotHome(home), homeBeforeReplay, 'literal relay replay writes zero bytes');

  report.cycle = {
    taskId,
    intakeId: intake.record.intakeId,
    dispatchId: runProjection.dispatchId,
    canonicalResultId: canonicalResult.resultId,
    canonicalResultBinding: canonicalBinding,
    resultStatus: canonicalResult.status,
    dispositionRef: `${taskId}@1`,
    dispositionState: disposition.state,
    relayStatus: runProjection.controlTowerRelay.status,
    relayIssueNumber: runProjection.controlTowerRelay.issueNumber,
    relayCommentId: runProjection.controlTowerRelay.commentId,
    readBackMarkerMatches: true,
    readBackResultIdMatches: true,
    readBackResultBindingMatches: true,
    manualCopyPasteRequired: false,
    replayOutcome: replayProjection.outcome,
    replayExecutorInvocations: replayProjection.executorInvocations,
    replayRelayStatus: replayProjection.controlTowerRelay.status,
    spawnedRelayStatus: spawnedRelayProjection.status,
    totalRealOpenCodeInvocations: processInvocations,
  };

  report.realOpenCodeInvocations = processInvocations;
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
    'the READ_ONLY OpenCode probe must not change repository or remote state',
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
