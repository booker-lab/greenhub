// Canonical owner: docs/specs/ops/development-authority.md sections 2, 6, 8
// (bounded task contract, outcome-relative publication, thin stateless
// automation).
//
// Goal-Constrained Development Loop, Phase 1 (deterministic goal core).
//
// One caller-supplied Goal Contract, one foreground process, one exit. Every
// bounded iteration:
//   1. reads current live `main` (two independent observations),
//   2. re-resolves the declared ACCEPTANCE_AUTHORITY at that exact live SHA,
//   3. recomputes every criterion at that live SHA,
//   4. selects at most one declared catalog task for an open AUTONOMOUS
//      criterion, and
//   5. delegates the entire execution/publication mechanics to the existing GN
//      executors, then re-reads live `main` and recomputes.
//
// This module owns composition and deterministic goal bookkeeping only:
//   scripts/agent/run-once.mjs          execution core (isolated workspace,
//                                       OpenCode invocation, mutation boundary,
//                                       proof execution, cleanup)
//   scripts/agent/run-publish-once.mjs  publication path (admission, transport,
//                                       PR, required checks, merge, remote
//                                       read-back, task-owned cleanup)
//
// This phase has no AI planning, no cross-process task state or task recovery,
// no background execution, no ref cleanup for pre-existing remote refs, no
// concurrent task admission, and no long-running service. Its only execution
// guarantee is scoped to one foreground attempt:
//   one selected task attempt -> one GN execution -> at most one OpenCode
//   mutation invocation.
// A process crash before remote publication evidence may let a later
// invocation re-run the same unfinished task; cross-process exactly-once is out
// of scope for this phase.
//
// Never invoked here: reset/restore/stash/clean of foreign state, checkout
// switching, force push, direct push to `main`, or local merge/rebase.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PROOF_TIMEOUT_MS,
  SUCCESS as RUN_ONCE_SUCCESS,
  createBaselineWorkspace,
  defaultRemoveWorkspace,
  defaultRunProofCommand,
  fetchBaseline,
  gitCapture,
  isPathAllowed,
  normalizeRepoPath,
  readLiveRemoteMain,
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

const LIVE_MAIN_PIN_ATTEMPTS = 3;
const PROOF_TAIL_CHARS = 2000;

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
    childCalls: 0,
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

function invokeChild({ task, taskText, options, deps, log }) {
  const shared = {
    repositoryRoot: options.repositoryRoot,
    remote: options.remote ?? 'origin',
    taskText,
    allowedPaths: [...task.allow],
    proofCommands: [...task.proof],
    proofOwners: task.proof_owner.map((owners) => [...owners]),
    title: options.title ?? null,
    model: options.model ?? null,
    agent: options.agent ?? null,
    opencodeBin: options.opencodeBin ?? null,
    opencodeTimeoutMs: options.opencodeTimeoutMs,
    proofTimeoutMs: options.proofTimeoutMs,
  };
  const childDeps = buildChildDeps(deps, log);
  if (task.publication === 'required') {
    const runner = deps.runPublishOnce ?? defaultRunPublishOnce;
    return runner(
      {
        ...shared,
        commitMessage: task.commit_message,
        prTitle: task.pr_title,
        githubRepository: options.githubRepository ?? null,
        ciTimeoutMs: options.ciTimeoutMs,
        maxRebindAttempts: options.maxRebindAttempts,
      },
      childDeps,
    );
  }
  const runner = deps.runOnce ?? defaultRunOnce;
  return runner(shared, childDeps);
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

    selection = selectTask({ contract, criteria: evaluation, attemptedTaskIds, completedTaskIds });
    if (selection.task === null) {
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

    const task = selection.task;
    result.selection = {
      taskId: task.id,
      closes: selection.closes,
      refusals: selection.refusals,
      skipped: selection.skipped,
    };
    result.refusals = selection.refusals;
    passCount += 1;

    const taskText = buildTaskText({ task, contract });
    let child;
    try {
      child = invokeChild({ task, taskText, options, deps, log });
    } catch (error) {
      child = { status: 'EXECUTOR_FAILED', reason: `child invocation failed: ${messageOf(error)}` };
    }
    attemptedTaskIds.add(task.id);

    let nextPin;
    try {
      nextPin = pinLiveMain({
        repositoryRoot,
        remote,
        readLiveMain: deps.readLiveMain ?? readLiveRemoteMain,
        fetchLiveMain: deps.fetchLiveMain ?? fetchBaseline,
      });
      result.liveMain.observations.push({ phase: `AFTER_TASK_${passCount}`, ...nextPin });
      pin = nextPin;
      lastPinSnapshot = { remoteSha: pin.remoteSha, fetchedSha: pin.fetchedSha, stable: pin.stable };
    } catch (error) {
      result.attempts.push({
        iteration: passCount,
        taskId: task.id,
        publication: task.publication,
        semanticOwner: [...task.semantic_owner],
        childStatus: child.status ?? null,
        childReason: child.reason ?? null,
        succeeded: isChildSuccess(task, child),
        progressed: null,
        changedPaths: Array.isArray(child.changedPaths) ? child.changedPaths : [],
        child,
      });
      result.iterations = passCount;
      result.criteria = evaluation;
      return finish(BLOCKED_EXTERNAL, `live main could not be re-read after a task: ${messageOf(error)}`);
    }

    let nextEvaluation;
    try {
      nextEvaluation = evaluateGoalCriteria({ contract, repositoryRoot, pin, options, deps, log });
    } catch (error) {
      return finish(BLOCKED_EXTERNAL, `criteria could not be re-evaluated: ${messageOf(error)}`);
    }
    const progressed = criteriaChanged(evaluation, nextEvaluation);
    const succeeded = isChildSuccess(task, child);
    if (succeeded) completedTaskIds.add(task.id);
    result.attempts.push({
      iteration: passCount,
      taskId: task.id,
      publication: task.publication,
      semanticOwner: [...task.semantic_owner],
      childStatus: child.status ?? null,
      childReason: child.reason ?? null,
      succeeded,
      progressed,
      changedPaths: Array.isArray(child.changedPaths) ? child.changedPaths : [],
      child,
    });
    evaluation = nextEvaluation;

    if (succeeded && !progressed) {
      result.iterations = passCount;
      result.criteria = annotateCriteria({
        contract,
        criteria: evaluation,
        attemptedTaskIds,
        completedTaskIds,
      });
      return finish(
        NO_PROGRESS,
        `task ${task.id} completed but no criterion state changed at live main ${pin.fetchedSha}`,
      );
    }
  }
}

export const USAGE = [
  'usage: node scripts/agent/run-goal.mjs --goal <file> [--repo <dir>] [--remote <name>]',
  '',
  '  --goal <file>               Goal Contract JSON file (GOAL/ACCEPTANCE_AUTHORITY/CRITERIA/TASK_CATALOG/BUDGET)',
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
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMainScript) {
  process.exitCode = main(process.argv.slice(2));
}
