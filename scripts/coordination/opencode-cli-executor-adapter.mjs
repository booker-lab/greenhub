// Bounded concrete-executor owner:
// GREENHUB-COORDINATION-OPENCODE-READONLY-STRUCTURED-RESULT-EXECUTOR-GF05.
// Surface: scripts/coordination/*opencode-cli-executor-adapter* (this module)
// + the existing Task 33 structured-result executor seam ONLY. No new durable
// family, no new generation, no new task status, no registry, no queue, no
// scheduler, no retry/backoff, and no fallback executor.
//
// State transition added here:
//   VALIDATED TASK 28 RECORD (handed over by Task 29)
//     -> ONE concrete OpenCode CLI non-interactive process boundary
//     -> existing Task 33 in-memory structured executor envelope
//        { schemaVersion: 1, dispatchId, outcome, result }
//
// createOpenCodeCliStructuredResultExecutor() is the ONE explicit concrete
// executor for the operator composition. It is not selected, matched, or
// discovered dynamically: the caller passes it explicitly at the invocation
// boundary and it is the only process boundary in this module.
//
// Executor capability is READ_ONLY ONLY and is enforced structurally, not by
// prompt wording:
//   - the OpenCode child process is started with a fixed, adapter-authored
//     OPENCODE_CONFIG_CONTENT document that pins the agent, the model, and a
//     permission ruleset (edit / bash / webfetch / websearch / task /
//     external_directory / skill / question = deny) at both the top level and
//     the agent level;
//   - OPENCODE_PURE=1 and --pure remove external plugins, and
//     OPENCODE_DISABLE_PROJECT_CONFIG=1 removes any repository-supplied
//     opencode config from the merge;
//   - the task payload can never select the executable, the working directory,
//     the agent, the model, the permission rules, or the child environment:
//     the payload is exactly ONE argv element (the canonical Task 28 record)
//     and the fixed adapter configuration is the only source of those values;
//   - the fixed environment allowlist drops every inherited OPENCODE_* variable
//     and every token/secret/proxy variable, and re-applies the authored
//     OPENCODE_* values last so an explicit environment map cannot weaken the
//     boundary.
//
// Structured result mechanism (verified against the installed OpenCode CLI
// 1.18.31 surface at implementation time):
//   - non-interactive: `opencode run [message..]`;
//   - fixed working directory: `--dir <workdir>` plus the child cwd;
//   - machine-readable stream: `--format json` emits ONE JSON event per stdout
//     line (step_start / text / step_finish / ...);
//   - the structured result is the FINAL assistant message text parsed as ONE
//     exact JSON object; stdout is never promoted to evidence beyond that
//     object, and process exit 0 is NEVER mapped to SUCCEEDED by itself;
//   - exit non-zero -> REJECTED; unobservable exit status -> UNKNOWN; process
//     start failure -> typed OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED error
//     (never UNKNOWN); missing / malformed / oversized structured output ->
//     fail closed with the existing Task 33 MISSING_EXECUTOR_STRUCTURED_RESULT
//     / INVALID_EXECUTOR_STRUCTURED_RESULT meanings;
//   - the six executor-authored fields (taskId / status / summary / proofRefs /
//     evidenceRefs / frictionObserved) are validated by the EXISTING Task 33
//     receipt contract AFTER this adapter returns; this module never
//     re-implements or weakens that validator, and taskId binding stays owned
//     by Task 33 / Task 34.
//
// Session behavior: the installed CLI persists a session under the operator's
// global OpenCode data directory (outside the repository); the adapter uses no
// --continue/--session/--fork flag, so every invocation is a fresh session and
// no session identity is ever reused or authored into coordination state.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   mutation-capable / write-enabled execution, executor registry, executor
//   selection, capability matching, fallback executor, retry/backoff/resend,
//   second spawn, scheduler, queue, daemon, task RUNNING status, ACK, receipt
//   persistence, result delivery, disposition, publication, candidateRef / PR
//   provenance, new generation authority, production deploy.

import { spawn } from 'node:child_process';
import nodePath from 'node:path';
import {
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_REJECTED,
  EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
  EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
} from './dispatch-executor-invocation-outcome.mjs';
import {
  INVALID_EXECUTOR_STRUCTURED_RESULT,
  MISSING_EXECUTOR_STRUCTURED_RESULT,
} from './executor-result-receipt.mjs';
import { TASK_KIND_READ_ONLY } from './task-envelope.mjs';

// The fixed read-only agent name. Not configurable: the caller cannot rename
// the agent, and the task payload cannot reference any other agent.
export const OPENCODE_READONLY_AGENT_NAME = 'greenhub-readonly';

// The fixed child environment allowlist. Only operator-environment variables
// needed to start an OS process and to locate the OpenCode home/auth are
// copied; every inherited OPENCODE_* variable (config, plugins, auth
// redirection, ...) is dropped and re-authored by this module.
export const OPENCODE_CLI_EXECUTOR_ENV_ALLOWLIST = Object.freeze([
  'PATH',
  'PATHEXT',
  'COMSPEC',
  'SystemRoot',
  'windir',
  'SystemDrive',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
]);

export const OPENCODE_CLI_EXECUTOR_PURE_ENV_KEY = 'OPENCODE_PURE';
export const OPENCODE_CLI_EXECUTOR_DISABLE_PROJECT_CONFIG_ENV_KEY =
  'OPENCODE_DISABLE_PROJECT_CONFIG';
export const OPENCODE_CLI_EXECUTOR_CONFIG_CONTENT_ENV_KEY = 'OPENCODE_CONFIG_CONTENT';

// Bounded stdout capture: an unbounded event stream is a contract violation.
export const MAX_OPENCODE_CLI_STDOUT_BYTES = 4 * 1024 * 1024;

// Adapter-native meanings ONLY. The six-field structured result validator and
// the taskId binding stay owned by the existing Task 33 / Task 34 contract; the
// missing/invalid structured output meanings are reused verbatim from it.
export const INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION =
  'INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION';
export const INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT =
  'INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT';
export const OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED =
  'OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED';
export const OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK =
  'OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK';

export class OpenCodeCliStructuredResultExecutorError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OpenCodeCliStructuredResultExecutorError';
    this.code =
      details.code ?? INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION;
  }
}

function fail(
  message,
  code = INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION,
) {
  throw new OpenCodeCliStructuredResultExecutorError(message, { code });
}

const STRUCTURED_EXECUTOR_CONFIGURATION_FIELDS = Object.freeze([
  'executablePath',
  'workdir',
  'model',
  'runner',
  'env',
]);

function assertValidConfigurationPath(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(
      `OpenCode CLI structured-result executor configuration requires a non-empty absolute ${fieldName} (the task payload never selects the executable, the working directory, the agent, the model, or the permissions).`,
    );
  }
  if (value.includes('\0')) {
    fail(`OpenCode CLI structured-result executor configuration ${fieldName} must not contain NUL bytes.`);
  }
  if (!nodePath.isAbsolute(value)) {
    fail(
      `OpenCode CLI structured-result executor configuration ${fieldName} must be an absolute path.`,
    );
  }
  return value;
}

function assertValidConfigurationModel(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(
      'OpenCode CLI structured-result executor configuration requires a non-empty model in provider/model form (the task payload never selects the model).',
    );
  }
  if (value.includes('\0')) {
    fail('OpenCode CLI structured-result executor configuration model must not contain NUL bytes.');
  }
  return value;
}

function assertNoUnknownStructuredExecutorConfigurationFields(configuration) {
  if (Object.getOwnPropertySymbols(configuration).length > 0) {
    fail(
      'OpenCode CLI structured-result executor configuration must not carry symbol keys.',
    );
  }
  for (const key of Object.getOwnPropertyNames(configuration)) {
    if (!STRUCTURED_EXECUTOR_CONFIGURATION_FIELDS.includes(key)) {
      fail(
        `OpenCode CLI structured-result executor configuration accepts exactly (${STRUCTURED_EXECUTOR_CONFIGURATION_FIELDS.join(', ')}); received unknown field "${key}".`,
      );
    }
  }
}

function buildOpenCodeReadOnlyAgentPrompt() {
  return [
    'You are the Greenhub READ_ONLY coordination executor, invoked non-interactively.',
    'You receive exactly ONE canonical dispatch record as a JSON user message. Its decisionInput.task is the canonical Task Envelope v1.',
    'Execute only the READ_ONLY probe that the task envelope describes, using the read-only tools available to you.',
    'You have no write, edit, or shell tool: repository mutation is impossible for you, and you must never simulate, claim, or attempt it outside the available tools.',
    'When the probe is complete, your FINAL message must be exactly one JSON object and nothing else: no markdown fences, no commentary, no leading or trailing text.',
    'Exact shape: {"taskId":"<copy decisionInput.task.taskId verbatim>","status":"SUCCEEDED|FAILED|BLOCKED","summary":"<one bounded sentence>","proofRefs":["<short reference>"],"evidenceRefs":["<short reference>"],"frictionObserved":["NONE"]}',
    'The status must be exactly SUCCEEDED, FAILED, or BLOCKED; the taskId must match the record exactly; every string must be non-empty and short (references, never dumps).',
    'Use FAILED or BLOCKED when the read-only probe could not be completed.',
  ].join(' ');
}

// The fixed adapter-authored OpenCode configuration: agent identity, model,
// and the read-only permission ruleset at both the top level and the agent
// level. The task payload contributes nothing here.
function buildOpenCodeReadOnlyConfigContent(model) {
  const deniedPermission = Object.freeze({
    edit: 'deny',
    bash: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    task: 'deny',
    external_directory: 'deny',
    skill: 'deny',
    question: 'deny',
  });
  return JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    share: 'disabled',
    permission: deniedPermission,
    agent: {
      [OPENCODE_READONLY_AGENT_NAME]: {
        description:
          'Greenhub READ_ONLY coordination executor: no repository mutation capability',
        mode: 'primary',
        model,
        prompt: buildOpenCodeReadOnlyAgentPrompt(),
        permission: deniedPermission,
      },
    },
  });
}

function buildStructuredExecutorChildEnvironment(explicitEnv, model) {
  const childEnvironment = Object.create(null);
  if (explicitEnv === undefined) {
    for (const name of OPENCODE_CLI_EXECUTOR_ENV_ALLOWLIST) {
      const value = process.env[name];
      if (typeof value === 'string' && !value.includes('\0')) {
        childEnvironment[name] = value;
      }
    }
  } else {
    if (explicitEnv === null || typeof explicitEnv !== 'object' || Array.isArray(explicitEnv)) {
      fail(
        'OpenCode CLI structured-result executor configuration env must be an explicit plain record of string values when provided.',
      );
    }
    for (const [name, value] of Object.entries(explicitEnv)) {
      if (name.length === 0 || name.includes('=') || name.includes('\0')) {
        fail(
          'OpenCode CLI structured-result executor configuration env names must be non-empty and must not contain "=" or NUL bytes.',
        );
      }
      if (typeof value !== 'string' || value.includes('\0')) {
        fail(
          `OpenCode CLI structured-result executor configuration env value for ${JSON.stringify(name)} must be a string without NUL bytes.`,
        );
      }
      if (!OPENCODE_CLI_EXECUTOR_ENV_ALLOWLIST.includes(name)) {
        continue;
      }
      childEnvironment[name] = value;
    }
  }
  // The adapter-authored boundary is applied LAST and always wins: an explicit
  // environment map can never inject or weaken an OPENCODE_* variable.
  childEnvironment[OPENCODE_CLI_EXECUTOR_PURE_ENV_KEY] = '1';
  childEnvironment[OPENCODE_CLI_EXECUTOR_DISABLE_PROJECT_CONFIG_ENV_KEY] = '1';
  childEnvironment[OPENCODE_CLI_EXECUTOR_CONFIG_CONTENT_ENV_KEY] =
    buildOpenCodeReadOnlyConfigContent(model);
  return Object.freeze(childEnvironment);
}

// The ONLY process boundary in this module. Settle-once process observation
// with a bounded stdout capture; stderr stays closed and is never interpreted.
function defaultOpenCodeCliStructuredResultRunner({ command, args, cwd, env }) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stdoutTruncated = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const text = typeof chunk === 'string' ? chunk : String(chunk);
      const remaining = MAX_OPENCODE_CLI_STDOUT_BYTES - Buffer.byteLength(stdout, 'utf8');
      if (remaining <= 0) {
        stdoutTruncated = true;
        return;
      }
      const chunkBytes = Buffer.byteLength(text, 'utf8');
      if (chunkBytes > remaining) {
        stdoutTruncated = true;
        stdout += text.slice(0, remaining);
        return;
      }
      stdout += text;
    });
    child.once('error', (error) => {
      const errorCode =
        typeof error?.code === 'string' && error.code.length > 0
          ? error.code
          : 'UNKNOWN_PROCESS_START_ERROR';
      settle({ kind: 'start-failed', errorCode });
    });
    child.once('close', (code) => {
      if (Number.isInteger(code)) {
        settle({ kind: 'exited', code, stdout, stdoutTruncated });
      } else {
        settle({ kind: 'terminated-without-exit-status' });
      }
    });
  });
}

function assertExactRunnerResultKeys(result, expectedKeys) {
  if (Object.getOwnPropertySymbols(result).length > 0) {
    fail(
      'OpenCode CLI structured-result runner result must not carry symbol keys.',
      INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
  const ownKeys = Object.getOwnPropertyNames(result);
  const exact =
    ownKeys.length === expectedKeys.length && expectedKeys.every((key) => ownKeys.includes(key));
  if (!exact) {
    fail(
      `OpenCode CLI structured-result runner result shape must be exactly (${expectedKeys.join(', ')}); received (${ownKeys.join(', ')}).`,
      INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
}

// Extract the final assistant message text from the `--format json` event
// stream. Event parts are de-duplicated by part id (last write wins) so a
// cumulative part update can never be double-counted; parts of the final
// message are concatenated in event order.
function extractFinalAssistantText(stdout) {
  const partsById = new Map();
  const anonymousParts = [];
  let order = 0;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      fail(
        `OpenCode structured event stream contains a non-JSON stdout line (fail-closed): ${line.slice(0, 160)}`,
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      );
    }
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      fail(
        'OpenCode structured event stream entries must be plain objects (fail-closed).',
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      );
    }
    if (event.type !== 'text') continue;
    const part = event.part;
    if (part === null || typeof part !== 'object' || Array.isArray(part)) continue;
    if (part.type !== 'text' || typeof part.text !== 'string') continue;
    const entry = {
      order,
      messageID: typeof part.messageID === 'string' ? part.messageID : null,
      text: part.text,
    };
    order += 1;
    if (typeof part.id === 'string' && part.id.length > 0) {
      partsById.set(part.id, entry);
    } else {
      anonymousParts.push(entry);
    }
  }
  const parts = [...partsById.values(), ...anonymousParts].sort(
    (left, right) => left.order - right.order,
  );
  if (parts.length === 0) {
    fail(
      'the OpenCode CLI process exited without any final assistant text; no structured result exists and process success alone is never evidence (fail-closed).',
      MISSING_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  const finalMessageId = parts[parts.length - 1].messageID;
  const text = parts
    .filter((part) => part.messageID === finalMessageId)
    .map((part) => part.text)
    .join('')
    .trim();
  if (text.length === 0) {
    fail(
      'the OpenCode final assistant text is empty; no structured result exists (fail-closed).',
      MISSING_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  return text;
}

function parseStructuredResultText(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    fail(
      `the OpenCode final assistant text is not valid JSON (fail-closed): ${text.slice(0, 160)}`,
      INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    fail(
      'the OpenCode structured result must be ONE plain JSON object with the six executor-authored fields (fail-closed).',
      INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  return document;
}

/**
 * Create the ONE concrete OpenCode CLI structured-result executor.
 *
 * Narrow configuration boundary (caller-supplied at creation ONLY; never taken
 * from the task payload):
 * - `executablePath`: absolute path of the OpenCode CLI executable;
 * - `workdir`: absolute working directory fixed for every invocation (also
 *   passed as `--dir`);
 * - `model`: the fixed `provider/model` the read-only agent uses;
 * - `runner`: optional process-invocation seam receiving exactly
 *   { command, args, cwd, env }; when omitted, the module default runner is the
 *   only process boundary;
 * - `env`: optional explicit allowlisted environment projection.
 * Unknown configuration fields fail closed (zero process invocations).
 *
 * The returned function is the exact Task 33 structured executor contract:
 *   async function executor(task28Record) ->
 *     { schemaVersion: 1, dispatchId, outcome, result }
 * with outcome in ACCEPTED | REJECTED | UNKNOWN, result the parsed six-field
 * payload for ACCEPTED / null otherwise. It invokes the runner AT MOST ONCE
 * per call and never retries, never falls back, and never selects another
 * executable or model.
 */
export function createOpenCodeCliStructuredResultExecutor(configuration = {}) {
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)) {
    fail('OpenCode CLI structured-result executor configuration must be an object.');
  }
  assertNoUnknownStructuredExecutorConfigurationFields(configuration);
  const command = assertValidConfigurationPath(configuration.executablePath, 'executablePath');
  const childWorkdir = assertValidConfigurationPath(configuration.workdir, 'workdir');
  const model = assertValidConfigurationModel(configuration.model);
  if (configuration.runner !== undefined && typeof configuration.runner !== 'function') {
    fail(
      'OpenCode CLI structured-result executor configuration runner must be a function when provided.',
    );
  }
  const processRunner =
    configuration.runner === undefined
      ? defaultOpenCodeCliStructuredResultRunner
      : configuration.runner;
  const childEnvironment = buildStructuredExecutorChildEnvironment(configuration.env, model);

  return async function openCodeCliStructuredResultExecutor(task28Record) {
    if (task28Record === null || typeof task28Record !== 'object' || Array.isArray(task28Record)) {
      fail(
        'OpenCode CLI structured-result executor invocation requires the EXACT validated Task 28 record handed over by Task 29 (received a non-record).',
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      );
    }
    if (
      typeof task28Record.dispatchId !== 'string' ||
      task28Record.dispatchId.trim().length === 0
    ) {
      fail(
        'OpenCode CLI structured-result executor invocation requires the exact Task 28 record dispatchId.',
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      );
    }
    const dispatchId = task28Record.dispatchId;
    const task = task28Record?.decisionInput?.task;
    if (task === null || typeof task !== 'object' || Array.isArray(task)) {
      fail(
        'OpenCode CLI structured-result executor invocation requires the Task 20 transport request task envelope.',
        INVALID_EXECUTOR_STRUCTURED_RESULT,
      );
    }
    // READ_ONLY capability gate BEFORE any process start.
    if (task.taskKind !== TASK_KIND_READ_ONLY) {
      fail(
        `OpenCode CLI structured-result executor provides READ_ONLY capability only: taskKind ${String(task.taskKind)} fails closed BEFORE process start.`,
        OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK,
      );
    }

    // The EXACT validated Task 28 record is the prompt payload: canonical
    // compact JSON as ONE argv element, never shell-interpreted. AT MOST ONE
    // process invocation: runner throw/rejection propagates unchanged, there
    // is no catch, no retry, and no second invocation.
    const prompt = JSON.stringify(task28Record);
    const runnerResult = await processRunner({
      command,
      args: [
        'run',
        '--format',
        'json',
        '--pure',
        '--agent',
        OPENCODE_READONLY_AGENT_NAME,
        '--dir',
        childWorkdir,
        prompt,
      ],
      cwd: childWorkdir,
      env: childEnvironment,
    });

    if (runnerResult === null || typeof runnerResult !== 'object' || Array.isArray(runnerResult)) {
      fail(
        'OpenCode CLI structured-result runner result must be a plain record describing ONE process-boundary observation.',
        INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
      );
    }
    if (runnerResult.kind === 'exited') {
      assertExactRunnerResultKeys(runnerResult, ['kind', 'code', 'stdout', 'stdoutTruncated']);
      if (!Number.isInteger(runnerResult.code)) {
        fail(
          'OpenCode CLI structured-result runner result kind "exited" requires an integer exit code.',
          INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
        );
      }
      if (typeof runnerResult.stdout !== 'string') {
        fail(
          'OpenCode CLI structured-result runner result kind "exited" requires the captured stdout string.',
          INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
        );
      }
      if (typeof runnerResult.stdoutTruncated !== 'boolean') {
        fail(
          'OpenCode CLI structured-result runner result kind "exited" requires the stdoutTruncated boolean.',
          INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
        );
      }
      if (runnerResult.code !== 0) {
        return Object.freeze({
          schemaVersion: EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
          dispatchId,
          outcome: EXECUTOR_INVOCATION_OUTCOME_REJECTED,
          result: null,
        });
      }
      if (runnerResult.stdoutTruncated) {
        fail(
          `OpenCode CLI stdout exceeded the bounded capture limit (${MAX_OPENCODE_CLI_STDOUT_BYTES} bytes); the structured result cannot be proven and the boundary fails closed.`,
          INVALID_EXECUTOR_STRUCTURED_RESULT,
        );
      }
      // Exit 0 is NOT success evidence: the structured result text is the ONLY
      // result authority. Missing / malformed -> fail closed.
      const payload = parseStructuredResultText(extractFinalAssistantText(runnerResult.stdout));
      return Object.freeze({
        schemaVersion: EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
        dispatchId,
        outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
        result: payload,
      });
    }
    if (runnerResult.kind === 'terminated-without-exit-status') {
      assertExactRunnerResultKeys(runnerResult, ['kind']);
      return Object.freeze({
        schemaVersion: EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
        dispatchId,
        outcome: EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
        result: null,
      });
    }
    if (runnerResult.kind === 'start-failed') {
      assertExactRunnerResultKeys(runnerResult, ['kind', 'errorCode']);
      if (typeof runnerResult.errorCode !== 'string' || runnerResult.errorCode.length === 0) {
        fail(
          'OpenCode CLI structured-result runner result kind "start-failed" requires a non-empty errorCode.',
          INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
        );
      }
      throw new OpenCodeCliStructuredResultExecutorError(
        `OpenCode CLI structured-result process could not be started (errorCode ${runnerResult.errorCode}): configuration / process-start failure only, never a protocol outcome.`,
        { code: OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED },
      );
    }
    fail(
      `unsupported OpenCode CLI structured-result runner result kind ${JSON.stringify(runnerResult.kind)}: no fourth outcome and no automatic re-invocation exists.`,
      INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  };
}
