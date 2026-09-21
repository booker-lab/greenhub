// Bounded concrete-executor owner:
// GREENHUB-COORDINATION-OPENCODE-READONLY-STRUCTURED-RESULT-EXECUTOR-GF05.
// Surface: scripts/coordination/*opencode-cli-executor-adapter* (this module)
// + the existing Task 33 structured-result executor seam ONLY. No new durable
// family, no new generation, no new task status, no registry, no queue, no
// scheduler, no retry/backoff, and no fallback executor.
//
// State transition added here:
//   VALIDATED TASK 28 RECORD (handed over by Task 29)
//     -> ONE fenced executor invocation composed of:
//        ONE adapter-started local OpenCode server process (localhost transport)
//        + ONE SDK session create + ONE SDK structured prompt
//     -> existing Task 33 in-memory structured executor envelope
//        { schemaVersion: 1, dispatchId, outcome, result }
//
// createOpenCodeCliStructuredResultExecutor() is the ONE explicit concrete
// executor for the operator composition. It is not selected, matched, or
// discovered dynamically: the caller passes it explicitly at the invocation
// boundary and the server process started here is the only process boundary
// in this module. The localhost server transport is implementation plumbing
// INSIDE one fenced executor invocation: it is never a coordination retry and
// never a second task execution, and it is deterministically terminated in
// finally cleanup on success and on failure.
//
// Executor capability is READ_ONLY ONLY and is enforced structurally, not by
// prompt wording:
//   - the OpenCode server child process is started with a fixed,
//     adapter-authored OPENCODE_CONFIG_CONTENT document that pins the agent,
//     the model, and a permission ruleset (edit / bash / webfetch / websearch /
//     task / external_directory / skill / question = deny) at both the top
//     level and the agent level;
//   - OPENCODE_PURE=1 and OPENCODE_DISABLE_PROJECT_CONFIG=1 remove external
//     plugins and any repository-supplied opencode config from the merge;
//   - the task payload can never select the executable, the working directory,
//     the agent, the model, the permission rules, the server endpoint, or the
//     child environment: the payload is exactly ONE prompt string (the
//     canonical Task 28 record) and the fixed adapter configuration is the
//     only source of those values;
//   - the fixed environment allowlist drops every inherited OPENCODE_* variable
//     and every token/secret/proxy variable, and re-applies the authored
//     OPENCODE_* values last so an explicit environment map cannot weaken the
//     boundary;
//   - the server is bound to loopback only (fixed --hostname=127.0.0.1) and the
//     adapter refuses any non-loopback baseUrl before the SDK client can send
//     the record anywhere.
//
// Structured result mechanism (verified against the OpenCode 1.18.31 runtime
// and the matching @opencode-ai/sdk 1.18.31 surface at implementation time):
//   - the adapter starts `opencode serve --hostname=127.0.0.1 --port=0` itself
//     through the bounded process runner below (never the SDK server helper,
//     which would inherit an arbitrary environment) and waits, with a single
//     fixed readiness timeout, for the documented server readiness line
//     ("opencode server listening on ..."), the same signal the official SDK
//     server helper uses;
//   - the SDK client is used for typed interaction: one session create and one
//     `session.prompt` carrying
//     `format: { type: 'json_schema', schema: <six-field JSON Schema> }`;
//   - the validated object is read from the assistant message info structured
//     channel ONLY: the server source at v1.18.31 assigns
//     `handle.message.structured = structured` (SessionV1 Assistant schema
//     `structured: Schema.optional(Schema.Any)`), while the newer documented
//     alias `structured_output` is accepted as the same exact structured
//     channel; assistant prose parts are NEVER parsed, scanned, or promoted;
//   - a failed structured-output attempt is the assistant message error
//     `StructuredOutputError` (or any other assistant error) and fails closed
//     with zero synthetic fields;
//   - missing / malformed structured output fails closed with the existing
//     Task 33 MISSING_EXECUTOR_STRUCTURED_RESULT /
//     INVALID_EXECUTOR_STRUCTURED_RESULT meanings;
//   - the adapter never requests or relies on retryCount, never retries, never
//     falls back to another model, and never crosses the executor boundary
//     twice; ONE schema-valid structured response is accepted, otherwise the
//     invocation fails closed;
//   - because the opencode-go gateway rejects the forced tool choice that
//     JSON-schema structured output requires while DeepSeek thinking mode is
//     active (upstream anomalyco/opencode#15226), the adapter-authored config
//     pins `thinking: { type: 'disabled' }` for the fixed opencode-go DeepSeek
//     model family: the SAME model is used (never a fallback model), the option
//     is fixed and task-independent, and it is required for structured output
//     to be produced at all on this runtime;
//   - the six executor-authored fields (taskId / status / summary / proofRefs /
//     evidenceRefs / frictionObserved) remain validated by the EXISTING Task 33
//     receipt contract AFTER this adapter returns; this module never
//     re-implements or weakens that validator, and taskId binding stays owned
//     by Task 33 / Task 34.
//
// Session behavior: every invocation creates ONE fresh session through the
// adapter-started server and no session identity is ever reused, continued, or
// authored into coordination state.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   mutation-capable / write-enabled execution, executor registry, executor
//   selection, capability matching, fallback executor, retry/backoff/resend,
//   second invocation, scheduler, queue, daemon, task RUNNING status, ACK,
//   receipt persistence, result delivery, disposition, publication,
//   candidateRef / PR provenance, new generation authority, production deploy.

import { spawn, spawnSync } from 'node:child_process';
import nodePath from 'node:path';
import {
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
} from './dispatch-executor-invocation-outcome.mjs';
import {
  EXECUTOR_RESULT_RECEIPT_STATUS_VALUES,
  EXECUTOR_RESULT_RECEIPT_STRUCTURED_FIELDS,
  INVALID_EXECUTOR_STRUCTURED_RESULT,
  MISSING_EXECUTOR_STRUCTURED_RESULT,
} from './executor-result-receipt.mjs';
import {
  MAX_FRICTION_ENTRIES,
  MAX_FRICTION_ENTRY_LENGTH,
  MAX_REF_STRING_LENGTH,
  MAX_SUMMARY_LENGTH,
  TASK_KIND_READ_ONLY,
} from './task-envelope.mjs';

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

// The fixed loopback hostname and the port that lets the server itself pick a
// free port. Both are adapter-authored argv values; neither is task-selectable.
export const OPENCODE_SERVER_HOSTNAME = '127.0.0.1';
export const OPENCODE_SERVER_PORT = 0;

// The documented server readiness line prefix. The official @opencode-ai/sdk
// 1.18.31 server helper waits for exactly this line; this adapter replicates
// the readiness signal while keeping its own bounded process boundary.
export const OPENCODE_SERVER_READY_LINE_PREFIX = 'opencode server listening';

// Bounded startup capture: an unbounded startup stream is a contract violation.
export const MAX_OPENCODE_SERVER_STARTUP_OUTPUT_BYTES = 64 * 1024;

// The single fixed readiness bound. It is a startup deadline, NOT a retry: on
// expiry the server process is terminated and the invocation fails closed.
export const DEFAULT_OPENCODE_SERVER_START_TIMEOUT_MS = 10_000;

export const OPENCODE_SERVER_START_TIMEOUT_ERROR_CODE = 'OPENCODE_SERVER_START_TIMEOUT';
export const OPENCODE_SERVER_UNREADABLE_READY_URL_ERROR_CODE =
  'OPENCODE_SERVER_UNREADABLE_READY_URL';

// Adapter-native meanings ONLY. The six-field structured result validator and
// the taskId binding stay owned by the existing Task 33 / Task 34 contract; the
// missing/invalid structured output meanings are reused verbatim from it.
export const INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION =
  'INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION';
export const INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT =
  'INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT';
export const OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED =
  'OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED';
export const OPENCODE_CLI_EXECUTOR_REQUEST_FAILED = 'OPENCODE_CLI_EXECUTOR_REQUEST_FAILED';
export const OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK =
  'OPENCODE_CLI_EXECUTOR_REQUIRES_READ_ONLY_TASK';

export class OpenCodeCliStructuredResultExecutorError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OpenCodeCliStructuredResultExecutorError';
    this.code = details.code ?? INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION;
  }
}

function fail(message, code = INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_CONFIGURATION) {
  throw new OpenCodeCliStructuredResultExecutorError(message, { code });
}

const STRUCTURED_EXECUTOR_CONFIGURATION_FIELDS = Object.freeze([
  'executablePath',
  'workdir',
  'model',
  'runner',
  'clientFactory',
  'env',
]);

function assertValidConfigurationPath(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(
      `OpenCode CLI structured-result executor configuration requires a non-empty absolute ${fieldName} (the task payload never selects the executable, the working directory, the agent, the model, or the permissions).`,
    );
  }
  if (value.includes('\0')) {
    fail(
      `OpenCode CLI structured-result executor configuration ${fieldName} must not contain NUL bytes.`,
    );
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
  const separatorIndex = value.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    fail(
      'OpenCode CLI structured-result executor configuration model must be exactly provider/model (both parts non-empty).',
    );
  }
  return value;
}

function parseOpenCodeModelReference(model) {
  const separatorIndex = model.indexOf('/');
  return {
    providerID: model.slice(0, separatorIndex),
    modelID: model.slice(separatorIndex + 1),
  };
}

function assertNoUnknownStructuredExecutorConfigurationFields(configuration) {
  if (Object.getOwnPropertySymbols(configuration).length > 0) {
    fail('OpenCode CLI structured-result executor configuration must not carry symbol keys.');
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
    'You are the Greenhub READ_ONLY coordination executor, invoked non-interactively through a local OpenCode server session.',
    'You receive exactly ONE canonical dispatch record as a JSON user message. Its decisionInput.task is the canonical Task Envelope v1.',
    'Execute only the READ_ONLY probe that the task envelope describes, using the read-only tools available to you.',
    'You have no write, edit, or shell tool: repository mutation is impossible for you, and you must never simulate, claim, or attempt it outside the available tools.',
    'When the probe is complete you MUST call the StructuredOutput tool exactly once with your final answer: plain assistant text is never the result.',
    'Call StructuredOutput with: taskId copied verbatim from decisionInput.task.taskId; status exactly SUCCEEDED, FAILED, or BLOCKED; a one-sentence summary; short proofRefs and evidenceRefs (references, never dumps); frictionObserved (["NONE"] when there is none).',
    'Note: the canonical record nests the task envelope under decisionInput.task, so its taskId is decisionInput.task.taskId, NOT the top-level dispatch record.',
    'Use FAILED or BLOCKED when the read-only probe could not be completed.',
  ].join(' ');
}

// DeepSeek OpenAI-format thinking toggle. The opencode-go gateway rejects the
// forced tool choice that JSON-schema structured output requires while DeepSeek
// thinking mode is active (upstream anomalyco/opencode#15226), so the adapter
// pins thinking to disabled for the fixed opencode-go DeepSeek model family in
// the adapter-authored config: the SAME model is used (never a fallback model),
// this is a fixed request parameter, and the task payload cannot influence it.
function buildStructuredOutputModelOptions(modelReference) {
  if (modelReference.providerID !== 'opencode-go') return undefined;
  if (!modelReference.modelID.toLowerCase().includes('deepseek')) return undefined;
  return { thinking: { type: 'disabled' } };
}

// The fixed adapter-authored OpenCode configuration: agent identity, model,
// the read-only permission ruleset at both the top level and the agent level,
// and the fixed structured-output compatibility options. The task payload
// contributes nothing here.
function buildOpenCodeReadOnlyConfigContent(model, modelReference) {
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
  const configuration = {
    $schema: 'https://opencode.ai/config.json',
    share: 'disabled',
    permission: deniedPermission,
    agent: {
      [OPENCODE_READONLY_AGENT_NAME]: {
        description: 'Greenhub READ_ONLY coordination executor: no repository mutation capability',
        mode: 'primary',
        model,
        prompt: buildOpenCodeReadOnlyAgentPrompt(),
        permission: deniedPermission,
      },
    },
  };
  const modelOptions = buildStructuredOutputModelOptions(modelReference);
  if (modelOptions !== undefined) {
    configuration.provider = {
      [modelReference.providerID]: {
        models: {
          [modelReference.modelID]: { options: modelOptions },
        },
      },
    };
  }
  return JSON.stringify(configuration);
}

// The exact six-field JSON Schema requested through the OpenCode structured
// output surface. The bounds and vocabulary are reused verbatim from the Task
// 33 six-field contract; the schema never pins taskId to a specific value, so
// the exact taskId binding stays owned by Task 33 downstream.
function buildStructuredResultJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...EXECUTOR_RESULT_RECEIPT_STRUCTURED_FIELDS],
    properties: {
      taskId: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: [...EXECUTOR_RESULT_RECEIPT_STATUS_VALUES] },
      summary: { type: 'string', minLength: 1, maxLength: MAX_SUMMARY_LENGTH },
      proofRefs: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: MAX_REF_STRING_LENGTH },
      },
      evidenceRefs: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: MAX_REF_STRING_LENGTH },
      },
      frictionObserved: {
        type: 'array',
        maxItems: MAX_FRICTION_ENTRIES,
        items: { type: 'string', minLength: 1, maxLength: MAX_FRICTION_ENTRY_LENGTH },
      },
    },
  };
}

function buildStructuredExecutorChildEnvironment(explicitEnv, model, modelReference) {
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
  // environment map can never inject or weaken an OPENCODE_* variable. `serve`
  // has no --pure flag, so OPENCODE_PURE is the pure-mode authority here.
  childEnvironment[OPENCODE_CLI_EXECUTOR_PURE_ENV_KEY] = '1';
  childEnvironment[OPENCODE_CLI_EXECUTOR_DISABLE_PROJECT_CONFIG_ENV_KEY] = '1';
  childEnvironment[OPENCODE_CLI_EXECUTOR_CONFIG_CONTENT_ENV_KEY] =
    buildOpenCodeReadOnlyConfigContent(model, modelReference);
  return Object.freeze(childEnvironment);
}

// Deterministic, idempotent server process termination: on Windows the whole
// process tree is force-terminated through taskkill (the same primitive the
// official SDK uses); otherwise a direct kill is attempted. The returned
// function is the ONLY way this module terminates the server process.
function createOpenCodeServerStop(child) {
  let stopped = false;
  return function stopOpenCodeServer() {
    if (stopped) return Promise.resolve();
    stopped = true;
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    if (process.platform === 'win32' && Number.isInteger(child.pid)) {
      try {
        const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        if (!result.error && result.status === 0) return Promise.resolve();
      } catch {
        // Fall through to the direct kill.
      }
    }
    try {
      child.kill();
    } catch {
      // The process is already gone.
    }
    return Promise.resolve();
  };
}

/**
 * The bounded default server-process runner: ONE `opencode serve` child process
 * started with the adapter-authored argv/environment/cwd. It waits for the
 * documented readiness line with a single fixed deadline and returns EITHER
 * `{ kind: 'started', baseUrl, stop }` OR `{ kind: 'start-failed', errorCode }`.
 * The child is force-terminated before any start failure is reported, so a
 * failed start never leaks a server process.
 *
 * Exported for focused process-level verification; the executor always calls it
 * with exactly { command, args, cwd, env } and the optional startTimeoutMs is a
 * test seam only (the default bound is the production value).
 */
export function defaultOpenCodeServerRunner({
  command,
  args,
  cwd,
  env,
  startTimeoutMs = DEFAULT_OPENCODE_SERVER_START_TIMEOUT_MS,
}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let startupOutput = '';
    let startupTruncated = false;
    let stop = () => Promise.resolve();
    const settle = (observation) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(observation);
    };
    const failStart = (errorCode) => settle({ kind: 'start-failed', errorCode });
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      const errorCode =
        typeof error?.code === 'string' && error.code.length > 0
          ? error.code
          : 'UNKNOWN_PROCESS_START_ERROR';
      failStart(errorCode);
      return;
    }
    stop = createOpenCodeServerStop(child);
    timer = setTimeout(() => {
      void stop();
      failStart(OPENCODE_SERVER_START_TIMEOUT_ERROR_CODE);
    }, startTimeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (settled || startupTruncated) return;
      const text = typeof chunk === 'string' ? chunk : String(chunk);
      if (
        Buffer.byteLength(startupOutput, 'utf8') + Buffer.byteLength(text, 'utf8') >
        MAX_OPENCODE_SERVER_STARTUP_OUTPUT_BYTES
      ) {
        startupTruncated = true;
        return;
      }
      startupOutput += text;
      let newlineIndex = startupOutput.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = startupOutput.slice(0, newlineIndex).replace(/\r$/, '');
        startupOutput = startupOutput.slice(newlineIndex + 1);
        if (line.startsWith(OPENCODE_SERVER_READY_LINE_PREFIX)) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (!match) {
            void stop();
            failStart(OPENCODE_SERVER_UNREADABLE_READY_URL_ERROR_CODE);
            return;
          }
          settle({ kind: 'started', baseUrl: match[1], stop });
          return;
        }
        newlineIndex = startupOutput.indexOf('\n');
      }
    });
    // stderr is drained and never interpreted or promoted to evidence.
    child.stderr.on('data', () => {});
    child.once('error', (error) => {
      const errorCode =
        typeof error?.code === 'string' && error.code.length > 0
          ? error.code
          : 'UNKNOWN_PROCESS_START_ERROR';
      void stop();
      failStart(errorCode);
    });
    child.once('close', (code) => {
      if (settled) return;
      void stop();
      failStart(
        `OPENCODE_SERVER_PROCESS_EXITED_BEFORE_READY_${Number.isInteger(code) ? code : 'UNOBSERVED'}`,
      );
    });
  });
}

// The default typed SDK client factory. The SDK is loaded from the installed
// @opencode-ai/sdk 1.18.31 package; loading is deferred to invocation time so
// the module itself never depends on load-time side effects.
async function defaultOpenCodeClientFactory({ baseUrl, directory }) {
  let sdk;
  try {
    sdk = await import('@opencode-ai/sdk');
  } catch (error) {
    fail(
      `the OpenCode SDK client (@opencode-ai/sdk) could not be loaded (fail-closed): ${error?.message}`,
    );
  }
  if (typeof sdk?.createOpencodeClient !== 'function') {
    fail(
      'the installed @opencode-ai/sdk package does not expose createOpencodeClient (fail-closed).',
    );
  }
  return sdk.createOpencodeClient({ baseUrl, directory });
}

// Binding to loopback only: the record may never be sent to a non-local
// endpoint, even if a caller-supplied runner returns one.
function assertLoopbackServerBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    fail(
      'OpenCode CLI structured-result server runner must report a non-empty baseUrl (fail-closed).',
      INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    fail(
      `the OpenCode server baseUrl is not a valid URL (fail-closed): ${baseUrl}`,
      INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(
      `the OpenCode server baseUrl must use http/https (fail-closed): ${baseUrl}`,
      INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
  const hostname = url.hostname.toLowerCase();
  const isLoopback =
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1';
  if (!isLoopback) {
    fail(
      `the OpenCode server baseUrl must be loopback-only (fail-closed): ${baseUrl}`,
      INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    fail(
      'the OpenCode server baseUrl must not carry credentials (fail-closed).',
      INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
  return url;
}

function assertExactRunnerResultKeys(result, expectedKeys) {
  if (Object.getOwnPropertySymbols(result).length > 0) {
    fail(
      'OpenCode CLI structured-result server runner result must not carry symbol keys.',
      INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
  const ownKeys = Object.getOwnPropertyNames(result);
  const exact =
    ownKeys.length === expectedKeys.length && expectedKeys.every((key) => ownKeys.includes(key));
  if (!exact) {
    fail(
      `OpenCode CLI structured-result server runner result shape must be exactly (${expectedKeys.join(', ')}); received (${ownKeys.join(', ')}).`,
      INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
    );
  }
}

function describeSdkError(error) {
  if (error !== null && typeof error === 'object') {
    if (typeof error.name === 'string' && error.name.length > 0) {
      const nested = typeof error.data === 'object' && error.data !== null ? error.data : null;
      const nestedMessage =
        nested && typeof nested.message === 'string' && nested.message.length > 0
          ? nested.message
          : null;
      return nestedMessage === null ? error.name : `${error.name}: ${nestedMessage}`;
    }
    if (typeof error.message === 'string' && error.message.length > 0) return error.message;
  }
  return typeof error === 'string' ? error : 'unknown SDK error';
}

function assertSdkResultUsable(result, what) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    fail(
      `${what} returned no usable SDK result (fail-closed).`,
      OPENCODE_CLI_EXECUTOR_REQUEST_FAILED,
    );
  }
  if (result.error !== undefined && result.error !== null) {
    throw new OpenCodeCliStructuredResultExecutorError(
      `${what} failed (fail-closed): ${describeSdkError(result.error)}`,
      { code: OPENCODE_CLI_EXECUTOR_REQUEST_FAILED },
    );
  }
}

// The validated structured object is read from the assistant message info
// structured channel(s) ONLY. Assistant prose text is never inspected. The
// runtime-authoritative channel at OpenCode 1.18.31 is `structured`; the newer
// documented alias `structured_output` is accepted as the same exact channel.
// If both are present they must agree; otherwise the invocation fails closed.
function readAssistantStructuredOutput(info) {
  const channels = [
    ['structured_output', info.structured_output],
    ['structured', info.structured],
  ];
  const present = channels.filter(([, value]) => value !== undefined && value !== null);
  if (present.length === 0) {
    fail(
      'the OpenCode assistant message carries no validated structured output; prose text is never promoted to a result and process success alone is never evidence (fail-closed).',
      MISSING_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  if (present.length > 1 && JSON.stringify(present[0][1]) !== JSON.stringify(present[1][1])) {
    fail(
      'the OpenCode assistant message carries two disagreeing structured output channels (fail-closed).',
      INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  const structured = present[0][1];
  if (structured === null || typeof structured !== 'object' || Array.isArray(structured)) {
    fail(
      'the OpenCode structured output must be ONE plain JSON object with the six executor-authored fields (fail-closed).',
      INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  return structured;
}

/**
 * Run ONE fenced structured prompt against the adapter-started local server:
 * exactly ONE session create and exactly ONE structured prompt. Any assistant
 * error (including StructuredOutputError) fails closed; the result is taken
 * from the validated structured channel ONLY.
 */
async function runOpenCodeStructuredPrompt({ client, workdir, modelReference, prompt }) {
  if (
    client === null ||
    typeof client !== 'object' ||
    typeof client.session?.create !== 'function' ||
    typeof client.session?.prompt !== 'function'
  ) {
    fail(
      'the OpenCode SDK client must expose session.create and session.prompt (fail-closed).',
      OPENCODE_CLI_EXECUTOR_REQUEST_FAILED,
    );
  }
  const created = await client.session.create({
    body: { title: 'Greenhub READ_ONLY coordination executor' },
    query: { directory: workdir },
  });
  assertSdkResultUsable(created, 'OpenCode session create');
  const sessionId = created.data?.id;
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    fail(
      'OpenCode session create returned no session identity (fail-closed).',
      OPENCODE_CLI_EXECUTOR_REQUEST_FAILED,
    );
  }
  const prompted = await client.session.prompt({
    path: { id: sessionId },
    body: {
      agent: OPENCODE_READONLY_AGENT_NAME,
      model: modelReference,
      parts: [{ type: 'text', text: prompt }],
      format: { type: 'json_schema', schema: buildStructuredResultJsonSchema() },
    },
  });
  assertSdkResultUsable(prompted, 'OpenCode structured prompt');
  const info = prompted.data?.info;
  if (info === null || typeof info !== 'object' || Array.isArray(info)) {
    fail(
      'OpenCode structured prompt returned no assistant message info (fail-closed).',
      OPENCODE_CLI_EXECUTOR_REQUEST_FAILED,
    );
  }
  if (info.error !== undefined && info.error !== null) {
    const errorName = typeof info.error?.name === 'string' ? info.error.name : 'unknown';
    const isStructuredOutputError = errorName === 'StructuredOutputError';
    fail(
      isStructuredOutputError
        ? `the OpenCode structured-output attempt failed (${describeSdkError(info.error)}); no validated object exists and no synthetic result is ever created (fail-closed).`
        : `the OpenCode assistant message carries error ${describeSdkError(info.error)} (fail-closed).`,
      INVALID_EXECUTOR_STRUCTURED_RESULT,
    );
  }
  // The exact taskId binding decision is NEVER made here: the adapter returns
  // the validated structured object and Task 33 / Task 34 own the binding
  // mismatch meaning (EXECUTOR_STRUCTURED_RESULT_BINDING_MISMATCH).
  return readAssistantStructuredOutput(info);
}

/**
 * Create the ONE concrete OpenCode SDK structured-result executor.
 *
 * Narrow configuration boundary (caller-supplied at creation ONLY; never taken
 * from the task payload):
 * - `executablePath`: absolute path of the native OpenCode executable started
 *   as `opencode serve --hostname=127.0.0.1 --port=0`;
 * - `workdir`: absolute working directory fixed for every invocation (server
 *   cwd and session directory);
 * - `model`: the fixed `provider/model` used by the read-only agent and by the
 *   structured prompt;
 * - `runner`: optional bounded server-process seam receiving exactly
 *   { command, args, cwd, env } and resolving to EITHER
 *   { kind: 'started', baseUrl, stop } OR { kind: 'start-failed', errorCode };
 *   when omitted, the module default server runner is the only process
 *   boundary;
 * - `clientFactory`: optional typed-client seam receiving exactly
 *   { baseUrl, directory } and resolving to an SDK client exposing
 *   session.create / session.prompt; when omitted, the installed
 *   @opencode-ai/sdk client is used;
 * - `env`: optional explicit allowlisted environment projection.
 * Unknown configuration fields fail closed (zero process invocations).
 *
 * The returned function is the exact Task 33 structured executor contract:
 *   async function executor(task28Record) ->
 *     { schemaVersion: 1, dispatchId, outcome, result }
 * with outcome in ACCEPTED | REJECTED | UNKNOWN. Only ACCEPTED is produced here
 * (REJECTED/UNKNOWN remain part of the Task 30 vocabulary but this SDK boundary
 * never observes an exit code as a protocol outcome): result is the validated
 * six-field payload for ACCEPTED and exactly null otherwise. It starts AT MOST
 * ONE server process, sends AT MOST ONE structured prompt, never retries, never
 * falls back, never selects another model, and terminates the server in
 * finally cleanup on success and on failure.
 */
export function createOpenCodeCliStructuredResultExecutor(configuration = {}) {
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)) {
    fail('OpenCode CLI structured-result executor configuration must be an object.');
  }
  assertNoUnknownStructuredExecutorConfigurationFields(configuration);
  const command = assertValidConfigurationPath(configuration.executablePath, 'executablePath');
  const childWorkdir = assertValidConfigurationPath(configuration.workdir, 'workdir');
  const model = assertValidConfigurationModel(configuration.model);
  const modelReference = parseOpenCodeModelReference(model);
  if (configuration.runner !== undefined && typeof configuration.runner !== 'function') {
    fail(
      'OpenCode CLI structured-result executor configuration runner must be a function when provided.',
    );
  }
  if (
    configuration.clientFactory !== undefined &&
    typeof configuration.clientFactory !== 'function'
  ) {
    fail(
      'OpenCode CLI structured-result executor configuration clientFactory must be a function when provided.',
    );
  }
  const processRunner =
    configuration.runner === undefined ? defaultOpenCodeServerRunner : configuration.runner;
  const clientFactory =
    configuration.clientFactory === undefined
      ? defaultOpenCodeClientFactory
      : configuration.clientFactory;
  const childEnvironment = buildStructuredExecutorChildEnvironment(
    configuration.env,
    model,
    modelReference,
  );

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

    // AT MOST ONE server process per invocation. Runner throw/rejection
    // propagates unchanged: there is no catch, no retry, and no second start.
    const runnerResult = await processRunner({
      command,
      args: ['serve', `--hostname=${OPENCODE_SERVER_HOSTNAME}`, `--port=${OPENCODE_SERVER_PORT}`],
      cwd: childWorkdir,
      env: childEnvironment,
    });

    if (runnerResult === null || typeof runnerResult !== 'object' || Array.isArray(runnerResult)) {
      fail(
        'OpenCode CLI structured-result server runner result must be a plain record describing ONE bounded server-process observation.',
        INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
      );
    }
    if (runnerResult.kind === 'start-failed') {
      assertExactRunnerResultKeys(runnerResult, ['kind', 'errorCode']);
      if (typeof runnerResult.errorCode !== 'string' || runnerResult.errorCode.length === 0) {
        fail(
          'OpenCode CLI structured-result server runner result kind "start-failed" requires a non-empty errorCode.',
          INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
        );
      }
      throw new OpenCodeCliStructuredResultExecutorError(
        `OpenCode server process could not be started (errorCode ${runnerResult.errorCode}): configuration / process-start failure only, never a protocol outcome.`,
        { code: OPENCODE_CLI_EXECUTOR_PROCESS_START_FAILED },
      );
    }
    if (runnerResult.kind !== 'started') {
      fail(
        `unsupported OpenCode CLI structured-result server runner result kind ${JSON.stringify(runnerResult.kind)}: no fourth outcome and no automatic re-invocation exists.`,
        INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
      );
    }
    assertExactRunnerResultKeys(runnerResult, ['kind', 'baseUrl', 'stop']);
    if (typeof runnerResult.stop !== 'function') {
      fail(
        'OpenCode CLI structured-result server runner result kind "started" requires a stop function for deterministic cleanup.',
        INVALID_OPENCODE_CLI_STRUCTURED_RESULT_EXECUTOR_RUNNER_RESULT,
      );
    }

    // ONE fenced invocation: localhost transport only, one session, one prompt.
    // The started server is deterministically terminated in finally cleanup on
    // success AND on failure; the record is never sent to a non-loopback URL.
    try {
      assertLoopbackServerBaseUrl(runnerResult.baseUrl);
      const client = await clientFactory({
        baseUrl: runnerResult.baseUrl,
        directory: childWorkdir,
      });
      const prompt = JSON.stringify(task28Record);
      const structured = await runOpenCodeStructuredPrompt({
        client,
        workdir: childWorkdir,
        modelReference,
        prompt,
      });
      return Object.freeze({
        schemaVersion: EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
        dispatchId,
        outcome: EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
        result: structured,
      });
    } finally {
      await runnerResult.stop();
    }
  };
}
