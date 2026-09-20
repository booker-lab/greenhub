// Bounded concrete-executor owner:
// GREENHUB-COORDINATION-CONCRETE-CODEX-CLI-EXECUTOR-ADAPTER-31.
// Surface: scripts/coordination/*codex-cli-executor-adapter* (this module) +
// composition of the Task 30 public outcome vocabulary ONLY
//   EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION
//   EXECUTOR_INVOCATION_OUTCOME_ACCEPTED / _REJECTED / _UNKNOWN
// over the unchanged durable authority
// <coordination-home>/executor-invocation-attempts/<dispatchId>.json.
// No store.mjs mutation. No Task 18~30 source or spec mutation.
//
// State transition added here:
//   DURABLE EXECUTOR INVOCATION ATTEMPT (Task 28 record, read by Task 29)
//     -> caller-supplied adapter invocation (Task 29)
//     -> concrete Codex CLI non-interactive process boundary (this module)
//     -> exact Task 30 outcome contract { schemaVersion: 1, dispatchId, outcome }
//
// Contract summary:
//   createCodexCliExecutorAdapter() != invokeExecutor() != executeTask()
//     != executor registry != worker registry != executor selection
//     != capability matching != environment-based selection != fallback
//     != retry/backoff/resend.
//   The created adapter is EXACTLY ONE concrete executor integration: it
//   accepts the EXACT validated Task 28 record handed over by Task 29 and
//   hands that record to AT MOST ONE Codex CLI non-interactive process.
//   It reads no durable state of its own (no store, no Task 27/26/24
//   reconstruction, no task/claim lookup, no directory scan), writes no
//   durable state, and creates no ACK, receipt, invoked/started marker, retry
//   counter, process record, pid artifact, task RUNNING status, task result,
//   disposition, or new coordination namespace.
//   ACCEPTED = the Codex CLI invocation boundary completed normally (process
//     exit code 0). ACCEPTED != task started != task RUNNING != task
//     completed != code modified != tests passed != result delivered
//     != ACK persisted != executor semantically received the task.
//   REJECTED = the Codex CLI invocation boundary exited non-zero (explicit
//     process/protocol refusal or abort). REJECTED != task failed.
//   UNKNOWN = the process started but no exit status was observable. UNKNOWN
//     is NOT a retry permission: this module has NO retry, NO backoff, NO
//     resend, NO second invocation, NO fallback executor, and NO alternate
//     executable. API call 1회당 Codex CLI process invocation is AT MOST ONE.
//   Global exactly-once execution is NOT claimed.
//
// Fail-closed boundary (never collapsed into UNKNOWN):
//   - invalid adapter configuration: the factory throws before any runner can
//     be called (zero process invocations);
//   - invalid Task 28 record input: the adapter rejects before any process
//     invocation;
//   - malformed runner result: typed INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT
//     fail-closed error, no retry;
//   - process start failure (spawn error): typed
//     CODEX_CLI_EXECUTOR_PROCESS_START_FAILED error, never UNKNOWN;
//   - runner thrown/rejected value: propagated to the caller with the EXACT
//     same value, never caught and never remapped.
//
// Process invocation contract (argv-only, shell-free):
//   - command = caller-configured absolute Codex CLI executable path;
//     NEVER taken from the task payload, never environment-selected;
//   - args    = ['exec', '--sandbox', 'read-only', '--ephemeral', '--cd',
//                <workdir>, <canonical Task 28 record as ONE prompt argv>];
//   - cwd     = caller-configured absolute workdir; also passed as the Codex
//     CLI --cd working root; NEVER taken from the task payload;
//   - shell: false, no exec/execSync/execFile/shell string concatenation, no
//     shell interpolation of the task payload: the payload is one argv element;
//   - stdio   = ['ignore', 'ignore', 'ignore']: Codex CLI stdout/stderr text
//     and JSON are NEVER read, NEVER interpreted, and NEVER promoted to a task
//     result, ACK, success proof, or completion signal;
//   - env     = fixed allowlist projection of the operator environment (or an
//     explicit caller-supplied map at adapter creation); no task-derived
//     environment exists;
//   - --sandbox read-only so task-derived commands cannot mutate the
//     workspace; --ephemeral avoids Codex session persistence.
//
// Input mapping:
//   The adapter consumes the EXACT validated Task 28 record. The execution
//   payload authority inside it is decisionInput.task (the Task Envelope v1
//   from the Task 20 transport request). The adapter serializes that EXACT
//   record (no wrapper schema, no reinterpretation, no new identity, no new
//   generation) as canonical compact JSON and delivers it as one argv element.
//   dispatchId / nextTaskId / workerId / claimGeneration remain provenance /
//   fencing context INSIDE the record; claimGeneration stays the SOLE fencing
//   generation.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   OpenCode / MCP / HTTP / WebSocket / gRPC adapter, executor registry,
//   worker registry, executor selection, capability matching, fallback
//   executor, environment-based executor selection, second spawn, retry,
//   backoff, resend, retry counter, scheduler, polling, daemon, cron, queue
//   consumer, task RUNNING, ACK protocol, ACK persistence, durable receipt,
//   result ingestion, result persistence, task completion, deliverResult
//   changes, claim mutation/extension/takeover, new generation authority,
//   production deploy, any node:fs access, store.mjs mutation, Task 18~30
//   source or spec mutation.

import { spawn } from 'node:child_process';
import nodePath from 'node:path';
import {
  EXECUTOR_INVOCATION_OUTCOME_ACCEPTED,
  EXECUTOR_INVOCATION_OUTCOME_REJECTED,
  EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
  EXECUTOR_INVOCATION_OUTCOME_UNKNOWN,
} from './dispatch-executor-invocation-outcome.mjs';

// The fixed child environment allowlist. Only operator-environment variables
// needed to start an OS process and to locate the Codex CLI home are copied;
// every other variable (tokens, secrets, proxies, app state) is dropped. Task
// payloads can never add, remove, or alter an entry.
export const CODEX_CLI_EXECUTOR_ENV_ALLOWLIST = Object.freeze([
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
  'CODEX_HOME',
]);

// Adapter-native meanings ONLY. Predecessor codes and runner throw/rejection
// values are NEVER remapped to these codes.
export const INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION =
  'INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION';
export const INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD = 'INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD';
export const INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT = 'INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT';
export const CODEX_CLI_EXECUTOR_PROCESS_START_FAILED = 'CODEX_CLI_EXECUTOR_PROCESS_START_FAILED';

export class CodexCliExecutorAdapterError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CodexCliExecutorAdapterError';
    this.code = details.code ?? INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION;
  }
}

function fail(message, code = INVALID_CODEX_CLI_EXECUTOR_ADAPTER_CONFIGURATION) {
  throw new CodexCliExecutorAdapterError(message, { code });
}

const ADAPTER_CONFIGURATION_FIELDS = Object.freeze(['executablePath', 'workdir', 'runner', 'env']);

function assertValidConfigurationPath(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(
      `Codex CLI executor adapter configuration requires a non-empty absolute ${fieldName} (the task payload never selects the executable or the working directory).`,
    );
  }
  if (value.includes('\0')) {
    fail(`Codex CLI executor adapter configuration ${fieldName} must not contain NUL bytes.`);
  }
  if (!nodePath.isAbsolute(value)) {
    fail(
      `Codex CLI executor adapter configuration ${fieldName} must be an absolute path (the task payload never selects the executable or the working directory).`,
    );
  }
  return value;
}

function assertNoUnknownConfigurationFields(configuration) {
  if (Object.getOwnPropertySymbols(configuration).length > 0) {
    fail('Codex CLI executor adapter configuration must not carry symbol keys.');
  }
  const ownKeys = Object.getOwnPropertyNames(configuration);
  for (const key of ownKeys) {
    if (!ADAPTER_CONFIGURATION_FIELDS.includes(key)) {
      fail(
        `Codex CLI executor adapter configuration accepts exactly (${ADAPTER_CONFIGURATION_FIELDS.join(', ')}); received unknown field "${key}".`,
      );
    }
  }
}

// Minimal payload-authority guard only. The EXACT Task 28 record shape,
// schemaVersion, decision value, and Task 20 decisionInput validity are owned
// by Task 29 / Task 24 / Task 20 and are NOT re-validated or duplicated here.
function assertInvocableTask28Record(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    fail(
      'Codex CLI executor adapter invocation requires the EXACT validated Task 28 record handed over by Task 29 (received a non-record).',
      INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD,
    );
  }
  if (typeof record.dispatchId !== 'string' || record.dispatchId.trim().length === 0) {
    fail(
      'Codex CLI executor adapter invocation requires the exact Task 28 record dispatchId (execution identity is preserved verbatim; no new identity exists).',
      INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD,
    );
  }
  const decisionInput = record.decisionInput;
  if (decisionInput === null || typeof decisionInput !== 'object' || Array.isArray(decisionInput)) {
    fail(
      'Codex CLI executor adapter invocation requires the Task 28 record decisionInput (the exact Task 20 transport request).',
      INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD,
    );
  }
  const task = decisionInput.task;
  if (task === null || typeof task !== 'object' || Array.isArray(task)) {
    fail(
      'Codex CLI executor adapter invocation requires the Task 20 transport request task envelope (the execution payload authority is record.decisionInput.task).',
      INVALID_CODEX_CLI_EXECUTOR_TASK28_RECORD,
    );
  }
  return record.dispatchId;
}

function buildChildEnvironment(explicitEnv) {
  const childEnvironment = Object.create(null);
  if (explicitEnv === undefined) {
    for (const name of CODEX_CLI_EXECUTOR_ENV_ALLOWLIST) {
      const value = process.env[name];
      if (typeof value === 'string' && !value.includes('\0')) {
        childEnvironment[name] = value;
      }
    }
    return Object.freeze(childEnvironment);
  }
  if (explicitEnv === null || typeof explicitEnv !== 'object' || Array.isArray(explicitEnv)) {
    fail(
      'Codex CLI executor adapter configuration env must be an explicit plain record of string values when provided.',
    );
  }
  for (const [name, value] of Object.entries(explicitEnv)) {
    if (name.length === 0 || name.includes('=') || name.includes('\0')) {
      fail(
        'Codex CLI executor adapter configuration env names must be non-empty and must not contain "=" or NUL bytes.',
      );
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      fail(
        `Codex CLI executor adapter configuration env value for ${JSON.stringify(name)} must be a string without NUL bytes.`,
      );
    }
    childEnvironment[name] = value;
  }
  return Object.freeze(childEnvironment);
}

// The ONLY process boundary in this module. Normalized, settle-once process
// observation with an explicitly closed stdin/stdout/stderr boundary. A
// synchronous spawn programming error (e.g. invalid spawn options) rejects
// the returned promise and propagates unchanged; executable/OS start failures
// are reported as start-failed.
function defaultCodexCliProcessRunner({ command, args, cwd, env }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
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
        settle({ kind: 'exited', code });
      } else {
        settle({ kind: 'terminated-without-exit-status' });
      }
    });
  });
}

function assertExactRunnerResultKeys(result, expectedKeys) {
  if (Object.getOwnPropertySymbols(result).length > 0) {
    fail(
      'Codex CLI runner result must not carry symbol keys.',
      INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT,
    );
  }
  const ownKeys = Object.getOwnPropertyNames(result);
  const exact =
    ownKeys.length === expectedKeys.length && expectedKeys.every((key) => ownKeys.includes(key));
  if (!exact) {
    fail(
      `Codex CLI runner result shape must be exactly (${expectedKeys.join(', ')}); received (${ownKeys.join(', ')}).`,
      INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT,
    );
  }
}

// The EXACT runner-result -> Task 30 outcome mapping. There is no fourth
// outcome, no automatic retry, and no normalization of runner failures.
function mapRunnerResultToProtocolOutcome(result) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    fail(
      'Codex CLI runner result must be a plain record describing ONE process-boundary observation.',
      INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT,
    );
  }
  if (result.kind === 'exited') {
    assertExactRunnerResultKeys(result, ['kind', 'code']);
    if (!Number.isInteger(result.code)) {
      fail(
        'Codex CLI runner result kind "exited" requires an integer exit code.',
        INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT,
      );
    }
    return result.code === 0
      ? EXECUTOR_INVOCATION_OUTCOME_ACCEPTED
      : EXECUTOR_INVOCATION_OUTCOME_REJECTED;
  }
  if (result.kind === 'terminated-without-exit-status') {
    assertExactRunnerResultKeys(result, ['kind']);
    return EXECUTOR_INVOCATION_OUTCOME_UNKNOWN;
  }
  if (result.kind === 'start-failed') {
    assertExactRunnerResultKeys(result, ['kind', 'errorCode']);
    if (typeof result.errorCode !== 'string' || result.errorCode.length === 0) {
      fail(
        'Codex CLI runner result kind "start-failed" requires a non-empty errorCode.',
        INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT,
      );
    }
    fail(
      `Codex CLI process could not be started (errorCode ${result.errorCode}): adapter configuration / process-start failure only, never a protocol outcome.`,
      CODEX_CLI_EXECUTOR_PROCESS_START_FAILED,
    );
  }
  fail(
    `unsupported Codex CLI runner result kind ${JSON.stringify(result.kind)}: no fourth outcome and no automatic re-invocation exists.`,
    INVALID_CODEX_CLI_EXECUTOR_RUNNER_RESULT,
  );
}

/**
 * Create the ONE concrete Codex CLI executor adapter.
 *
 * Narrow configuration boundary (caller-supplied at creation ONLY; never taken
 * from the task payload):
 * - `executablePath`: absolute path of the Codex CLI executable;
 * - `workdir`: absolute working directory fixed for every invocation (also
 *   passed as the Codex CLI --cd working root);
 * - `runner`: optional process-invocation seam (a function receiving exactly
 *   { command, args, cwd, env }); when omitted, the module default runner is
 *   the only process boundary;
 * - `env`: optional explicit child environment map (string values); when
 *   omitted, the fixed CODEX_CLI_EXECUTOR_ENV_ALLOWLIST projection is used.
 * Unknown configuration fields fail closed (zero process invocations).
 *
 * The returned function is the exact Task 29 adapter contract:
 *   async function adapter(task28Record) -> { schemaVersion: 1, dispatchId, outcome }
 * It invokes the runner AT MOST ONCE per call and never retries, never falls
 * back, and never selects another executable.
 */
export function createCodexCliExecutorAdapter(configuration = {}) {
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)) {
    fail('Codex CLI executor adapter configuration must be an object.');
  }
  assertNoUnknownConfigurationFields(configuration);
  const command = assertValidConfigurationPath(configuration.executablePath, 'executablePath');
  const childWorkdir = assertValidConfigurationPath(configuration.workdir, 'workdir');
  if (configuration.runner !== undefined && typeof configuration.runner !== 'function') {
    fail(
      'Codex CLI executor adapter configuration runner must be a function when provided (the module default runner is the only process boundary).',
    );
  }
  const processRunner =
    configuration.runner === undefined ? defaultCodexCliProcessRunner : configuration.runner;
  const childEnvironment = buildChildEnvironment(configuration.env);

  return async function codexCliExecutorAdapter(task28Record) {
    // Invalid record input performs zero process invocations.
    const dispatchId = assertInvocableTask28Record(task28Record);
    // The EXACT validated Task 28 record is the payload: no wrapper schema, no
    // reconstructed predecessor state, no task reinterpretation. Canonical
    // compact JSON is one argv element and is never shell-interpreted.
    const prompt = JSON.stringify(task28Record);
    // AT MOST ONE process invocation. Runner throw/rejection propagates
    // unchanged; there is no catch, no retry, and no second invocation.
    const runnerResult = await processRunner({
      command,
      args: ['exec', '--sandbox', 'read-only', '--ephemeral', '--cd', childWorkdir, prompt],
      cwd: childWorkdir,
      env: childEnvironment,
    });
    const outcome = mapRunnerResultToProtocolOutcome(runnerResult);
    return Object.freeze({
      schemaVersion: EXECUTOR_INVOCATION_OUTCOME_SCHEMA_VERSION,
      dispatchId,
      outcome,
    });
  };
}
