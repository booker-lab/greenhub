// Canonical owner: docs/specs/ops/development-authority.md sections 2, 6, 8
// (bounded task contract, outcome-relative publication, thin stateless
// automation).
//
// Goal-Constrained Development Loop, Phase 1 deterministic core with an
// optional read-only Phase 2 planner seam.
//
// One caller-supplied Goal Contract, one foreground process, one exit. Every
// bounded iteration:
//   1. reads current live `main` (two independent observations),
//   2. re-resolves the declared ACCEPTANCE_AUTHORITY at that exact live SHA,
//   3. recomputes every criterion at that live SHA,
//   4. admits a bounded batch of at most five pairwise-independent declared
//      catalog tasks for open AUTONOMOUS criteria, and
//   5. delegates the entire execution/publication mechanics to the existing GN
//      executors, then re-reads live `main` once for the settled batch and
//      recomputes.
//
// Batch admission is still one foreground owner: the same process admits the
// batch, starts each admitted task in a task-owned worker thread, waits for the
// whole batch to settle, and then performs exactly one authoritative live-main
// re-observation and criterion recomputation. No durable coordination state,
// background service, or cross-process wake loop is created; worker threads
// exist only inside one bounded batch and are gone before the next evaluation.
//
// Two admitted tasks are never started together when they materially overlap:
// semantic_owner, declared mutation allow surface, proof_owner against the
// sibling mutation surface, or an explicit depends_on relationship. A task that
// admission or the task budget excludes stays eligible for a later
// recomputation and is never marked failed for being excluded. A failing task
// does not cancel independent siblings that already started.
//
// A declared eligible catalog task always wins. Only when no eligible declared
// task exists, an open AUTONOMOUS gap remains, and the Goal Contract opts in
// with `PLANNER.enabled` does this module ask one read-only planner for at most
// one bounded proposal per criterion-state fingerprint, validate that proposal
// deterministically, derive the executable task from existing goal authority,
// and hand it to the same GN executors.
//
// The planner is never a writer: it reads one disposable workspace created from
// the exact pinned live main, never receives publication credentials, and any
// Git-observed mutation in its workspace rejects the proposal before any
// executor is invoked.
//
// This module owns composition and deterministic goal bookkeeping only:
//   scripts/agent/run-once.mjs          execution core (isolated workspace,
//                                       OpenCode invocation, mutation boundary,
//                                       proof execution, cleanup)
//   scripts/agent/run-publish-once.mjs  publication path (admission, transport,
//                                       PR, required checks, merge, remote
//                                       read-back, task-owned cleanup)
//
// This phase has no cross-process task state or task recovery, no background
// execution, no ref cleanup for pre-existing remote refs, and no long-running
// service. Its execution guarantee is scoped to one foreground attempt:
//   one admitted task -> at most one OpenCode mutation invocation.
// A bounded start retry is allowed only when the baseline observation failed
// before any OpenCode invocation or task-owned mutation (for example a
// transient concurrent `git` observation race); once an invocation starts, the
// task runs exactly once. A process crash before remote publication evidence
// may let a later invocation re-run the same unfinished task; cross-process
// exactly-once is out of scope for this phase.
//
// Deterministic test seam: when the caller injects the in-process child
// executors (`runOnce` / `runPublishOnce`), the batch runs those executors
// in-process in declaration order instead of starting worker threads, so the
// same admission, bookkeeping, and recomputation path stays fully deterministic
// without real OpenCode processes. Production runs use the worker batch below.
//
// Never invoked here: reset/restore/stash/clean of foreign state, checkout
// switching, force push, direct push to `main`, or local merge/rebase.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, workerData } from 'node:worker_threads';

import {
  DEFAULT_OPENCODE_TIMEOUT_MS,
  DEFAULT_PROOF_TIMEOUT_MS,
  SUCCESS as RUN_ONCE_SUCCESS,
  buildChildEnv,
  buildOpencodeArgs,
  createBaselineWorkspace,
  defaultInvokeOpencode,
  defaultRemoveWorkspace,
  defaultRunProofCommand,
  fetchBaseline,
  gitCapture,
  isPathAllowed,
  normalizeRepoPath,
  observeChangedPaths,
  readLiveRemoteMain,
  resolveOpencodeCommand,
  runOnce as defaultRunOnce,
} from './run-once.mjs';
import {
  DEFAULT_CI_TIMEOUT_MS,
  DEFAULT_MAX_REBIND_ATTEMPTS,
  PUBLICATION_SUCCESS_OUTCOMES,
  defaultRunGh,
  runPublishOnce as defaultRunPublishOnce,
} from './run-publish-once.mjs';
import { captureCheckoutState, isCheckoutUnchanged } from '../git/publication-transport.mjs';

export const GOAL_SATISFIED = 'GOAL_SATISFIED';
export const HUMAN_DECISION_REQUIRED = 'HUMAN_DECISION_REQUIRED';
export const BLOCKED_EXTERNAL = 'BLOCKED_EXTERNAL';
export const NO_TASK_FOR_GAP = 'NO_TASK_FOR_GAP';
export const NO_PROGRESS = 'NO_PROGRESS';
export const BUDGET_EXHAUSTED = 'BUDGET_EXHAUSTED';
export const INVALID_GOAL = 'INVALID_GOAL';
export const INVALID_TASK = 'INVALID_TASK';

export const GOAL_STATUSES = Object.freeze([
  GOAL_SATISFIED,
  HUMAN_DECISION_REQUIRED,
  BLOCKED_EXTERNAL,
  NO_TASK_FOR_GAP,
  NO_PROGRESS,
  BUDGET_EXHAUSTED,
  INVALID_GOAL,
]);

export const CRITERION_DISPOSITIONS = Object.freeze([
  'SATISFIED',
  'AUTONOMOUS_TASKABLE',
  'AUTONOMOUS_UNTASKED',
  'HUMAN',
  'EXTERNAL',
]);

export const CHECK_KINDS = Object.freeze([
  'PATH_PRESENT',
  'PATH_ABSENT',
  'DOC_TOKEN',
  'PROOF_AT_MAIN',
  'PR_MERGED',
  'EXTERNAL_GATE',
  'HUMAN_AUTHORITY',
]);

export const CRITERION_CLASSES = Object.freeze(['AUTONOMOUS', 'HUMAN', 'EXTERNAL']);

export const PUBLICATION_MODES = Object.freeze(['required', 'none']);

export const PLANNER_DECISIONS = Object.freeze(['TASK', 'NO_TASK', 'ESCALATE']);

// Bounded planner evidence statuses. They are planner-proposal dispositions,
// never goal statuses; the goal status mapping stays in PLANNER_TERMINALS.
export const PLANNER_STATUSES = Object.freeze([
  'TASK',
  'NO_TASK',
  'ESCALATE',
  'INVALID_OUTPUT',
  'MUTATION_REJECTED',
  'INVOCATION_FAILED',
  'WORKSPACE_FAILED',
  'ALLOW_OUTSIDE_AUTHORITY',
  'HUMAN_CRITERION_REJECTED',
  'EXTERNAL_CRITERION_REJECTED',
  'PROOF_AUTHORITY_REQUIRED',
  'ID_COLLISION',
]);

const PLANNER_TASK_FIELDS = Object.freeze(['id', 'outcome', 'closes', 'allow', 'semantic_owner']);
const PLANNER_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const PLANNER_OUTCOME_MAX_CHARS = 500;
const PLANNER_OUTPUT_TAIL_CHARS = 4000;

// Authoritative Goal Contract field sets. This module owns the fields
// `validateGoalContract` accepts; run-build derives the strict BUILD-mode
// selector contract from the same lists so the generator-facing contract and
// the deterministic validator cannot drift apart.
export const GOAL_CONTRACT_FIELDS = Object.freeze([
  'GOAL',
  'ACCEPTANCE_AUTHORITY',
  'PRESERVE',
  'AUTONOMOUSLY_ALLOWED',
  'ESCALATE_IF',
  'STOP_WHEN',
  'CRITERIA',
  'TASK_CATALOG',
  'PLANNER',
  'BUDGET',
]);

export const GOAL_TASK_FIELDS = Object.freeze([
  'id',
  'outcome',
  'preserve',
  'closes',
  'allow',
  'proof',
  'proof_owner',
  'semantic_owner',
  'publication',
  'commit_message',
  'pr_title',
  'escalate_only_if',
  'depends_on',
]);

// A rejected planner proposal still fails closed, but the goal status it maps
// to depends on which authority boundary was touched.
const PLANNER_TERMINALS = Object.freeze({
  NO_TASK: NO_TASK_FOR_GAP,
  ESCALATE: HUMAN_DECISION_REQUIRED,
  INVALID_OUTPUT: BLOCKED_EXTERNAL,
  MUTATION_REJECTED: BLOCKED_EXTERNAL,
  INVOCATION_FAILED: BLOCKED_EXTERNAL,
  WORKSPACE_FAILED: BLOCKED_EXTERNAL,
  ID_COLLISION: BLOCKED_EXTERNAL,
  EXTERNAL_CRITERION_REJECTED: BLOCKED_EXTERNAL,
  ALLOW_OUTSIDE_AUTHORITY: HUMAN_DECISION_REQUIRED,
  HUMAN_CRITERION_REJECTED: HUMAN_DECISION_REQUIRED,
  PROOF_AUTHORITY_REQUIRED: HUMAN_DECISION_REQUIRED,
});

// Fixed Phase 1 escalation vocabulary. An undeclared or unknown token fails
// closed as a contract validation error; the evaluator never infers one of
// these from criterion text alone.
export const HUMAN_ESCALATION_TOKENS = Object.freeze([
  'PRODUCT_POLICY_FORK',
  'ACCEPTANCE_MEANING_CHANGE',
  'SECURITY_PRIVACY_AUTHORITY',
  'FINANCIAL_POLICY',
  'LEGAL_OPERATIONAL_POLICY',
  'IRREVERSIBLE_EXTERNAL_MUTATION',
  'PILOT_GO',
  'PRODUCTION_ACTIVATION',
  'EXTERNAL_AUTHORITY',
]);

export const DEFAULT_BUDGET = Object.freeze({
  max_iterations: 8,
  max_tasks: 4,
  max_wall_clock_ms: 60 * 60 * 1000,
});

// Fixed batch concurrency contract: one foreground owner admits at most five
// pairwise-independent tasks per live-main evaluation.
export const MAX_BATCH_CONCURRENCY = 5;

const LIVE_MAIN_PIN_ATTEMPTS = 3;
const PROOF_TAIL_CHARS = 2000;

// Worker batch signaling. Each admitted task owns one state slot in a shared
// Int32Array; two trailing slots are cross-thread mutexes that serialize the
// task-owned workspace removal (so concurrent `git worktree remove`/`prune`
// calls cannot race each other) and the bounded start-retry backoff (so a
// transient baseline race is not immediately repeated by every worker).
const BATCH_STATE_CREATED = 0;
const BATCH_STATE_STARTED = 1;
const BATCH_STATE_DONE = 2;
const BATCH_STATE_CANCELLED = -1;
const BATCH_WORKER_START_TIMEOUT_MS = 30000;
const BATCH_WORKER_POLL_MS = 1000;
const MAX_BATCH_TASK_START_ATTEMPTS = 3;
const BATCH_RETRY_BACKOFF_MS = 250;

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // a failed synchronous wait must not break the batch; the retry continues
  }
}

// Narrow child seam keys forwarded to run-once / run-publish-once. Everything
// else stays owned by the existing executors.
const CHILD_SEAM_KEYS = Object.freeze([
  'invokeOpencode',
  'runProofCommand',
  'removeWorkspace',
  'runGh',
  'publishExactCandidate',
  'deleteTemporaryTransportRef',
  'decidePrePublication',
  'decidePreMerge',
  'sleep',
  'env',
]);

function messageOf(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

function gitFailureMessage(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  if (stderr.length > 0) return stderr;
  return messageOf(error);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ghMessageOf(result) {
  const stderr = typeof result?.stderr === 'string' ? result.stderr.trim() : '';
  if (stderr.length > 0) return stderr;
  const stdout = typeof result?.stdout === 'string' ? result.stdout.trim() : '';
  if (stdout.length > 0) return stdout;
  return `gh exited with status ${result?.exitCode ?? 'unknown'}`;
}

function tail(value, limit = PROOF_TAIL_CHARS) {
  const text = typeof value === 'string' ? value : '';
  return text.length <= limit ? text : text.slice(text.length - limit);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Repo-relative path safety: no absolute paths, no drive letters, no `..`. */
export function isSafeRepoPath(value) {
  if (typeof value !== 'string') return false;
  const normalized = normalizeRepoPath(value.trim());
  if (normalized.length === 0) return false;
  if (normalized.startsWith('/')) return false;
  if (/^[a-z]:/i.test(normalized)) return false;
  return !normalized.split('/').some((segment) => segment === '..');
}

function normalizePathList(value) {
  return value.map((entry) => normalizeRepoPath(entry.trim()));
}

function validatePathList({ value, field, errors, min }) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of repo-relative paths`);
    return [];
  }
  const paths = [];
  for (const entry of value) {
    if (!isSafeRepoPath(entry)) {
      errors.push(`${field} contains an invalid repo-relative path: ${JSON.stringify(entry)}`);
      continue;
    }
    paths.push(normalizeRepoPath(entry.trim()));
  }
  if (typeof min === 'number' && paths.length < min) {
    errors.push(`${field} must declare at least ${min} repo-relative path(s)`);
  }
  return paths;
}

function validateTextList({ value, field, errors, min }) {
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list)) {
    errors.push(`${field} must be a non-empty string or an array of non-empty strings`);
    return [];
  }
  const texts = [];
  for (const entry of list) {
    if (!isNonEmptyString(entry)) {
      errors.push(`${field} entries must be non-empty strings`);
      continue;
    }
    texts.push(entry.trim());
  }
  if (typeof min === 'number' && texts.length < min) {
    errors.push(`${field} must declare at least ${min} non-empty entr(ies)`);
  }
  return texts;
}

function validateTokenList({ value, field, errors }) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  const tokens = [];
  for (const token of list) {
    if (!humanEscalationToken(token)) {
      errors.push(`${field} contains an unknown escalation token: ${JSON.stringify(token)}`);
      continue;
    }
    tokens.push(token);
  }
  return tokens;
}

function humanEscalationToken(value) {
  return typeof value === 'string' && HUMAN_ESCALATION_TOKENS.includes(value);
}

function validateCriterion(raw, errors) {
  if (!isPlainObject(raw)) {
    errors.push('CRITERIA entries must be objects');
    return null;
  }
  const id = isNonEmptyString(raw.id) ? raw.id.trim() : null;
  if (id === null) errors.push('criterion id must be a non-empty string');
  const statement = isNonEmptyString(raw.statement) ? raw.statement.trim() : null;
  if (statement === null) errors.push(`criterion ${id ?? '(unknown)'} statement must be a non-empty string`);
  let authority = [];
  if (Array.isArray(raw.authority)) {
    authority = validatePathList({
      value: raw.authority,
      field: `criterion ${id ?? '(unknown)'} authority`,
      errors,
    });
  } else {
    errors.push(`criterion ${id ?? '(unknown)'} authority must be an array of repo-relative paths`);
  }
  const check = raw.check;
  if (!CHECK_KINDS.includes(check)) {
    errors.push(`criterion ${id ?? '(unknown)'} check must be one of ${CHECK_KINDS.join(', ')}`);
  }
  const criterionClass = raw.class;
  if (!CRITERION_CLASSES.includes(criterionClass)) {
    errors.push(`criterion ${id ?? '(unknown)'} class must be one of ${CRITERION_CLASSES.join(', ')}`);
  }
  if (check === 'HUMAN_AUTHORITY' && criterionClass !== 'HUMAN') {
    errors.push(`criterion ${id ?? '(unknown)'} HUMAN_AUTHORITY must declare class HUMAN`);
  }
  if (check === 'EXTERNAL_GATE' && criterionClass !== 'EXTERNAL') {
    errors.push(`criterion ${id ?? '(unknown)'} EXTERNAL_GATE must declare class EXTERNAL`);
  }
  const criterion = { id, statement, authority, check, class: criterionClass };
  if (check === 'PATH_PRESENT' || check === 'PATH_ABSENT' || check === 'DOC_TOKEN') {
    if (!isSafeRepoPath(raw.path)) {
      errors.push(`criterion ${id ?? '(unknown)'} ${check} requires a safe repo-relative path`);
    } else {
      criterion.path = normalizeRepoPath(raw.path.trim());
    }
    if (check === 'DOC_TOKEN' && !isNonEmptyString(raw.token)) {
      errors.push(`criterion ${id ?? '(unknown)'} DOC_TOKEN requires a non-empty token`);
    } else if (check === 'DOC_TOKEN') {
      criterion.token = raw.token;
    }
  }
  if (check === 'PROOF_AT_MAIN' && !isNonEmptyString(raw.command)) {
    errors.push(`criterion ${id ?? '(unknown)'} PROOF_AT_MAIN requires a non-empty command`);
  } else if (check === 'PROOF_AT_MAIN') {
    criterion.command = raw.command;
  }
  if (check === 'PR_MERGED') {
    if (!isNonEmptyString(raw.repository) || !/^[^\s/]+\/[^\s/]+$/.test(raw.repository)) {
      errors.push(`criterion ${id ?? '(unknown)'} PR_MERGED requires repository <owner>/<name>`);
    } else {
      criterion.repository = raw.repository;
    }
    if (!Number.isInteger(raw.pr) || raw.pr <= 0) {
      errors.push(`criterion ${id ?? '(unknown)'} PR_MERGED requires a positive integer pr`);
    } else {
      criterion.pr = raw.pr;
    }
  }
  return criterion;
}

function validateTask(raw, errors) {
  if (!isPlainObject(raw)) {
    errors.push('TASK_CATALOG entries must be objects');
    return null;
  }
  const id = isNonEmptyString(raw.id) ? raw.id.trim() : null;
  if (id === null) errors.push('task id must be a non-empty string');
  const label = id ?? '(unknown)';
  const outcome = isNonEmptyString(raw.outcome) ? raw.outcome.trim() : null;
  if (outcome === null) errors.push(`task ${label} outcome must be a non-empty string`);
  const preserve = isNonEmptyString(raw.preserve) ? raw.preserve.trim() : null;
  if (preserve === null) errors.push(`task ${label} preserve must be a non-empty string`);
  const closesList = raw.closes == null ? [] : Array.isArray(raw.closes) ? raw.closes : [raw.closes];
  const closes = [];
  for (const entry of closesList) {
    if (!isNonEmptyString(entry)) errors.push(`task ${label} closes entries must be non-empty strings`);
    else closes.push(entry.trim());
  }
  if (closes.length === 0) errors.push(`task ${label} must close at least one criterion`);
  const allow = validatePathList({ value: raw.allow, field: `task ${label} allow`, errors, min: 1 });
  const proof = validateTextList({ value: raw.proof ?? [], field: `task ${label} proof`, errors });
  let proofOwner = [];
  if (raw.proof_owner != null) {
    if (!Array.isArray(raw.proof_owner) || raw.proof_owner.length !== proof.length) {
      errors.push(`task ${label} proof_owner must be index-positional with proof`);
    } else {
      for (const owners of raw.proof_owner) {
        if (!Array.isArray(owners) || owners.some((entry) => !isNonEmptyString(entry))) {
          errors.push(`task ${label} proof_owner entries must be arrays of non-empty strings`);
          continue;
        }
        proofOwner.push(normalizePathList(owners.map((entry) => entry.trim())));
      }
    }
  }
  const semanticOwner =
    raw.semantic_owner == null
      ? []
      : validatePathList({ value: raw.semantic_owner, field: `task ${label} semantic_owner`, errors });
  const publication = raw.publication;
  if (!PUBLICATION_MODES.includes(publication)) {
    errors.push(`task ${label} publication must be one of ${PUBLICATION_MODES.join(', ')}`);
  }
  let commitMessage = null;
  let prTitle = null;
  if (publication === 'required') {
    if (!isNonEmptyString(raw.commit_message)) {
      errors.push(`task ${label} requires commit_message when publication is required`);
    } else {
      commitMessage = raw.commit_message;
    }
    if (!isNonEmptyString(raw.pr_title)) {
      errors.push(`task ${label} requires pr_title when publication is required`);
    } else {
      prTitle = raw.pr_title;
    }
  }
  const escalateOnlyIf = validateTokenList({
    value: raw.escalate_only_if,
    field: `task ${label} escalate_only_if`,
    errors,
  });
  const dependsOnList =
    raw.depends_on == null ? [] : Array.isArray(raw.depends_on) ? raw.depends_on : [raw.depends_on];
  const dependsOn = [];
  for (const entry of dependsOnList) {
    if (!isNonEmptyString(entry)) errors.push(`task ${label} depends_on entries must be non-empty strings`);
    else dependsOn.push(entry.trim());
  }
  return {
    id,
    outcome,
    preserve,
    closes,
    allow,
    proof,
    proof_owner: proofOwner,
    semantic_owner: semanticOwner,
    publication,
    commit_message: commitMessage,
    pr_title: prTitle,
    escalate_only_if: escalateOnlyIf,
    depends_on: dependsOn,
  };
}

function hasDependencyCycle(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set();
  const visited = new Set();
  const walk = (id) => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const task = byId.get(id);
    if (task) {
      for (const dependency of task.depends_on) {
        if (walk(dependency)) return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return tasks.some((task) => walk(task.id));
}

/**
 * Deterministic contract validation. Returns `{ok: true, contract}` or
 * `{ok: false, kind, errors}` where kind is INVALID_GOAL for goal-level
 * problems and INVALID_TASK when only catalog tasks are invalid.
 */
export function validateGoalContract(raw) {
  const goalErrors = [];
  const taskErrors = [];
  if (!isPlainObject(raw)) {
    return { ok: false, kind: INVALID_GOAL, errors: ['goal contract must be a JSON object'] };
  }
  const goal = isNonEmptyString(raw.GOAL) ? raw.GOAL.trim() : null;
  if (goal === null) goalErrors.push('GOAL must be a non-empty string');
  const acceptanceAuthority = validatePathList({
    value: raw.ACCEPTANCE_AUTHORITY,
    field: 'ACCEPTANCE_AUTHORITY',
    errors: goalErrors,
    min: 1,
  });
  const preserve = validateTextList({
    value: raw.PRESERVE,
    field: 'PRESERVE',
    errors: goalErrors,
    min: 1,
  });
  const autonomouslyAllowed = validatePathList({
    value: raw.AUTONOMOUSLY_ALLOWED,
    field: 'AUTONOMOUSLY_ALLOWED',
    errors: goalErrors,
  });
  const escalateIf = validateTokenList({
    value: raw.ESCALATE_IF,
    field: 'ESCALATE_IF',
    errors: goalErrors,
  });
  const stopWhen = validateTextList({
    value: raw.STOP_WHEN,
    field: 'STOP_WHEN',
    errors: goalErrors,
    min: 1,
  });

  const criteria = [];
  const criterionIds = new Set();
  const rawCriteria = raw.CRITERIA ?? [];
  if (!Array.isArray(rawCriteria)) {
    goalErrors.push('CRITERIA must be an array');
  } else {
    for (const rawCriterion of rawCriteria) {
      const criterion = validateCriterion(rawCriterion, goalErrors);
      if (criterion === null) continue;
      if (criterion.id !== null) {
        if (criterionIds.has(criterion.id)) {
          goalErrors.push(`duplicate criterion id: ${criterion.id}`);
          continue;
        }
        criterionIds.add(criterion.id);
      }
      criteria.push(criterion);
    }
  }

  const taskCatalog = [];
  const taskIds = new Set();
  const rawCatalog = raw.TASK_CATALOG ?? [];
  if (!Array.isArray(rawCatalog)) {
    taskErrors.push('TASK_CATALOG must be an array');
  } else {
    for (const rawTask of rawCatalog) {
      const task = validateTask(rawTask, taskErrors);
      if (task === null) continue;
      if (task.id !== null) {
        if (taskIds.has(task.id)) {
          taskErrors.push(`duplicate task id: ${task.id}`);
          continue;
        }
        taskIds.add(task.id);
      }
      taskCatalog.push(task);
    }
  }

  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const taskById = new Map(taskCatalog.map((task) => [task.id, task]));
  for (const task of taskCatalog) {
    for (const criterionId of task.closes) {
      const criterion = criteriaById.get(criterionId);
      if (criterion === undefined) {
        taskErrors.push(`task ${task.id} closes an unknown criterion: ${criterionId}`);
      } else if (criterion.class !== 'AUTONOMOUS') {
        taskErrors.push(`task ${task.id} must not close a ${criterion.class} criterion: ${criterionId}`);
      }
    }
    for (const dependency of task.depends_on) {
      if (!taskById.has(dependency)) {
        taskErrors.push(`task ${task.id} depends on an unknown task: ${dependency}`);
      } else if (dependency === task.id) {
        taskErrors.push(`task ${task.id} must not depend on itself`);
      }
    }
  }
  if (taskCatalog.length > 0 && hasDependencyCycle(taskCatalog)) {
    taskErrors.push('TASK_CATALOG depends_on contains a cycle');
  }

  const budget = { ...DEFAULT_BUDGET };
  if (raw.BUDGET != null) {
    if (!isPlainObject(raw.BUDGET)) {
      goalErrors.push('BUDGET must be an object');
    } else {
      for (const [key, fallback] of Object.entries(DEFAULT_BUDGET)) {
        if (raw.BUDGET[key] == null) continue;
        const value = raw.BUDGET[key];
        if (!Number.isInteger(value) || value < 0) {
          goalErrors.push(`BUDGET.${key} must be a non-negative integer`);
          continue;
        }
        budget[key] = value;
      }
    }
  }

  const planner = { enabled: false };
  if (raw.PLANNER != null) {
    if (!isPlainObject(raw.PLANNER)) {
      goalErrors.push('PLANNER must be an object');
    } else {
      for (const key of Object.keys(raw.PLANNER)) {
        if (key !== 'enabled') {
          goalErrors.push(`PLANNER contains an unsupported field: ${key}`);
        }
      }
      if (raw.PLANNER.enabled != null && typeof raw.PLANNER.enabled !== 'boolean') {
        goalErrors.push('PLANNER.enabled must be a boolean');
      }
      planner.enabled = raw.PLANNER.enabled === true;
    }
  }

  if (goalErrors.length > 0 || taskErrors.length > 0) {
    return {
      ok: false,
      kind: goalErrors.length > 0 ? INVALID_GOAL : INVALID_TASK,
      errors: [...goalErrors, ...taskErrors],
    };
  }
  return {
    ok: true,
    contract: {
      goal,
      acceptance_authority: acceptanceAuthority,
      preserve,
      autonomously_allowed: autonomouslyAllowed,
      escalate_if: escalateIf,
      stop_when: stopWhen,
      criteria,
      task_catalog: taskCatalog,
      budget,
      planner,
    },
  };
}

/** Parse + validate a Goal Contract JSON document. */
export function parseGoalContract(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, kind: INVALID_GOAL, errors: [`goal contract is not valid JSON: ${messageOf(error)}`] };
  }
  return validateGoalContract(raw);
}

/** Two independent live `main` observations, bounded to a stable pin. */
export function pinLiveMain({
  repositoryRoot,
  remote,
  readLiveMain = readLiveRemoteMain,
  fetchLiveMain = fetchBaseline,
}) {
  let remoteSha = null;
  let fetchedSha = null;
  const observations = [];
  for (let attempt = 0; attempt < LIVE_MAIN_PIN_ATTEMPTS; attempt += 1) {
    remoteSha = readLiveMain({ repositoryRoot, remote });
    fetchedSha = fetchLiveMain({ repositoryRoot, remote });
    observations.push({ remoteSha, fetchedSha });
    if (remoteSha === fetchedSha) break;
  }
  return { remoteSha, fetchedSha, stable: remoteSha === fetchedSha, observations };
}

/** ACCEPTANCE_AUTHORITY must be readable as a tracked blob at the live SHA. */
export function resolveAcceptanceAuthority({ contract, repositoryRoot, pin }) {
  const entries = [];
  let ok = true;
  for (const path of contract.acceptance_authority) {
    const probe = gitCapture(repositoryRoot, ['cat-file', '-t', `${pin.fetchedSha}:${path}`], {
      allowFailure: true,
    });
    const objectType = probe.ok ? probe.stdout.trim() : null;
    const readable = objectType === 'blob';
    if (!readable) ok = false;
    entries.push({
      path,
      readableAtLiveMain: readable,
      objectType,
      error: readable
        ? null
        : `ACCEPTANCE_AUTHORITY path is empty, missing, or unreadable at live main ${pin.fetchedSha}: ${path}`,
    });
  }
  return { ok, entries };
}

function readTreePresence({ repositoryRoot, ref, path }) {
  const result = gitCapture(repositoryRoot, ['ls-tree', ref, '--', path], { allowFailure: true });
  if (!result.ok) return { ok: false, error: gitFailureMessage(result.error) };
  const line = result.stdout.split('\n').find((entry) => entry.trim().length > 0);
  return { ok: true, present: line !== undefined, entry: line ?? null };
}

function baseCriterionResult(criterion) {
  return {
    id: criterion.id,
    statement: criterion.statement,
    class: criterion.class,
    check: criterion.check,
    authority: [...criterion.authority],
    satisfied: false,
    disposition: null,
    reason: null,
    evaluationError: false,
    proofResult: null,
    cleanup: null,
  };
}

/**
 * Evaluate one criterion against the pinned live main. All Git tree/doc reads
 * use the live object store (`<live-sha>:<path>`), never the working tree.
 * PROOF_AT_MAIN runs in a disposable isolated workspace created from that exact
 * SHA and removed before this function returns.
 */
export function evaluateCriterion({ criterion, repositoryRoot, pin, options = {}, deps = {}, log = () => {} }) {
  const result = baseCriterionResult(criterion);
  const ref = pin.fetchedSha;
  try {
    if (criterion.check === 'PATH_PRESENT' || criterion.check === 'PATH_ABSENT') {
      const presence = readTreePresence({ repositoryRoot, ref, path: criterion.path });
      if (!presence.ok) {
        result.evaluationError = true;
        result.reason = `live-main tree observation failed: ${presence.error}`;
      } else {
        result.satisfied = criterion.check === 'PATH_PRESENT' ? presence.present : !presence.present;
        result.reason =
          criterion.check === 'PATH_PRESENT'
            ? presence.present
              ? `${criterion.path} is present at live main ${ref}`
              : `${criterion.path} is absent from live main ${ref}`
            : !presence.present
              ? `${criterion.path} is absent from live main ${ref}`
              : `${criterion.path} is still present at live main ${ref}`;
      }
      return result;
    }

    if (criterion.check === 'DOC_TOKEN') {
      const read = gitCapture(repositoryRoot, ['show', `${ref}:${criterion.path}`], {
        allowFailure: true,
      });
      if (!read.ok) {
        result.satisfied = false;
        result.reason = `authority document is not readable at live main ${ref}: ${criterion.path}`;
      } else {
        result.satisfied = read.stdout.includes(criterion.token);
        result.reason = result.satisfied
          ? `authority document ${criterion.path} owns token ${criterion.token} at live main ${ref}`
          : `authority document ${criterion.path} does not contain token ${criterion.token} at live main ${ref}`;
      }
      return result;
    }

    if (criterion.check === 'PROOF_AT_MAIN') {
      const runProofCommand = deps.runProofCommand ?? defaultRunProofCommand;
      const removeWorkspace = deps.removeWorkspace ?? defaultRemoveWorkspace;
      const env = deps.env ?? process.env;
      const proofTimeoutMs = options.proofTimeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS;
      let tempRoot = null;
      let workspacePath = null;
      try {
        tempRoot = mkdtempSync(join(tmpdir(), 'greenhub-run-goal-proof-'));
        workspacePath = join(tempRoot, 'workspace');
        createBaselineWorkspace({ repositoryRoot, tempRoot, baselineSha: ref });
        let proof;
        try {
          proof = runProofCommand({
            command: criterion.command,
            cwd: workspacePath,
            env,
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
        result.proofResult = {
          command: criterion.command,
          exitCode: proof.exitCode ?? null,
          signal: proof.signal ?? null,
          timedOut: Boolean(proof.timedOut),
          startErrorCode: proof.startErrorCode ?? null,
          ok: proof.exitCode === 0 && !proof.startErrorCode,
          stdoutTail: tail(proof.stdout),
          stderrTail: tail(proof.stderr),
        };
        result.satisfied = result.proofResult.ok;
        result.reason = result.satisfied
          ? `proof command passed in a disposable workspace at live main ${ref}`
          : `proof command did not pass at live main ${ref} (exit=${result.proofResult.exitCode ?? 'unknown'})`;
      } catch (error) {
        result.evaluationError = true;
        result.reason = `proof workspace could not be prepared at live main ${ref}: ${messageOf(error)}`;
      } finally {
        if (tempRoot !== null) {
          try {
            const removal = removeWorkspace({ repositoryRoot, tempRoot, workspacePath });
            result.cleanup = removal.removed ? 'REMOVED' : 'FAILED';
            if (!removal.removed) {
              result.reason = `${result.reason}; proof workspace cleanup failed: ${(removal.errors ?? []).join('; ')}`;
            }
          } catch (error) {
            result.cleanup = 'FAILED';
            result.reason = `${result.reason}; proof workspace cleanup failed: ${messageOf(error)}`;
          }
        }
      }
      return result;
    }

    if (criterion.check === 'PR_MERGED') {
      const runGh = deps.runGh ?? defaultRunGh;
      const view = runGh(
        ['pr', 'view', String(criterion.pr), '--repo', criterion.repository, '--json', 'state,mergeCommit'],
        { cwd: repositoryRoot },
      );
      if (view.startErrorCode || view.exitCode !== 0) {
        result.evaluationError = true;
        result.reason = `current PR state could not be read from GitHub: ${ghMessageOf(view)}`;
        return result;
      }
      const pr = parseJson(view.stdout);
      if (!isPlainObject(pr)) {
        result.evaluationError = true;
        result.reason = 'current PR observation returned no JSON payload';
        return result;
      }
      result.satisfied = pr.state === 'MERGED';
      result.prState = pr.state ?? null;
      result.reason = result.satisfied
        ? `PR #${criterion.pr} is MERGED according to GitHub`
        : `PR #${criterion.pr} state is ${pr.state ?? 'unknown'}`;
      return result;
    }

    if (criterion.check === 'HUMAN_AUTHORITY') {
      result.reason = 'human authority: this phase never closes a human criterion automatically';
      return result;
    }

    if (criterion.check === 'EXTERNAL_GATE') {
      result.reason = 'external gate: this phase never closes an external criterion automatically';
      return result;
    }

    result.evaluationError = true;
    result.reason = `unsupported criterion check: ${String(criterion.check)}`;
    return result;
  } catch (error) {
    result.evaluationError = true;
    result.reason = `criterion evaluation failed: ${messageOf(error)}`;
    return result;
  }
}

export function evaluateGoalCriteria({ contract, repositoryRoot, pin, options = {}, deps = {}, log = () => {} }) {
  return contract.criteria.map((criterion) =>
    evaluateCriterion({ criterion, repositoryRoot, pin, options, deps, log }),
  );
}

function criteriaById(criteria) {
  return new Map(criteria.map((criterion) => [criterion.id, criterion]));
}

function openAutonomousCriteria(criteria) {
  return new Set(
    criteria
      .filter(
        (criterion) =>
          !criterion.satisfied && criterion.class === 'AUTONOMOUS' && !criterion.evaluationError,
      )
      .map((criterion) => criterion.id),
  );
}

function isDependencySatisfied(taskId, state) {
  if (state.completedTaskIds.has(taskId)) return true;
  const task = state.taskById.get(taskId);
  if (task === undefined) return false;
  return task.closes.every((criterionId) => state.criteriaById.get(criterionId)?.satisfied === true);
}

function taskAllowWithinBoundary(task, contract) {
  return task.allow.filter((path) => !isPathAllowed(path, contract.autonomously_allowed));
}

function taskEligibility(task, state) {
  if (state.attemptedTaskIds.has(task.id)) {
    return { eligible: false, skip: 'already attempted in this invocation', refusal: null, closes: [] };
  }
  const open = state.openAutonomous;
  const closes = task.closes.filter((criterionId) => open.has(criterionId));
  if (closes.length === 0) {
    return { eligible: false, skip: 'no open AUTONOMOUS criterion it closes', refusal: null, closes: [] };
  }
  const unmet = task.depends_on.filter((dependency) => !isDependencySatisfied(dependency, state));
  if (unmet.length > 0) {
    return {
      eligible: false,
      skip: `depends_on not satisfied: ${unmet.join(', ')}`,
      refusal: null,
      closes,
    };
  }
  const outside = taskAllowWithinBoundary(task, state.contract);
  if (outside.length > 0) {
    return {
      eligible: false,
      skip: null,
      refusal: `allow path(s) outside AUTONOMOUSLY_ALLOWED: ${outside.join(', ')}`,
      closes,
    };
  }
  return { eligible: true, skip: null, refusal: null, closes };
}

function buildSelectionState({ contract, criteria, attemptedTaskIds, completedTaskIds }) {
  return {
    contract,
    criteriaById: criteriaById(criteria),
    openAutonomous: openAutonomousCriteria(criteria),
    taskById: new Map(contract.task_catalog.map((task) => [task.id, task])),
    attemptedTaskIds,
    completedTaskIds,
  };
}

/**
 * Deterministic selection: first catalog task (declaration order) that closes
 * an open AUTONOMOUS criterion, is not already attempted, has satisfied
 * depends_on, and stays inside AUTONOMOUSLY_ALLOWED. Tasks that exist but are
 * refused by the authority boundary are reported separately.
 */
export function selectTask({ contract, criteria, attemptedTaskIds, completedTaskIds }) {
  const state = buildSelectionState({ contract, criteria, attemptedTaskIds, completedTaskIds });
  const skipped = [];
  const refusals = [];
  for (const task of contract.task_catalog) {
    const eligibility = taskEligibility(task, state);
    if (eligibility.eligible) {
      return { task, closes: eligibility.closes, skipped, refusals };
    }
    if (eligibility.refusal !== null) {
      refusals.push({ taskId: task.id, closes: eligibility.closes, reason: eligibility.refusal });
    } else if (eligibility.skip !== null && eligibility.skip !== 'no open AUTONOMOUS criterion it closes') {
      skipped.push({ taskId: task.id, reason: eligibility.skip });
    }
  }
  return { task: null, closes: [], skipped, refusals };
}

/** True when any declared path of `left` and `right` overlap by prefix. */
function pathListsOverlap(left, right) {
  return left.some((a) => right.some((b) => isPathAllowed(a, [b]) || isPathAllowed(b, [a])));
}

/**
 * Material overlap between two admitted candidates. `null` means the two tasks
 * may start together. The returned kind names the exact dimension that would be
 * violated by concurrent execution.
 */
function taskConflict(task, sibling) {
  if (task.depends_on.includes(sibling.id) || sibling.depends_on.includes(task.id)) {
    return { kind: 'DEPENDS_ON', reason: `explicit depends_on relationship between ${task.id} and ${sibling.id}` };
  }
  if (pathListsOverlap(task.semantic_owner, sibling.semantic_owner)) {
    return {
      kind: 'SEMANTIC_OWNER',
      reason: `semantic_owner overlap between ${task.id} and ${sibling.id}`,
    };
  }
  if (pathListsOverlap(task.allow, sibling.allow)) {
    return {
      kind: 'ALLOW_SURFACE',
      reason: `declared mutation allow surface overlap between ${task.id} and ${sibling.id}`,
    };
  }
  if (pathListsOverlap(task.semantic_owner, sibling.allow) || pathListsOverlap(sibling.semantic_owner, task.allow)) {
    return {
      kind: 'SEMANTIC_MUTATION',
      reason: `semantic_owner against the sibling mutation surface between ${task.id} and ${sibling.id}`,
    };
  }
  const taskProofOwners = task.proof_owner.flat();
  const siblingProofOwners = sibling.proof_owner.flat();
  if (pathListsOverlap(taskProofOwners, sibling.allow) || pathListsOverlap(siblingProofOwners, task.allow)) {
    return {
      kind: 'PROOF_OWNER',
      reason: `proof_owner against the sibling mutation surface between ${task.id} and ${sibling.id}`,
    };
  }
  return null;
}

/**
 * Deterministic batch admission: up to `maxConcurrency` pairwise-independent
 * eligible catalog tasks in declaration order. Excluded tasks are reported with
 * the exact reason and stay eligible for a later recomputation; they are never
 * failed merely because this batch refused them.
 */
export function admitTaskBatch({
  contract,
  criteria,
  attemptedTaskIds,
  completedTaskIds,
  maxConcurrency = MAX_BATCH_CONCURRENCY,
}) {
  const state = buildSelectionState({ contract, criteria, attemptedTaskIds, completedTaskIds });
  const tasks = [];
  const skipped = [];
  const refusals = [];
  const excluded = [];
  for (const task of contract.task_catalog) {
    const eligibility = taskEligibility(task, state);
    if (!eligibility.eligible) {
      if (eligibility.refusal !== null) {
        refusals.push({ taskId: task.id, closes: eligibility.closes, reason: eligibility.refusal });
      } else if (
        eligibility.skip !== null &&
        eligibility.skip !== 'no open AUTONOMOUS criterion it closes'
      ) {
        skipped.push({ taskId: task.id, reason: eligibility.skip });
      }
      continue;
    }
    if (tasks.length >= maxConcurrency) {
      excluded.push({
        taskId: task.id,
        closes: eligibility.closes,
        kind: 'CONCURRENCY_LIMIT',
        withTaskId: null,
        reason: `batch concurrency limit ${maxConcurrency} reached`,
      });
      continue;
    }
    let conflict = null;
    for (const admitted of tasks) {
      conflict = taskConflict(task, admitted.task);
      if (conflict !== null) {
        conflict = { ...conflict, withTaskId: admitted.task.id };
        break;
      }
    }
    if (conflict !== null) {
      excluded.push({
        taskId: task.id,
        closes: eligibility.closes,
        kind: conflict.kind,
        withTaskId: conflict.withTaskId,
        reason: conflict.reason,
      });
      continue;
    }
    tasks.push({ task, closes: eligibility.closes });
  }
  return { tasks, skipped, refusals, excluded };
}

/**
 * Stable, distinct OpenCode session title for one task. Serial batches keep the
 * caller-supplied title exactly; a concurrent batch derives a distinct title
 * from the task id so the shared OpenCode server shows separate sessions.
 */
export function buildTaskTitle({ baseTitle = null, taskId, concurrent = false }) {
  if (!concurrent) return isNonEmptyString(baseTitle) ? baseTitle : null;
  const base = isNonEmptyString(baseTitle) ? baseTitle.trim() : 'run-goal';
  return `${base} [${taskId}]`;
}

/** OpenCode-facing semantic text in the existing four-section shape. */
export function buildTaskText({ task, contract }) {
  const preserveLines = [task.preserve];
  if (contract.preserve.length > 0) {
    preserveLines.push(`Goal-level preserve (do not change): ${contract.preserve.join(', ')}`);
  }
  const proofText =
    task.proof.length > 0
      ? task.proof.map((command) => `- ${command}`).join('\n')
      : 'No proof command is declared; stop when the OUTCOME is satisfied inside the declared boundary.';
  const escalateText =
    task.escalate_only_if.length > 0
      ? task.escalate_only_if.map((token) => `- ${token}`).join('\n')
      : 'The bounded task contract is unclear or would exceed its declared boundary.';
  return [
    `OUTCOME:\n${task.outcome}`,
    `PRESERVE:\n${preserveLines.join('\n')}`,
    `PROOF:\n${proofText}`,
    `ESCALATE ONLY IF:\n${escalateText}`,
  ].join('\n\n');
}

function isChildSuccess(task, child) {
  if (!isPlainObject(child)) return false;
  if (task.publication === 'required') return PUBLICATION_SUCCESS_OUTCOMES.includes(child.status);
  return child.status === RUN_ONCE_SUCCESS;
}

function criterionStateFingerprint(criteria) {
  return JSON.stringify(
    criteria
      .filter(
        (criterion) =>
          !criterion.satisfied && criterion.class === 'AUTONOMOUS' && !criterion.evaluationError,
      )
      .map((criterion) => criterion.id)
      .sort(),
  );
}

export function buildPlannerPrompt({ contract, pin, criteria }) {
  const openAutonomous = criteria.filter(
    (criterion) =>
      !criterion.satisfied && criterion.class === 'AUTONOMOUS' && !criterion.evaluationError,
  );
  const criterionBlocks = openAutonomous.map((criterion) =>
    [
      `- id: ${criterion.id}`,
      `  statement: ${criterion.statement}`,
      `  check: ${criterion.check}`,
      `  authority: ${criterion.authority.join(', ') || '(none declared)'}`,
      `  current evaluation: ${criterion.reason ?? 'not evaluated'}`,
    ].join('\n'),
  );
  return [
    'You are the read-only planner for exactly one bounded development goal.',
    'Inspect this disposable workspace, then propose at most one next bounded task.',
    '',
    'You are not a writer. Do not modify, create, or delete any file. Do not commit.',
    'Do not create branches, tags, or refs. Do not push. Do not open pull requests.',
    'Do not deploy. Do not mutate any external system. Git observes this workspace',
    'after you exit; any repository mutation rejects your proposal.',
    '',
    '## GOAL',
    contract.goal,
    '',
    '## Current live main',
    pin.fetchedSha,
    '',
    '## ACCEPTANCE_AUTHORITY',
    ...contract.acceptance_authority.map((path) => `- ${path}`),
    '',
    '## PRESERVE (must not change)',
    ...contract.preserve.map((entry) => `- ${entry}`),
    '',
    '## AUTONOMOUSLY_ALLOWED',
    ...contract.autonomously_allowed.map((path) => `- ${path}`),
    '',
    '## Declared escalation tokens (the only tokens you may return)',
    ...(contract.escalate_if.length > 0
      ? contract.escalate_if.map((token) => `- ${token}`)
      : ['- (none declared)']),
    '',
    '## Unsatisfied AUTONOMOUS criteria',
    ...(criterionBlocks.length > 0 ? criterionBlocks : ['- (none)']),
    '',
    '## Required output',
    'Return exactly one JSON object and nothing else: no markdown fence, no',
    'commentary, no second payload. Allowed shapes:',
    '{"decision":"TASK","reason":"...","task":{"id":"...","outcome":"...","closes":["criterion-id"],"allow":["repo/path"],"semantic_owner":["repo/path"]}}',
    '{"decision":"NO_TASK","reason":"..."}',
    '{"decision":"ESCALATE","reason":"...","escalation_token":"..."}',
    '',
    'Rules:',
    `- "outcome" must be a non-empty string of at most ${PLANNER_OUTCOME_MAX_CHARS} characters.`,
    '- "closes" must be a non-empty subset of the unsatisfied AUTONOMOUS criterion ids above.',
    '- "allow" must be non-empty repo-relative paths inside AUTONOMOUSLY_ALLOWED.',
    '- "semantic_owner" entries must be repo-relative paths inside AUTONOMOUSLY_ALLOWED.',
    '- Do not return proof commands, publication fields, commit messages, PR titles, dependencies, or any other field; the runner derives them.',
    '- Return NO_TASK when no single safe autonomous task can advance the goal.',
    '- Return ESCALATE only with one of the declared escalation tokens.',
  ].join('\n');
}

function parsePlannerOutput(stdout) {
  const textParts = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const event = parseJson(line);
    if (!isPlainObject(event)) {
      return { ok: false, reason: 'planner stdout contains a line that is not a JSON event' };
    }
    if (event.type !== 'text') continue;
    const part = event.part;
    if (!isPlainObject(part) || typeof part.text !== 'string') {
      return { ok: false, reason: 'planner text event has no text payload' };
    }
    textParts.push(part.text);
  }
  if (textParts.length === 0) {
    return { ok: false, reason: 'planner output contained no assistant text' };
  }
  const text = textParts.join('').trim();
  const proposal = parseJson(text);
  if (!isPlainObject(proposal)) {
    return { ok: false, reason: 'planner final text is not exactly one JSON object' };
  }
  return { ok: true, proposal, text };
}

function validatePlannerProposal({ proposal, contract, criteria, usedTaskIds }) {
  const reject = (kind, reason) => ({ ok: false, kind, reason });
  if (!PLANNER_DECISIONS.includes(proposal.decision)) {
    return reject('INVALID_OUTPUT', 'planner decision must be TASK, NO_TASK, or ESCALATE');
  }
  if (!isNonEmptyString(proposal.reason)) {
    return reject('INVALID_OUTPUT', 'planner reason must be a non-empty string');
  }
  const topLevelFields =
    proposal.decision === 'TASK'
      ? ['decision', 'reason', 'task']
      : proposal.decision === 'ESCALATE'
        ? ['decision', 'reason', 'escalation_token']
        : ['decision', 'reason'];
  const extraTopLevel = Object.keys(proposal).filter((key) => !topLevelFields.includes(key));
  if (extraTopLevel.length > 0) {
    return reject(
      'INVALID_OUTPUT',
      `planner proposal contains unsupported field(s): ${extraTopLevel.join(', ')}`,
    );
  }

  if (proposal.decision === 'NO_TASK') {
    return { ok: true, decision: 'NO_TASK', reason: proposal.reason.trim() };
  }

  if (proposal.decision === 'ESCALATE') {
    const token = isNonEmptyString(proposal.escalation_token)
      ? proposal.escalation_token.trim()
      : null;
    if (token === null) {
      return reject('INVALID_OUTPUT', 'planner ESCALATE requires a non-empty escalation_token');
    }
    if (!contract.escalate_if.includes(token)) {
      return reject(
        'INVALID_OUTPUT',
        `planner escalation_token is not declared in the Goal Contract: ${token}`,
      );
    }
    return { ok: true, decision: 'ESCALATE', reason: proposal.reason.trim(), escalation_token: token };
  }

  if (!isPlainObject(proposal.task)) {
    return reject('INVALID_OUTPUT', 'planner TASK requires a task object');
  }
  const extraTask = Object.keys(proposal.task).filter(
    (key) => !PLANNER_TASK_FIELDS.includes(key),
  );
  if (extraTask.length > 0) {
    return reject(
      'INVALID_OUTPUT',
      `planner task contains unsupported field(s): ${extraTask.join(', ')}`,
    );
  }
  const id = isNonEmptyString(proposal.task.id) ? proposal.task.id.trim() : null;
  if (id === null || !PLANNER_TASK_ID_PATTERN.test(id)) {
    return reject('INVALID_OUTPUT', 'planner task id must be a deterministic-safe identifier');
  }
  if (usedTaskIds.has(id)) {
    return reject('ID_COLLISION', `planner task id collides with an already used task id: ${id}`);
  }
  const outcome = isNonEmptyString(proposal.task.outcome) ? proposal.task.outcome.trim() : null;
  if (outcome === null || outcome.length > PLANNER_OUTCOME_MAX_CHARS) {
    return reject(
      'INVALID_OUTPUT',
      `planner task outcome must be a non-empty string of at most ${PLANNER_OUTCOME_MAX_CHARS} characters`,
    );
  }
  if (!Array.isArray(proposal.task.closes) || proposal.task.closes.length === 0) {
    return reject('INVALID_OUTPUT', 'planner task closes must be a non-empty array of criterion ids');
  }
  const openAutonomous = new Set(
    criteria
      .filter(
        (criterion) =>
          !criterion.satisfied && criterion.class === 'AUTONOMOUS' && !criterion.evaluationError,
      )
      .map((criterion) => criterion.id),
  );
  const byId = criteriaById(criteria);
  const closes = [];
  const humanCloses = [];
  const externalCloses = [];
  for (const entry of proposal.task.closes) {
    if (!isNonEmptyString(entry)) {
      return reject('INVALID_OUTPUT', 'planner task closes entries must be non-empty strings');
    }
    const criterionId = entry.trim();
    const criterion = byId.get(criterionId);
    if (criterion === undefined) {
      return reject('INVALID_OUTPUT', `planner task closes an unknown criterion: ${criterionId}`);
    }
    if (criterion.class === 'HUMAN') {
      humanCloses.push(criterionId);
      continue;
    }
    if (criterion.class === 'EXTERNAL') {
      externalCloses.push(criterionId);
      continue;
    }
    if (!openAutonomous.has(criterionId)) {
      return reject(
        'INVALID_OUTPUT',
        `planner task closes a criterion that is not an unsatisfied AUTONOMOUS gap: ${criterionId}`,
      );
    }
    closes.push(criterionId);
  }
  if (humanCloses.length > 0) {
    return reject(
      'HUMAN_CRITERION_REJECTED',
      `planner must not close a HUMAN criterion: ${humanCloses.join(', ')}`,
    );
  }
  if (externalCloses.length > 0) {
    return reject(
      'EXTERNAL_CRITERION_REJECTED',
      `planner must not close an EXTERNAL criterion: ${externalCloses.join(', ')}`,
    );
  }
  if (!Array.isArray(proposal.task.allow) || proposal.task.allow.length === 0) {
    return reject('INVALID_OUTPUT', 'planner task allow must be a non-empty array of repo-relative paths');
  }
  const allow = [];
  for (const entry of proposal.task.allow) {
    if (!isSafeRepoPath(entry)) {
      return reject(
        'INVALID_OUTPUT',
        `planner task allow contains an invalid repo-relative path: ${JSON.stringify(entry)}`,
      );
    }
    allow.push(normalizeRepoPath(entry.trim()));
  }
  const semanticOwnerRaw = proposal.task.semantic_owner ?? [];
  if (!Array.isArray(semanticOwnerRaw)) {
    return reject('INVALID_OUTPUT', 'planner task semantic_owner must be an array of repo-relative paths');
  }
  const semanticOwner = [];
  for (const entry of semanticOwnerRaw) {
    if (!isSafeRepoPath(entry)) {
      return reject(
        'INVALID_OUTPUT',
        `planner task semantic_owner contains an invalid repo-relative path: ${JSON.stringify(entry)}`,
      );
    }
    semanticOwner.push(normalizeRepoPath(entry.trim()));
  }
  const outside = [...new Set([...allow, ...semanticOwner].filter((path) => !isPathAllowed(path, contract.autonomously_allowed)))];
  if (outside.length > 0) {
    return reject(
      'ALLOW_OUTSIDE_AUTHORITY',
      `planner path(s) outside AUTONOMOUSLY_ALLOWED: ${outside.join(', ')}`,
    );
  }
  return {
    ok: true,
    decision: 'TASK',
    reason: proposal.reason.trim(),
    task: { id, outcome, closes, allow, semantic_owner: semanticOwner },
  };
}

/**
 * Runner-authored executable task for a validated planner proposal. Proof comes
 * only from canonical PROOF_AT_MAIN commands already declared in the Goal
 * Contract, copied exactly; the planner never authors a proof command.
 */
export function buildPlannerTask({ validated, contract }) {
  const contractById = criteriaById(contract.criteria);
  const proof = [];
  const proofOwner = [];
  for (const criterionId of validated.task.closes) {
    const criterion = contractById.get(criterionId);
    if (criterion.check === 'PROOF_AT_MAIN') {
      proof.push(criterion.command);
      proofOwner.push([]);
    }
  }
  if (proof.length === 0) return null;
  return {
    id: validated.task.id,
    outcome: validated.task.outcome,
    preserve: `Preserve ${contract.preserve.join(', ')} and every current live-main behavior outside the bounded outcome.`,
    closes: [...validated.task.closes],
    allow: [...validated.task.allow],
    proof,
    proof_owner: proofOwner,
    semantic_owner: [...validated.task.semantic_owner],
    publication: 'required',
    commit_message: `feat(agent): ${validated.task.id} ${validated.task.outcome}`,
    pr_title: `feat(agent): ${validated.task.outcome}`,
    escalate_only_if: [...contract.escalate_if],
    depends_on: [],
  };
}

function runPlanner({ contract, pin, criteria, options, deps, log, usedTaskIds }) {
  const repositoryRoot = resolve(options.repositoryRoot);
  const baseEnv = deps.env ?? process.env;
  const invokeOpencode = deps.invokePlannerOpencode ?? defaultInvokeOpencode;
  const removeWorkspace = deps.removeWorkspace ?? defaultRemoveWorkspace;
  const evidence = {
    status: null,
    reason: null,
    decision: null,
    proposal: null,
    task: null,
    terminal: null,
    changedPaths: [],
    workspaceCleanup: 'NOT_CREATED',
    outputTail: '',
    executor: {
      invoked: false,
      commandSource: null,
      exitCode: null,
      timedOut: false,
      startErrorCode: null,
    },
  };
  let tempRoot = null;
  let workspacePath = null;
  let mutationObserved = false;
  let invocationFailure = null;
  try {
    tempRoot = mkdtempSync(join(tmpdir(), 'greenhub-run-goal-planner-'));
    workspacePath = createBaselineWorkspace({
      repositoryRoot,
      tempRoot,
      baselineSha: pin.fetchedSha,
    });
    let resolvedCommand = null;
    if (deps.invokePlannerOpencode === undefined) {
      resolvedCommand = resolveOpencodeCommand({ explicitBin: options.opencodeBin ?? null, baseEnv });
      evidence.executor.commandSource = resolvedCommand.source;
    }
    const prompt = buildPlannerPrompt({ contract, pin, criteria });
    const args = buildOpencodeArgs({
      taskText: prompt,
      workspacePath,
      model: options.model ?? null,
      agent: options.agent ?? null,
      title: isNonEmptyString(options.title) ? `${options.title} planner` : null,
    });
    const childEnv = buildChildEnv({ baseEnv, scratchDir: tempRoot });
    evidence.executor.invoked = true;
    log(`[run-goal] planner opencode start in ${workspacePath}`);
    const execution = invokeOpencode({
      resolvedCommand,
      args,
      cwd: workspacePath,
      env: childEnv,
      timeoutMs: options.opencodeTimeoutMs ?? DEFAULT_OPENCODE_TIMEOUT_MS,
    });
    evidence.executor.exitCode = execution?.exitCode ?? null;
    evidence.executor.timedOut = Boolean(execution?.timedOut);
    evidence.executor.startErrorCode = execution?.startErrorCode ?? null;
    evidence.outputTail = tail(execution?.stdout, PLANNER_OUTPUT_TAIL_CHARS);
    log(
      `[run-goal] planner opencode exit=${evidence.executor.exitCode} timedOut=${evidence.executor.timedOut}`,
    );
    const observation = observeChangedPaths({ workspacePath, baselineSha: pin.fetchedSha });
    evidence.changedPaths = observation.changedPaths;
    const executionSucceeded =
      !evidence.executor.startErrorCode &&
      !evidence.executor.timedOut &&
      evidence.executor.exitCode === 0;
    if (observation.changedPaths.length > 0) {
      mutationObserved = true;
      if (executionSucceeded) {
        const parsed = parsePlannerOutput(execution?.stdout);
        if (parsed.ok) {
          evidence.proposal = parsed.proposal;
          evidence.decision = parsed.proposal.decision;
        }
      }
    } else if (!executionSucceeded) {
      invocationFailure =
        `exit=${evidence.executor.exitCode} timedOut=${evidence.executor.timedOut} ` +
        `startError=${evidence.executor.startErrorCode ?? 'none'}`;
    } else {
      const parsed = parsePlannerOutput(execution?.stdout);
      if (!parsed.ok) {
        evidence.status = 'INVALID_OUTPUT';
        evidence.reason = parsed.reason;
      } else {
        evidence.proposal = parsed.proposal;
        evidence.decision = parsed.proposal.decision;
        const validation = validatePlannerProposal({
          proposal: parsed.proposal,
          contract,
          criteria,
          usedTaskIds,
        });
        if (!validation.ok) {
          evidence.status = validation.kind;
          evidence.reason = validation.reason;
        } else if (validation.decision === 'TASK') {
          const task = buildPlannerTask({ validated: validation, contract });
          if (task === null) {
            evidence.status = 'PROOF_AUTHORITY_REQUIRED';
            evidence.reason =
              `planner task ${validation.task.id} has no canonical PROOF_AT_MAIN authority: ` +
              'PROOF_AUTHORITY_REQUIRED';
          } else {
            evidence.status = 'TASK';
            evidence.reason = `planner proposed bounded task ${task.id}`;
            evidence.task = task;
          }
        } else if (validation.decision === 'NO_TASK') {
          evidence.status = 'NO_TASK';
          evidence.reason = `planner returned NO_TASK: ${validation.reason}`;
        } else {
          evidence.status = 'ESCALATE';
          evidence.reason =
            `planner escalated with declared token ${validation.escalation_token}: ${validation.reason}`;
        }
      }
    }
  } catch (error) {
    evidence.status = 'WORKSPACE_FAILED';
    evidence.reason = `planner workspace could not be prepared or invoked: ${messageOf(error)}`;
  } finally {
    if (tempRoot !== null) {
      try {
        const removal = removeWorkspace({ repositoryRoot, tempRoot, workspacePath });
        evidence.workspaceCleanup = removal.removed ? 'REMOVED' : 'FAILED';
        if (!removal.removed) {
          evidence.status = 'WORKSPACE_FAILED';
          evidence.reason = `planner workspace cleanup failed: ${(removal.errors ?? []).join('; ')}`;
          evidence.task = null;
        }
      } catch (error) {
        evidence.workspaceCleanup = 'FAILED';
        evidence.status = 'WORKSPACE_FAILED';
        evidence.reason = `planner workspace cleanup failed: ${messageOf(error)}`;
        evidence.task = null;
      }
    }
  }
  if (evidence.status === null) {
    if (mutationObserved) {
      evidence.status = 'MUTATION_REJECTED';
      evidence.reason =
        `planner workspace mutation observed: ${evidence.changedPaths.join(', ')}; ` +
        'PLANNER_MUTATION_REJECTED';
    } else {
      evidence.status = 'INVOCATION_FAILED';
      evidence.reason = `planner invocation did not complete successfully (${invocationFailure})`;
    }
  }
  if (evidence.status !== 'TASK') evidence.task = null;
  evidence.terminal = PLANNER_TERMINALS[evidence.status] ?? null;
  log(`[run-goal] planner status=${evidence.status} terminal=${evidence.terminal ?? 'none'}`);
  return evidence;
}

function createPlannerResult() {
  return {
    enabled: false,
    calls: 0,
    decisions: [],
    lastStatus: null,
    lastReason: null,
    lastProposal: null,
    lastOutputTail: '',
    lastChangedPaths: [],
    lastWorkspaceCleanup: 'NOT_CREATED',
    lastExecutor: null,
  };
}

function criteriaChanged(previous, next) {
  const before = criteriaById(previous);
  return next.some((criterion) => before.get(criterion.id)?.satisfied !== criterion.satisfied);
}

function allSatisfied(criteria) {
  return criteria.every((criterion) => criterion.satisfied);
}

function checkBudget({ passCount, attemptsCount, startedAt, now, budget }) {
  if (passCount >= budget.max_iterations) return 'ITERATIONS';
  if (attemptsCount >= budget.max_tasks) return 'TASKS';
  if (now() - startedAt > budget.max_wall_clock_ms) return 'WALL_CLOCK';
  return null;
}

function annotateCriteria({ contract, criteria, attemptedTaskIds, completedTaskIds }) {
  const state = buildSelectionState({ contract, criteria, attemptedTaskIds, completedTaskIds });
  return criteria.map((criterion) => {
    if (criterion.satisfied) return { ...criterion, disposition: 'SATISFIED' };
    if (criterion.evaluationError) return { ...criterion, disposition: 'EXTERNAL' };
    if (criterion.class === 'HUMAN') return { ...criterion, disposition: 'HUMAN' };
    if (criterion.class === 'EXTERNAL') return { ...criterion, disposition: 'EXTERNAL' };
    const closingTasks = contract.task_catalog.filter((task) => task.closes.includes(criterion.id));
    const taskable =
      state.openAutonomous.has(criterion.id) &&
      closingTasks.some((task) => taskEligibility(task, state).eligible);
    return { ...criterion, disposition: taskable ? 'AUTONOMOUS_TASKABLE' : 'AUTONOMOUS_UNTASKED' };
  });
}

function classifyTerminal({ criteria, attempts, refusals, attemptedTaskIds }) {
  if (criteria.some((criterion) => !criterion.satisfied && criterion.class === 'HUMAN')) {
    return HUMAN_DECISION_REQUIRED;
  }
  // A declared task that the AUTONOMOUSLY_ALLOWED boundary refuses means the
  // remaining gap cannot be closed without expanding human-granted authority.
  if (refusals.length > 0) return HUMAN_DECISION_REQUIRED;
  if (
    criteria.some(
      (criterion) => !criterion.satisfied && (criterion.class === 'EXTERNAL' || criterion.evaluationError),
    )
  ) {
    return BLOCKED_EXTERNAL;
  }
  if (attemptedTaskIds.size > 0) {
    if (attempts.some((attempt) => !attempt.succeeded)) return NO_PROGRESS;
    return NO_TASK_FOR_GAP;
  }
  return NO_TASK_FOR_GAP;
}

function createGoalResult() {
  return {
    status: null,
    reason: null,
    goal: {
      text: null,
      acceptanceAuthority: [],
      preserve: [],
      autonomouslyAllowed: [],
      escalateIf: [],
      stopWhen: [],
      budget: null,
    },
    validation: { kind: null, errors: [] },
    liveMain: {
      atStart: null,
      atEnd: null,
      movement: 'UNKNOWN',
      observations: [],
      error: null,
    },
    acceptanceAuthority: [],
    criteriaAtStart: [],
    criteria: [],
    iterations: 0,
    budget: {
      maxIterations: null,
      maxTasks: null,
      maxWallClockMs: null,
      iterationsUsed: 0,
      tasksAttempted: 0,
      elapsedMs: 0,
      exhausted: null,
    },
    selection: { taskId: null, closes: [], refusals: [], skipped: [] },
    refusals: [],
    attempts: [],
    batches: [],
    maxBatchConcurrency: MAX_BATCH_CONCURRENCY,
    childCalls: 0,
    planner: createPlannerResult(),
    canonicalCheckout: { before: null, after: null, unchanged: null },
  };
}

function readGoalText(options) {
  if (typeof options?.goalText === 'string') return { ok: true, text: options.goalText };
  if (!isNonEmptyString(options?.goalFile)) {
    return { ok: false, error: '--goal is required' };
  }
  try {
    return { ok: true, text: readFileSync(resolve(options.goalFile), 'utf8') };
  } catch (error) {
    return { ok: false, error: `cannot read goal file: ${messageOf(error)}` };
  }
}

function buildChildDeps(deps, log) {
  const childDeps = {};
  for (const key of CHILD_SEAM_KEYS) {
    if (deps[key] !== undefined) childDeps[key] = deps[key];
  }
  childDeps.log = log;
  return childDeps;
}

/** Serializable child invocation for one admitted task. */
export function buildChildInvocation({ task, taskText, options, title }) {
  const shared = {
    repositoryRoot: resolve(options.repositoryRoot ?? process.cwd()),
    remote: options.remote ?? 'origin',
    taskText,
    allowedPaths: [...task.allow],
    proofCommands: [...task.proof],
    proofOwners: task.proof_owner.map((owners) => [...owners]),
    title,
    model: options.model ?? null,
    agent: options.agent ?? null,
    opencodeBin: options.opencodeBin ?? null,
    opencodeTimeoutMs: options.opencodeTimeoutMs,
    proofTimeoutMs: options.proofTimeoutMs,
  };
  if (task.publication === 'required') {
    return {
      runner: 'runPublishOnce',
      options: {
        ...shared,
        commitMessage: task.commit_message,
        prTitle: task.pr_title,
        githubRepository: options.githubRepository ?? null,
        ciTimeoutMs: options.ciTimeoutMs,
        maxRebindAttempts: options.maxRebindAttempts,
      },
    };
  }
  return { runner: 'runOnce', options: shared };
}

/**
 * A baseline observation that failed before any OpenCode invocation and before
 * any task-owned mutation is a transient start race (for example concurrent
 * `git` observations on one canonical checkout), not a semantic failure. It is
 * the only failure class the batch may retry.
 */
export function isRetryableStartFailure(child) {
  if (!isPlainObject(child)) return false;
  if (child.status !== 'BASELINE_OBSERVATION_FAILED') return false;
  if (child.executor?.invoked === true) return false;
  const changedPaths = Array.isArray(child.changedPaths) ? child.changedPaths : [];
  return changedPaths.length === 0;
}

/**
 * Bounded start retry shared by the worker path and the deterministic in-process
 * path. `execute` returns a record with a `child` result; `onRetry` is called
 * before each retry (workers use it for a serialized backoff).
 */
export function runTaskWithStartRetry({
  execute,
  onRetry = null,
  maxAttempts = MAX_BATCH_TASK_START_ATTEMPTS,
}) {
  let record = execute();
  let attempts = 1;
  const retryReasons = [];
  while (isRetryableStartFailure(record?.child) && attempts < maxAttempts) {
    retryReasons.push(record.child.reason ?? 'baseline observation failed');
    if (typeof onRetry === 'function') onRetry(attempts);
    record = execute();
    attempts += 1;
  }
  return { ...record, attempts, retryReasons };
}

function invokeDescriptorInProcess({ descriptor, deps, log }) {
  const startedAt = Date.now();
  const childDeps = buildChildDeps(deps, log);
  const runner =
    descriptor.invocation.runner === 'runPublishOnce'
      ? (deps.runPublishOnce ?? defaultRunPublishOnce)
      : (deps.runOnce ?? defaultRunOnce);
  const execute = () => {
    let child;
    try {
      child = runner(descriptor.invocation.options, childDeps);
    } catch (error) {
      child = { status: 'EXECUTOR_FAILED', reason: `child invocation failed: ${messageOf(error)}` };
    }
    return { taskId: descriptor.taskId, title: descriptor.title, child };
  };
  const record = runTaskWithStartRetry({ execute });
  return { ...record, startedAt, endedAt: Date.now() };
}

function serializeWorkerEnv(env) {
  if (!isPlainObject(env)) return null;
  const serialized = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string') serialized[name] = value;
  }
  return serialized;
}

function withBatchLock(states, lockIndex, action) {
  for (;;) {
    if (Atomics.compareExchange(states, lockIndex, 0, 1) === 0) break;
    Atomics.wait(states, lockIndex, 1);
  }
  try {
    return action();
  } finally {
    Atomics.store(states, lockIndex, 0);
    Atomics.notify(states, lockIndex);
  }
}

function workerChildDeps({ states, lockIndex, env }) {
  const deps = {
    // Task-owned workspace removal is serialized across the batch so
    // concurrent `git worktree remove`/`prune` calls cannot race each other.
    removeWorkspace: (input) => withBatchLock(states, lockIndex, () => defaultRemoveWorkspace(input)),
  };
  if (env !== null) deps.env = env;
  return deps;
}

function batchWorkerMain(payload) {
  const { index, states: shared, lockIndex, retryLockIndex, invocation, env, resultPath } = payload;
  const states = new Int32Array(shared);
  const claimed = Atomics.compareExchange(states, index, BATCH_STATE_CREATED, BATCH_STATE_STARTED);
  if (claimed !== BATCH_STATE_CREATED) {
    // The foreground owner cancelled this slot before it started; no task-owned
    // side effect may happen.
    try {
      writeFileSync(
        resultPath,
        JSON.stringify({
          child: { status: 'EXECUTOR_FAILED', reason: 'batch task was cancelled before start' },
          startedAt: null,
          endedAt: null,
          attempts: 0,
          retryReasons: [],
        }),
      );
    } catch {
      // the owner observes the missing result and fails this task closed
    }
    Atomics.store(states, index, BATCH_STATE_DONE);
    Atomics.notify(states, index);
    return;
  }
  Atomics.notify(states, index);
  const startedAt = Date.now();
  const execute = () => {
    let child;
    try {
      const runner = invocation.runner === 'runPublishOnce' ? defaultRunPublishOnce : defaultRunOnce;
      child = runner(invocation.options, workerChildDeps({ states, lockIndex, env }));
    } catch (error) {
      child = { status: 'EXECUTOR_FAILED', reason: `batch task invocation failed: ${messageOf(error)}` };
    }
    return { child };
  };
  const record = runTaskWithStartRetry({
    execute,
    onRetry: () =>
      withBatchLock(states, retryLockIndex, () => sleepSync(BATCH_RETRY_BACKOFF_MS)),
  });
  const endedAt = Date.now();
  try {
    writeFileSync(
      resultPath,
      JSON.stringify({
        child: record.child,
        startedAt,
        endedAt,
        attempts: record.attempts,
        retryReasons: record.retryReasons,
      }),
    );
  } catch {
    // the owner observes the missing result and fails this task closed
  }
  Atomics.store(states, index, BATCH_STATE_DONE);
  Atomics.notify(states, index);
}

function maxObservedConcurrency(results) {
  const intervals = results
    .filter((entry) => Number.isFinite(entry.startedAt) && Number.isFinite(entry.endedAt))
    .map((entry) => ({ startedAt: entry.startedAt, endedAt: entry.endedAt }));
  if (intervals.length === 0) return null;
  let max = 0;
  for (const point of intervals) {
    let active = 0;
    for (const other of intervals) {
      if (other.startedAt <= point.startedAt && point.startedAt < other.endedAt) active += 1;
    }
    max = Math.max(max, active);
  }
  return max;
}

/**
 * Execute one admitted batch. Production starts one task-owned worker thread per
 * admitted task and blocks the foreground owner on shared-memory completion
 * signals until the whole batch settles. Deterministic tests provide an
 * in-process executor through `executeTask`; the batch is then run in
 * declaration order without starting threads.
 */
export function runTaskBatch({
  descriptors,
  maxConcurrency = MAX_BATCH_CONCURRENCY,
  env = null,
  log = () => {},
  executeTask = null,
}) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return [];
  if (descriptors.length > maxConcurrency) {
    throw new Error(
      `batch of ${descriptors.length} task(s) exceeds the maximum concurrency ${maxConcurrency}`,
    );
  }
  if (typeof executeTask === 'function') {
    return descriptors.map((descriptor) => executeTask(descriptor));
  }

  const count = descriptors.length;
  const lockIndex = count;
  const retryLockIndex = count + 1;
  const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * (count + 2));
  const states = new Int32Array(shared);
  const tempRoot = mkdtempSync(join(tmpdir(), 'greenhub-run-goal-batch-'));
  const workerEnv = serializeWorkerEnv(env);
  const workers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      let worker;
      try {
        worker = new Worker(new URL(import.meta.url), {
          workerData: {
            greenhubRunGoalBatchTask: {
              index,
              states: shared,
              lockIndex,
              retryLockIndex,
              invocation: descriptors[index].invocation,
              env: workerEnv,
              resultPath: join(tempRoot, `task-${index}-result.json`),
            },
          },
        });
      } catch (error) {
        Atomics.store(states, index, BATCH_STATE_DONE);
        Atomics.notify(states, index);
        log(`[run-goal] batch worker ${index} could not start: ${messageOf(error)}`);
      }
      if (worker !== undefined) workers.push(worker);
    }

    const startupDeadline = Date.now() + BATCH_WORKER_START_TIMEOUT_MS;
    for (let index = 0; index < count; index += 1) {
      for (;;) {
        const state = Atomics.load(states, index);
        if (state !== BATCH_STATE_CREATED) break;
        const remaining = startupDeadline - Date.now();
        if (remaining <= 0) {
          const previous = Atomics.compareExchange(
            states,
            index,
            BATCH_STATE_CREATED,
            BATCH_STATE_CANCELLED,
          );
          if (previous !== BATCH_STATE_CREATED) continue;
          Atomics.notify(states, index);
          log(
            `[run-goal] batch worker ${index} did not start within ${BATCH_WORKER_START_TIMEOUT_MS} ms; ` +
              'cancelled before any task-owned side effect',
          );
          break;
        }
        Atomics.wait(states, index, BATCH_STATE_CREATED, Math.min(remaining, BATCH_WORKER_POLL_MS));
      }
    }

    for (let index = 0; index < count; index += 1) {
      for (;;) {
        const state = Atomics.load(states, index);
        if (state === BATCH_STATE_DONE || state === BATCH_STATE_CANCELLED) break;
        Atomics.wait(states, index, state, BATCH_WORKER_POLL_MS);
      }
    }

    const results = [];
    for (let index = 0; index < count; index += 1) {
      const descriptor = descriptors[index];
      const state = Atomics.load(states, index);
      let record = null;
      if (state === BATCH_STATE_DONE) {
        const resultPath = join(tempRoot, `task-${index}-result.json`);
        if (existsSync(resultPath)) {
          try {
            record = JSON.parse(readFileSync(resultPath, 'utf8'));
          } catch {
            record = null;
          }
        }
      }
      results.push({
        taskId: descriptor.taskId,
        title: descriptor.title,
        child: record?.child ?? {
          status: 'EXECUTOR_FAILED',
          reason: 'batch task did not produce a result',
        },
        startedAt: record?.startedAt ?? null,
        endedAt: record?.endedAt ?? null,
        attempts: record?.attempts ?? null,
        retryReasons: Array.isArray(record?.retryReasons) ? record.retryReasons : [],
      });
    }
    return results;
  } finally {
    for (const worker of workers) {
      worker.terminate().catch(() => {});
    }
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      log(`[run-goal] batch scratch cleanup failed: ${messageOf(error)}`);
    }
  }
}

function executeTaskBatch({ descriptors, deps, log }) {
  // Any injected in-process child seam (an executor, an invocation seam, or a
  // publication seam) requires the deterministic in-process path; those seams
  // cannot cross a worker boundary. `env` is excluded because workers support it
  // natively.
  const hasInProcessSeam =
    deps.runOnce !== undefined ||
    deps.runPublishOnce !== undefined ||
    CHILD_SEAM_KEYS.some((key) => key !== 'env' && deps[key] !== undefined);
  const executeTask = hasInProcessSeam
    ? (descriptor) => invokeDescriptorInProcess({ descriptor, deps, log })
    : null;
  return runTaskBatch({
    descriptors,
    maxConcurrency: MAX_BATCH_CONCURRENCY,
    env: deps.env ?? null,
    log,
    executeTask,
  });
}

/**
 * Run one bounded goal evaluation. Returns a deterministic result object.
 * `deps` is a narrow seam for deterministic tests: runOnce, runPublishOnce,
 * runProofCommand, removeWorkspace, runGh, readLiveMain, fetchLiveMain, env,
 * log, now.
 */
export function runGoal(options = {}, deps = {}) {
  const log = deps.log ?? ((message) => process.stderr.write(`${message}\n`));
  const now = deps.now ?? (() => Date.now());
  const result = createGoalResult();
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const remote = options.remote ?? 'origin';
  let lastPinSnapshot = null;

  const finish = (status, reason) => {
    result.status = status;
    result.reason = reason;
    result.budget.iterationsUsed = result.iterations;
    result.budget.tasksAttempted = result.attempts.length;
    result.childCalls = result.attempts.length;
    result.budget.elapsedMs = Math.max(0, now() - startedAt);
    result.liveMain.atEnd = lastPinSnapshot;
    if (result.liveMain.atStart !== null && lastPinSnapshot !== null) {
      result.liveMain.movement =
        result.liveMain.atStart.fetchedSha === lastPinSnapshot.fetchedSha ? 'UNCHANGED' : 'MOVED';
    }
    try {
      const after = captureCheckoutState({ repositoryRoot });
      result.canonicalCheckout.after = { branch: after.branch, head: after.head };
      result.canonicalCheckout.unchanged =
        canonicalBefore === null ? null : isCheckoutUnchanged(canonicalBefore, after);
    } catch (error) {
      result.canonicalCheckout.unchanged = null;
      log(`[run-goal] canonical checkout re-observation failed: ${messageOf(error)}`);
    }
    return result;
  };

  const startedAt = now();
  let canonicalBefore = null;
  try {
    canonicalBefore = captureCheckoutState({ repositoryRoot });
    result.canonicalCheckout.before = { branch: canonicalBefore.branch, head: canonicalBefore.head };
  } catch (error) {
    log(`[run-goal] canonical checkout observation failed: ${messageOf(error)}`);
  }

  const goalText = readGoalText(options);
  if (!goalText.ok) {
    result.validation = { kind: INVALID_GOAL, errors: [goalText.error] };
    return finish(INVALID_GOAL, goalText.error);
  }
  const parsed = parseGoalContract(goalText.text);
  if (!parsed.ok) {
    result.validation = { kind: parsed.kind, errors: [...parsed.errors] };
    return finish(INVALID_GOAL, `${parsed.kind}: ${parsed.errors.join('; ')}`);
  }
  const contract = parsed.contract;
  result.goal = {
    text: contract.goal,
    acceptanceAuthority: [...contract.acceptance_authority],
    preserve: [...contract.preserve],
    autonomouslyAllowed: [...contract.autonomously_allowed],
    escalateIf: [...contract.escalate_if],
    stopWhen: [...contract.stop_when],
    budget: { ...contract.budget },
  };
  result.planner.enabled = contract.planner.enabled;
  result.budget.maxIterations = contract.budget.max_iterations;
  result.budget.maxTasks = contract.budget.max_tasks;
  result.budget.maxWallClockMs = contract.budget.max_wall_clock_ms;

  let pin;
  try {
    pin = pinLiveMain({
      repositoryRoot,
      remote,
      readLiveMain: deps.readLiveMain ?? readLiveRemoteMain,
      fetchLiveMain: deps.fetchLiveMain ?? fetchBaseline,
    });
    result.liveMain.atStart = {
      remoteSha: pin.remoteSha,
      fetchedSha: pin.fetchedSha,
      stable: pin.stable,
      observations: [...pin.observations],
    };
    result.liveMain.observations.push({ phase: 'START', ...pin });
    lastPinSnapshot = { remoteSha: pin.remoteSha, fetchedSha: pin.fetchedSha, stable: pin.stable };
  } catch (error) {
    result.liveMain.error = messageOf(error);
    return finish(BLOCKED_EXTERNAL, `live main could not be observed: ${messageOf(error)}`);
  }

  const authority = resolveAcceptanceAuthority({ contract, repositoryRoot, pin });
  result.acceptanceAuthority = authority.entries;
  if (!authority.ok) {
    result.validation = {
      kind: INVALID_GOAL,
      errors: authority.entries.filter((entry) => !entry.readableAtLiveMain).map((entry) => entry.error),
    };
    return finish(INVALID_GOAL, `ACCEPTANCE_AUTHORITY could not be resolved at live main ${pin.fetchedSha}`);
  }

  const attemptedTaskIds = new Set();
  const completedTaskIds = new Set();
  const plannerFingerprints = new Set();
  let evaluation;
  try {
    evaluation = evaluateGoalCriteria({
      contract,
      repositoryRoot,
      pin,
      options,
      deps,
      log,
    });
  } catch (error) {
    return finish(BLOCKED_EXTERNAL, `criteria could not be evaluated: ${messageOf(error)}`);
  }
  result.criteriaAtStart = evaluation;

  let passCount = 0;
  let selection = { task: null, closes: [], skipped: [], refusals: [] };
  while (true) {
    if (allSatisfied(evaluation)) {
      result.iterations = passCount;
      result.criteria = annotateCriteria({
        contract,
        criteria: evaluation,
        attemptedTaskIds,
        completedTaskIds,
      });
      return finish(
        GOAL_SATISFIED,
        `all ${evaluation.length} criterion(s) are satisfied at live main`,
      );
    }

    const admission = admitTaskBatch({
      contract,
      criteria: evaluation,
      attemptedTaskIds,
      completedTaskIds,
    });
    selection = {
      task: admission.tasks[0]?.task ?? null,
      closes: admission.tasks[0]?.closes ?? [],
      skipped: admission.skipped,
      refusals: admission.refusals,
    };
    let batchEntries = admission.tasks;

    if (batchEntries.length === 0) {
      result.selection = {
        taskId: null,
        closes: [],
        refusals: selection.refusals,
        skipped: selection.skipped,
      };
      result.refusals = selection.refusals;

      const openAutonomous = openAutonomousCriteria(evaluation);
      if (contract.planner.enabled && openAutonomous.size > 0) {
        const fingerprint = criterionStateFingerprint(evaluation);
        const plannerBudget = checkBudget({
          passCount,
          attemptsCount: result.attempts.length,
          startedAt,
          now,
          budget: contract.budget,
        });
        if (plannerBudget !== null) {
          result.iterations = passCount;
          result.criteria = annotateCriteria({
            contract,
            criteria: evaluation,
            attemptedTaskIds,
            completedTaskIds,
          });
          result.budget.exhausted = plannerBudget;
          return finish(BUDGET_EXHAUSTED, `budget exhausted: ${plannerBudget}`);
        }
        if (!plannerFingerprints.has(fingerprint)) {
          plannerFingerprints.add(fingerprint);
          const usedTaskIds = new Set([
            ...contract.task_catalog.map((task) => task.id),
            ...attemptedTaskIds,
          ]);
          const plannerRun = runPlanner({
            contract,
            pin,
            criteria: evaluation,
            options,
            deps,
            log,
            usedTaskIds,
          });
          result.planner.calls += 1;
          result.planner.decisions.push(plannerRun.decision ?? plannerRun.status);
          result.planner.lastStatus = plannerRun.status;
          result.planner.lastReason = plannerRun.reason;
          result.planner.lastProposal = plannerRun.proposal;
          result.planner.lastOutputTail = plannerRun.outputTail;
          result.planner.lastChangedPaths = [...plannerRun.changedPaths];
          result.planner.lastWorkspaceCleanup = plannerRun.workspaceCleanup;
          result.planner.lastExecutor = plannerRun.executor;
          if (plannerRun.task !== null) {
            batchEntries = [{ task: plannerRun.task, closes: [...plannerRun.task.closes] }];
          } else {
            result.iterations = passCount;
            result.criteria = annotateCriteria({
              contract,
              criteria: evaluation,
              attemptedTaskIds,
              completedTaskIds,
            });
            return finish(plannerRun.terminal ?? BLOCKED_EXTERNAL, plannerRun.reason);
          }
        }
      }

      if (batchEntries.length === 0) {
        result.iterations = passCount;
        result.criteria = annotateCriteria({
          contract,
          criteria: evaluation,
          attemptedTaskIds,
          completedTaskIds,
        });
        const status = classifyTerminal({
          criteria: result.criteria,
          attempts: result.attempts,
          refusals: selection.refusals,
          attemptedTaskIds,
        });
        const reason =
          status === HUMAN_DECISION_REQUIRED
            ? selection.refusals.length > 0
              ? `catalog task(s) outside AUTONOMOUSLY_ALLOWED: ${selection.refusals
                  .map((refusal) => refusal.taskId)
                  .join(', ')}`
              : 'unsatisfied HUMAN criterion requires a human decision'
            : status === BLOCKED_EXTERNAL
              ? 'unsatisfied EXTERNAL criterion or unreadable external observation'
              : status === NO_PROGRESS
                ? 'attempted task(s) did not change criterion state'
                : 'no declared catalog task closes the remaining AUTONOMOUS gap';
        return finish(status, reason);
      }
    }

    const budgetExhausted = checkBudget({
      passCount,
      attemptsCount: result.attempts.length,
      startedAt,
      now,
      budget: contract.budget,
    });
    if (budgetExhausted !== null) {
      result.iterations = passCount;
      result.selection = {
        taskId: null,
        closes: [],
        refusals: selection.refusals,
        skipped: selection.skipped,
      };
      result.refusals = selection.refusals;
      result.criteria = annotateCriteria({
        contract,
        criteria: evaluation,
        attemptedTaskIds,
        completedTaskIds,
      });
      result.budget.exhausted = budgetExhausted;
      return finish(BUDGET_EXHAUSTED, `budget exhausted: ${budgetExhausted}`);
    }

    const remainingTaskBudget = contract.budget.max_tasks - result.attempts.length;
    const batch = batchEntries.slice(0, Math.max(0, remainingTaskBudget));
    if (batch.length === 0) {
      result.iterations = passCount;
      result.selection = {
        taskId: null,
        closes: [],
        refusals: selection.refusals,
        skipped: selection.skipped,
      };
      result.refusals = selection.refusals;
      result.criteria = annotateCriteria({
        contract,
        criteria: evaluation,
        attemptedTaskIds,
        completedTaskIds,
      });
      result.budget.exhausted = 'TASKS';
      return finish(BUDGET_EXHAUSTED, 'budget exhausted: TASKS');
    }
    // Eligible tasks that do not fit this batch (concurrency or task budget)
    // stay eligible for a later recomputation and are never marked failed.
    const batchExcluded = batchEntries.slice(batch.length).map((entry) => ({
      taskId: entry.task.id,
      closes: [...entry.closes],
      kind: 'TASK_BUDGET',
      withTaskId: null,
      reason: `task budget leaves room for ${remainingTaskBudget} more attempt(s)`,
    }));

    passCount += 1;
    const concurrent = batch.length > 1;
    result.selection = {
      taskId: batch[0].task.id,
      closes: [...batch[0].closes],
      refusals: selection.refusals,
      skipped: selection.skipped,
    };
    result.refusals = selection.refusals;

    const descriptors = batch.map((entry) => {
      const title = buildTaskTitle({
        baseTitle: options.title ?? null,
        taskId: entry.task.id,
        concurrent,
      });
      return {
        taskId: entry.task.id,
        task: entry.task,
        closes: [...entry.closes],
        title,
        invocation: buildChildInvocation({
          task: entry.task,
          taskText: buildTaskText({ task: entry.task, contract }),
          options,
          title,
        }),
      };
    });

    let batchResults;
    try {
      batchResults = executeTaskBatch({ descriptors, deps, log });
    } catch (error) {
      batchResults = descriptors.map((descriptor) => ({
        taskId: descriptor.taskId,
        title: descriptor.title,
        child: { status: 'EXECUTOR_FAILED', reason: `batch execution failed: ${messageOf(error)}` },
        startedAt: null,
        endedAt: null,
        attempts: 0,
        retryReasons: [],
      }));
    }
    for (const descriptor of descriptors) attemptedTaskIds.add(descriptor.taskId);

    let nextPin;
    try {
      nextPin = pinLiveMain({
        repositoryRoot,
        remote,
        readLiveMain: deps.readLiveMain ?? readLiveRemoteMain,
        fetchLiveMain: deps.fetchLiveMain ?? fetchBaseline,
      });
      result.liveMain.observations.push({ phase: `AFTER_BATCH_${passCount}`, ...nextPin });
      pin = nextPin;
      lastPinSnapshot = { remoteSha: pin.remoteSha, fetchedSha: pin.fetchedSha, stable: pin.stable };
    } catch (error) {
      for (const descriptor of descriptors) {
        const entry = batchResults.find((candidate) => candidate.taskId === descriptor.taskId);
        const child = entry?.child ?? { status: 'EXECUTOR_FAILED', reason: 'no batch result' };
        result.attempts.push({
          iteration: passCount,
          taskId: descriptor.taskId,
          title: descriptor.title,
          publication: descriptor.task.publication,
          semanticOwner: [...descriptor.task.semantic_owner],
          childStatus: child.status ?? null,
          childReason: child.reason ?? null,
          succeeded: isChildSuccess(descriptor.task, child),
          progressed: null,
          changedPaths: Array.isArray(child.changedPaths) ? child.changedPaths : [],
          child,
        });
      }
      result.iterations = passCount;
      result.criteria = evaluation;
      return finish(
        BLOCKED_EXTERNAL,
        `live main could not be re-read after a task batch: ${messageOf(error)}`,
      );
    }

    let nextEvaluation;
    try {
      nextEvaluation = evaluateGoalCriteria({ contract, repositoryRoot, pin, options, deps, log });
    } catch (error) {
      return finish(BLOCKED_EXTERNAL, `criteria could not be re-evaluated: ${messageOf(error)}`);
    }
    const progressed = criteriaChanged(evaluation, nextEvaluation);
    const batchResultsByTask = new Map(batchResults.map((entry) => [entry.taskId, entry]));
    const batchAttempts = [];
    for (const descriptor of descriptors) {
      const entry = batchResultsByTask.get(descriptor.taskId);
      const child = entry?.child ?? { status: 'EXECUTOR_FAILED', reason: 'no batch result' };
      const succeeded = isChildSuccess(descriptor.task, child);
      if (succeeded) completedTaskIds.add(descriptor.taskId);
      const attempt = {
        iteration: passCount,
        taskId: descriptor.taskId,
        title: descriptor.title,
        publication: descriptor.task.publication,
        semanticOwner: [...descriptor.task.semantic_owner],
        childStatus: child.status ?? null,
        childReason: child.reason ?? null,
        succeeded,
        progressed,
        changedPaths: Array.isArray(child.changedPaths) ? child.changedPaths : [],
        child,
      };
      result.attempts.push(attempt);
      batchAttempts.push(attempt);
    }
    result.batches.push({
      iteration: passCount,
      taskIds: descriptors.map((descriptor) => descriptor.taskId),
      titles: descriptors.map((descriptor) => descriptor.title),
      admitted: descriptors.map((descriptor) => ({
        taskId: descriptor.taskId,
        title: descriptor.title,
        closes: [...descriptor.closes],
      })),
      excluded: [...admission.excluded, ...batchExcluded],
      concurrencyLimit: MAX_BATCH_CONCURRENCY,
      observedConcurrency: maxObservedConcurrency(batchResults),
      results: batchAttempts.map((attempt) => ({
        taskId: attempt.taskId,
        childStatus: attempt.childStatus,
        succeeded: attempt.succeeded,
        progressed: attempt.progressed,
        startedAt: batchResultsByTask.get(attempt.taskId)?.startedAt ?? null,
        endedAt: batchResultsByTask.get(attempt.taskId)?.endedAt ?? null,
        attempts: batchResultsByTask.get(attempt.taskId)?.attempts ?? null,
        retryReasons: batchResultsByTask.get(attempt.taskId)?.retryReasons ?? [],
      })),
    });
    evaluation = nextEvaluation;

    const succeededInBatch = batchAttempts.filter((attempt) => attempt.succeeded).length;
    if (succeededInBatch > 0 && !progressed) {
      result.iterations = passCount;
      result.criteria = annotateCriteria({
        contract,
        criteria: evaluation,
        attemptedTaskIds,
        completedTaskIds,
      });
      return finish(
        NO_PROGRESS,
        batch.length === 1
          ? `task ${descriptors[0].taskId} completed but no criterion state changed at live main ${pin.fetchedSha}`
          : `task batch [${descriptors
              .map((descriptor) => descriptor.taskId)
              .join(', ')}] completed but no criterion state changed at live main ${pin.fetchedSha}`,
      );
    }
  }
}

export const USAGE = [
  'usage: node scripts/agent/run-goal.mjs --goal <file> [--repo <dir>] [--remote <name>]',
  '',
  '  --goal <file>               Goal Contract JSON file (GOAL/ACCEPTANCE_AUTHORITY/CRITERIA/TASK_CATALOG/PLANNER/BUDGET)',
  '  --repo <dir>                canonical checkout root (default: current directory)',
  '  --remote <name>             remote observed for live main (default: origin)',
  '  --title <title>             optional OpenCode session title for child tasks',
  '  --model <provider/model>    optional OpenCode model override for child tasks',
  '  --agent <name>              optional OpenCode agent override for child tasks',
  '  --opencode-bin <path>       explicit OpenCode executable for child tasks',
  '  --opencode-timeout-ms <n>   child opencode timeout in ms (default: 3600000, 0 disables)',
  '  --proof-timeout-ms <n>      child/proof timeout in ms (default: 1800000, 0 disables)',
  '  --ci-timeout-ms <n>         child required-check watch timeout in ms (default: 2700000)',
  '  --max-rebind-attempts <n>   child fresh-main rebind constructions (default: 2)',
  '  --github-repo <owner/name>  optional explicit GitHub repository for child publication',
  '',
  'Prints one deterministic JSON result to stdout. Exit code 0 only for GOAL_SATISFIED.',
].join('\n');

export function parseArgs(argv) {
  const options = {
    goalFile: null,
    repositoryRoot: process.cwd(),
    remote: 'origin',
    title: null,
    model: null,
    agent: null,
    opencodeBin: null,
    opencodeTimeoutMs: 60 * 60 * 1000,
    proofTimeoutMs: DEFAULT_PROOF_TIMEOUT_MS,
    ciTimeoutMs: DEFAULT_CI_TIMEOUT_MS,
    maxRebindAttempts: DEFAULT_MAX_REBIND_ATTEMPTS,
    githubRepository: null,
    help: false,
  };
  const valueFlags = {
    '--goal': 'goalFile',
    '--repo': 'repositoryRoot',
    '--remote': 'remote',
    '--title': 'title',
    '--model': 'model',
    '--agent': 'agent',
    '--opencode-bin': 'opencodeBin',
    '--github-repo': 'githubRepository',
  };
  const numberFlags = {
    '--opencode-timeout-ms': 'opencodeTimeoutMs',
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
  if (!options.goalFile) return { ok: false, error: '--goal is required' };
  return { ok: true, options };
}

export function main(
  argv,
  { env = process.env, stdout = process.stdout, stderr = process.stderr, deps = {} } = {},
) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr.write(`${parsed.error}\n${USAGE}\n`);
    stdout.write(`${JSON.stringify({ status: INVALID_GOAL, reason: parsed.error }, null, 2)}\n`);
    return 1;
  }
  if (parsed.options.help) {
    stderr.write(`${USAGE}\n`);
    return 0;
  }
  const result = runGoal(parsed.options, { ...deps, env });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const summary = [
    `[run-goal] STATUS ${result.status}`,
    `[run-goal] LIVE_MAIN ${result.liveMain?.atStart?.fetchedSha ?? 'unknown'} -> ${result.liveMain?.atEnd?.fetchedSha ?? result.liveMain?.observations?.at(-1)?.fetchedSha ?? 'unknown'}`,
    `[run-goal] CRITERIA ${result.criteria.filter((criterion) => criterion.satisfied).length}/${result.criteria.length} satisfied`,
    `[run-goal] ITERATIONS ${result.iterations}`,
    `[run-goal] CHILD_CALLS ${result.childCalls}`,
  ].join('\n');
  stderr.write(`${summary}\n`);
  return result.status === GOAL_SATISFIED ? 0 : 1;
}

const invokedAsMainScript =
  isMainThread &&
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMainScript) {
  process.exitCode = main(process.argv.slice(2));
}

// Task-owned worker entry for one admitted batch task. The worker never talks
// to the foreground owner through the event loop; it signals completion through
// the shared state slot and a task-owned result file, so the owner can stay
// synchronous while the batch runs.
if (!isMainThread && workerData != null && workerData.greenhubRunGoalBatchTask != null) {
  batchWorkerMain(workerData.greenhubRunGoalBatchTask);
}
