// Canonical owner: docs/specs/ops/development-authority.md section 10 and
// AGENTS.md section 0 (bounded semantic task, Git-native publication, thin
// stateless automation).
//
// Foreground Night Run: repeat the existing natural-language BUILD front door
// over fresh live `main`, one bounded cycle at a time, until a finite terminal.
//
//   RUN NIGHT
//   -> fresh live `main` observation (diagnostic record only)
//   -> BUILD cycle (scripts/agent/run-build.mjs as one real child process)
//   -> cycle terminal interpretation
//   -> continue only after FRONTIER_COMPLETE with provable progress
//   -> bounded `--max-cycles` (and optional `--max-minutes`) stop
//   -> one deterministic summary
//   -> process exit
//
// This module is repetition/lifetime authority only. It never selects a
// frontier, never executes a task, never publishes, and never reuses a previous
// cycle's selector decision as authority. Each cycle is a fresh BUILD
// invocation that re-pins live `main` itself. The BUILD request is read exactly
// once into process memory and passed to every cycle unchanged; it is never
// stored as durable coordination state.
//
// Ctrl+C contract: one SIGINT requests a safe stop. The active BUILD child is
// spawned in its own process group (detached) so console Ctrl+C is never
// forwarded into a mutation/proof/publication critical section. The current
// cycle always reaches its own terminal; no new cycle starts afterwards.
// Repeated SIGINT only prints a diagnostic and never escalates to a hard kill.
//
// Never created here: daemon, scheduler, durable queue, background service,
// watchdog, polling loop, persistent loop state, or a second publication path.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALREADY_SATISFIED,
  BLOCKED_EXTERNAL,
  BUILD_STATUSES,
  FRONTIER_COMPLETE,
  HUMAN_DECISION_REQUIRED,
  INVALID_BUILD_REQUEST,
  NO_EXECUTABLE_FRONTIER,
  PROOF_FAILED,
  PUBLICATION_FAILED,
} from './run-build.mjs';
import { NO_PROGRESS } from './run-goal.mjs';
import {
  CODEX_EXECUTOR,
  DEFAULT_CODEX_TIMEOUT_MS,
  resolveAgentExecutor,
  validateAgentExecutorOptions,
} from './agent-executor.mjs';
import {
  DEFAULT_OPENCODE_TIMEOUT_MS,
  DEFAULT_PROOF_TIMEOUT_MS,
  OPENCODE_ATTACH_URL_ENV,
  parseVisibleAttachUrl,
  probeVisibleServer,
  readLiveRemoteMain,
} from './run-once.mjs';
import { DEFAULT_CI_TIMEOUT_MS, DEFAULT_MAX_REBIND_ATTEMPTS } from './run-publish-once.mjs';

// Night-level terminals. Product frontiers reuse the existing BUILD vocabulary
// unchanged; only the repetition/lifetime terminals are new here.
export {
  ALREADY_SATISFIED,
  BLOCKED_EXTERNAL,
  FRONTIER_COMPLETE,
  HUMAN_DECISION_REQUIRED,
  INVALID_BUILD_REQUEST,
  NO_EXECUTABLE_FRONTIER,
  NO_PROGRESS,
  PROOF_FAILED,
  PUBLICATION_FAILED,
};
export const MAX_CYCLES_REACHED = 'MAX_CYCLES_REACHED';
export const MAX_MINUTES_REACHED = 'MAX_MINUTES_REACHED';
export const USER_STOPPED = 'USER_STOPPED';
export const BUILD_CHILD_FAILED = 'BUILD_CHILD_FAILED';
export const INVALID_NIGHT_REQUEST = 'INVALID_NIGHT_REQUEST';

// The only BUILD result that requests a fresh re-evaluation on the next cycle.
export const CONTINUATION_BUILD_STATUSES = Object.freeze([FRONTIER_COMPLETE]);

// BUILD results that conclude the requested product work without a failure.
export const PRODUCT_TERMINAL_BUILD_STATUSES = Object.freeze([
  ALREADY_SATISFIED,
  NO_EXECUTABLE_FRONTIER,
]);

export const NIGHT_STATUSES = Object.freeze([
  ALREADY_SATISFIED,
  NO_EXECUTABLE_FRONTIER,
  HUMAN_DECISION_REQUIRED,
  BLOCKED_EXTERNAL,
  PROOF_FAILED,
  PUBLICATION_FAILED,
  INVALID_BUILD_REQUEST,
  MAX_CYCLES_REACHED,
  MAX_MINUTES_REACHED,
  USER_STOPPED,
  NO_PROGRESS,
  BUILD_CHILD_FAILED,
  INVALID_NIGHT_REQUEST,
]);

// Exit codes: 0 for a bounded run that ended in product conclusion or bound,
// 130 for the operator's graceful Ctrl+C stop (POSIX SIGINT convention), and 1
// for any failure terminal.
const SUCCESS_EXIT_STATUSES = Object.freeze([
  ALREADY_SATISFIED,
  NO_EXECUTABLE_FRONTIER,
  MAX_CYCLES_REACHED,
  MAX_MINUTES_REACHED,
]);
const OPERATOR_STOP_EXIT_CODE = 130;

const FAILURE_BUILD_STATUSES = Object.freeze([
  PROOF_FAILED,
  PUBLICATION_FAILED,
  INVALID_BUILD_REQUEST,
]);

const CHILD_STDOUT_LIMIT_CHARS = 64 * 1024 * 1024;

function messageOf(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tail(value, limit = 2000) {
  const text = typeof value === 'string' ? value : '';
  return text.length <= limit ? text : text.slice(text.length - limit);
}

function findBalancedObjectEnd(text, startIndex) {
  if (text[startIndex] !== '{') return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * One real BUILD invocation output is exactly one pretty-printed JSON result
 * object. Anything else (a crash, a stray banner, two objects, trailing text)
 * fails closed instead of being guessed.
 */
export function parseBuildResultOutput(stdout) {
  const text = String(stdout ?? '').trim();
  if (text.length === 0) return { ok: false, reason: 'child produced no stdout' };
  if (text[0] !== '{')
    return { ok: false, reason: 'child stdout does not start with a JSON object' };
  const end = findBalancedObjectEnd(text, 0);
  if (end === -1) return { ok: false, reason: 'child stdout JSON object is unbalanced' };
  if (end !== text.length - 1) {
    return {
      ok: false,
      reason: 'child stdout has unexpected trailing output after the JSON result',
    };
  }
  const parsed = parseJson(text);
  if (!isPlainObject(parsed)) return { ok: false, reason: 'child stdout is not a JSON object' };
  const status = typeof parsed.status === 'string' ? parsed.status : null;
  if (status === null || !BUILD_STATUSES.includes(status)) {
    return {
      ok: false,
      reason: `child terminal is not a declared BUILD status: ${JSON.stringify(status)}`,
    };
  }
  return { ok: true, result: parsed };
}

function readNightRequest(options) {
  if (typeof options.requestText === 'string') {
    return { ok: true, text: options.requestText, source: 'inline' };
  }
  if (isNonEmptyString(options.requestFile)) {
    try {
      return {
        ok: true,
        text: readFileSync(resolve(options.requestFile), 'utf8'),
        source: 'file',
      };
    } catch (error) {
      return { ok: false, error: `cannot read BUILD request file: ${messageOf(error)}` };
    }
  }
  try {
    return { ok: true, text: readFileSync(0, 'utf8'), source: 'stdin' };
  } catch (error) {
    return {
      ok: false,
      error: `cannot read BUILD request from stdin: ${messageOf(error)}; pass --request <file>`,
    };
  }
}

/**
 * VISIBLE_TUI is the existing operator contract read from
 * `GREENHUB_OPENCODE_ATTACH_URL` (run-once). Night Run never redesigns it: when
 * the URL is present it must be preserved to every BUILD child explicitly, and
 * an unusable or unavailable attach target fails closed before any cycle
 * starts. A silent HEADLESS downgrade is never allowed.
 */
function resolveNightVisibility({ baseEnv, backend, probe = probeVisibleServer }) {
  const raw =
    typeof baseEnv?.[OPENCODE_ATTACH_URL_ENV] === 'string'
      ? baseEnv[OPENCODE_ATTACH_URL_ENV].trim()
      : '';
  if (backend === CODEX_EXECUTOR) {
    return {
      requested: raw.length > 0,
      attachUrl: null,
      health: 'NOT_APPLICABLE_TO_CODEX',
      error: null,
    };
  }
  if (raw.length === 0) {
    return { requested: false, attachUrl: null, health: 'NOT_REQUESTED', error: null };
  }
  const parsed = parseVisibleAttachUrl(raw);
  if (!parsed.ok) {
    return { requested: true, attachUrl: null, health: 'INVALID', error: parsed.reason };
  }
  const preflight = probe({ attachUrl: parsed.url });
  if (!preflight?.ok) {
    return {
      requested: true,
      attachUrl: parsed.url,
      health: 'UNAVAILABLE',
      error: preflight?.error ?? 'no healthy OpenCode server',
    };
  }
  return { requested: true, attachUrl: parsed.url, health: 'HEALTHY', error: null };
}

/**
 * Explicit visibility preservation: the BUILD child inherits the operator
 * environment (run-once still sanitizes the OpenCode child), and the validated
 * attach URL is written into it explicitly so the run-build -> run-goal ->
 * run-publish-once -> run-once chain cannot lose VISIBLE_TUI through
 * inheritance gaps.
 */
function buildBuildChildEnv({ baseEnv, attachUrl, backend }) {
  const childEnv = { ...baseEnv };
  if (backend === CODEX_EXECUTOR) delete childEnv[OPENCODE_ATTACH_URL_ENV];
  if (attachUrl !== null) childEnv[OPENCODE_ATTACH_URL_ENV] = attachUrl;
  return childEnv;
}

/**
 * Spawn one real run-build child in its own process group so a console Ctrl+C
 * addressed to the Night Run process is never delivered into an active BUILD
 * mutation/proof/publication critical section. Child stderr is relayed live to
 * the operator; child stdout is captured only to parse the terminal JSON.
 */
export function defaultInvokeBuild({
  buildScriptPath,
  args,
  cwd,
  env,
  requestText,
  stderr,
  spawnFn = spawn,
  execPath = process.execPath,
}) {
  return new Promise((resolveInvocation) => {
    let child;
    try {
      child = spawnFn(execPath, [buildScriptPath, ...args], {
        cwd,
        env,
        detached: true,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolveInvocation({
        exitCode: null,
        signal: null,
        stdout: '',
        stderrBytes: 0,
        stdoutOverflow: false,
        startErrorCode: 'SPAWN_THREW',
        startErrorMessage: messageOf(error),
      });
      return;
    }
    let stdout = '';
    let stderrBytes = 0;
    let stdoutOverflow = false;
    let stdinError = null;
    let stdinFinished = false;
    let settled = false;
    const settle = (payload) => {
      if (settled) return;
      settled = true;
      resolveInvocation(payload);
    };
    child.on('error', (error) => {
      settle({
        exitCode: null,
        signal: null,
        stdout,
        stderrBytes,
        stdoutOverflow,
        startErrorCode: error?.code ?? 'SPAWN_ERROR',
        startErrorMessage: messageOf(error),
      });
    });
    child.stdout.on('data', (chunk) => {
      if (stdout.length + chunk.length > CHILD_STDOUT_LIMIT_CHARS) {
        stdoutOverflow = true;
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      try {
        stderr.write(chunk);
      } catch {
        // the operator stream may already be gone; the child terminal is unaffected
      }
    });
    child.stdin.on('finish', () => {
      stdinFinished = true;
    });
    child.stdin.on('error', (error) => {
      stdinError ??= messageOf(error);
    });
    child.stdin.on('close', () => {
      if (!stdinFinished) {
        stdinError ??= 'BUILD 자식이 요청 stdin 쓰기를 마치기 전에 파이프를 닫았습니다';
      }
    });
    child.on('close', (code, signal) => {
      const requestDeliveryError =
        stdinError ??
        (!stdinFinished ? 'BUILD 자식이 요청 stdin 쓰기를 마치기 전에 종료되었습니다' : null);
      settle({
        exitCode: code,
        signal: signal ?? null,
        stdout,
        stderrBytes,
        stdoutOverflow,
        startErrorCode: requestDeliveryError === null ? null : 'STDIN_WRITE_FAILED',
        startErrorMessage: requestDeliveryError,
      });
    });
    try {
      child.stdin.end(requestText);
    } catch (error) {
      stdinError ??= messageOf(error);
      try {
        child.stdin.destroy();
      } catch {
        // the child terminal below still settles on close/error
      }
    }
  });
}

function createNightResult(options) {
  return {
    status: null,
    stopReason: null,
    finalTerminal: null,
    repositoryRoot: resolve(options.repositoryRoot ?? process.cwd()),
    remote: options.remote ?? 'origin',
    executor: { selected: null, backendsObserved: [] },
    request: {
      source: null,
      characters: 0,
      reusedAcrossCycles: false,
    },
    bound: {
      maxCycles: Number.isInteger(options.maxCycles) ? options.maxCycles : null,
      maxMinutes: Number.isFinite(options.maxMinutes) ? options.maxMinutes : null,
      cyclesStarted: 0,
      cyclesCompleted: 0,
      maxCyclesReached: false,
      maxMinutesReached: false,
      elapsedMs: 0,
    },
    liveMain: {
      atStart: null,
      atEnd: null,
    },
    cycles: [],
    completedFrontiers: [],
    productFrontiersCompleted: [],
    humanDecisionRequired: null,
    blockedExternal: null,
    failures: [],
    operatorStop: {
      requested: false,
      duringCycle: false,
      cyclesFinishedAfterRequest: 0,
      signals: 0,
      stoppedBeforeNextBuild: false,
    },
    progressGuard: {
      triggered: false,
      kind: null,
      cycle: null,
    },
    nextFrontierSelected: false,
    childCalls: 0,
    visibility: {
      requested: false,
      attachUrl: null,
      health: 'NOT_REQUESTED',
      error: null,
      preservedToBuildChildren: false,
      mutationExecutorModes: [],
      visibleTuiTasks: 0,
    },
    residue: {
      taskOwned: [],
      foreign: 'NOT_TOUCHED',
    },
  };
}

function buildChildArgs(options) {
  const args = [
    '--repo',
    resolve(options.repositoryRoot ?? process.cwd()),
    '--remote',
    options.remote ?? 'origin',
  ];
  const valueFlags = [
    ['executor', '--executor'],
    ['title', '--title'],
    ['model', '--model'],
    ['agent', '--agent'],
    ['opencodeBin', '--opencode-bin'],
    ['codexBin', '--codex-bin'],
    ['githubRepository', '--github-repo'],
  ];
  for (const [key, flag] of valueFlags) {
    if (isNonEmptyString(options[key])) args.push(flag, options[key]);
  }
  const numberFlags = [
    ['opencodeTimeoutMs', '--opencode-timeout-ms'],
    ['codexTimeoutMs', '--codex-timeout-ms'],
    ['proofTimeoutMs', '--proof-timeout-ms'],
    ['ciTimeoutMs', '--ci-timeout-ms'],
    ['maxRebindAttempts', '--max-rebind-attempts'],
  ];
  for (const [key, flag] of numberFlags) {
    const value = options[key];
    if (Number.isFinite(value)) args.push(flag, String(value));
  }
  return args;
}

function extractCyclePublication(buildResult) {
  const attempts = Array.isArray(buildResult?.goalResult?.attempts)
    ? buildResult.goalResult.attempts
    : [];
  const prNumbers = [];
  const mergeShas = [];
  for (const attempt of attempts) {
    const publication = attempt?.child?.publication;
    if (!isPlainObject(publication)) continue;
    const prNumber = publication.pr?.number;
    if (Number.isInteger(prNumber)) prNumbers.push(prNumber);
    const mergeSha = publication.merge?.mergeSha;
    if (isNonEmptyString(mergeSha)) mergeShas.push(mergeSha);
  }
  return { prNumbers: [...new Set(prNumbers)], mergeShas: [...new Set(mergeShas)] };
}

function summarizeCycle({
  cycleNumber,
  buildResult,
  invocation,
  liveMainStart,
  liveMainEnd,
  startObservation,
  endObservation,
  elapsedMs,
}) {
  const status = buildResult?.status ?? BUILD_CHILD_FAILED;
  const selectedFrontier = buildResult?.decision?.selected?.id ?? null;
  const admittedFrontiers = Array.isArray(buildResult?.batch?.admitted)
    ? buildResult.batch.admitted.map((entry) => entry.id)
    : [];
  const movement =
    liveMainStart === null || liveMainEnd === null
      ? 'UNKNOWN'
      : liveMainStart === liveMainEnd
        ? 'UNCHANGED'
        : 'MOVED';
  const attempts = Array.isArray(buildResult?.goalResult?.attempts)
    ? buildResult.goalResult.attempts
    : [];
  const executorModes = [
    ...new Set(
      attempts
        .map((attempt) => attempt?.child?.executor?.mode)
        .filter((value) => typeof value === 'string' && value.length > 0),
    ),
  ];
  const observedBackends = new Set([
    ...(Array.isArray(buildResult?.executor?.backendsObserved)
      ? buildResult.executor.backendsObserved
      : []),
    buildResult?.selector?.executor?.backend,
    buildResult?.goalResult?.planner?.lastExecutor?.backend,
    ...attempts.map((attempt) => attempt?.child?.executor?.backend),
  ].filter((value) => typeof value === 'string' && value.length > 0));
  return {
    cycle: cycleNumber,
    executor: {
      selected: buildResult?.executor?.selected ?? null,
      backendsObserved: [...observedBackends],
    },
    liveMainStart,
    liveMainEnd,
    liveMainObservation: { start: startObservation, end: endObservation },
    liveMainMovement: movement,
    status,
    reason: typeof buildResult?.reason === 'string' ? buildResult.reason : null,
    selectedFrontier,
    admittedFrontiers,
    deferredFrontiers: Array.isArray(buildResult?.batch?.deferred)
      ? buildResult.batch.deferred.map((entry) => entry.id)
      : [],
    kind:
      buildResult?.decision?.selected?.kind ??
      (buildResult?.decision?.considered ?? []).find((entry) => entry.id === selectedFrontier)
        ?.kind ??
      null,
    childCalls: Number.isInteger(buildResult?.childCalls) ? buildResult.childCalls : 0,
    publication: extractCyclePublication(buildResult),
    escalationToken: buildResult?.decision?.escalationToken ?? null,
    nextFrontierSelected: buildResult?.nextFrontierSelected === true,
    executorModes,
    visibleTuiTaskCount: attempts.filter(
      (attempt) => attempt?.child?.executor?.mode === 'VISIBLE_TUI',
    ).length,
    child: {
      exitCode: invocation.exitCode,
      signal: invocation.signal,
      startErrorCode: invocation.startErrorCode,
    },
    elapsedMs,
  };
}

function cycleFingerprint(cycle) {
  return JSON.stringify([
    cycle.liveMainStart,
    cycle.liveMainEnd,
    cycle.status,
    cycle.selectedFrontier,
    cycle.admittedFrontiers,
  ]);
}

function progressGuardFor(cycle, fingerprint, seenFingerprints) {
  if (cycle.liveMainMovement === 'UNCHANGED') return 'NO_MAIN_MOVEMENT';
  if (cycle.liveMainMovement === 'UNKNOWN') return 'UNPROVEN_MAIN_MOVEMENT';
  if (seenFingerprints.has(fingerprint)) return 'REPEATED_CYCLE';
  return null;
}

function appendFailure(result, cycle) {
  if (FAILURE_BUILD_STATUSES.includes(cycle.status) || cycle.status === BUILD_CHILD_FAILED) {
    result.failures.push({
      cycle: cycle.cycle,
      status: cycle.status,
      reason: cycle.reason,
    });
  }
}

/**
 * The Night Run foreground loop. One caller process, one finite bound, one
 * exit. `deps` carries the test seams (invokeBuild, readLiveMain, now,
 * signalSource, log, stderr, yieldToSignals); production uses the real seams.
 */
export async function runNight(options = {}, deps = {}) {
  const stderr = deps.stderr ?? process.stderr;
  const log = deps.log ?? ((message) => stderr.write(`${message}\n`));
  const now = deps.now ?? (() => Date.now());
  const signalSource = deps.signalSource ?? process;
  const readLiveMain = deps.readLiveMain ?? readLiveRemoteMain;
  const invokeBuild = deps.invokeBuild ?? defaultInvokeBuild;
  const yieldToSignals =
    deps.yieldToSignals ?? (() => new Promise((resolveYield) => setImmediate(resolveYield)));
  const buildScriptPath =
    deps.buildScriptPath ?? fileURLToPath(new URL('./run-build.mjs', import.meta.url));
  const env = deps.env ?? process.env;

  const result = createNightResult(options);
  const startedAt = now();
  const maxCycles = options.maxCycles;
  const maxMinutes = options.maxMinutes ?? null;

  const finish = (status, stopReason) => {
    result.status = status;
    result.stopReason = stopReason;
    result.finalTerminal = stopReason;
    result.bound.cyclesStarted = result.cycles.length;
    result.bound.cyclesCompleted = result.cycles.length;
    result.bound.maxCyclesReached = status === MAX_CYCLES_REACHED;
    result.bound.maxMinutesReached = status === MAX_MINUTES_REACHED;
    result.bound.elapsedMs = Math.max(0, now() - startedAt);
    result.childCalls = result.cycles.reduce((total, cycle) => total + cycle.childCalls, 0);
    result.request.reusedAcrossCycles = result.cycles.length >= 2;
    return result;
  };

  const executorSelection = resolveAgentExecutor({
    explicitValue: options.executor ?? null,
    baseEnv: env,
  });
  const executorOptions = validateAgentExecutorOptions({
    selection: executorSelection,
    agent: options.agent,
  });
  if (!executorOptions.ok) return finish(INVALID_NIGHT_REQUEST, executorOptions.reason);
  result.executor.selected = executorSelection.backend;
  options = { ...options, executor: executorSelection.backend.toLowerCase() };

  if (!Number.isInteger(maxCycles) || maxCycles <= 0) {
    return finish(INVALID_NIGHT_REQUEST, '--max-cycles must be a positive integer');
  }
  if (maxMinutes !== null && (!Number.isFinite(maxMinutes) || maxMinutes <= 0)) {
    return finish(INVALID_NIGHT_REQUEST, '--max-minutes must be a positive number');
  }

  let stopRequested = false;
  let activeBuild = false;
  const onSignal = () => {
    result.operatorStop.signals += 1;
    result.operatorStop.requested = true;
    if (activeBuild) {
      result.operatorStop.duringCycle = true;
    } else {
      result.operatorStop.stoppedBeforeNextBuild = true;
    }
    if (result.operatorStop.signals === 1) {
      log('[NIGHT RUN] stop requested.');
      log('[NIGHT RUN] current BUILD will finish safely; no new BUILD will start.');
    } else {
      log('[NIGHT RUN] safe stop already requested; current BUILD is reaching its terminal.');
    }
    stopRequested = true;
  };
  signalSource.on('SIGINT', onSignal);

  try {
    log(
      '[NIGHT RUN] max-cycles=' +
        maxCycles +
        (maxMinutes === null ? '' : ` max-minutes=${maxMinutes}`),
    );
    log('[NIGHT RUN] Ctrl+C once = stop safely after the current BUILD cycle.');
    log('[NIGHT RUN] the current BUILD will not be killed mid-publication.');

    // VISIBLE_TUI contract: if the operator requested the existing OpenCode TUI
    // workflow, preserve it explicitly or fail closed. Never fall back HEADLESS.
    const visibility = resolveNightVisibility({
      baseEnv: env,
      backend: executorSelection.backend,
      probe: deps.probeVisibleServer ?? probeVisibleServer,
    });
    result.visibility = {
      requested: visibility.requested,
      attachUrl: visibility.attachUrl,
      health: visibility.health,
      error: visibility.error,
      preservedToBuildChildren: visibility.requested && visibility.health === 'HEALTHY',
      mutationExecutorModes: [],
      visibleTuiTasks: 0,
    };
    if (visibility.health === 'INVALID' || visibility.health === 'UNAVAILABLE') {
      log(`[NIGHT RUN] VISIBILITY_UNAVAILABLE: ${visibility.error}`);
      return finish(
        BLOCKED_EXTERNAL,
        `VISIBILITY_UNAVAILABLE: ${visibility.error}; no BUILD was started and VISIBLE_TUI is never downgraded to HEADLESS`,
      );
    }
    const buildChildEnv = buildBuildChildEnv({
      baseEnv: env,
      attachUrl: visibility.attachUrl,
      backend: executorSelection.backend,
    });
    if (visibility.health === 'HEALTHY' && visibility.attachUrl !== null) {
      log(
        `[NIGHT RUN] visible OpenCode TUI ${visibility.attachUrl} (HEALTHY); mutation tasks attach to it.`,
      );
      log('[NIGHT RUN] watch Window A with /sessions or Ctrl+X L.');
      log(
        '[NIGHT RUN] Ctrl+C stops only this Night Run process; the TUI and the active BUILD are never signaled.',
      );
    }

    const request = readNightRequest(options);
    if (!request.ok) {
      return finish(INVALID_NIGHT_REQUEST, request.error);
    }
    result.request = {
      source: request.source,
      characters: request.text.length,
      reusedAcrossCycles: false,
    };

    const args = buildChildArgs(options);
    const seenFingerprints = new Set();
    let lastEndMain = null;

    for (let cycleNumber = 1; cycleNumber <= maxCycles; cycleNumber += 1) {
      if (stopRequested) break;
      if (maxMinutes !== null && now() - startedAt >= maxMinutes * 60 * 1000) {
        return finish(MAX_MINUTES_REACHED, 'max-minutes bound reached');
      }
      await yieldToSignals();
      if (stopRequested) break;

      const startObservation = observeLiveMain({
        readLiveMain,
        repositoryRoot: result.repositoryRoot,
        remote: result.remote,
        log,
      });
      if (stopRequested) break;

      log(`[NIGHT RUN] cycle ${cycleNumber}/${maxCycles}`);
      log(`[NIGHT RUN] starting from live main ${startObservation.sha ?? 'unknown'}`);

      const cycleStartedAt = now();
      activeBuild = true;
      let invocation;
      try {
        invocation = await invokeBuild({
          buildScriptPath,
          args,
          cwd: result.repositoryRoot,
          env: buildChildEnv,
          requestText: request.text,
          stderr,
        });
      } catch (error) {
        invocation = {
          exitCode: null,
          signal: null,
          stdout: '',
          stderrBytes: 0,
          stdoutOverflow: false,
          startErrorCode: 'INVOKE_THREW',
          startErrorMessage: messageOf(error),
        };
      } finally {
        activeBuild = false;
      }

      const endObservation = observeLiveMain({
        readLiveMain,
        repositoryRoot: result.repositoryRoot,
        remote: result.remote,
        log,
      });
      const parsed = parseBuildResultOutput(invocation?.stdout);
      const buildResult = parsed.ok ? parsed.result : null;
      let childFailureReason = null;
      if (invocation?.startErrorCode) {
        childFailureReason = `BUILD child failed to start (${invocation.startErrorCode}): ${invocation.startErrorMessage ?? 'no detail'}`;
      } else if (invocation?.stdoutOverflow) {
        childFailureReason = 'BUILD child stdout exceeded the bounded capture limit';
      } else if (!parsed.ok) {
        childFailureReason =
          `BUILD child did not produce a parseable terminal (exitCode=${invocation?.exitCode ?? 'null'}, ` +
          `signal=${invocation?.signal ?? 'null'}): ${parsed.reason}; stdout tail: ${tail(invocation?.stdout) || '<empty>'}`;
      } else if (
        buildResult?.status === FRONTIER_COMPLETE &&
        (invocation?.signal != null ||
          !Number.isInteger(invocation?.exitCode) ||
          invocation.exitCode !== 0)
      ) {
        childFailureReason =
          `BUILD 자식 프로세스가 비정상 종료되었습니다 (exitCode=${invocation?.exitCode ?? 'null'}, ` +
          `signal=${invocation?.signal ?? 'null'})`;
      }

      const liveMainStart = startObservation.sha ?? buildResult?.observedMain?.fetchedSha ?? null;
      const liveMainEnd =
        endObservation.sha ??
        buildResult?.goalResult?.liveMain?.atEnd?.fetchedSha ??
        buildResult?.goalResult?.liveMain?.atStart?.fetchedSha ??
        buildResult?.observedMain?.fetchedSha ??
        null;

      const cycle = summarizeCycle({
        cycleNumber,
        buildResult,
        invocation: invocation ?? {},
        liveMainStart,
        liveMainEnd,
        startObservation: startObservation.sha === null ? 'UNKNOWN' : 'DIRECT',
        endObservation: endObservation.sha === null ? 'UNKNOWN' : 'DIRECT',
        elapsedMs: Math.max(0, now() - cycleStartedAt),
      });
      const mismatchedBackend = cycle.executor.backendsObserved.find(
        (backend) => backend !== result.executor.selected,
      );
      if (mismatchedBackend !== undefined && childFailureReason === null) {
        childFailureReason =
          `선택한 executor ${result.executor.selected} 대신 ${mismatchedBackend} 실행이 관찰됐습니다`;
      }
      if (childFailureReason !== null) {
        cycle.status = BUILD_CHILD_FAILED;
        cycle.reason = childFailureReason;
      }
      result.cycles.push(cycle);
      for (const backend of cycle.executor.backendsObserved) {
        if (!result.executor.backendsObserved.includes(backend)) {
          result.executor.backendsObserved.push(backend);
        }
      }
      if (cycle.liveMainStart !== null && result.liveMain.atStart === null) {
        result.liveMain.atStart = cycle.liveMainStart;
      }
      if (cycle.liveMainEnd !== null) lastEndMain = cycle.liveMainEnd;
      result.liveMain.atEnd = lastEndMain;

      log(
        `[NIGHT RUN] cycle ${cycleNumber} result: ${cycle.status}` +
          ` (selected=${cycle.selectedFrontier ?? 'none'}, admitted=${cycle.admittedFrontiers.length}, ` +
          `childCalls=${cycle.childCalls})`,
      );

      if (cycle.status === FRONTIER_COMPLETE) {
        result.completedFrontiers.push({
          cycle: cycleNumber,
          id: cycle.selectedFrontier,
          kind: cycle.kind,
          admitted: [...cycle.admittedFrontiers],
          mergeShas: [...cycle.publication.mergeShas],
        });
        if (cycle.kind !== 'MAINTENANCE' && cycle.selectedFrontier !== null) {
          result.productFrontiersCompleted.push(cycle.selectedFrontier);
        }
      } else if (cycle.status === HUMAN_DECISION_REQUIRED) {
        result.humanDecisionRequired = {
          cycle: cycleNumber,
          reason: cycle.reason,
          escalationToken: cycle.escalationToken,
        };
      } else if (cycle.status === BLOCKED_EXTERNAL) {
        result.blockedExternal = { cycle: cycleNumber, reason: cycle.reason };
      }
      for (const executorMode of cycle.executorModes) {
        if (!result.visibility.mutationExecutorModes.includes(executorMode)) {
          result.visibility.mutationExecutorModes.push(executorMode);
        }
      }
      result.visibility.visibleTuiTasks += cycle.visibleTuiTaskCount;
      appendFailure(result, cycle);

      if (stopRequested) {
        result.operatorStop.cyclesFinishedAfterRequest += 1;
        return finish(
          USER_STOPPED,
          'operator stop requested; the active BUILD cycle reached its terminal',
        );
      }
      if (cycle.status === BUILD_CHILD_FAILED || FAILURE_BUILD_STATUSES.includes(cycle.status)) {
        return finish(cycle.status, `cycle ${cycleNumber} terminal ${cycle.status}`);
      }
      if (cycle.status === FRONTIER_COMPLETE) {
        const fingerprint = cycleFingerprint(cycle);
        const guard = progressGuardFor(cycle, fingerprint, seenFingerprints);
        seenFingerprints.add(fingerprint);
        if (guard !== null) {
          result.progressGuard = { triggered: true, kind: guard, cycle: cycleNumber };
          return finish(
            NO_PROGRESS,
            `frontier reported complete without provable progress (${guard})`,
          );
        }
        continue;
      }
      if (PRODUCT_TERMINAL_BUILD_STATUSES.includes(cycle.status)) {
        return finish(
          cycle.status,
          `cycle ${cycleNumber} reached product terminal ${cycle.status}`,
        );
      }
      // HUMAN_DECISION_REQUIRED / BLOCKED_EXTERNAL and any future declared
      // BUILD terminal that is not a continuation stop the Night Run.
      return finish(cycle.status, `cycle ${cycleNumber} terminal ${cycle.status}`);
    }

    if (stopRequested) {
      return finish(USER_STOPPED, 'operator stop requested before the next BUILD cycle');
    }
    return finish(MAX_CYCLES_REACHED, 'max-cycles bound reached');
  } finally {
    signalSource.removeListener?.('SIGINT', onSignal);
  }
}

function observeLiveMain({ readLiveMain, repositoryRoot, remote, log }) {
  try {
    return { sha: readLiveMain({ repositoryRoot, remote }), error: null };
  } catch (error) {
    log(`[NIGHT RUN] live main observation failed (diagnostic): ${messageOf(error)}`);
    return { sha: null, error: messageOf(error) };
  }
}

export const USAGE = [
  'usage: node scripts/agent/run-night.mjs --max-cycles <n> [--request <file>] [--repo <dir>]',
  '',
  '  --max-cycles <n>            required finite bound; positive integer cycle count',
  '  --max-minutes <n>           optional wall-clock bound checked between cycles',
  '  --request <file>            BUILD request text; omit to read stdin once',
  '  --repo <dir>                canonical checkout root (default: current directory)',
  '  --remote <name>             remote observed for live main (default: origin)',
  '  --executor <name>           실행 backend: opencode (기본값) 또는 codex',
  '  GREENHUB_AGENT_EXECUTOR     --executor가 없을 때 backend 환경 변수로 사용',
  '  --title <title>             optional OpenCode session title for child tasks',
  '  --model <value>             backend가 지원하는 model 지정; Codex에서는 값을 그대로 전달',
  '  --agent <name>              optional OpenCode agent override for child tasks',
  '  --opencode-bin <path>       explicit OpenCode executable for child tasks',
  '  --opencode-timeout-ms <n>   child/selector opencode timeout in ms (default: 3600000)',
  '  --codex-bin <path>          Codex 실행 파일 경로를 지정',
  '  --codex-timeout-ms <n>      Codex 자식/selector 제한 시간(ms, 기본값: 3600000)',
  '  --proof-timeout-ms <n>      child/proof timeout in ms (default: 1800000, 0 disables)',
  '  --ci-timeout-ms <n>         child required-check watch timeout in ms (default: 2700000)',
  '  --max-rebind-attempts <n>   child fresh-main rebind constructions (default: 2)',
  '  --github-repo <owner/name>  optional explicit GitHub repository for child publication',
  '',
  'Foreground Night Run: each cycle is the existing BUILD front door re-run on',
  'fresh live main. Ctrl+C once requests a safe stop: the active BUILD cycle',
  'finishes its own terminal and no new BUILD starts. Repeated Ctrl+C only',
  'prints a diagnostic and never escalates to a hard kill. The BUILD request is',
  'read once into process memory and reused unchanged for every cycle; it is',
  'never stored as durable coordination state.',
  '',
  'Windows two-window usage (operator-visible OpenCode TUI):',
  '  Window A - OpenCode TUI:',
  '    node scripts/agent/open-visible-tui.mjs',
  '    -> prints the loopback URL for this TUI-owned server.',
  '  Window B - Night Run control (separate PowerShell):',
  "    $env:GREENHUB_OPENCODE_ATTACH_URL='http://127.0.0.1:4096'",
  '    node scripts/agent/run-night.mjs --request .\\night-request.txt --max-cycles 10',
  '  Watch the current mutation BUILD in Window A with /sessions or Ctrl+X L.',
  '  Press Ctrl+C once in Window B only; the active BUILD finishes safely, no',
  '  new BUILD starts, and the OpenCode TUI is never signaled.',
  '  If the attach URL is set but invalid or the server is unavailable, Night Run',
  '  fails closed with VISIBILITY_UNAVAILABLE instead of downgrading to HEADLESS.',
  '  Codex는 OpenCode TUI 연결을 사용하지 않으며 진행 상태는 이 control terminal에 표시된다.',
  '',
  'Prints one deterministic JSON summary to stdout. Exit codes: 0 (product',
  'terminal, max-cycles, or max-minutes), 130 (operator Ctrl+C safe stop),',
  '1 (any failure terminal or invalid invocation).',
].join('\n');

export function parseArgs(argv) {
  const options = {
    requestFile: null,
    maxCycles: null,
    maxMinutes: null,
    repositoryRoot: process.cwd(),
    remote: 'origin',
    executor: null,
    title: null,
    model: null,
    agent: null,
    opencodeBin: null,
    codexBin: null,
    opencodeTimeoutMs: DEFAULT_OPENCODE_TIMEOUT_MS,
    codexTimeoutMs: DEFAULT_CODEX_TIMEOUT_MS,
    proofTimeoutMs: DEFAULT_PROOF_TIMEOUT_MS,
    ciTimeoutMs: DEFAULT_CI_TIMEOUT_MS,
    maxRebindAttempts: DEFAULT_MAX_REBIND_ATTEMPTS,
    githubRepository: null,
    help: false,
  };
  const valueFlags = {
    '--request': 'requestFile',
    '--repo': 'repositoryRoot',
    '--remote': 'remote',
    '--executor': 'executor',
    '--title': 'title',
    '--model': 'model',
    '--agent': 'agent',
    '--opencode-bin': 'opencodeBin',
    '--codex-bin': 'codexBin',
    '--github-repo': 'githubRepository',
  };
  const positiveIntegerFlags = { '--max-cycles': 'maxCycles' };
  const positiveNumberFlags = { '--max-minutes': 'maxMinutes' };
  const numberFlags = {
    '--opencode-timeout-ms': 'opencodeTimeoutMs',
    '--codex-timeout-ms': 'codexTimeoutMs',
    '--proof-timeout-ms': 'proofTimeoutMs',
    '--ci-timeout-ms': 'ciTimeoutMs',
    '--max-rebind-attempts': 'maxRebindAttempts',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (Object.hasOwn(valueFlags, arg)) {
      const value = argv[index + 1];
      if (value === undefined) return { ok: false, error: `${arg} requires a value` };
      index += 1;
      options[valueFlags[arg]] = value;
      continue;
    }
    if (Object.hasOwn(positiveIntegerFlags, arg)) {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (value === undefined || !Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: `${arg} requires a positive integer` };
      }
      index += 1;
      options[positiveIntegerFlags[arg]] = parsed;
      continue;
    }
    if (Object.hasOwn(positiveNumberFlags, arg)) {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (value === undefined || !Number.isFinite(parsed) || parsed <= 0) {
        return { ok: false, error: `${arg} requires a positive number` };
      }
      index += 1;
      options[positiveNumberFlags[arg]] = parsed;
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
  return { ok: true, options };
}

export async function main(
  argv,
  { env = process.env, stdout = process.stdout, stderr = process.stderr, deps = {} } = {},
) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr.write(`${parsed.error}\n${USAGE}\n`);
    stdout.write(
      `${JSON.stringify({ status: INVALID_NIGHT_REQUEST, reason: parsed.error }, null, 2)}\n`,
    );
    return 1;
  }
  if (parsed.options.help) {
    stderr.write(`${USAGE}\n`);
    return 0;
  }
  const result = await runNight(parsed.options, { ...deps, env, stdout, stderr });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const summary = [
    `[NIGHT RUN] STATUS ${result.status}`,
    `[NIGHT RUN] STOP_REASON ${result.stopReason}`,
    `[NIGHT RUN] EXECUTOR selected=${result.executor?.selected ?? 'unknown'} observed=${(result.executor?.backendsObserved ?? []).join(',') || 'none'}`,
    `[NIGHT RUN] LIVE_MAIN ${result.liveMain?.atStart ?? 'unknown'} -> ${result.liveMain?.atEnd ?? 'unknown'}`,
    `[NIGHT RUN] CYCLES started=${result.bound?.cyclesStarted ?? 0} completed=${result.bound?.cyclesCompleted ?? 0} max=${result.bound?.maxCycles ?? 'none'}`,
    `[NIGHT RUN] OPERATOR_STOP requested=${result.operatorStop?.requested ? 'YES' : 'NO'} during_cycle=${result.operatorStop?.duringCycle ? 'YES' : 'NO'}`,
    `[NIGHT RUN] VISIBILITY ${
      result.visibility?.health === 'NOT_APPLICABLE_TO_CODEX'
        ? 'NOT_APPLICABLE_TO_CODEX'
        : result.visibility?.requested
        ? `VISIBLE_TUI ${result.visibility.health} tasks=${result.visibility.visibleTuiTasks}`
        : 'HEADLESS_DEFAULT'
    }`,
    `[NIGHT RUN] NEXT_FRONTIER_SELECTED ${result.nextFrontierSelected ? 'YES' : 'NO'}`,
  ].join('\n');
  stderr.write(`${summary}\n`);
  if (SUCCESS_EXIT_STATUSES.includes(result.status)) return 0;
  if (result.status === USER_STOPPED) return OPERATOR_STOP_EXIT_CODE;
  return 1;
}

const invokedAsMainScript =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMainScript) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
