// Bounded on-demand next-work sourcing owner:
// GREENHUB-COORDINATION-ON-DEMAND-NEXT-WORK-SOURCING-36.
// Surface: scripts/coordination/*on-demand-next-work-sourcing-adapter* ONLY.
// No store.mjs mutation, no Task Envelope schema mutation, no coordination
// store schema mutation, no canonical task lifecycle mutation, no
// result-delivery semantics mutation, no application/OpenCode/Operator CLI/
// Notion surface mutation. No durable coordination state is added.
//
// Role split this adapter preserves:
//   OpenCode      = actual implementation executor (source mutation, tests).
//   Control Tower = result intake, canonical state recompute, DROP | WATCH |
//                   CHANGE, next bounded task authorship.
//   Codex / Astra = OPTIONAL, ON-DEMAND, READ-ONLY next-work sourcing agent
//                   only (this module), never part of the per-task completion
//                   loop.
//
// Contract summary:
//   createOnDemandNextWorkSourcingAdapter() != Control Tower
//     != task creation != OpenCode dispatch != executor adapter != scheduler
//     != polling != watcher != reminder != durable registry.
//   OPTIONAL_DISCOVERY != AUTOMATIC_POST_PROCESSING:
//     OPEN_CODE_RESULT != CODEX_TRIGGER, TASK_CLOSED != CODEX_TRIGGER,
//     CODEX_CANDIDATE != CANONICAL_TASK.
//   The created adapter accepts EXACTLY ONE caller request, requires the
//   caller-supplied explicit approval signal `userApproved: true`, performs at
//   most ONE read-only Codex/Astra process invocation, validates the
//   structured sourcing result, and returns it to the caller as an explicitly
//   NON_CANONICAL / CONTROL_TOWER_REVIEW_REQUIRED payload. It never creates a
//   task, never writes durable coordination state, never dispatches OpenCode,
//   never opens a PR/branch/commit, and never deploys.
//
// Invocation approval gate (fail-closed BEFORE any process or write):
//   - `userApproved` must be EXACTLY the boolean true;
//   - absent / false / malformed / ambiguous -> typed
//     CODEX_RESEARCH_REQUIRES_EXPLICIT_USER_APPROVAL;
//   - zero process invocations, zero durable writes, no retry, no fallback;
//   - approval is invocation permission ONLY: it is not durable task state,
//     not a coordination lifecycle status, not a scheduler signal, and it is
//     never persisted;
//   - approval is NEVER inferred from task completion, RESULT_DELIVERED,
//     CHANGE classification, lack of queued work, elapsed time, WATCH state,
//     user silence, previous approval, Notion state, environment variables,
//     or an existing Codex receipt. Every investigation invocation needs an
//     explicit current call.
//
// Investigation input boundary (reference-first, bounded):
//   allowed scope fields: domain, questions, repositoryAreas, policyRefs,
//   contextRefs, evidenceRefs, liveMainHint, knownConstraints, excludedAreas.
//   Full chat history, previous transcripts, previous RESULT bodies, full
//   SSOT documents, repository dumps, unrelated project history, and large
//   task chains are structurally rejected by bounded reference validation.
//   liveMainHint is a HINT ONLY: shape-validated, labeled HINT_ONLY in the
//   prompt, never read as current repository fact, and never used to make an
//   adapter decision. Current authoritative evidence always comes from the
//   investigator directly reading current sources.
//
// Process invocation contract (argv-only, shell-free, AT MOST ONE):
//   - command = caller-configured absolute Codex/Astra executable path at
//     adapter creation; NEVER taken from the request;
//   - args    = ['exec', '--sandbox', 'read-only', '--ephemeral',
//                '--output-schema', <schemaFile>,
//                '--output-last-message', <resultFile>,
//                '--cd', <workdir>, <prompt>];
//   - cwd     = caller-configured absolute workdir; NEVER request-selected;
//   - shell: false and no shell interpolation: the prompt is ONE argv element;
//   - stdio   = ['ignore', 'ignore', 'ignore']: stdout/stderr are never read,
//     never parsed, and never promoted to evidence; the structured result
//     travels ONLY through the Codex CLI documented
//     `--output-schema` / `--output-last-message` surface (the same mechanism
//     verified for the Task 31/33 Codex CLI invocation contract);
//   - env     = fixed CODEX_CLI_EXECUTOR_ENV_ALLOWLIST projection (or an
//     explicit caller-supplied map at creation); the request can never add,
//     remove, or alter an entry;
//   - `--sandbox read-only` and `--ephemeral` are fixed by this module: the
//     request can never select a sandbox mode or a persistent session;
//   - transient schema/result artifacts live ONLY under the caller-configured
//     absolute `resultDirectory`, which must NOT be the workdir or inside it;
//     they are deleted after the call; zero durable state is created.
//
// Read-only fail-closed conditions:
//   - invalid adapter configuration: factory throws before any invocation;
//   - invalid request / invalid scope: zero process invocations, zero writes;
//   - process start failure: typed CODEX_CLI_EXECUTOR_PROCESS_START_FAILED
//     (Task 31 meaning preserved verbatim), never retried;
//   - non-zero exit: typed CODEX_RESEARCH_PROCESS_FAILED (no result);
//   - no observable exit status: typed
//     CODEX_RESEARCH_PROCESS_TERMINATED_WITHOUT_EXIT_STATUS;
//   - exit 0 + missing result file: typed MISSING_CODEX_RESEARCH_RESULT;
//   - exit 0 + malformed / non-conforming structured result: typed
//     INVALID_CODEX_RESEARCH_RESULT (arbitrary narrative stdout is never
//     parsed into coordination authority);
//   - structured result tries to masquerade as canonical task authority or to
//     request OpenCode execution: typed
//     CODEX_RESEARCH_RESULT_AUTHORITY_VIOLATION;
//   - optional caller-supplied `repositoryStateProbe` observed a change across
//     the single process invocation: typed REPOSITORY_MUTATION_DETECTED;
//     probe failure fails closed with CODEX_RESEARCH_REPOSITORY_PROBE_FAILED;
//   - runner throw/rejection propagates the EXACT value unchanged (no catch,
//     no remap, no retry).
//
// Structured sourcing output (transient, returned directly to the caller):
//   { investigationStatus, scope, summary, evidenceRefs, actionableCandidates,
//     watchSignals, frictionObserved }
//   plus explicit non-authority markers:
//     sourcingResultAuthority: 'NON_CANONICAL',
//     controlTowerReviewRequired: true,
//   and every actionable candidate / watch signal carries
//     canonicalAuthority: 'NON_CANONICAL',
//     controlTowerReviewRequired: true.
//   Investigator classification labels (ACTIONABLE_CANDIDATE, WATCH_SIGNAL,
//   INFORMATIONAL, STALE_OR_SUPERSEDED, INSUFFICIENT_EVIDENCE) are output
//   labels ONLY and are never canonical Problem Framer decisions.
//   suggestedPrioritySignal is descriptive only and never becomes an
//   automatic priority ranking authority; Control Tower and the user retain
//   final prioritization authority.
//   Zero candidates is a valid successful result and is never reported as
//   FAILED/BLOCKED merely because no work was found.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   canonical task creation, Task Envelope creation, READY transitions,
//   admission, claim, dispatch, OpenCode invocation, executor registry,
//   executor selection, fallback executor, retry/backoff/resend, scheduler,
//   polling, watcher, reminder, recurring search, durable watch registry,
//   durable sourcing namespace, coordination store writes, Notion projection,
//   Operator CLI, publication, commit, branch, PR, deploy, previous-OpenCode-
//   RESULT review loop.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import nodeFs from 'node:fs';
import nodePath from 'node:path';
import {
  CODEX_CLI_EXECUTOR_ENV_ALLOWLIST,
  CODEX_CLI_EXECUTOR_PROCESS_START_FAILED,
  CodexCliExecutorAdapterError,
} from './codex-cli-executor-adapter.mjs';
import {
  MAX_FRICTION_ENTRIES,
  MAX_FRICTION_ENTRY_LENGTH,
  MAX_REF_STRING_LENGTH,
  MAX_SUMMARY_LENGTH,
} from './task-envelope.mjs';

// The one required approval code. The approval gate never collapses into a
// generic invalid-request code when approval is absent/false/malformed.
export const CODEX_RESEARCH_REQUIRES_EXPLICIT_USER_APPROVAL =
  'CODEX_RESEARCH_REQUIRES_EXPLICIT_USER_APPROVAL';

// Adapter-native meanings ONLY. Predecessor runner throw/rejection values and
// predecessor codes are never remapped to these codes.
export const INVALID_ON_DEMAND_NEXT_WORK_SOURCING_ADAPTER_CONFIGURATION =
  'INVALID_ON_DEMAND_NEXT_WORK_SOURCING_ADAPTER_CONFIGURATION';
export const INVALID_CODEX_RESEARCH_REQUEST = 'INVALID_CODEX_RESEARCH_REQUEST';
export const INVALID_CODEX_RESEARCH_RUNNER_RESULT = 'INVALID_CODEX_RESEARCH_RUNNER_RESULT';
export const CODEX_RESEARCH_ARTIFACT_WRITE_FAILED = 'CODEX_RESEARCH_ARTIFACT_WRITE_FAILED';
export const CODEX_RESEARCH_PROCESS_FAILED = 'CODEX_RESEARCH_PROCESS_FAILED';
export const CODEX_RESEARCH_PROCESS_TERMINATED_WITHOUT_EXIT_STATUS =
  'CODEX_RESEARCH_PROCESS_TERMINATED_WITHOUT_EXIT_STATUS';
export const MISSING_CODEX_RESEARCH_RESULT = 'MISSING_CODEX_RESEARCH_RESULT';
export const INVALID_CODEX_RESEARCH_RESULT = 'INVALID_CODEX_RESEARCH_RESULT';
export const CODEX_RESEARCH_RESULT_AUTHORITY_VIOLATION =
  'CODEX_RESEARCH_RESULT_AUTHORITY_VIOLATION';
export const CODEX_RESEARCH_REPOSITORY_PROBE_FAILED = 'CODEX_RESEARCH_REPOSITORY_PROBE_FAILED';
export const REPOSITORY_MUTATION_DETECTED = 'REPOSITORY_MUTATION_DETECTED';

// Explicit non-authority markers. Every sourcing result is a review input for
// Control Tower ONLY: it is never a canonical task, never a Problem Framer
// decision, and never an execution permission.
export const NON_CANONICAL_SOURCING_RESULT_AUTHORITY = 'NON_CANONICAL';
export const CONTROL_TOWER_REVIEW_REQUIRED = true;

// Investigator output labels ONLY. These are NOT canonical Problem Framer
// decisions; Control Tower independently decides DROP | WATCH | CHANGE.
export const RESEARCH_CANDIDATE_CLASSIFICATION_ACTIONABLE = 'ACTIONABLE_CANDIDATE';
export const RESEARCH_CANDIDATE_CLASSIFICATION_WATCH = 'WATCH_SIGNAL';
export const RESEARCH_CANDIDATE_CLASSIFICATION_INFORMATIONAL = 'INFORMATIONAL';
export const RESEARCH_CANDIDATE_CLASSIFICATION_STALE_OR_SUPERSEDED = 'STALE_OR_SUPERSEDED';
export const RESEARCH_CANDIDATE_CLASSIFICATION_INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE';
export const RESEARCH_CANDIDATE_CLASSIFICATION_VALUES = Object.freeze([
  RESEARCH_CANDIDATE_CLASSIFICATION_ACTIONABLE,
  RESEARCH_CANDIDATE_CLASSIFICATION_WATCH,
  RESEARCH_CANDIDATE_CLASSIFICATION_INFORMATIONAL,
  RESEARCH_CANDIDATE_CLASSIFICATION_STALE_OR_SUPERSEDED,
  RESEARCH_CANDIDATE_CLASSIFICATION_INSUFFICIENT_EVIDENCE,
]);

// Bounded reference-first input limits. Full chat history, transcripts,
// previous RESULT bodies, SSOT dumps, and repository dumps are structurally
// rejected rather than summarized.
export const MAX_RESEARCH_SCOPE_ENTRIES = 50;
export const MAX_RESEARCH_INVESTIGATION_JSON_BYTES = 16 * 1024;
export const MAX_RESEARCH_RESULT_CANDIDATES = 32;
export const MAX_RESEARCH_RESULT_WATCH_SIGNALS = 32;
export const MAX_RESEARCH_STATUS_LENGTH = 128;

// The exact caller request shape: the explicit approval signal plus ONE
// bounded investigation scope. Executable / cwd / environment / sandbox /
// timeout / retry / session options are structurally impossible: they are
// creation-time caller configuration ONLY and are never request-selectable.
export const ON_DEMAND_SOURCING_REQUEST_FIELDS = Object.freeze(['userApproved', 'investigation']);
export const ON_DEMAND_SOURCING_INVESTIGATION_FIELDS = Object.freeze([
  'domain',
  'questions',
  'repositoryAreas',
  'policyRefs',
  'contextRefs',
  'evidenceRefs',
  'liveMainHint',
  'knownConstraints',
  'excludedAreas',
]);
export const ON_DEMAND_SOURCING_INVESTIGATION_LIST_FIELDS = Object.freeze([
  'questions',
  'repositoryAreas',
  'policyRefs',
  'contextRefs',
  'evidenceRefs',
  'knownConstraints',
  'excludedAreas',
]);
export const ON_DEMAND_SOURCING_SCOPE_ANCHOR_FIELDS = Object.freeze([
  'domain',
  'questions',
  'repositoryAreas',
  'policyRefs',
  'contextRefs',
  'evidenceRefs',
]);
export const LIVE_MAIN_HINT_PATTERN = /^[0-9a-f]{40}$/i;

// The exact structured sourcing result shape requested from the investigator
// through `--output-schema`. Anything outside this shape is rejected.
export const ON_DEMAND_SOURCING_RESULT_FIELDS = Object.freeze([
  'investigationStatus',
  'scope',
  'summary',
  'evidenceRefs',
  'actionableCandidates',
  'watchSignals',
  'frictionObserved',
]);
export const ON_DEMAND_SOURCING_CANDIDATE_REQUIRED_FIELDS = Object.freeze([
  'title',
  'problem',
  'evidence',
  'proposedOwnedSurface',
  'desiredExitState',
  'proofRequirement',
]);
export const ON_DEMAND_SOURCING_CANDIDATE_OPTIONAL_FIELDS = Object.freeze([
  'candidateId',
  'whyItMatters',
  'dependencies',
  'collisionRisk',
  'suggestedPrioritySignal',
  'smallestSufficientClosure',
  'classification',
]);
export const ON_DEMAND_SOURCING_WATCH_SIGNAL_FIELDS = Object.freeze([
  'signal',
  'promotionTrigger',
  'supportingEvidence',
]);

// Authority-escalation scan pattern for string values inside a sourcing
// result. A result claiming Problem Framer authority fails closed instead of
// reaching Control Tower as if it were canonical coordination authority.
// Suggested review wording such as "evidence suggests this may warrant Control
// Tower CHANGE review" does not match.
//
// OpenCode execution requests need no separate narrative scan: the exact
// result shape admits NO executable field (unknown keys fail closed), and the
// returned payload carries no dispatch capability at all. A narrative mention
// of OpenCode boundaries would be a legitimate finding, not an authority
// escalation, so only the explicitly forbidden Problem Framer authority claim
// is pattern-scanned.
export const PROBLEM_FRAMER_AUTHORITY_CLAIM_PATTERN =
  /problem\s*framer\s*(?:=|:|is)\s*(?:change|watch|drop)/i;

const ADAPTER_CONFIGURATION_FIELDS = Object.freeze([
  'executablePath',
  'workdir',
  'resultDirectory',
  'runner',
  'env',
  'repositoryStateProbe',
]);

export class OnDemandNextWorkSourcingAdapterError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OnDemandNextWorkSourcingAdapterError';
    this.code = details.code ?? INVALID_ON_DEMAND_NEXT_WORK_SOURCING_ADAPTER_CONFIGURATION;
  }
}

function fail(message, code = INVALID_ON_DEMAND_NEXT_WORK_SOURCING_ADAPTER_CONFIGURATION) {
  throw new OnDemandNextWorkSourcingAdapterError(message, { code });
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function assertPlainRecord(value, code, what) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${what} must be a plain record (received ${describeValue(value)}).`, code);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(
      `${what} must be a plain record with Object.prototype or null prototype (class instances, Maps, Dates, and other exotic objects are not valid).`,
      code,
    );
  }
}

function assertNoSymbolKeys(record, code, what) {
  if (Object.getOwnPropertySymbols(record).length > 0) {
    fail(`${what} must not carry symbol keys.`, code);
  }
}

function assertNoUnknownFields(record, allowedFields, code, what) {
  assertNoSymbolKeys(record, code, what);
  for (const key of Object.getOwnPropertyNames(record)) {
    if (!allowedFields.includes(key)) {
      fail(
        `${what} accepts exactly (${allowedFields.join(', ')}); received unknown field "${key}".`,
        code,
      );
    }
  }
}

function readExactOwnDataFields(record, expectedFields, code, what) {
  assertNoSymbolKeys(record, code, what);
  const ownKeys = Object.getOwnPropertyNames(record);
  const exactKeySet =
    ownKeys.length === expectedFields.length &&
    expectedFields.every((field) => ownKeys.includes(field));
  if (!exactKeySet) {
    fail(
      `${what} must carry exactly the fields (${expectedFields.join(', ')}); received [${ownKeys.join(', ')}].`,
      code,
    );
  }
  const fields = {};
  for (const field of expectedFields) {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined) {
      fail(
        `${what} field "${field}" must be a plain data property (accessors are not valid).`,
        code,
      );
    }
    fields[field] = descriptor.value;
  }
  return fields;
}

function assertNonEmptyBoundedString(value, fieldName, maxLength, code) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${fieldName} must be a non-empty string.`, code);
  }
  if (value.length > maxLength) {
    fail(`${fieldName} exceeds ${maxLength} chars (reference-first, no embedded dumps).`, code);
  }
  return value;
}

function assertBoundedRefArray(
  value,
  fieldName,
  code,
  { minItems = 0, maxItems = MAX_RESEARCH_SCOPE_ENTRIES } = {},
) {
  if (!Array.isArray(value)) {
    fail(`${fieldName} must be an array of reference strings.`, code);
  }
  if (value.length < minItems) {
    fail(`${fieldName} requires at least ${minItems} entr${minItems === 1 ? 'y' : 'ies'}.`, code);
  }
  if (value.length > maxItems) {
    fail(`${fieldName} exceeds ${maxItems} entries (reference-first, no embedded dumps).`, code);
  }
  for (const entry of value) {
    assertNonEmptyBoundedString(entry, `${fieldName}[]`, MAX_REF_STRING_LENGTH, code);
    if (entry.includes('\n\n\n')) {
      fail(`${fieldName} entry looks like an embedded dump, not a reference.`, code);
    }
  }
  return Object.freeze([...value]);
}

function assertNonEmptyBoundedText(value, fieldName, code, maxLength = MAX_SUMMARY_LENGTH) {
  assertNonEmptyBoundedString(value, fieldName, maxLength, code);
  return value;
}

// ---------------------------------------------------------------------------
// Configuration boundary (creation-time ONLY; never request-selectable).
// ---------------------------------------------------------------------------

function assertValidConfigurationPath(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(
      `on-demand sourcing adapter configuration requires a non-empty absolute ${fieldName} (the request never selects the executable, the working directory, or the result directory).`,
    );
  }
  if (value.includes('\0')) {
    fail(`on-demand sourcing adapter configuration ${fieldName} must not contain NUL bytes.`);
  }
  if (!nodePath.isAbsolute(value)) {
    fail(
      `on-demand sourcing adapter configuration ${fieldName} must be an absolute path (the request never selects the executable, the working directory, or the result directory).`,
    );
  }
  return value;
}

function normalizePathForComparison(value) {
  const resolved = nodePath.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSamePathOrDescendant(candidate, parent) {
  const normalizedCandidate = normalizePathForComparison(candidate);
  const normalizedParent = normalizePathForComparison(parent);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${nodePath.sep}`)
  );
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
      'on-demand sourcing adapter configuration env must be an explicit plain record of string values when provided.',
    );
  }
  for (const [name, value] of Object.entries(explicitEnv)) {
    if (name.length === 0 || name.includes('=') || name.includes('\0')) {
      fail(
        'on-demand sourcing adapter configuration env names must be non-empty and must not contain "=" or NUL bytes.',
      );
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      fail(
        `on-demand sourcing adapter configuration env value for ${JSON.stringify(name)} must be a string without NUL bytes.`,
      );
    }
    childEnvironment[name] = value;
  }
  return Object.freeze(childEnvironment);
}

// The ONLY process boundary in this module. Normalized, settle-once process
// observation with an explicitly closed stdin/stdout/stderr boundary: the
// structured result travels ONLY through the Codex CLI `--output-last-message`
// file. AT MOST ONE process per sourcing call: this runner never retries and
// there is no fallback executor.
function defaultCodexResearchProcessRunner({ command, args, cwd, env }) {
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

// ---------------------------------------------------------------------------
// Request boundary: explicit approval + bounded reference-first scope.
// ---------------------------------------------------------------------------

function assertExplicitUserApproval(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    fail(
      `on-demand next-work sourcing requires the caller-supplied explicit approval signal userApproved: true (received ${describeValue(request)}).`,
      CODEX_RESEARCH_REQUIRES_EXPLICIT_USER_APPROVAL,
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(request, 'userApproved');
  if (
    !descriptor ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    descriptor.value !== true
  ) {
    fail(
      'on-demand next-work sourcing requires explicit current user approval: userApproved must be EXACTLY the boolean true. Approval is never inferred from task completion, RESULT_DELIVERED, CHANGE classification, lack of queued work, elapsed time, WATCH state, user silence, previous approval, Notion state, environment variables, or an existing Codex receipt.',
      CODEX_RESEARCH_REQUIRES_EXPLICIT_USER_APPROVAL,
    );
  }
}

function normalizeInvestigation(investigation) {
  assertPlainRecord(investigation, INVALID_CODEX_RESEARCH_REQUEST, 'investigation scope');
  assertNoUnknownFields(
    investigation,
    ON_DEMAND_SOURCING_INVESTIGATION_FIELDS,
    INVALID_CODEX_RESEARCH_REQUEST,
    'investigation scope',
  );

  const normalized = {};
  let anchorPresent = false;

  const domainDescriptor = Object.getOwnPropertyDescriptor(investigation, 'domain');
  if (domainDescriptor !== undefined) {
    if (domainDescriptor.get !== undefined || domainDescriptor.set !== undefined) {
      fail(
        'investigation scope domain must be a plain data property.',
        INVALID_CODEX_RESEARCH_REQUEST,
      );
    }
    normalized.domain = assertNonEmptyBoundedText(
      domainDescriptor.value,
      'investigation scope domain',
      INVALID_CODEX_RESEARCH_REQUEST,
      MAX_REF_STRING_LENGTH,
    );
    anchorPresent = true;
  }

  for (const field of ON_DEMAND_SOURCING_INVESTIGATION_LIST_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(investigation, field);
    if (descriptor === undefined) continue;
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      fail(
        `investigation scope ${field} must be a plain data property.`,
        INVALID_CODEX_RESEARCH_REQUEST,
      );
    }
    const list = assertBoundedRefArray(
      descriptor.value,
      `investigation scope ${field}`,
      INVALID_CODEX_RESEARCH_REQUEST,
    );
    if (list.length === 0) {
      fail(
        `investigation scope ${field} must not be present as an empty list (omit it instead).`,
        INVALID_CODEX_RESEARCH_REQUEST,
      );
    }
    normalized[field] = list;
    if (ON_DEMAND_SOURCING_SCOPE_ANCHOR_FIELDS.includes(field)) {
      anchorPresent = true;
    }
  }

  const hintDescriptor = Object.getOwnPropertyDescriptor(investigation, 'liveMainHint');
  let liveMainHint;
  if (hintDescriptor !== undefined) {
    if (hintDescriptor.get !== undefined || hintDescriptor.set !== undefined) {
      fail(
        'investigation scope liveMainHint must be a plain data property.',
        INVALID_CODEX_RESEARCH_REQUEST,
      );
    }
    if (
      typeof hintDescriptor.value !== 'string' ||
      !LIVE_MAIN_HINT_PATTERN.test(hintDescriptor.value)
    ) {
      fail(
        'investigation scope liveMainHint must be a 40-hex commit SHA when present; it is a HINT ONLY and is never treated as current repository fact.',
        INVALID_CODEX_RESEARCH_REQUEST,
      );
    }
    liveMainHint = hintDescriptor.value;
  }

  if (!anchorPresent) {
    fail(
      `investigation scope requires at least one anchor among (${ON_DEMAND_SOURCING_SCOPE_ANCHOR_FIELDS.join(', ')}); an empty investigation is not a bounded reference-first request.`,
      INVALID_CODEX_RESEARCH_REQUEST,
    );
  }

  const serializedBytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (serializedBytes > MAX_RESEARCH_INVESTIGATION_JSON_BYTES) {
    fail(
      `investigation scope serializes to ${serializedBytes} bytes which exceeds ${MAX_RESEARCH_INVESTIGATION_JSON_BYTES} bytes; keep the request reference-first and do not embed transcripts, dumps, or SSOT bodies.`,
      INVALID_CODEX_RESEARCH_REQUEST,
    );
  }

  return Object.freeze({ normalized: Object.freeze(normalized), liveMainHint });
}

// The adapter-authored investigation prompt. The caller supplies references
// ONLY; the instructions, role boundaries, and HINT_ONLY labeling are fixed by
// this module. The prompt is delivered as ONE argv element and is never
// shell-interpreted.
export function buildOnDemandNextWorkSourcingPrompt(investigation) {
  const { normalized, liveMainHint } = normalizeInvestigation(investigation);
  const referenceHints =
    liveMainHint === undefined
      ? 'none'
      : JSON.stringify({
          liveMainHint: {
            value: liveMainHint,
            authority: 'HINT_ONLY_MAY_BE_STALE_VERIFY_AGAINST_CURRENT_SOURCES',
          },
        });
  return [
    'ON-DEMAND NEXT-WORK SOURCING INVESTIGATION (READ-ONLY)',
    '',
    'You are an OPTIONAL, ON-DEMAND, READ-ONLY next-work sourcing investigator for the Greenhub repository.',
    'This investigation exists ONLY to discover possible future bounded work when the user explicitly decided to spend investigation capacity.',
    '',
    'Boundaries:',
    '- You are NOT part of the normal per-task completion loop. This is NOT a review of a just-finished task or executor result; do not assume one exists, and do not require one.',
    '- READ-ONLY: inspect current source structure, tests, static contracts, current live main, relevant Git history, current GitHub PR/check state when available, architecture boundaries, duplicated logic, missing tests, stale assumptions, insufficient proof, complexity hot spots, unclosed operational risk, and areas where behavior and intended contract diverge.',
    '- Purpose: FIND POTENTIALLY VALUABLE NEXT WORK. Every finding must be backed by evidence you directly inspect in the current repository or current Git/GitHub state.',
    '- HINTS ARE NOT FACTS: reference hints below are HINT_ONLY and may be stale. Verify everything against current authoritative sources; never treat a hint as current fact.',
    '- You must NOT create canonical tasks, must NOT request or trigger OpenCode execution, must NOT dispatch anything, must NOT use a scheduler/polling/watcher/reminder, and must NOT claim Problem Framer authority.',
    `- The strongest allowed statement about a finding is that evidence suggests it may warrant Control Tower CHANGE review. Never output "Problem Framer = CHANGE" as an authority claim.`,
    '- Classification labels (ACTIONABLE_CANDIDATE, WATCH_SIGNAL, INFORMATIONAL, STALE_OR_SUPERSEDED, INSUFFICIENT_EVIDENCE) are investigator output labels only; they are NOT canonical Problem Framer decisions.',
    '- suggestedPrioritySignal is descriptive only; Control Tower and the user retain final prioritization authority.',
    '- Zero candidates is a valid result. Do not fabricate work. If nothing is justified by inspected evidence, return an empty actionableCandidates list with a clear summary.',
    '- For non-immediate concerns, return watch signals with signal, promotionTrigger, and supportingEvidence only. Never create scheduled checks, recurring searches, polling, watchdogs, reminders, durable watch registries, or future tasks.',
    '- Return ONLY the structured JSON conforming to the supplied output schema as your final message.',
    '',
    'INVESTIGATION SCOPE (caller-supplied, reference-first):',
    JSON.stringify(normalized),
    '',
    'REFERENCE HINTS (HINT_ONLY, may be stale; never treat as current fact; verify by reading current authoritative repository evidence):',
    referenceHints,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Structured result validation: strict shape + authority-escalation scan.
// ---------------------------------------------------------------------------

function assertNoAuthorityEscalation(value, path) {
  if (typeof value === 'string') {
    if (PROBLEM_FRAMER_AUTHORITY_CLAIM_PATTERN.test(value)) {
      fail(
        `sourcing result at ${path} claims Problem Framer authority; Problem Framer decisions are Control Tower ONLY. Evidence may suggest that a finding warrants Control Tower CHANGE review, but it must not claim the decision.`,
        CODEX_RESEARCH_RESULT_AUTHORITY_VIOLATION,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertNoAuthorityEscalation(entry, `${path}[${index}]`);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assertNoAuthorityEscalation(entry, `${path}.${key}`);
    }
  }
}

function validateResearchCandidate(record, index) {
  const what = `sourcing result actionableCandidates[${index}]`;
  assertPlainRecord(record, INVALID_CODEX_RESEARCH_RESULT, what);
  assertNoUnknownFields(
    record,
    [
      ...ON_DEMAND_SOURCING_CANDIDATE_REQUIRED_FIELDS,
      ...ON_DEMAND_SOURCING_CANDIDATE_OPTIONAL_FIELDS,
    ],
    INVALID_CODEX_RESEARCH_RESULT,
    what,
  );
  for (const field of ON_DEMAND_SOURCING_CANDIDATE_REQUIRED_FIELDS) {
    if (!Object.hasOwn(record, field)) {
      fail(`${what} is missing required field "${field}".`, INVALID_CODEX_RESEARCH_RESULT);
    }
  }

  const candidate = {};
  if (Object.hasOwn(record, 'candidateId')) {
    candidate.candidateId = assertNonEmptyBoundedText(
      record.candidateId,
      `${what} candidateId`,
      INVALID_CODEX_RESEARCH_RESULT,
      MAX_RESEARCH_STATUS_LENGTH,
    );
  }
  candidate.title = assertNonEmptyBoundedText(
    record.title,
    `${what} title`,
    INVALID_CODEX_RESEARCH_RESULT,
  );
  candidate.problem = assertNonEmptyBoundedText(
    record.problem,
    `${what} problem`,
    INVALID_CODEX_RESEARCH_RESULT,
  );
  candidate.evidence = assertBoundedRefArray(
    record.evidence,
    `${what} evidence`,
    INVALID_CODEX_RESEARCH_RESULT,
    { minItems: 1, maxItems: MAX_RESEARCH_SCOPE_ENTRIES },
  );
  if (Object.hasOwn(record, 'whyItMatters')) {
    candidate.whyItMatters = assertNonEmptyBoundedText(
      record.whyItMatters,
      `${what} whyItMatters`,
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  candidate.proposedOwnedSurface = assertBoundedRefArray(
    record.proposedOwnedSurface,
    `${what} proposedOwnedSurface`,
    INVALID_CODEX_RESEARCH_RESULT,
    { minItems: 1, maxItems: MAX_RESEARCH_SCOPE_ENTRIES },
  );
  candidate.desiredExitState = assertNonEmptyBoundedText(
    record.desiredExitState,
    `${what} desiredExitState`,
    INVALID_CODEX_RESEARCH_RESULT,
  );
  candidate.proofRequirement = assertBoundedRefArray(
    record.proofRequirement,
    `${what} proofRequirement`,
    INVALID_CODEX_RESEARCH_RESULT,
    { minItems: 1, maxItems: MAX_RESEARCH_SCOPE_ENTRIES },
  );
  if (Object.hasOwn(record, 'dependencies')) {
    candidate.dependencies = assertBoundedRefArray(
      record.dependencies,
      `${what} dependencies`,
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  if (Object.hasOwn(record, 'collisionRisk')) {
    candidate.collisionRisk = assertNonEmptyBoundedText(
      record.collisionRisk,
      `${what} collisionRisk`,
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  if (Object.hasOwn(record, 'suggestedPrioritySignal')) {
    candidate.suggestedPrioritySignal = assertNonEmptyBoundedText(
      record.suggestedPrioritySignal,
      `${what} suggestedPrioritySignal`,
      INVALID_CODEX_RESEARCH_RESULT,
      MAX_RESEARCH_STATUS_LENGTH,
    );
  }
  if (Object.hasOwn(record, 'smallestSufficientClosure')) {
    candidate.smallestSufficientClosure = assertNonEmptyBoundedText(
      record.smallestSufficientClosure,
      `${what} smallestSufficientClosure`,
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  if (Object.hasOwn(record, 'classification')) {
    if (!RESEARCH_CANDIDATE_CLASSIFICATION_VALUES.includes(record.classification)) {
      fail(
        `${what} classification must be exactly one of ${RESEARCH_CANDIDATE_CLASSIFICATION_VALUES.join(' | ')} when present; received ${describeValue(record.classification)} ${String(record.classification)}. These labels are investigator output labels only, never canonical Problem Framer decisions.`,
        INVALID_CODEX_RESEARCH_RESULT,
      );
    }
    candidate.classification = record.classification;
  }
  return candidate;
}

function validateResearchWatchSignal(record, index) {
  const what = `sourcing result watchSignals[${index}]`;
  assertPlainRecord(record, INVALID_CODEX_RESEARCH_RESULT, what);
  const fields = readExactOwnDataFields(
    record,
    ON_DEMAND_SOURCING_WATCH_SIGNAL_FIELDS,
    INVALID_CODEX_RESEARCH_RESULT,
    what,
  );
  return {
    signal: assertNonEmptyBoundedText(
      fields.signal,
      `${what} signal`,
      INVALID_CODEX_RESEARCH_RESULT,
    ),
    promotionTrigger: assertNonEmptyBoundedText(
      fields.promotionTrigger,
      `${what} promotionTrigger`,
      INVALID_CODEX_RESEARCH_RESULT,
    ),
    supportingEvidence: assertBoundedRefArray(
      fields.supportingEvidence,
      `${what} supportingEvidence`,
      INVALID_CODEX_RESEARCH_RESULT,
      { minItems: 1, maxItems: MAX_RESEARCH_SCOPE_ENTRIES },
    ),
  };
}

function normalizeFrictionObserved(value) {
  if (typeof value === 'string') {
    return Object.freeze([
      assertNonEmptyBoundedString(
        value,
        'sourcing result frictionObserved',
        MAX_FRICTION_ENTRY_LENGTH,
        INVALID_CODEX_RESEARCH_RESULT,
      ),
    ]);
  }
  if (!Array.isArray(value)) {
    fail(
      'sourcing result frictionObserved must be a string or an array of strings.',
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  if (value.length > MAX_FRICTION_ENTRIES) {
    fail(
      `sourcing result frictionObserved exceeds ${MAX_FRICTION_ENTRIES} entries.`,
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  for (const entry of value) {
    assertNonEmptyBoundedString(
      entry,
      'sourcing result frictionObserved[]',
      MAX_FRICTION_ENTRY_LENGTH,
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  return Object.freeze([...value]);
}

/**
 * Validate one structured sourcing result and return the normalized,
 * explicitly NON_CANONICAL caller payload. Strict shape, strict types,
 * bounded references, investigator-label validation, and the
 * authority-escalation scan. No repair, no normalization beyond
 * non-authority stamping.
 */
export function normalizeOnDemandSourcingResult(record) {
  assertPlainRecord(record, INVALID_CODEX_RESEARCH_RESULT, 'sourcing result');
  const fields = readExactOwnDataFields(
    record,
    ON_DEMAND_SOURCING_RESULT_FIELDS,
    INVALID_CODEX_RESEARCH_RESULT,
    'sourcing result',
  );

  const investigationStatus = assertNonEmptyBoundedText(
    fields.investigationStatus,
    'sourcing result investigationStatus',
    INVALID_CODEX_RESEARCH_RESULT,
    MAX_RESEARCH_STATUS_LENGTH,
  );
  const scope = assertNonEmptyBoundedText(
    fields.scope,
    'sourcing result scope',
    INVALID_CODEX_RESEARCH_RESULT,
  );
  const summary = assertNonEmptyBoundedText(
    fields.summary,
    'sourcing result summary',
    INVALID_CODEX_RESEARCH_RESULT,
  );
  const evidenceRefs = assertBoundedRefArray(
    fields.evidenceRefs,
    'sourcing result evidenceRefs',
    INVALID_CODEX_RESEARCH_RESULT,
  );

  if (!Array.isArray(fields.actionableCandidates)) {
    fail('sourcing result actionableCandidates must be an array.', INVALID_CODEX_RESEARCH_RESULT);
  }
  if (fields.actionableCandidates.length > MAX_RESEARCH_RESULT_CANDIDATES) {
    fail(
      `sourcing result actionableCandidates exceeds ${MAX_RESEARCH_RESULT_CANDIDATES} entries.`,
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  const actionableCandidates = fields.actionableCandidates.map((candidate, index) => {
    const validated = validateResearchCandidate(candidate, index);
    // Every candidate is explicitly NON_CANONICAL and Control-Tower-review
    // ONLY: the adapter never converts a candidate into a task, a READY
    // transition, an admission, a claim, a dispatch, or an OpenCode call.
    return Object.freeze({
      localCandidateIndex: index,
      ...validated,
      canonicalAuthority: NON_CANONICAL_SOURCING_RESULT_AUTHORITY,
      controlTowerReviewRequired: CONTROL_TOWER_REVIEW_REQUIRED,
    });
  });

  if (!Array.isArray(fields.watchSignals)) {
    fail('sourcing result watchSignals must be an array.', INVALID_CODEX_RESEARCH_RESULT);
  }
  if (fields.watchSignals.length > MAX_RESEARCH_RESULT_WATCH_SIGNALS) {
    fail(
      `sourcing result watchSignals exceeds ${MAX_RESEARCH_RESULT_WATCH_SIGNALS} entries.`,
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  const watchSignals = fields.watchSignals.map((signal, index) =>
    Object.freeze({
      ...validateResearchWatchSignal(signal, index),
      canonicalAuthority: NON_CANONICAL_SOURCING_RESULT_AUTHORITY,
      controlTowerReviewRequired: CONTROL_TOWER_REVIEW_REQUIRED,
    }),
  );

  const frictionObserved = normalizeFrictionObserved(fields.frictionObserved);

  const normalized = {
    sourcingResultAuthority: NON_CANONICAL_SOURCING_RESULT_AUTHORITY,
    controlTowerReviewRequired: CONTROL_TOWER_REVIEW_REQUIRED,
    investigationStatus,
    scope,
    summary,
    evidenceRefs,
    actionableCandidates: Object.freeze(actionableCandidates),
    watchSignals: Object.freeze(watchSignals),
    frictionObserved,
  };

  // The authority-escalation scan runs over the ORIGINAL investigator-authored
  // values (never over adapter-added markers).
  assertNoAuthorityEscalation(record, 'sourcing result');

  return Object.freeze(normalized);
}

// ---------------------------------------------------------------------------
// `--output-schema` JSON Schema: the exact structured result contract.
// ---------------------------------------------------------------------------

function boundedStringSchema(maxLength) {
  return { type: 'string', minLength: 1, maxLength };
}

function refArraySchema({ minItems = 0, maxItems = MAX_RESEARCH_SCOPE_ENTRIES } = {}) {
  return {
    type: 'array',
    minItems,
    maxItems,
    items: boundedStringSchema(MAX_REF_STRING_LENGTH),
  };
}

export function buildOnDemandSourcingResultJsonSchema() {
  const candidateProperties = {
    candidateId: boundedStringSchema(MAX_RESEARCH_STATUS_LENGTH),
    title: boundedStringSchema(MAX_SUMMARY_LENGTH),
    problem: boundedStringSchema(MAX_SUMMARY_LENGTH),
    evidence: refArraySchema({ minItems: 1 }),
    whyItMatters: boundedStringSchema(MAX_SUMMARY_LENGTH),
    proposedOwnedSurface: refArraySchema({ minItems: 1 }),
    desiredExitState: boundedStringSchema(MAX_SUMMARY_LENGTH),
    proofRequirement: refArraySchema({ minItems: 1 }),
    dependencies: refArraySchema(),
    collisionRisk: boundedStringSchema(MAX_SUMMARY_LENGTH),
    suggestedPrioritySignal: boundedStringSchema(MAX_RESEARCH_STATUS_LENGTH),
    smallestSufficientClosure: boundedStringSchema(MAX_SUMMARY_LENGTH),
    classification: { type: 'string', enum: [...RESEARCH_CANDIDATE_CLASSIFICATION_VALUES] },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: [...ON_DEMAND_SOURCING_RESULT_FIELDS],
    properties: {
      investigationStatus: boundedStringSchema(MAX_RESEARCH_STATUS_LENGTH),
      scope: boundedStringSchema(MAX_SUMMARY_LENGTH),
      summary: boundedStringSchema(MAX_SUMMARY_LENGTH),
      evidenceRefs: refArraySchema(),
      actionableCandidates: {
        type: 'array',
        maxItems: MAX_RESEARCH_RESULT_CANDIDATES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...ON_DEMAND_SOURCING_CANDIDATE_REQUIRED_FIELDS],
          properties: candidateProperties,
        },
      },
      watchSignals: {
        type: 'array',
        maxItems: MAX_RESEARCH_RESULT_WATCH_SIGNALS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...ON_DEMAND_SOURCING_WATCH_SIGNAL_FIELDS],
          properties: {
            signal: boundedStringSchema(MAX_SUMMARY_LENGTH),
            promotionTrigger: boundedStringSchema(MAX_SUMMARY_LENGTH),
            supportingEvidence: refArraySchema({ minItems: 1 }),
          },
        },
      },
      frictionObserved: {
        type: 'array',
        maxItems: MAX_FRICTION_ENTRIES,
        items: boundedStringSchema(MAX_FRICTION_ENTRY_LENGTH),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Runner result mapping and structured result file read.
// ---------------------------------------------------------------------------

function assertExactRunnerResultKeys(result, expectedKeys) {
  assertNoSymbolKeys(result, INVALID_CODEX_RESEARCH_RUNNER_RESULT, 'Codex research runner result');
  const ownKeys = Object.getOwnPropertyNames(result);
  const exact =
    ownKeys.length === expectedKeys.length && expectedKeys.every((key) => ownKeys.includes(key));
  if (!exact) {
    fail(
      `Codex research runner result shape must be exactly (${expectedKeys.join(', ')}); received (${ownKeys.join(', ')}).`,
      INVALID_CODEX_RESEARCH_RUNNER_RESULT,
    );
  }
}

function readStructuredResearchResult(resultFilePath) {
  let raw;
  try {
    raw = nodeFs.readFileSync(resultFilePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(
        `the Codex/Astra process exited 0 but produced no structured result file (fail-closed): ${resultFilePath}`,
        MISSING_CODEX_RESEARCH_RESULT,
      );
    }
    fail(
      `the Codex/Astra structured sourcing result file could not be read (fail-closed): ${error?.message}`,
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    fail(
      `the Codex/Astra structured sourcing result is not valid JSON (fail-closed): ${error?.message}`,
      INVALID_CODEX_RESEARCH_RESULT,
    );
  }
  return normalizeOnDemandSourcingResult(document);
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/**
 * Create the ONE on-demand Codex/Astra next-work sourcing adapter.
 *
 * Creation-time caller configuration ONLY (never request-selectable):
 * - `executablePath`: absolute path of the Codex/Astra CLI executable;
 * - `workdir`: absolute repository working directory fixed for every call;
 * - `resultDirectory`: absolute directory for transient operational artifacts
 *   (schema + last-message files, deleted after each call); it must not be the
 *   workdir or a descendant of it, so the adapter itself can never write
 *   inside the repository;
 * - `runner`: optional process-invocation seam (a function receiving exactly
 *   { command, args, cwd, env }); the module default runner is the only real
 *   process boundary;
 * - `env`: optional explicit child environment map; otherwise the fixed
 *   CODEX_CLI_EXECUTOR_ENV_ALLOWLIST projection is used;
 * - `repositoryStateProbe`: optional nullary function returning a comparable
 *   snapshot (for example a read-only `git status` capture). When provided it
 *   is called before and after the single process invocation; a detected
 *   change fails closed with REPOSITORY_MUTATION_DETECTED.
 * Unknown configuration fields fail closed (zero process invocations).
 *
 * The returned function is the exact sourcing contract:
 *   async function adapter({ userApproved, investigation }) -> NON_CANONICAL
 *   structured sourcing result for Control Tower review.
 * Without explicit current approval it fails closed BEFORE any process start
 * or filesystem write with CODEX_RESEARCH_REQUIRES_EXPLICIT_USER_APPROVAL.
 */
export function createOnDemandNextWorkSourcingAdapter(configuration = {}) {
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)) {
    fail('on-demand next-work sourcing adapter configuration must be an object.');
  }
  assertNoUnknownFields(
    configuration,
    ADAPTER_CONFIGURATION_FIELDS,
    INVALID_ON_DEMAND_NEXT_WORK_SOURCING_ADAPTER_CONFIGURATION,
    'on-demand next-work sourcing adapter configuration',
  );
  const command = assertValidConfigurationPath(configuration.executablePath, 'executablePath');
  const childWorkdir = assertValidConfigurationPath(configuration.workdir, 'workdir');
  const resultDirectory = assertValidConfigurationPath(
    configuration.resultDirectory,
    'resultDirectory',
  );
  if (isSamePathOrDescendant(resultDirectory, childWorkdir)) {
    fail(
      'on-demand next-work sourcing adapter configuration resultDirectory must not be the workdir or a descendant of it: transient artifacts must never be written inside the repository worktree.',
    );
  }
  if (configuration.runner !== undefined && typeof configuration.runner !== 'function') {
    fail(
      'on-demand next-work sourcing adapter configuration runner must be a function when provided (the module default runner is the only real process boundary).',
    );
  }
  if (
    configuration.repositoryStateProbe !== undefined &&
    typeof configuration.repositoryStateProbe !== 'function'
  ) {
    fail(
      'on-demand next-work sourcing adapter configuration repositoryStateProbe must be a function when provided.',
    );
  }
  const processRunner =
    configuration.runner === undefined ? defaultCodexResearchProcessRunner : configuration.runner;
  const childEnvironment = buildChildEnvironment(configuration.env);
  const repositoryStateProbe = configuration.repositoryStateProbe;

  function safeProbe() {
    if (repositoryStateProbe === undefined) return undefined;
    let snapshot;
    try {
      snapshot = repositoryStateProbe();
    } catch (error) {
      fail(
        `repository state probe failed; a guaranteed read-only outcome cannot be established (fail-closed): ${error?.message}`,
        CODEX_RESEARCH_REPOSITORY_PROBE_FAILED,
      );
    }
    return JSON.stringify(snapshot);
  }

  return async function onDemandNextWorkSourcingAdapter(request) {
    // 1. Explicit current user approval gate: fail closed BEFORE any process
    //    start and BEFORE any filesystem write.
    assertExplicitUserApproval(request);

    // 2. Exact request shape: approval + ONE bounded investigation scope.
    assertPlainRecord(
      request,
      INVALID_CODEX_RESEARCH_REQUEST,
      'on-demand next-work sourcing request',
    );
    assertNoUnknownFields(
      request,
      ON_DEMAND_SOURCING_REQUEST_FIELDS,
      INVALID_CODEX_RESEARCH_REQUEST,
      'on-demand next-work sourcing request',
    );
    if (!Object.hasOwn(request, 'investigation')) {
      fail(
        'on-demand next-work sourcing request requires a bounded investigation scope.',
        INVALID_CODEX_RESEARCH_REQUEST,
      );
    }
    const investigationDescriptor = Object.getOwnPropertyDescriptor(request, 'investigation');
    if (investigationDescriptor.get !== undefined || investigationDescriptor.set !== undefined) {
      fail(
        'on-demand next-work sourcing request investigation must be a plain data property.',
        INVALID_CODEX_RESEARCH_REQUEST,
      );
    }
    const { normalized, liveMainHint } = normalizeInvestigation(investigationDescriptor.value);

    // 3. Optional read-only probe BEFORE the process boundary.
    const repositoryStateBefore = safeProbe();

    // 4. Transient operational artifacts ONLY, outside the repository worktree.
    const invocationToken = `${process.pid}-${randomUUID().replace(/-/g, '')}`;
    const schemaPath = nodePath.join(
      resultDirectory,
      `greenhub-on-demand-sourcing-${invocationToken}.schema.json`,
    );
    const resultPath = nodePath.join(
      resultDirectory,
      `greenhub-on-demand-sourcing-${invocationToken}.last-message.json`,
    );
    try {
      nodeFs.mkdirSync(resultDirectory, { recursive: true });
      nodeFs.writeFileSync(
        schemaPath,
        JSON.stringify(buildOnDemandSourcingResultJsonSchema(), null, 2),
        {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        },
      );
    } catch (error) {
      fail(
        `on-demand sourcing result artifacts could not be prepared (fail-closed, nothing was invoked): ${error?.message}`,
        CODEX_RESEARCH_ARTIFACT_WRITE_FAILED,
      );
    }

    try {
      // 5. AT MOST ONE process invocation, argv-only and shell-free. The
      //    prompt is ONE argv element and is never shell-interpreted.
      const prompt = buildOnDemandNextWorkSourcingPrompt(
        liveMainHint === undefined ? normalized : { ...normalized, liveMainHint },
      );
      const runnerResult = await processRunner({
        command,
        args: [
          'exec',
          '--sandbox',
          'read-only',
          '--ephemeral',
          '--output-schema',
          schemaPath,
          '--output-last-message',
          resultPath,
          '--cd',
          childWorkdir,
          prompt,
        ],
        cwd: childWorkdir,
        env: childEnvironment,
      });

      // 6. Optional read-only probe AFTER the process boundary: any detected
      //    repository change fails closed.
      if (repositoryStateProbe !== undefined) {
        const repositoryStateAfter = safeProbe();
        if (repositoryStateAfter !== repositoryStateBefore) {
          fail(
            'repository mutation was detected across the read-only sourcing invocation (fail-closed); the sourcing result is not returned.',
            REPOSITORY_MUTATION_DETECTED,
          );
        }
      }

      // 7. Exact process-boundary observation mapping. No fourth kind, no
      //    retry, no fallback, no second invocation.
      if (
        runnerResult === null ||
        typeof runnerResult !== 'object' ||
        Array.isArray(runnerResult)
      ) {
        fail(
          'Codex research runner result must be a plain record describing ONE process-boundary observation.',
          INVALID_CODEX_RESEARCH_RUNNER_RESULT,
        );
      }
      if (runnerResult.kind === 'exited') {
        assertExactRunnerResultKeys(runnerResult, ['kind', 'code']);
        if (!Number.isInteger(runnerResult.code)) {
          fail(
            'Codex research runner result kind "exited" requires an integer exit code.',
            INVALID_CODEX_RESEARCH_RUNNER_RESULT,
          );
        }
        if (runnerResult.code !== 0) {
          fail(
            `the read-only sourcing process exited with code ${runnerResult.code} (fail-closed, no result, no retry).`,
            CODEX_RESEARCH_PROCESS_FAILED,
          );
        }
        // Exit 0 is NOT evidence: the structured result file is the ONLY
        // result authority.
        return readStructuredResearchResult(resultPath);
      }
      if (runnerResult.kind === 'terminated-without-exit-status') {
        assertExactRunnerResultKeys(runnerResult, ['kind']);
        fail(
          'the read-only sourcing process terminated without an observable exit status (fail-closed, no result, no retry).',
          CODEX_RESEARCH_PROCESS_TERMINATED_WITHOUT_EXIT_STATUS,
        );
      }
      if (runnerResult.kind === 'start-failed') {
        assertExactRunnerResultKeys(runnerResult, ['kind', 'errorCode']);
        if (typeof runnerResult.errorCode !== 'string' || runnerResult.errorCode.length === 0) {
          fail(
            'Codex research runner result kind "start-failed" requires a non-empty errorCode.',
            INVALID_CODEX_RESEARCH_RUNNER_RESULT,
          );
        }
        // Task 31 typed process-start failure meaning preserved verbatim.
        throw new CodexCliExecutorAdapterError(
          `Codex/Astra sourcing process could not be started (errorCode ${runnerResult.errorCode}): configuration / process-start failure only, never a protocol outcome, no retry, no fallback executor.`,
          { code: CODEX_CLI_EXECUTOR_PROCESS_START_FAILED },
        );
      }
      fail(
        `unsupported Codex research runner result kind ${JSON.stringify(runnerResult.kind)}: no fourth observation and no automatic re-invocation exists.`,
        INVALID_CODEX_RESEARCH_RUNNER_RESULT,
      );
    } finally {
      // 8. Best-effort transient artifact cleanup: zero durable sourcing state.
      try {
        nodeFs.rmSync(schemaPath, { force: true });
      } catch {
        // transient cleanup only; never a failure authority
      }
      try {
        nodeFs.rmSync(resultPath, { force: true });
      } catch {
        // transient cleanup only; never a failure authority
      }
    }
  };
}
