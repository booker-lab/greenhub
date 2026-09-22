// Canonical owner: docs/specs/ops/development-authority.md sections 2, 3, 6, 8
// (opt-in isolated workspace, dimensional freshness, outcome-relative
// publication, thin stateless runner).
//
// One caller-supplied bounded task, one foreground process, one exit.
// Stateless by construction: no durable task state, no result store, no
// background process, no task selection. The live remote is re-read at start;
// mutation scope is observed from Git after the child exits; everything the
// runner creates is removed before exit.
//
// Never invoked here: publication, PR/merge, deployment, git push, canonical
// checkout switching, and reset/restore/stash/clean of foreign state. See the
// module contract in AGENTS.md and docs/specs/ops/development-authority.md.
//
// Optional in-process handoff: `runOnce(options, { successFinalizer })` calls
// the caller-owned finalizer exactly once, only after a Git-verified SUCCESS,
// while the task-owned workspace is still alive. The local-only CLI never
// provides one, so its behavior is unchanged. The finalizer result is attached
// as `result.successHandoff`; the workspace is still cleaned up afterwards.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureCheckoutState, isCheckoutUnchanged } from '../git/publication-transport.mjs';

export const SUCCESS = 'SUCCESS';
export const ALREADY_SATISFIED = 'ALREADY_SATISFIED';
export const PROOF_FAILED = 'PROOF_FAILED';
export const BOUNDARY_VIOLATION = 'BOUNDARY_VIOLATION';
export const EXECUTOR_FAILED = 'EXECUTOR_FAILED';
export const BASELINE_OBSERVATION_FAILED = 'BASELINE_OBSERVATION_FAILED';
export const CLEANUP_FAILED = 'CLEANUP_FAILED';
export const INVALID_INPUT = 'INVALID_INPUT';

export const RUN_ONCE_STATUSES = Object.freeze([
  SUCCESS,
  ALREADY_SATISFIED,
  PROOF_FAILED,
  BOUNDARY_VIOLATION,
  EXECUTOR_FAILED,
  BASELINE_OBSERVATION_FAILED,
  CLEANUP_FAILED,
  INVALID_INPUT,
]);

export const TASK_TEXT_MAX_CHARS = 30000;
export const DEFAULT_OPENCODE_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_PROOF_TIMEOUT_MS = 30 * 60 * 1000;
export const OUTPUT_TAIL_CHARS = 4000;

// Credential-shaped environment names that must not reach the OpenCode child.
// Operational publication/provider credentials are dropped here; model provider
// authentication is expected to come from the existing OpenCode auth store.
const DENIED_ENV_NAME_PATTERNS = Object.freeze([
  /^GH_/i,
  /^GITHUB/i,
  /^VERCEL/i,
  /^RAILWAY/i,
  /^FIREBASE/i,
  /^GCLOUD/i,
  /^GOOGLE_APPLICATION_CREDENTIALS$/i,
  /^ALIGO/i,
  /^PORTONE/i,
  /^TOSS/i,
  /^AWS/i,
  /^AZURE/i,
  /SECRET/i,
  /PASSWORD/i,
  /PASSWD/i,
  /PRIVATE_KEY/i,
  /^SSH_AUTH/i,
  /^SSH_AGENT/i,
  /^GIT_ASKPASS$/i,
  /^GIT_SSH/i,
  /^OPENCODE$/i,
  /^OPENCODE_PID$/i,
  /^NPM_TOKEN$/i,
  /^NODE_AUTH_TOKEN$/i,
]);

// Runner-authored Git hardening for the child process. Network transports fail
// closed, credential helpers and hooks are disabled, and `git push` defaults to
// nothing so the child cannot publish even if it ignores its instructions.
export const CHILD_GIT_SAFETY_ENV = Object.freeze({
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'greenhub-run-once-no-askpass',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '5',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: '',
  GIT_CONFIG_KEY_1: 'protocol.allow',
  GIT_CONFIG_VALUE_1: 'never',
  GIT_CONFIG_KEY_2: 'protocol.file.allow',
  GIT_CONFIG_VALUE_2: 'never',
  GIT_CONFIG_KEY_3: 'push.default',
  GIT_CONFIG_VALUE_3: 'nothing',
  GIT_CONFIG_KEY_4: 'core.hooksPath',
  GIT_CONFIG_VALUE_4: 'greenhub-run-once-no-hooks-directory',
});

export function normalizeRepoPath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

export function isPathAllowed(changedPath, allowedPaths) {
  const target = normalizeRepoPath(changedPath);
  if (target.length === 0) return false;
  return allowedPaths.some((allowed) => {
    const base = normalizeRepoPath(allowed);
    return base.length > 0 && (target === base || target.startsWith(`${base}/`));
  });
}

export function classifyChangedPaths({ changedPaths, allowedPaths }) {
  const withinBoundary = [];
  const violations = [];
  for (const changedPath of changedPaths) {
    if (isPathAllowed(changedPath, allowedPaths)) withinBoundary.push(changedPath);
    else violations.push(changedPath);
  }
  return { withinBoundary, violations };
}

export function isDeniedEnvName(name) {
  return DENIED_ENV_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

export function buildChildEnv({ baseEnv, scratchDir }) {
  const childEnv = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (isDeniedEnvName(name)) continue;
    if (/^GIT_CONFIG_/i.test(name)) continue;
    childEnv[name] = value;
  }
  Object.assign(childEnv, CHILD_GIT_SAFETY_ENV);
  // Point the GitHub CLI at an empty runner-owned directory so stored
  // publication credentials in the operator profile are not picked up.
  childEnv.GH_CONFIG_DIR = join(scratchDir, 'opencode-child-gh-config');
  return childEnv;
}

export function buildTaskPrompt({ taskText, allowedPaths }) {
  const contract = String(taskText).trim();
  return [
    'Execute exactly one bounded task in this isolated Git workspace.',
    'The current directory is a temporary detached worktree created from the live baseline; it is not the shared checkout.',
    '',
    '## Task contract',
    contract,
    '',
    '## Execution boundary',
    `- Allowed paths (create, modify, or delete only these): ${allowedPaths.join(', ')}`,
    '- Do not change Git remotes or Git configuration.',
    '- Do not run git push, create pull requests, merge, or deploy.',
    '- Do not modify secrets or environment configuration.',
    '- Stop when the task contract is satisfied.',
  ].join('\n');
}

export function buildOpencodeArgs({
  taskText,
  workspacePath,
  model = null,
  agent = null,
  title = null,
}) {
  const args = ['run', '--format', 'json', '--dir', workspacePath, '--auto'];
  if (model) args.push('--model', model);
  if (agent) args.push('--agent', agent);
  if (title) args.push('--title', title);
  args.push(taskText);
  return args;
}

export function findOnPath({ fileName, baseEnv, platform, exists = existsSync }) {
  const rawPath = baseEnv.PATH ?? baseEnv.Path ?? '';
  const separator = platform === 'win32' ? ';' : ':';
  for (const directory of rawPath.split(separator)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, fileName);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function extractWindowsShimTarget({
  shimPath,
  exists = existsSync,
  readFile = readFileSync,
}) {
  let text;
  try {
    text = readFile(shimPath, 'utf8');
  } catch {
    return null;
  }
  const shimDirectory = dirname(shimPath);
  const tokens = [];
  const pattern = /"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"'=]+)/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    const candidate = raw.replace(/%~?dp0%?/gi, shimDirectory);
    if (candidate.includes('\\') || candidate.includes('/')) tokens.push(candidate);
    match = pattern.exec(text);
  }
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (/\.(exe|com)$/i.test(token) && exists(token)) return { command: token, prefixArgs: [] };
    if (/\.(js|mjs|cjs)$/i.test(token) && exists(token)) {
      return { command: process.execPath, prefixArgs: [token] };
    }
  }
  return null;
}

export function resolveOpencodeCommand({
  explicitBin = null,
  baseEnv = process.env,
  platform = process.platform,
  exists = existsSync,
  readFile = readFileSync,
} = {}) {
  if (typeof explicitBin === 'string' && explicitBin.length > 0) {
    if (!exists(explicitBin)) throw new Error(`--opencode-bin does not exist: ${explicitBin}`);
    return { command: explicitBin, prefixArgs: [], source: 'explicit' };
  }
  if (typeof baseEnv.OPENCODE_BIN === 'string' && baseEnv.OPENCODE_BIN.length > 0) {
    if (!exists(baseEnv.OPENCODE_BIN)) {
      throw new Error(`OPENCODE_BIN does not exist: ${baseEnv.OPENCODE_BIN}`);
    }
    return { command: baseEnv.OPENCODE_BIN, prefixArgs: [], source: 'environment' };
  }
  if (platform === 'win32') {
    const executable = findOnPath({ fileName: 'opencode.exe', baseEnv, platform, exists });
    if (executable) return { command: executable, prefixArgs: [], source: 'path-exe' };
    const shim =
      findOnPath({ fileName: 'opencode.cmd', baseEnv, platform, exists }) ??
      findOnPath({ fileName: 'opencode.bat', baseEnv, platform, exists });
    if (shim) {
      const target = extractWindowsShimTarget({ shimPath: shim, exists, readFile });
      if (target) return { ...target, source: 'windows-shim' };
      throw new Error(
        `could not resolve the OpenCode executable from ${shim}; pass --opencode-bin explicitly`,
      );
    }
  }
  return { command: 'opencode', prefixArgs: [], source: 'path' };
}

function messageOf(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

function gitMessageOf(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  if (stderr.length > 0) return stderr;
  return messageOf(error);
}

export function gitCapture(cwd, args, { allowFailure = false } = {}) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, stdout, error: null };
  } catch (error) {
    if (!allowFailure) throw error;
    return { ok: false, stdout: typeof error?.stdout === 'string' ? error.stdout : '', error };
  }
}

export function revParse(cwd, ref) {
  return gitCapture(cwd, ['rev-parse', ref]).stdout.trim();
}

function splitNul(value) {
  return value.split('\0').filter((entry) => entry.length > 0);
}

function tail(value, limit = OUTPUT_TAIL_CHARS) {
  const text = typeof value === 'string' ? value : '';
  return text.length <= limit ? text : text.slice(text.length - limit);
}

export function readLiveRemoteMain({ repositoryRoot, remote = 'origin' }) {
  const stdout = execFileSync('git', ['ls-remote', '--exit-code', remote, 'refs/heads/main'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
  const line = stdout.split('\n').find((entry) => entry.trim().length > 0);
  const sha = line?.split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(
      `live remote main is not an exact commit SHA on ${remote}: ${JSON.stringify(stdout)}`,
    );
  }
  return sha;
}

export function fetchBaseline({ repositoryRoot, remote = 'origin' }) {
  execFileSync('git', ['fetch', '--no-tags', '--quiet', remote, 'main'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  return revParse(repositoryRoot, 'FETCH_HEAD');
}

export function createBaselineWorkspace({ repositoryRoot, tempRoot, baselineSha }) {
  const workspacePath = join(tempRoot, 'workspace');
  const noHooksDirectory = join(tempRoot, 'no-hooks');
  execFileSync(
    'git',
    [
      '-c',
      `core.hooksPath=${noHooksDirectory}`,
      'worktree',
      'add',
      '--detach',
      workspacePath,
      baselineSha,
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const porcelain = gitCapture(workspacePath, ['status', '--porcelain=v1']).stdout.trim();
  if (porcelain.length > 0) {
    throw new Error(`baseline workspace is not clean after checkout: ${porcelain}`);
  }
  return workspacePath;
}

export function observeChangedPaths({ workspacePath, baselineSha }) {
  const tracked = splitNul(
    gitCapture(workspacePath, ['diff', '--name-only', '--no-renames', '-z', baselineSha]).stdout,
  );
  const untracked = splitNul(
    gitCapture(workspacePath, ['ls-files', '--others', '--exclude-standard', '-z']).stdout,
  );
  const changedPaths = [
    ...new Set(
      [...tracked, ...untracked].map(normalizeRepoPath).filter((entry) => entry.length > 0),
    ),
  ].sort();
  return { changedPaths, workspaceHead: revParse(workspacePath, 'HEAD') };
}

export function defaultInvokeOpencode({ resolvedCommand, args, cwd, env, timeoutMs }) {
  const result = spawnSync(resolvedCommand.command, [...resolvedCommand.prefixArgs, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
    windowsHide: true,
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : null,
    signal: result.signal ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    startErrorCode: result.error && result.error.code !== 'ETIMEDOUT' ? result.error.code : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function defaultRunProofCommand({ command, cwd, env, timeoutMs }) {
  const result = spawnSync(command, {
    cwd,
    env,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
    windowsHide: true,
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : null,
    signal: result.signal ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    startErrorCode: result.error && result.error.code !== 'ETIMEDOUT' ? result.error.code : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function defaultRemoveWorkspace({ repositoryRoot, tempRoot, workspacePath }) {
  const errors = [];
  if (existsSync(workspacePath)) {
    const removal = gitCapture(repositoryRoot, ['worktree', 'remove', '--force', workspacePath], {
      allowFailure: true,
    });
    if (!removal.ok) {
      errors.push(`git worktree remove failed: ${gitMessageOf(removal.error)}`);
      try {
        rmSync(workspacePath, { recursive: true, force: true });
      } catch (error) {
        errors.push(`workspace removal failed: ${messageOf(error)}`);
      }
      gitCapture(repositoryRoot, ['worktree', 'prune'], { allowFailure: true });
    }
  }
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch (error) {
    errors.push(`temporary run directory removal failed: ${messageOf(error)}`);
  }
  if (existsSync(tempRoot)) errors.push(`temporary run directory still exists: ${tempRoot}`);
  return { removed: errors.length === 0, errors };
}

function createResult(options = {}) {
  return {
    status: null,
    reason: null,
    task: {
      title: options.title ?? null,
      allowedPaths: Array.isArray(options.allowedPaths) ? [...options.allowedPaths] : [],
      proofCommands: Array.isArray(options.proofCommands) ? [...options.proofCommands] : [],
    },
    baseline: {
      remote: options.remote ?? 'origin',
      liveMainAtStart: null,
      baselineSha: null,
      baselineMatchesLiveMainAtStart: null,
      error: null,
    },
    liveMainAtEnd: null,
    liveMainAtEndError: null,
    baselineMovement: 'UNKNOWN',
    changedPaths: [],
    boundary: {
      allowedPaths: Array.isArray(options.allowedPaths) ? [...options.allowedPaths] : [],
      withinBoundary: [],
      violations: [],
      error: null,
    },
    executor: {
      invoked: false,
      commandSource: null,
      exitCode: null,
      signal: null,
      timedOut: false,
      startErrorCode: null,
      stdoutBytes: 0,
      stdoutTail: '',
      stderrTail: '',
    },
    proofResults: [],
    workspace: {
      created: false,
      path: null,
      headSha: null,
      cleanup: 'NOT_CREATED',
      cleanupErrors: [],
    },
    canonicalCheckout: {
      before: null,
      after: null,
      unchanged: null,
    },
    successHandoff: null,
  };
}

function validateRunOnceInput(options) {
  if (options == null || typeof options !== 'object') return 'runner options are required';
  if (typeof options.repositoryRoot !== 'string' || options.repositoryRoot.length === 0) {
    return '--repo is required';
  }
  if (!Array.isArray(options.allowedPaths) || options.allowedPaths.length === 0) {
    return 'at least one --allow path is required';
  }
  if (
    options.allowedPaths.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)
  ) {
    return '--allow paths must be non-empty strings';
  }
  if (typeof options.taskText !== 'string' || options.taskText.trim().length === 0) {
    return 'task text is required';
  }
  if (
    options.proofCommands != null &&
    (!Array.isArray(options.proofCommands) ||
      options.proofCommands.some((entry) => typeof entry !== 'string' || entry.trim().length === 0))
  ) {
    return '--proof commands must be non-empty strings';
  }
  for (const numeric of ['opencodeTimeoutMs', 'proofTimeoutMs']) {
    const value = options[numeric];
    if (value != null && (!Number.isFinite(value) || value < 0)) return `${numeric} must be >= 0`;
  }
  return null;
}

/**
 * Execute one bounded task. Returns a deterministic summary object.
 * `deps` is a narrow seam for deterministic tests: invokeOpencode,
 * runProofCommand, removeWorkspace, log, env, successFinalizer.
 */
export function runOnce(options, deps = {}) {
  const invokeOpencode = deps.invokeOpencode ?? defaultInvokeOpencode;
  const runProofCommand = deps.runProofCommand ?? defaultRunProofCommand;
  const removeWorkspace = deps.removeWorkspace ?? defaultRemoveWorkspace;
  const successFinalizer = deps.successFinalizer ?? null;
  const log = deps.log ?? ((message) => process.stderr.write(`${message}\n`));
  const baseEnv = deps.env ?? process.env;

  const result = createResult(options);
  const invalidReason = validateRunOnceInput(options);
  if (invalidReason) {
    result.status = INVALID_INPUT;
    result.reason = invalidReason;
    return result;
  }

  const repositoryRoot = resolve(options.repositoryRoot);
  const remote = options.remote ?? 'origin';
  const allowedPaths = [...options.allowedPaths];
  const proofCommands = [...(options.proofCommands ?? [])];
  const opencodeTimeoutMs = options.opencodeTimeoutMs ?? DEFAULT_OPENCODE_TIMEOUT_MS;
  const proofTimeoutMs = options.proofTimeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS;

  const prompt = buildTaskPrompt({ taskText: options.taskText, allowedPaths });
  if (prompt.length > TASK_TEXT_MAX_CHARS) {
    result.status = INVALID_INPUT;
    result.reason = `task text is too long (${prompt.length} > ${TASK_TEXT_MAX_CHARS} characters)`;
    return result;
  }

  if (!existsSync(repositoryRoot)) {
    result.status = BASELINE_OBSERVATION_FAILED;
    result.reason = `repository root does not exist: ${repositoryRoot}`;
    return result;
  }

  let status = null;
  let reason = null;
  const fail = (nextStatus, nextReason) => {
    status = nextStatus;
    reason = nextReason;
  };

  let canonicalBeforeState = null;
  let tempRoot = null;
  let workspacePath = null;

  try {
    canonicalBeforeState = captureCheckoutState({ repositoryRoot });
    result.canonicalCheckout.before = {
      branch: canonicalBeforeState.branch,
      head: canonicalBeforeState.head,
    };
  } catch (error) {
    fail(BASELINE_OBSERVATION_FAILED, `canonical checkout observation failed: ${messageOf(error)}`);
  }

  if (status === null) {
    try {
      result.baseline.liveMainAtStart = readLiveRemoteMain({ repositoryRoot, remote });
    } catch (error) {
      result.baseline.error = messageOf(error);
      fail(BASELINE_OBSERVATION_FAILED, `live remote observation failed: ${messageOf(error)}`);
    }
  }

  if (status === null) {
    try {
      result.baseline.baselineSha = fetchBaseline({ repositoryRoot, remote });
      result.baseline.baselineMatchesLiveMainAtStart =
        result.baseline.baselineSha === result.baseline.liveMainAtStart;
      if (!result.baseline.baselineMatchesLiveMainAtStart) {
        log(
          `[run-once] live main moved during baseline fetch: observed ${result.baseline.liveMainAtStart}, fetched ${result.baseline.baselineSha}`,
        );
      }
    } catch (error) {
      result.baseline.error = messageOf(error);
      fail(BASELINE_OBSERVATION_FAILED, `baseline fetch failed: ${messageOf(error)}`);
    }
  }

  if (status === null) {
    try {
      tempRoot = mkdtempSync(join(tmpdir(), 'greenhub-run-once-'));
      workspacePath = createBaselineWorkspace({
        repositoryRoot,
        tempRoot,
        baselineSha: result.baseline.baselineSha,
      });
      result.workspace.created = true;
      result.workspace.path = workspacePath;
      result.workspace.headSha = revParse(workspacePath, 'HEAD');
    } catch (error) {
      fail(BASELINE_OBSERVATION_FAILED, `baseline workspace creation failed: ${messageOf(error)}`);
    }
  }

  let execution = null;
  if (status === null) {
    try {
      const resolvedCommand = resolveOpencodeCommand({
        explicitBin: options.opencodeBin ?? null,
        baseEnv,
      });
      result.executor.commandSource = resolvedCommand.source;
      const args = buildOpencodeArgs({
        taskText: prompt,
        workspacePath,
        model: options.model ?? null,
        agent: options.agent ?? null,
        title: options.title ?? null,
      });
      const childEnv = buildChildEnv({ baseEnv, scratchDir: tempRoot });
      result.executor.invoked = true;
      log(`[run-once] opencode start (${resolvedCommand.source}) in ${workspacePath}`);
      execution = invokeOpencode({
        resolvedCommand,
        args,
        cwd: workspacePath,
        env: childEnv,
        timeoutMs: opencodeTimeoutMs,
      });
      result.executor.exitCode = execution.exitCode ?? null;
      result.executor.signal = execution.signal ?? null;
      result.executor.timedOut = Boolean(execution.timedOut);
      result.executor.startErrorCode = execution.startErrorCode ?? null;
      result.executor.stdoutBytes = Buffer.byteLength(execution.stdout ?? '', 'utf8');
      result.executor.stdoutTail = tail(execution.stdout);
      result.executor.stderrTail = tail(execution.stderr);
      log(
        `[run-once] opencode exit=${result.executor.exitCode} timedOut=${result.executor.timedOut} stdoutBytes=${result.executor.stdoutBytes}`,
      );
      if (execution.stderr) log(`[run-once] opencode stderr:\n${tail(execution.stderr, 6000)}`);
    } catch (error) {
      result.executor.invoked = true;
      result.executor.startErrorCode = error?.code ?? null;
      fail(EXECUTOR_FAILED, `opencode invocation failed: ${messageOf(error)}`);
    }
  }

  if (result.workspace.created) {
    try {
      const observation = observeChangedPaths({
        workspacePath,
        baselineSha: result.baseline.baselineSha,
      });
      result.changedPaths = observation.changedPaths;
      result.workspace.headSha = observation.workspaceHead;
      const classification = classifyChangedPaths({
        changedPaths: observation.changedPaths,
        allowedPaths,
      });
      result.boundary.withinBoundary = classification.withinBoundary;
      result.boundary.violations = classification.violations;
    } catch (error) {
      result.boundary.error = messageOf(error);
      if (status === null) {
        fail(
          BASELINE_OBSERVATION_FAILED,
          `mutation boundary observation failed: ${messageOf(error)}`,
        );
      }
    }
  }

  if (status === null) {
    if (execution === null) {
      fail(EXECUTOR_FAILED, 'opencode invocation did not run');
    } else if (execution.startErrorCode || execution.timedOut || execution.exitCode !== 0) {
      fail(
        EXECUTOR_FAILED,
        `opencode did not complete successfully (exit=${execution.exitCode}, timedOut=${Boolean(
          execution.timedOut,
        )}, startError=${execution.startErrorCode ?? 'none'})`,
      );
    } else if (result.boundary.error !== null) {
      fail(
        BASELINE_OBSERVATION_FAILED,
        `mutation boundary observation failed: ${result.boundary.error}`,
      );
    } else if (result.boundary.violations.length > 0) {
      fail(
        BOUNDARY_VIOLATION,
        `changes outside the allowed paths were observed: ${result.boundary.violations.join(', ')}`,
      );
    }
  }

  if (status === null) {
    for (const command of proofCommands) {
      let proof;
      try {
        proof = runProofCommand({
          command,
          cwd: workspacePath,
          env: baseEnv,
          timeoutMs: proofTimeoutMs,
        });
      } catch (error) {
        proof = {
          exitCode: null,
          signal: null,
          timedOut: false,
          startErrorCode: error?.code ?? null,
          stdout: '',
          stderr: messageOf(error),
        };
      }
      const entry = {
        command,
        exitCode: proof.exitCode ?? null,
        signal: proof.signal ?? null,
        timedOut: Boolean(proof.timedOut),
        startErrorCode: proof.startErrorCode ?? null,
        ok: proof.exitCode === 0 && !proof.startErrorCode,
        stdoutTail: tail(proof.stdout),
        stderrTail: tail(proof.stderr),
      };
      result.proofResults.push(entry);
      log(`[run-once] proof "${command}" exit=${entry.exitCode} ok=${entry.ok}`);
      if (proof.stderr) log(`[run-once] proof stderr:\n${tail(proof.stderr, 6000)}`);
    }
    const failedProof = result.proofResults.find((entry) => !entry.ok);
    if (failedProof) {
      fail(PROOF_FAILED, `proof command did not pass: ${failedProof.command}`);
    } else if (result.changedPaths.length === 0) {
      fail(ALREADY_SATISFIED, 'no repository changes were produced and all proofs passed');
    } else {
      fail(
        SUCCESS,
        `${result.changedPaths.length} changed path(s) inside the allowed boundary and all proofs passed`,
      );
    }
  }

  try {
    result.liveMainAtEnd = readLiveRemoteMain({ repositoryRoot, remote });
  } catch (error) {
    result.liveMainAtEndError = messageOf(error);
  }
  if (result.baseline.liveMainAtStart && result.liveMainAtEnd) {
    result.baselineMovement =
      result.baseline.liveMainAtStart === result.liveMainAtEnd ? 'UNCHANGED' : 'MOVED';
  }

  try {
    const after = captureCheckoutState({ repositoryRoot });
    result.canonicalCheckout.after = { branch: after.branch, head: after.head };
    result.canonicalCheckout.unchanged =
      canonicalBeforeState === null ? null : isCheckoutUnchanged(canonicalBeforeState, after);
  } catch (error) {
    result.canonicalCheckout.unchanged = null;
    log(`[run-once] canonical checkout re-observation failed: ${messageOf(error)}`);
  }
  if (
    result.canonicalCheckout.unchanged === false &&
    (status === null || status === SUCCESS || status === ALREADY_SATISFIED)
  ) {
    fail(EXECUTOR_FAILED, 'canonical checkout state changed during the run');
  }

  if (status === SUCCESS && typeof successFinalizer === 'function') {
    try {
      const output = successFinalizer({
        repositoryRoot,
        remote,
        baselineSha: result.baseline.baselineSha,
        workspacePath,
        tempRoot,
        changedPaths: [...result.changedPaths],
        proofResults: [...result.proofResults],
        log,
      });
      result.successHandoff = { invoked: true, error: null, output: output ?? null };
    } catch (error) {
      result.successHandoff = { invoked: true, error: messageOf(error), output: null };
      log(`[run-once] success finalizer failed: ${messageOf(error)}`);
    }
  }

  if (tempRoot !== null) {
    try {
      const removal = removeWorkspace({ repositoryRoot, tempRoot, workspacePath });
      result.workspace.cleanup = removal.removed ? 'REMOVED' : 'FAILED';
      result.workspace.cleanupErrors = Array.isArray(removal.errors) ? removal.errors : [];
    } catch (error) {
      result.workspace.cleanup = 'FAILED';
      result.workspace.cleanupErrors = [messageOf(error)];
    }
    if (
      result.workspace.cleanup === 'FAILED' &&
      (status === null || status === SUCCESS || status === ALREADY_SATISFIED)
    ) {
      fail(
        CLEANUP_FAILED,
        `task-owned workspace cleanup failed: ${result.workspace.cleanupErrors.join('; ')}`,
      );
    }
    if (result.workspace.cleanup === 'FAILED') {
      log(`[run-once] cleanup failed: ${result.workspace.cleanupErrors.join('; ')}`);
    }
  }

  result.status = status ?? EXECUTOR_FAILED;
  result.reason = reason ?? 'runner did not reach a decision';
  return result;
}

export const USAGE = [
  'usage: node scripts/agent/run-once.mjs --task <file> --allow <path>... [--proof <command>...]',
  '',
  '  --task <file>               bounded task contract file (OUTCOME/PRESERVE/PROOF/ESCALATE ONLY IF)',
  '  --allow <path>              repo-relative path the task may mutate (repeatable, required)',
  '  --proof <command>           focused proof command, run in order in the workspace (repeatable)',
  '  --title <title>             optional OpenCode session title',
  '  --model <provider/model>    optional OpenCode model override',
  '  --agent <name>              optional OpenCode agent override',
  '  --opencode-bin <path>       explicit OpenCode executable (default: resolved from PATH)',
  '  --repo <dir>                canonical checkout root (default: current directory)',
  '  --remote <name>             publication remote observed for the live baseline (default: origin)',
  '  --opencode-timeout-ms <n>   opencode timeout in ms (default: 3600000, 0 disables)',
  '  --proof-timeout-ms <n>      per-proof timeout in ms (default: 1800000, 0 disables)',
  '',
  'Prints one deterministic JSON result to stdout. Exit code 0 for SUCCESS/ALREADY_SATISFIED.',
].join('\n');

export function parseArgs(argv) {
  const options = {
    taskFile: null,
    allowedPaths: [],
    proofCommands: [],
    title: null,
    model: null,
    agent: null,
    opencodeBin: null,
    repositoryRoot: process.cwd(),
    remote: 'origin',
    opencodeTimeoutMs: DEFAULT_OPENCODE_TIMEOUT_MS,
    proofTimeoutMs: DEFAULT_PROOF_TIMEOUT_MS,
    help: false,
  };
  const valueFlags = {
    '--task': 'taskFile',
    '--title': 'title',
    '--model': 'model',
    '--agent': 'agent',
    '--opencode-bin': 'opencodeBin',
    '--repo': 'repositoryRoot',
    '--remote': 'remote',
  };
  const numberFlags = {
    '--opencode-timeout-ms': 'opencodeTimeoutMs',
    '--proof-timeout-ms': 'proofTimeoutMs',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--allow' || arg === '--proof') {
      const value = argv[index + 1];
      if (value === undefined) return { ok: false, error: `${arg} requires a value` };
      index += 1;
      if (arg === '--allow') options.allowedPaths.push(value);
      else options.proofCommands.push(value);
      continue;
    }
    if (Object.hasOwn(valueFlags, arg)) {
      const value = argv[index + 1];
      if (value === undefined) return { ok: false, error: `${arg} requires a value` };
      index += 1;
      options[valueFlags[arg]] = value;
      continue;
    }
    if (Object.hasOwn(numberFlags, arg)) {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (value === undefined || !Number.isFinite(parsed) || parsed < 0) {
        return { ok: false, error: `${arg} requires a non-negative number` };
      }
      index += 1;
      options[numberFlags[arg]] = parsed;
      continue;
    }
    return { ok: false, error: `unknown argument: ${arg}` };
  }
  if (options.help) return { ok: true, options };
  if (!options.taskFile) return { ok: false, error: '--task is required' };
  if (options.allowedPaths.length === 0)
    return { ok: false, error: 'at least one --allow is required' };
  return { ok: true, options };
}

export function main(
  argv,
  { env = process.env, stdout = process.stdout, stderr = process.stderr, deps = {} } = {},
) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr.write(`${parsed.error}\n${USAGE}\n`);
    stdout.write(`${JSON.stringify({ status: INVALID_INPUT, reason: parsed.error }, null, 2)}\n`);
    return 1;
  }
  if (parsed.options.help) {
    stderr.write(`${USAGE}\n`);
    return 0;
  }
  const taskPath = resolve(parsed.options.taskFile);
  let taskText;
  try {
    taskText = readFileSync(taskPath, 'utf8');
  } catch (error) {
    stderr.write(`cannot read task file: ${messageOf(error)}\n`);
    stdout.write(
      `${JSON.stringify({ status: INVALID_INPUT, reason: `cannot read task file: ${messageOf(error)}` }, null, 2)}\n`,
    );
    return 1;
  }
  const result = runOnce({ ...parsed.options, taskText }, { ...deps, env });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const summary = [
    `[run-once] STATUS ${result.status}`,
    `[run-once] BASELINE ${result.baseline.baselineSha ?? 'unknown'}`,
    `[run-once] LIVE_MAIN_AT_END ${result.liveMainAtEnd ?? 'unobserved'}`,
    `[run-once] CHANGED_PATHS ${result.changedPaths.length}`,
    `[run-once] PROOF_RESULTS ${result.proofResults.filter((entry) => entry.ok).length}/${result.proofResults.length} passed`,
    `[run-once] WORKSPACE_CLEANUP ${result.workspace.cleanup}`,
  ].join('\n');
  stderr.write(`${summary}\n`);
  return result.status === SUCCESS || result.status === ALREADY_SATISFIED ? 0 : 1;
}

const invokedAsMainScript =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMainScript) {
  process.exitCode = main(process.argv.slice(2));
}
