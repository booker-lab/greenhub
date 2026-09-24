// Canonical owner: docs/specs/ops/development-authority.md sections 2, 6, 8, 9
// and AGENTS.md section 0 (bounded semantic task, nearest faithful proof,
// Git-native publication, thin stateless automation).
//
// BUILD-mode natural-language front door for the existing Goal-Constrained
// Development Loop. One invocation owns one bounded batch of independently
// closable product frontiers:
//
//   BUILD request (MODE: BUILD + natural language)
//   -> fresh live `main` pin
//   -> declared-authority resolution at that exact SHA
//   -> one read-only frontier-selector invocation in a disposable workspace
//   -> deterministic validation of the selector decision
//   -> deterministic admission of the independently closable frontier fragments
//   -> ephemeral merged Goal Contract (in memory, never a durable queue/registry)
//   -> the existing run-goal loop (run-once / run-publish-once / 5-way batch)
//   -> one finite BUILD terminal
//   -> stop, never select a next frontier
//
// This module owns composition of the natural-language front door only. It does
// not reimplement execution, publication, or task-level conflict detection; all
// of those stay with scripts/agent/run-goal.mjs, scripts/agent/run-once.mjs, and
// scripts/agent/run-publish-once.mjs. Frontier-level independence reuses the
// exported run-goal `taskConflict` rule so both layers admit on the same
// semantic_owner / mutation surface / proof_owner / depends_on dimensions.
//
// The selector is never a writer: it runs in a detached worktree created from
// the pinned live main, receives the same sanitized child environment as every
// other OpenCode invocation, and any Git-observed mutation in its workspace
// rejects the decision before run-goal is invoked.
//
// Never created here: persistent task queue, scheduler, daemon, durable frontier
// registry, dashboard, watcher, custom control plane, or a second publication
// path. Never performed here: direct push to `main`, force push, local
// merge/rebase fallback, browser Web UI, or a loop over further frontiers.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BLOCKED_EXTERNAL,
  BUDGET_EXHAUSTED,
  evaluateGoalCriteria,
  GOAL_SATISFIED,
  HUMAN_DECISION_REQUIRED,
  HUMAN_ESCALATION_TOKENS,
  INVALID_GOAL,
  INVALID_TASK,
  isSafeRepoPath,
  NO_PROGRESS,
  NO_TASK_FOR_GAP,
  pinLiveMain,
  runGoal,
  taskConflict,
  validateGoalContract,
} from './run-goal.mjs';
import {
  buildChildEnv,
  buildOpencodeArgs,
  createBaselineWorkspace,
  DEFAULT_OPENCODE_TIMEOUT_MS,
  DEFAULT_PROOF_TIMEOUT_MS,
  defaultInvokeOpencode,
  defaultRemoveWorkspace,
  fetchBaseline,
  gitCapture,
  isPathAllowed,
  normalizeRepoPath,
  observeChangedPaths,
  readLiveRemoteMain,
  resolveOpencodeCommand,
  TASK_TEXT_MAX_CHARS,
} from './run-once.mjs';
import {
  CI_FAILED,
  DEFAULT_CI_TIMEOUT_MS,
  DEFAULT_MAX_REBIND_ATTEMPTS,
  PUBLICATION_BLOCKED,
  PUBLICATION_REFRESH_REQUIRED,
  REMOTE_READBACK_FAILED,
} from './run-publish-once.mjs';

export const BUILD_MODE = 'BUILD';

// Reused run-goal terminals (one vocabulary, no parallel status system).
export { BLOCKED_EXTERNAL, HUMAN_DECISION_REQUIRED };

// Finite BUILD terminals. HUMAN_DECISION_REQUIRED and BLOCKED_EXTERNAL are the
// run-goal vocabulary reused unchanged. INVALID_BUILD_REQUEST is the
// pre-execution request gate (the same role INVALID_GOAL has inside run-goal);
// every frontier-execution path ends in one of the other seven.
export const FRONTIER_COMPLETE = 'FRONTIER_COMPLETE';
export const ALREADY_SATISFIED = 'ALREADY_SATISFIED';
export const NO_EXECUTABLE_FRONTIER = 'NO_EXECUTABLE_FRONTIER';
export const PROOF_FAILED = 'PROOF_FAILED';
export const PUBLICATION_FAILED = 'PUBLICATION_FAILED';
export const INVALID_BUILD_REQUEST = 'INVALID_BUILD_REQUEST';

export const BUILD_STATUSES = Object.freeze([
  FRONTIER_COMPLETE,
  ALREADY_SATISFIED,
  HUMAN_DECISION_REQUIRED,
  BLOCKED_EXTERNAL,
  NO_EXECUTABLE_FRONTIER,
  PROOF_FAILED,
  PUBLICATION_FAILED,
  INVALID_BUILD_REQUEST,
]);

export const SELECTOR_DECISIONS = Object.freeze([
  'FRONTIER',
  'ALREADY_SATISFIED',
  'NO_EXECUTABLE_FRONTIER',
  'HUMAN_DECISION_REQUIRED',
  'BLOCKED_EXTERNAL',
]);

export const SELECTOR_STATUSES = Object.freeze([
  'DECISION',
  'INVALID_OUTPUT',
  'MUTATION_REJECTED',
  'INVOCATION_FAILED',
  'WORKSPACE_FAILED',
]);

// A considered frontier must be deterministically evaluable at live main. A
// `PROOF_AT_MAIN` criterion runs its command in a disposable workspace; the
// remaining accepted checks are pure live-object-store reads.
export const BUILD_CRITERION_CHECKS = Object.freeze([
  'PATH_PRESENT',
  'PATH_ABSENT',
  'DOC_TOKEN',
  'PROOF_AT_MAIN',
]);

export const FRONTIER_KINDS = Object.freeze(['PRODUCT', 'MAINTENANCE']);

// Historical documentation is provenance, never frontier authority
// (docs/README.md "역사 자료로 보는 문서", development-authority section 7).
export const HISTORICAL_PATH_PREFIXES = Object.freeze([
  'docs/archive/',
  'docs/discussions/',
  'docs/plans/',
  'docs/reports/',
]);
export const HISTORICAL_BASENAME_PATTERN = /^(PLAN_|REPORT_|PROMPT_)/i;

export const MAX_CONSIDERED_FRONTIERS = 5;

// Boundary for the bounded multi-frontier batch (section 9.3): the existing
// run-goal executor already admits at most five independent tasks per live-main
// evaluation, so the front door supplies at most that many frontiers.
export const MAX_BATCH_FRONTIERS = MAX_CONSIDERED_FRONTIERS;

// Current-evidence classification for every considered open frontier
// (development-authority section 9.2). It is an ephemeral selector judgment;
// nothing here is persisted.
export const GAP_CLASSES = Object.freeze([
  'IMPLEMENTATION_GAP',
  'STALE_SPEC',
  'SEMANTIC_CONFLICT',
]);

// Criterion field sets by check. The selector prompt and the validator both
// read this table; neither side keeps a second copy.
export const BUILD_CRITERION_FIELDS = Object.freeze({
  PATH_PRESENT: Object.freeze(['id', 'statement', 'authority', 'check', 'class', 'path']),
  PATH_ABSENT: Object.freeze(['id', 'statement', 'authority', 'check', 'class', 'path']),
  DOC_TOKEN: Object.freeze(['id', 'statement', 'authority', 'check', 'class', 'path', 'token']),
  PROOF_AT_MAIN: Object.freeze(['id', 'statement', 'authority', 'check', 'class', 'command']),
});

// Canonical Goal Contract field set (run-goal validateGoalContract).
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

export const RECONCILIATION_FIELDS = Object.freeze([
  'statement',
  'intended_contract',
  'behavior_evidence',
  'proof_evidence',
  'spec_paths',
]);

/**
 * The single authoritative selector-facing contract. `buildFrontierPrompt`
 * renders the generator-visible constraints from this descriptor and the
 * deterministic validator reads the same arrays; adding a field, enum, or limit
 * here changes both sides at once. No parallel magic literals.
 */
export const BUILD_SELECTOR_CONTRACT = Object.freeze({
  statuses: SELECTOR_DECISIONS,
  kinds: FRONTIER_KINDS,
  checks: BUILD_CRITERION_CHECKS,
  criterionClass: 'AUTONOMOUS',
  gapClasses: GAP_CLASSES,
  escalationTokens: HUMAN_ESCALATION_TOKENS,
  maxConsideredFrontiers: MAX_CONSIDERED_FRONTIERS,
  maxBatchFrontiers: MAX_BATCH_FRONTIERS,
  topLevelFields: Object.freeze([
    'status',
    'reason',
    'authority_resolved',
    'considered',
    'selected',
    'escalation_token',
  ]),
  consideredFields: Object.freeze([
    'priority',
    'id',
    'statement',
    'kind',
    'criteria',
    'satisfied',
    'evidence',
    'maintenance_justification',
    'gap_class',
    'reconciliation',
    'goal',
  ]),
  selectedFields: Object.freeze([
    'priority',
    'id',
    'statement',
    'kind',
    'why_selected',
    'maintenance_justification',
    'goal',
  ]),
  reconciliationFields: RECONCILIATION_FIELDS,
  criterionFieldsByCheck: BUILD_CRITERION_FIELDS,
  goalFields: GOAL_CONTRACT_FIELDS,
  goalTaskFields: GOAL_TASK_FIELDS,
  publicationMode: 'required',
  plannerEnabled: false,
  taskTextMaxChars: TASK_TEXT_MAX_CHARS,
});

// Repository canonical authority reading order (AGENTS.md section 2). Only
// pointers that exist at the pinned live SHA are handed to the selector.
export const CANONICAL_AUTHORITY_POINTERS = Object.freeze([
  'AGENTS.md',
  'docs/README.md',
  'docs/memory.md',
  'docs/PROJECT_MAP.md',
  'docs/BACKLOG.md',
  'docs/specs/ops/development-authority.md',
]);

const SELECTOR_OUTPUT_TAIL_CHARS = 8000;

const PUBLICATION_FAILURE_STATUSES = Object.freeze([
  PUBLICATION_BLOCKED,
  CI_FAILED,
  PUBLICATION_REFRESH_REQUIRED,
  REMOTE_READBACK_FAILED,
]);

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

function tail(value, limit = SELECTOR_OUTPUT_TAIL_CHARS) {
  const text = typeof value === 'string' ? value : '';
  return text.length <= limit ? text : text.slice(text.length - limit);
}

function uniqueNormalizedPaths(value) {
  const paths = [];
  const seen = new Set();
  for (const entry of value) {
    const normalized = normalizeRepoPath(entry);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
  }
  return paths;
}

/**
 * Deterministic BUILD request parse. MODE must be the first non-empty line and
 * must be BUILD. Backticked concrete repo-relative paths are the declared
 * authority set; globs and identifier-shaped tokens are not authority.
 */
export function parseBuildRequest(text) {
  const source = typeof text === 'string' ? text : '';
  if (source.trim().length === 0) {
    return { ok: false, reason: 'BUILD request is empty' };
  }
  const lines = source.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  const header = lines[headerIndex].trim();
  const headerMatch = /^MODE\s*:\s*(\S+)\s*$/i.exec(header);
  if (headerMatch === null) {
    return { ok: false, reason: 'BUILD request must start with "MODE: BUILD"' };
  }
  const mode = headerMatch[1].toUpperCase();
  if (mode !== BUILD_MODE) {
    return {
      ok: false,
      reason: `unsupported MODE: ${headerMatch[1]} (only ${BUILD_MODE} is supported)`,
    };
  }
  const body = lines
    .slice(headerIndex + 1)
    .join('\n')
    .trim();
  if (body.length === 0) {
    return { ok: false, reason: 'BUILD request body must not be empty' };
  }
  return { ok: true, mode, body, backtickedTokens: extractBacktickedTokens(body) };
}

function isAuthorityPathToken(token) {
  if (!isSafeRepoPath(token)) return false;
  return !/[*?[\]{}]/.test(token);
}

export function extractBacktickedTokens(body) {
  const tokens = [];
  const pattern = /`([^`\n]+)`/g;
  let match = pattern.exec(body);
  while (match !== null) {
    const token = match[1].trim();
    if (token.length > 0) tokens.push(token);
    match = pattern.exec(body);
  }
  return tokens;
}

/**
 * Backticked concrete repo-relative paths whose first segment is an actual
 * top-level entry of the pinned live main tree are the declared authority set.
 * Non-path backticked tokens (`origin/main`, identifiers) are ignored.
 */
export function extractDeclaredAuthorityPaths({ tokens, topLevelEntries }) {
  const topLevel = new Set(topLevelEntries);
  const paths = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!isAuthorityPathToken(token)) continue;
    const normalized = normalizeRepoPath(token);
    const firstSegment = normalized.split('/')[0];
    if (!topLevel.has(firstSegment)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
  }
  return paths;
}

export function isHistoricalPath(value) {
  const normalized = normalizeRepoPath(value);
  if (HISTORICAL_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  const base = normalized.split('/').pop() ?? '';
  return HISTORICAL_BASENAME_PATTERN.test(base);
}

/** Git object type of `path` at the exact SHA (`blob` / `tree` / null). */
export function observeRepoObject({ repositoryRoot, ref, path }) {
  const probe = gitCapture(repositoryRoot, ['cat-file', '-t', `${ref}:${path}`], {
    allowFailure: true,
  });
  if (!probe.ok) return null;
  const objectType = probe.stdout.trim();
  return objectType.length > 0 ? objectType : null;
}

function resolveAuthorityPaths({ repositoryRoot, ref, paths }) {
  return paths.map((path) => ({
    path,
    objectType: observeRepoObject({ repositoryRoot, ref, path }),
  }));
}

function readRequestText(options) {
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

const CRITERION_VALUE_PLACEHOLDERS = Object.freeze({
  id: '"criterion-id"',
  statement: '"..."',
  authority: '["repo/path"]',
  check: '"CHECK"',
  class: '"AUTONOMOUS"',
  path: '"repo/path"',
  token: '"..."',
  command: '"node --test ..."',
});

function renderCriterionFields(check) {
  const fields = BUILD_SELECTOR_CONTRACT.criterionFieldsByCheck[check];
  return `{${fields.map((field) => `"${field}":${CRITERION_VALUE_PLACEHOLDERS[field]}`).join(',')}}`;
}

function renderCriterionFieldList() {
  return BUILD_SELECTOR_CONTRACT.checks.map(
    (check) =>
      `- ${check}: ${BUILD_SELECTOR_CONTRACT.criterionFieldsByCheck[check].join(', ')}`,
  );
}

function renderGoalTaskFields() {
  return `{${GOAL_TASK_FIELDS.map((field) => {
    switch (field) {
      case 'closes':
        return `"${field}":["criterion-id"]`;
      case 'allow':
      case 'semantic_owner':
        return `"${field}":["repo/path"]`;
      case 'proof':
        return `"${field}":["node --test ..."]`;
      case 'proof_owner':
        return `"${field}":[["repo/path"]]`;
      case 'publication':
        return `"${field}":"required"`;
      case 'escalate_only_if':
      case 'depends_on':
        return `"${field}":[]`;
      default:
        return `"${field}":"..."`;
    }
  }).join(',')}}`;
}

function renderGoalSkeleton() {
  return [
    '{"GOAL":"..."',
    '"ACCEPTANCE_AUTHORITY":["repo/path"]',
    '"PRESERVE":["..."]',
    '"AUTONOMOUSLY_ALLOWED":["repo/path"]',
    `"ESCALATE_IF":["${HUMAN_ESCALATION_TOKENS[0]}"]`,
    '"STOP_WHEN":["..."]',
    '"CRITERIA":[<criterion objects, one per frontier criterion>]',
    `"TASK_CATALOG":[${renderGoalTaskFields()}]`,
    `"PLANNER":{"enabled":${BUILD_SELECTOR_CONTRACT.plannerEnabled}}`,
    '"BUDGET":{"max_iterations":2,"max_tasks":3}}',
  ].join(',');
}

function renderReconciliationSkeleton() {
  return `{${RECONCILIATION_FIELDS.map((field) =>
    field === 'statement' ? '"statement":"..."' : `"${field}":["..."]`,
  ).join(',')}}`;
}

function renderFrontierDecisionSkeleton() {
  const criterion = renderCriterionFields('PATH_PRESENT');
  return [
    '{"status":"FRONTIER"',
    '"reason":"..."',
    '"authority_resolved":["repo/path"]',
    `"considered":[{"priority":1,"id":"..."`,
    '"statement":"..."',
    `"kind":"${FRONTIER_KINDS[0]}"`,
    `"criteria":[${criterion}]`,
    '"satisfied":false',
    `"gap_class":"${GAP_CLASSES[0]}"`,
    `"reconciliation":${renderReconciliationSkeleton()}}]`,
    '"selected":{"priority":1,"id":"..."',
    '"statement":"..."',
    `"kind":"${FRONTIER_KINDS[0]}"`,
    '"why_selected":"..."',
    `"goal":${renderGoalSkeleton()}}}`,
  ].join(',');
}

/**
 * The exact selector contract the build layer must consult. The generator
 * (selector prompt) and the deterministic validator are both rendered from
 * `BUILD_SELECTOR_CONTRACT`; neither side keeps a parallel copy of a field,
 * enum, or limit.
 */
export function buildFrontierPrompt({ buildRequest, declaredAuthority, canonicalAuthority, pin }) {
  const sha = pin.fetchedSha;
  const contract = BUILD_SELECTOR_CONTRACT;
  return [
    'You are the read-only frontier selector for exactly one BUILD-mode development request.',
    '',
    'You are not a writer. Do not modify, create, or delete any file. Do not commit, push,',
    'create branches, tags, or refs. Do not open pull requests. Do not deploy or mutate any',
    'external system. The runner observes this workspace with Git after you exit; any',
    'repository mutation rejects your entire decision before any executor runs.',
    '',
    '## Current live main',
    sha,
    '',
    '## BUILD REQUEST (verbatim)',
    buildRequest,
    '',
    '## Declared authority paths named by the BUILD REQUEST (each exists at live main)',
    ...(declaredAuthority.length > 0
      ? declaredAuthority.map((path) => `- ${path}`)
      : ['- (none declared; use the repository canonical authority below)']),
    '',
    '## Repository canonical authority (read these first, in this order)',
    ...canonicalAuthority.map((path) => `- ${path}`),
    '',
    '## Task',
    'Read the current authority in this workspace. For every considered frontier, classify',
    'the current evidence, then select the lowest-numbered currently-open frontier. Provide',
    'one Goal Contract fragment for the selected frontier and, when they are independently',
    'closable, for the other open considered frontiers the runner may batch with it.',
    '',
    '## Rules',
    `1. Authority is current truth only: files that exist at live main ${sha}.`,
    '   Never promote a historical TODO, backlog, report, completed plan, archive, or',
    '   discussion into frontier authority. Historical paths are docs/archive/**,',
    '   docs/discussions/**, docs/plans/**, docs/reports/**, and any PLAN_*/REPORT_*/',
    '   PROMPT_* file. They must not appear in ACCEPTANCE_AUTHORITY, criterion authority,',
    '   reconciliation, task allow, task semantic_owner, or task proof_owner unless the',
    '   BUILD REQUEST names that exact path.',
    '2. A frontier is open only when live main does not already satisfy it. Its criteria',
    '   are deterministic checks; the runner re-evaluates every satisfied/unsatisfied',
    '   claim at live main and rejects a mismatch, then does not invoke any executor.',
    '3. The BUILD REQUEST priority list is a ranking, not one frontier per entry. Group it',
    `   into at most ${contract.maxConsideredFrontiers} considered frontiers, preserving the`,
    '   same relative order when the request names more than that many priorities.',
    `   Considered priorities must be exactly 1..N with no gaps and must not exceed`,
    `   ${contract.maxConsideredFrontiers}.`,
    '4. A considered frontier is PRODUCT by default. MAINTENANCE is allowed only when',
    '   every considered PRODUCT frontier is already satisfied and the selected',
    '   maintenance_justification names the real blocker. A STALE_SPEC frontier is',
    '   MAINTENANCE: only spec/document wording is synced, never implementation behavior.',
    '5. Semantic gate. Return HUMAN_DECISION_REQUIRED instead of a frontier when closing',
    '   it would create new product meaning, choose a UX/product policy fork, decide',
    '   security/privacy authority, decide clinical/safety/financial/legal policy, perform',
    '   an irreversible external action, or change acceptance meaning.',
    '6. Every considered OPEN frontier must carry a gap_class from',
    `   ${contract.gapClasses.join(', ')}:`,
    '   - IMPLEMENTATION_GAP: current source behavior does not satisfy the intended',
    '     contract and a direct proof currently fails. Product frontier candidate.',
    '   - STALE_SPEC: current source behavior and a direct proof already satisfy the',
    '     intended contract and only current spec/document wording differs. Product gap',
    '     is not created; the frontier is MAINTENANCE and may only sync the current spec',
    '     lines that are stale. Do not infer STALE_SPEC from code existence alone and do',
    '     not treat test existence as a changed intended contract.',
    '   - SEMANTIC_CONFLICT: current intended contract and current implementation directly',
    '     contradict each other, or current authorities conflict about meaning. Never',
    '     resolve it automatically; return HUMAN_DECISION_REQUIRED with an allowed',
    '     escalation_token instead of a frontier.',
    '   Every open frontier also declares a reconciliation object: non-empty',
    '   intended_contract paths, and for IMPLEMENTATION_GAP/STALE_SPEC non-empty',
    '   proof_evidence; STALE_SPEC additionally requires non-empty behavior_evidence and',
    '   non-empty spec_paths. Every reconciliation path must exist at live main.',
    '7. The selected frontier is the lowest-numbered considered frontier whose criteria are',
    '   not all satisfied. An open considered frontier may carry its own goal fragment with',
    '   CRITERIA exactly equal to that frontier criteria and a TASK_CATALOG that closes',
    '   exactly those criteria. The runner admits independently closable fragments in',
    '   priority order into one bounded batch (at most',
    `   ${contract.maxBatchFrontiers} frontiers) and serializes the rest for a later`,
    '   evaluation; overlapping fragments are never executed together. Criterion ids and',
    '   task ids must be globally unique across all fragments. A frontier without a goal',
    '   fragment simply is not batched.',
    '8. Criteria use only the checks ' +
      contract.checks.join(', ') +
      ` and class ${contract.criterionClass}. Every criterion authority path must already`,
    '   exist at live main, and authority_resolved must list every authority path the',
    '   BUILD REQUEST names plus every criterion authority path of every considered',
    '   frontier. A PROOF_AT_MAIN command runs in a disposable live-main worktree with no',
    '   installed project dependencies, so it must be self-contained (for example',
    '   `node --test` against a dependency-free spec). A behavior check that needs the',
    '   project toolchain belongs in a task `proof` command instead: task proof runs in',
    '   the task workspace after the task may have installed what it needs.',
    `9. Every task must declare publication "${contract.publicationMode}", at least one`,
    '   proof command, and non-empty commit_message and pr_title. Its allow,',
    '   semantic_owner, and proof_owner paths must all stay inside AUTONOMOUSLY_ALLOWED,',
    '   and the union of goal-fragment task closes must be exactly that fragment CRITERIA.',
    `10. PLANNER.enabled must be ${contract.plannerEnabled}. The runner never enables a`,
    '    second generator.',
    '11. Every ACCEPTANCE_AUTHORITY path must exist as a file (blob) at live main.',
    '    ACCEPTANCE_AUTHORITY must include every path the BUILD REQUEST names and every',
    '    criterion authority path that exists as a blob at live main.',
    `12. Do not invent fields. Every shape allows exactly these fields:`,
    `    - decision: ${contract.topLevelFields.join(', ')}`,
    `    - considered entry: ${contract.consideredFields.join(', ')}`,
    `    - selected: ${contract.selectedFields.join(', ')}`,
    `    - reconciliation: ${contract.reconciliationFields.join(', ')}`,
    `    - goal: ${contract.goalFields.join(', ')}`,
    `    - task: ${contract.goalTaskFields.join(', ')}`,
    '    Unknown fields, missing required fields, and any criterion field outside its',
    '    check field set reject the decision. Generated task text must stay under',
    `    ${contract.taskTextMaxChars} characters.`,
    '',
    '## Required output',
    'Return exactly one JSON object and nothing else: no markdown fence, no commentary, no',
    'second payload. Allowed shapes:',
    renderFrontierDecisionSkeleton(),
    '{"status":"ALREADY_SATISFIED","reason":"...","authority_resolved":["repo/path"],"considered":[{"priority":1,"id":"...","statement":"...","kind":"PRODUCT","criteria":[...],"satisfied":true,"evidence":"..."}]}',
    '{"status":"NO_EXECUTABLE_FRONTIER","reason":"...","authority_resolved":["repo/path"]}',
    `{"status":"HUMAN_DECISION_REQUIRED","reason":"...","escalation_token":"...","authority_resolved":["repo/path"]}`,
    '{"status":"BLOCKED_EXTERNAL","reason":"...","authority_resolved":["repo/path"]}',
    '',
    'Allowed statuses: ' + contract.statuses.join(', ') + '.',
    'A non-selected open considered frontier that the runner may batch with the selected',
    'frontier carries its own "goal" fragment with the same shape as selected.goal. The',
    'selected frontier fragment may go in selected.goal or in its considered entry goal;',
    'if both are present they must be the same fragment.',
    'Criterion fields by check:',
    ...renderCriterionFieldList(),
    '',
    'A considered entry with satisfied true must carry a non-empty "evidence" string.',
    'HUMAN_DECISION_REQUIRED escalation_token must be one of: ' +
      contract.escalationTokens.join(', ') +
      '.',
  ].join('\n');
}

/**
 * Index of the `}` that balances the `{` at `startIndex`, ignoring braces that
 * appear inside JSON strings. Returns -1 when no balanced end exists.
 */
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
 * Extract exactly one parseable plain JSON object from arbitrary text using a
 * string-aware brace balance scan. Returns the object when the text contains
 * exactly one parseable object; returns null for zero or two-or-more objects.
 */
function extractSingleJsonObject(text) {
  const source = typeof text === 'string' ? text : '';
  let found = null;
  let index = source.indexOf('{');
  while (index !== -1) {
    const end = findBalancedObjectEnd(source, index);
    if (end === -1) {
      index = source.indexOf('{', index + 1);
      continue;
    }
    const parsed = parseJson(source.slice(index, end + 1));
    if (isPlainObject(parsed)) {
      if (found !== null) return null;
      found = parsed;
    }
    index = source.indexOf('{', end + 1);
  }
  return found;
}

function parseSelectorOutput(stdout) {
  const textParts = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const event = parseJson(line);
    if (!isPlainObject(event)) {
      return { ok: false, reason: 'selector stdout contains a line that is not a JSON event' };
    }
    if (event.type !== 'text') continue;
    const part = event.part;
    if (!isPlainObject(part) || typeof part.text !== 'string') {
      return { ok: false, reason: 'selector text event has no text payload' };
    }
    textParts.push(part.text);
  }
  if (textParts.length === 0) {
    return { ok: false, reason: 'selector output contained no assistant text' };
  }
  // The OpenCode JSON stream may carry earlier commentary text parts before the
  // final answer. The final assistant text part is the required payload; the
  // joined stream is accepted only when it is already exactly one JSON object.
  const joined = textParts.join('').trim();
  const joinedDecision = parseJson(joined);
  if (isPlainObject(joinedDecision)) {
    return { ok: true, decision: joinedDecision, text: joined };
  }
  const finalText = textParts[textParts.length - 1].trim();
  const finalDecision = parseJson(finalText);
  if (isPlainObject(finalDecision)) {
    return { ok: true, decision: finalDecision, text: finalText };
  }
  // The exact-JSON attempts above are strict. As a last resort, accept exactly
  // one parseable plain object embedded in the final text part (tolerating
  // surrounding prose or a stray trailing brace), then in the concatenated
  // text. Zero or two-or-more objects still fails closed unchanged.
  const extractedFinal = extractSingleJsonObject(finalText);
  if (extractedFinal !== null) {
    return { ok: true, decision: extractedFinal, text: finalText };
  }
  const extractedJoined = extractSingleJsonObject(joined);
  if (extractedJoined !== null) {
    return { ok: true, decision: extractedJoined, text: joined };
  }
  return { ok: false, reason: 'selector final text is not exactly one JSON object' };
}

function createSelectorEvidence() {
  return {
    status: null,
    reason: null,
    decision: null,
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
}

/** One read-only frontier-selector invocation in a disposable live-main workspace. */
function runFrontierSelector({
  buildRequest,
  declaredAuthority,
  canonicalAuthority,
  repositoryRoot,
  pin,
  options,
  deps,
  log,
}) {
  const baseEnv = deps.env ?? process.env;
  const invokeOpencode = deps.invokeSelectorOpencode ?? defaultInvokeOpencode;
  const removeWorkspace = deps.removeWorkspace ?? defaultRemoveWorkspace;
  const evidence = createSelectorEvidence();
  let tempRoot = null;
  let workspacePath = null;
  let mutationObserved = false;
  let invocationFailure = null;
  try {
    tempRoot = mkdtempSync(join(tmpdir(), 'greenhub-run-build-selector-'));
    workspacePath = createBaselineWorkspace({
      repositoryRoot,
      tempRoot,
      baselineSha: pin.fetchedSha,
    });
    let resolvedCommand = null;
    if (deps.invokeSelectorOpencode === undefined) {
      resolvedCommand = resolveOpencodeCommand({
        explicitBin: options.opencodeBin ?? null,
        baseEnv,
      });
      evidence.executor.commandSource = resolvedCommand.source;
    }
    const prompt = buildFrontierPrompt({
      buildRequest,
      declaredAuthority,
      canonicalAuthority,
      pin,
    });
    const args = buildOpencodeArgs({
      taskText: prompt,
      workspacePath,
      model: options.model ?? null,
      agent: options.agent ?? null,
      title: isNonEmptyString(options.title)
        ? `${options.title} selector`
        : 'build-frontier-selector',
    });
    const childEnv = buildChildEnv({ baseEnv, scratchDir: tempRoot });
    evidence.executor.invoked = true;
    log(`[run-build] selector opencode start in ${workspacePath}`);
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
    evidence.outputTail = tail(execution?.stdout);
    log(
      `[run-build] selector opencode exit=${evidence.executor.exitCode} timedOut=${evidence.executor.timedOut}`,
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
        const parsed = parseSelectorOutput(execution?.stdout);
        if (parsed.ok) {
          evidence.decision = parsed.decision;
        }
      }
    } else if (!executionSucceeded) {
      invocationFailure =
        `exit=${evidence.executor.exitCode} timedOut=${evidence.executor.timedOut} ` +
        `startError=${evidence.executor.startErrorCode ?? 'none'}`;
    } else {
      const parsed = parseSelectorOutput(execution?.stdout);
      if (!parsed.ok) {
        evidence.status = 'INVALID_OUTPUT';
        evidence.reason = parsed.reason;
      } else {
        evidence.status = 'DECISION';
        evidence.decision = parsed.decision;
      }
    }
  } catch (error) {
    evidence.status = 'WORKSPACE_FAILED';
    evidence.reason = `selector workspace could not be prepared or invoked: ${messageOf(error)}`;
  } finally {
    if (tempRoot !== null) {
      try {
        const removal = removeWorkspace({ repositoryRoot, tempRoot, workspacePath });
        evidence.workspaceCleanup = removal.removed ? 'REMOVED' : 'FAILED';
        if (!removal.removed) {
          evidence.status = 'WORKSPACE_FAILED';
          evidence.reason = `selector workspace cleanup failed: ${(removal.errors ?? []).join('; ')}`;
        }
      } catch (error) {
        evidence.workspaceCleanup = 'FAILED';
        evidence.status = 'WORKSPACE_FAILED';
        evidence.reason = `selector workspace cleanup failed: ${messageOf(error)}`;
      }
    }
  }
  if (evidence.status === null) {
    if (mutationObserved) {
      evidence.status = 'MUTATION_REJECTED';
      evidence.reason =
        `selector workspace mutation observed: ${evidence.changedPaths.join(', ')}; ` +
        'BUILD_SELECTOR_MUTATION_REJECTED';
    } else {
      evidence.status = 'INVOCATION_FAILED';
      evidence.reason = `selector invocation did not complete successfully (${invocationFailure})`;
    }
  }
  if (evidence.status !== 'DECISION') evidence.decision = null;
  log(`[run-build] selector status=${evidence.status}`);
  return evidence;
}

function canonicalCriteria(criteria) {
  const synthetic = validateGoalContract({
    GOAL: 'frontier criterion normalization',
    ACCEPTANCE_AUTHORITY: ['AGENTS.md'],
    PRESERVE: ['normalization placeholder'],
    AUTONOMOUSLY_ALLOWED: [],
    ESCALATE_IF: [],
    STOP_WHEN: ['normalization placeholder'],
    CRITERIA: criteria,
    TASK_CATALOG: [],
  });
  if (!synthetic.ok) return { ok: false, errors: synthetic.errors };
  return {
    ok: true,
    criteria: [...synthetic.contract.criteria].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
  };
}

function validateCriterionSet({ criteria, field }) {
  if (Array.isArray(criteria)) {
    for (const raw of criteria) {
      if (!isPlainObject(raw)) continue;
      const allowed = BUILD_SELECTOR_CONTRACT.criterionFieldsByCheck[raw.check];
      if (allowed === undefined) continue;
      const extra = Object.keys(raw).filter((key) => !allowed.includes(key));
      if (extra.length > 0) {
        return {
          ok: false,
          reason: `${field} criterion for ${raw.check} contains field(s) outside the check field set: ${extra.join(', ')}`,
        };
      }
    }
  }
  const canonical = canonicalCriteria(criteria);
  if (!canonical.ok) {
    return {
      ok: false,
      reason: `${field} contains invalid criterion entries: ${canonical.errors.join('; ')}`,
    };
  }
  const normalized = canonical.criteria;
  if (normalized.length === 0) {
    return { ok: false, reason: `${field} must declare at least one criterion` };
  }
  for (const criterion of normalized) {
    if (criterion.class !== BUILD_SELECTOR_CONTRACT.criterionClass) {
      return {
        ok: false,
        reason: `${field} criterion ${criterion.id} must be class ${BUILD_SELECTOR_CONTRACT.criterionClass} for a BUILD frontier`,
      };
    }
    if (!BUILD_SELECTOR_CONTRACT.checks.includes(criterion.check)) {
      return {
        ok: false,
        reason: `${field} criterion ${criterion.id} check must be one of ${BUILD_SELECTOR_CONTRACT.checks.join(', ')}`,
      };
    }
  }
  return { ok: true, criteria: normalized };
}

function validateEvidencePaths({ value, field, required, repositoryRoot, pin }) {
  if (value == null) {
    if (required) return { ok: false, reason: `${field} must be a non-empty path array` };
    return { ok: true, paths: [] };
  }
  if (!Array.isArray(value) || value.some((entry) => !isSafeRepoPath(entry))) {
    return { ok: false, reason: `${field} must be an array of safe repo-relative paths` };
  }
  const paths = uniqueNormalizedPaths(value);
  if (required && paths.length === 0) {
    return { ok: false, reason: `${field} must be a non-empty path array` };
  }
  for (const path of paths) {
    if (observeRepoObject({ repositoryRoot, ref: pin.fetchedSha, path }) === null) {
      return {
        ok: false,
        reason: `${field} path does not exist at live main ${pin.fetchedSha}: ${path}`,
      };
    }
  }
  return { ok: true, paths };
}

/**
 * Current-evidence reconciliation for one open considered frontier
 * (development-authority section 9.2). Classification and evidence are
 * ephemeral selector judgments; nothing is persisted.
 */
function validateReconciliation({
  value,
  label,
  gapClass,
  repositoryRoot,
  pin,
  declaredAuthority,
}) {
  if (!isPlainObject(value)) {
    return { ok: false, reason: `${label} reconciliation must be an object` };
  }
  const extra = Object.keys(value).filter(
    (key) => !BUILD_SELECTOR_CONTRACT.reconciliationFields.includes(key),
  );
  if (extra.length > 0) {
    return {
      ok: false,
      reason: `${label} reconciliation contains unsupported field(s): ${extra.join(', ')}`,
    };
  }
  if (!isNonEmptyString(value.statement)) {
    return { ok: false, reason: `${label} reconciliation statement must be a non-empty string` };
  }
  const staleSpec = gapClass === 'STALE_SPEC';
  const requiresProof = gapClass === 'IMPLEMENTATION_GAP' || staleSpec;
  const fields = {
    intended_contract: { required: true },
    behavior_evidence: { required: staleSpec },
    proof_evidence: { required: requiresProof },
    spec_paths: { required: staleSpec },
  };
  const normalized = { statement: value.statement.trim() };
  for (const [field, rule] of Object.entries(fields)) {
    const validated = validateEvidencePaths({
      value: value[field],
      field: `${label} reconciliation ${field}`,
      required: rule.required,
      repositoryRoot,
      pin,
    });
    if (!validated.ok) return validated;
    normalized[field] = validated.paths;
  }
  const historical = historicalViolations({
    paths: [
      ...normalized.intended_contract,
      ...normalized.behavior_evidence,
      ...normalized.proof_evidence,
      ...normalized.spec_paths,
    ],
    declaredAuthority,
  });
  if (historical.length > 0) {
    return {
      ok: false,
      reason:
        `${label} reconciliation must not use historical documentation unless the BUILD ` +
        `REQUEST names it exactly: ${historical.join(', ')}`,
    };
  }
  return { ok: true, reconciliation: normalized };
}

function validateConsideredEntries({
  value,
  authorityResolved,
  repositoryRoot,
  pin,
  declaredAuthority,
}) {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, reason: 'considered must be a non-empty array' };
  }
  if (value.length > BUILD_SELECTOR_CONTRACT.maxConsideredFrontiers) {
    return {
      ok: false,
      reason: `considered must contain at most ${BUILD_SELECTOR_CONTRACT.maxConsideredFrontiers} frontiers`,
    };
  }
  const entries = [];
  const ids = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    const label = `considered[${index}]`;
    if (!isPlainObject(raw)) return { ok: false, reason: `${label} must be an object` };
    const extra = Object.keys(raw).filter(
      (key) => !BUILD_SELECTOR_CONTRACT.consideredFields.includes(key),
    );
    if (extra.length > 0) {
      return { ok: false, reason: `${label} contains unsupported field(s): ${extra.join(', ')}` };
    }
    if (raw.priority !== index + 1) {
      return {
        ok: false,
        reason: `${label} priority must be ${index + 1} in request priority order`,
      };
    }
    if (!isNonEmptyString(raw.id))
      return { ok: false, reason: `${label} id must be a non-empty string` };
    if (ids.has(raw.id.trim()))
      return { ok: false, reason: `${label} id is duplicated: ${raw.id}` };
    ids.add(raw.id.trim());
    if (!isNonEmptyString(raw.statement)) {
      return { ok: false, reason: `${label} statement must be a non-empty string` };
    }
    if (!BUILD_SELECTOR_CONTRACT.kinds.includes(raw.kind)) {
      return {
        ok: false,
        reason: `${label} kind must be one of ${BUILD_SELECTOR_CONTRACT.kinds.join(', ')}`,
      };
    }
    if (typeof raw.satisfied !== 'boolean') {
      return { ok: false, reason: `${label} satisfied must be a boolean` };
    }
    if (raw.satisfied && !isNonEmptyString(raw.evidence)) {
      return { ok: false, reason: `${label} requires a non-empty evidence string when satisfied` };
    }
    if (raw.kind === 'MAINTENANCE' && !isNonEmptyString(raw.maintenance_justification)) {
      return { ok: false, reason: `${label} MAINTENANCE requires a maintenance_justification` };
    }
    const criteriaValidation = validateCriterionSet({
      criteria: raw.criteria,
      field: `${label} criteria`,
    });
    if (!criteriaValidation.ok) return criteriaValidation;
    const outside = criteriaValidation.criteria
      .flatMap((criterion) => criterion.authority)
      .filter((path) => !authorityResolved.has(path));
    if (outside.length > 0) {
      return {
        ok: false,
        reason: `${label} criterion authority path(s) are not resolved at live main: ${[...new Set(outside)].join(', ')}`,
      };
    }

    let gapClass = null;
    let reconciliation = null;
    let rawGoal = null;
    if (!raw.satisfied) {
      if (!BUILD_SELECTOR_CONTRACT.gapClasses.includes(raw.gap_class)) {
        return {
          ok: false,
          reason: `${label} open frontier requires gap_class one of ${BUILD_SELECTOR_CONTRACT.gapClasses.join(', ')}`,
        };
      }
      gapClass = raw.gap_class;
      const reconciled = validateReconciliation({
        value: raw.reconciliation,
        label,
        gapClass,
        repositoryRoot,
        pin,
        declaredAuthority,
      });
      if (!reconciled.ok) return reconciled;
      reconciliation = reconciled.reconciliation;
      if (raw.goal != null) {
        if (!isPlainObject(raw.goal)) {
          return { ok: false, reason: `${label} goal must be an object` };
        }
        rawGoal = raw.goal;
      }
      if (gapClass === 'STALE_SPEC' && raw.kind !== 'MAINTENANCE') {
        return {
          ok: false,
          reason: `${label} STALE_SPEC is a spec-sync maintenance frontier and must declare kind MAINTENANCE`,
        };
      }
    } else {
      if (raw.gap_class != null && !BUILD_SELECTOR_CONTRACT.gapClasses.includes(raw.gap_class)) {
        return {
          ok: false,
          reason: `${label} gap_class must be one of ${BUILD_SELECTOR_CONTRACT.gapClasses.join(', ')}`,
        };
      }
      if (raw.goal != null) {
        return { ok: false, reason: `${label} satisfied frontier must not carry a goal` };
      }
    }

    entries.push({
      priority: raw.priority,
      id: raw.id.trim(),
      statement: raw.statement.trim(),
      kind: raw.kind,
      criteria: criteriaValidation.criteria,
      satisfied: raw.satisfied,
      evidence: isNonEmptyString(raw.evidence) ? raw.evidence.trim() : null,
      maintenanceJustification: isNonEmptyString(raw.maintenance_justification)
        ? raw.maintenance_justification.trim()
        : null,
      gapClass,
      reconciliation,
      rawGoal,
    });
  }
  return { ok: true, entries };
}

function verifyEntrySatisfaction({ entry, repositoryRoot, pin, options, deps, log }) {
  const evaluation = evaluateGoalCriteria({
    contract: { criteria: entry.criteria },
    repositoryRoot,
    pin,
    options,
    deps,
    log,
  });
  const evaluationError = evaluation.find((criterion) => criterion.evaluationError);
  if (evaluationError !== undefined) {
    return {
      ok: false,
      reason:
        `considered frontier ${entry.id} criterion ${evaluationError.id} could not be evaluated ` +
        `at live main: ${evaluationError.reason}`,
    };
  }
  const satisfied = evaluation.every((criterion) => criterion.satisfied);
  if (satisfied !== entry.satisfied) {
    return {
      ok: false,
      reason:
        `considered frontier ${entry.id} claims satisfied=${entry.satisfied} but live main ${pin.fetchedSha} ` +
        `evaluates satisfied=${satisfied}`,
    };
  }
  return { ok: true, evaluation };
}

function validateTaskBoundaries({ taskCatalog, autonomouslyAllowed }) {
  for (const task of taskCatalog) {
    const declared = [...task.allow, ...task.semantic_owner, ...task.proof_owner.flat()];
    const outside = declared.filter((path) => !isPathAllowed(path, autonomouslyAllowed));
    if (outside.length > 0) {
      return {
        ok: false,
        reason: `task ${task.id} declares path(s) outside AUTONOMOUSLY_ALLOWED: ${[...new Set(outside)].join(', ')}`,
      };
    }
  }
  return { ok: true };
}

function historicalViolations({ paths, declaredAuthority }) {
  const declared = new Set(declaredAuthority);
  return [...new Set(paths)].filter((path) => isHistoricalPath(path) && !declared.has(path));
}

function validateGoalShape({ goal, label }) {
  if (!isPlainObject(goal)) return { ok: false, reason: `${label} must be an object` };
  const extraGoal = Object.keys(goal).filter(
    (key) => !BUILD_SELECTOR_CONTRACT.goalFields.includes(key),
  );
  if (extraGoal.length > 0) {
    return { ok: false, reason: `${label} contains unsupported field(s): ${extraGoal.join(', ')}` };
  }
  if (Array.isArray(goal.CRITERIA)) {
    for (const raw of goal.CRITERIA) {
      if (!isPlainObject(raw)) continue;
      const allowed = BUILD_SELECTOR_CONTRACT.criterionFieldsByCheck[raw.check];
      if (allowed === undefined) continue;
      const extra = Object.keys(raw).filter((key) => !allowed.includes(key));
      if (extra.length > 0) {
        return {
          ok: false,
          reason: `${label} criterion for ${raw.check} contains field(s) outside the check field set: ${extra.join(', ')}`,
        };
      }
    }
  }
  if (Array.isArray(goal.TASK_CATALOG)) {
    for (const rawTask of goal.TASK_CATALOG) {
      if (!isPlainObject(rawTask)) continue;
      const extra = Object.keys(rawTask).filter(
        (key) => !BUILD_SELECTOR_CONTRACT.goalTaskFields.includes(key),
      );
      if (extra.length > 0) {
        return {
          ok: false,
          reason: `${label} task ${rawTask.id ?? '(unknown)'} contains unsupported field(s): ${extra.join(', ')}`,
        };
      }
    }
  }
  return { ok: true };
}

function sortedById(entries) {
  return [...entries].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

function validateGoalCore({
  goal,
  expectedCriteria,
  criteriaMessage,
  declaredAuthority,
  repositoryRoot,
  pin,
}) {
  const reject = (reason) => ({ ok: false, reason });
  const label = 'ephemeral Goal Contract';
  const shape = validateGoalShape({ goal, label });
  if (!shape.ok) return reject(shape.reason);
  const validation = validateGoalContract(goal);
  if (!validation.ok) {
    return reject(`${label} is invalid (${validation.kind}): ${validation.errors.join('; ')}`);
  }
  const contract = validation.contract;
  if (contract.criteria.length === 0) {
    return reject(`${label} must declare at least one criterion`);
  }
  for (const criterion of contract.criteria) {
    if (criterion.class !== BUILD_SELECTOR_CONTRACT.criterionClass) {
      return reject(
        `criterion ${criterion.id} must be class ${BUILD_SELECTOR_CONTRACT.criterionClass} for a BUILD frontier`,
      );
    }
    if (!BUILD_SELECTOR_CONTRACT.checks.includes(criterion.check)) {
      return reject(
        `criterion ${criterion.id} check must be one of ${BUILD_SELECTOR_CONTRACT.checks.join(', ')}`,
      );
    }
  }
  if (contract.task_catalog.length === 0) {
    return reject(`${label} must declare at least one task`);
  }
  if (contract.planner.enabled !== BUILD_SELECTOR_CONTRACT.plannerEnabled) {
    return reject(`${label} must not enable PLANNER`);
  }
  if (contract.autonomously_allowed.length === 0) {
    return reject('AUTONOMOUSLY_ALLOWED must declare at least one path');
  }
  const expected = JSON.stringify(sortedById(expectedCriteria));
  const actual = JSON.stringify(sortedById(contract.criteria));
  if (actual !== expected) {
    return reject(criteriaMessage);
  }
  const criterionIds = new Set(contract.criteria.map((criterion) => criterion.id));
  const closed = new Set();
  for (const task of contract.task_catalog) {
    if (task.publication !== BUILD_SELECTOR_CONTRACT.publicationMode) {
      return reject(
        `task ${task.id} must declare publication "${BUILD_SELECTOR_CONTRACT.publicationMode}" in BUILD mode`,
      );
    }
    if (task.proof.length === 0) {
      return reject(`task ${task.id} must declare at least one proof command`);
    }
    for (const criterionId of task.closes) closed.add(criterionId);
  }
  const unclosed = [...criterionIds].filter((criterionId) => !closed.has(criterionId));
  if (unclosed.length > 0) {
    return reject(`task catalog does not close criterion(s): ${unclosed.join(', ')}`);
  }
  const boundary = validateTaskBoundaries({
    taskCatalog: contract.task_catalog,
    autonomouslyAllowed: contract.autonomously_allowed,
  });
  if (!boundary.ok) return reject(boundary.reason);

  const authorityPaths = [
    ...contract.acceptance_authority,
    ...contract.criteria.flatMap((criterion) => criterion.authority),
    ...contract.task_catalog.flatMap((task) => [
      ...task.allow,
      ...task.semantic_owner,
      ...task.proof_owner.flat(),
    ]),
  ];
  const historical = historicalViolations({ paths: authorityPaths, declaredAuthority });
  if (historical.length > 0) {
    return reject(
      `historical documentation must not be frontier authority or mutation surface ` +
        `unless the BUILD REQUEST names it exactly: ${historical.join(', ')}`,
    );
  }
  for (const path of contract.acceptance_authority) {
    if (observeRepoObject({ repositoryRoot, ref: pin.fetchedSha, path }) !== 'blob') {
      return reject(
        `ACCEPTANCE_AUTHORITY path is not a readable blob at live main ${pin.fetchedSha}: ${path}`,
      );
    }
  }
  for (const criterion of contract.criteria) {
    for (const path of criterion.authority) {
      if (observeRepoObject({ repositoryRoot, ref: pin.fetchedSha, path }) === null) {
        return reject(
          `criterion ${criterion.id} authority path does not exist at live main ${pin.fetchedSha}: ${path}`,
        );
      }
    }
  }
  return { ok: true, contract };
}

/**
 * A STALE_SPEC frontier may only sync the current spec lines its reconciliation
 * proves stale; its mutation surface must stay inside reconciliation.spec_paths.
 */
function validateStaleSpecBoundaries({ entry, contract }) {
  const specPaths = entry.reconciliation?.spec_paths ?? [];
  for (const task of contract.task_catalog) {
    const declared = [...task.allow, ...task.semantic_owner];
    const outside = declared.filter((path) => !isPathAllowed(path, specPaths));
    if (outside.length > 0) {
      return {
        ok: false,
        reason:
          `STALE_SPEC task ${task.id} may only sync its reconciliation spec_paths; ` +
          `outside: ${[...new Set(outside)].join(', ')}`,
      };
    }
  }
  return { ok: true };
}

/**
 * One considered frontier's Goal Contract fragment. CRITERIA must equal that
 * frontier's criteria exactly.
 */
export function validateGeneratedGoal({
  goal,
  selectedEntry,
  declaredAuthority,
  repositoryRoot,
  pin,
}) {
  const core = validateGoalCore({
    goal,
    expectedCriteria: selectedEntry.criteria,
    criteriaMessage: 'CRITERIA must be exactly the selected considered frontier criteria',
    declaredAuthority,
    repositoryRoot,
    pin,
  });
  if (!core.ok) return core;
  if (selectedEntry.gapClass === 'STALE_SPEC') {
    const stale = validateStaleSpecBoundaries({ entry: selectedEntry, contract: core.contract });
    if (!stale.ok) return stale;
  }
  return core;
}

/** Independently closable fragments merged into one run-goal contract. */
function validateMergedGoal({
  goal,
  expectedCriteria,
  declaredAuthority,
  repositoryRoot,
  pin,
}) {
  return validateGoalCore({
    goal,
    expectedCriteria,
    criteriaMessage: 'CRITERIA must be exactly the union of the admitted frontier criteria',
    declaredAuthority,
    repositoryRoot,
    pin,
  });
}

/**
 * Pairwise independence of two frontier fragments, derived from the same
 * authoritative conflict rule the run-goal batch admission uses. `null` means
 * the two fragments may run in one bounded batch.
 */
function fragmentConflict(leftContract, rightContract) {
  const leftTaskIds = new Set(leftContract.task_catalog.map((task) => task.id));
  const rightTaskIds = new Set(rightContract.task_catalog.map((task) => task.id));
  for (const id of leftTaskIds) {
    if (rightTaskIds.has(id)) {
      return { kind: 'TASK_ID', reason: `task id ${id} is declared by both fragments` };
    }
  }
  const leftCriterionIds = new Set(leftContract.criteria.map((criterion) => criterion.id));
  for (const criterion of rightContract.criteria) {
    if (leftCriterionIds.has(criterion.id)) {
      return {
        kind: 'CRITERION_ID',
        reason: `criterion id ${criterion.id} is declared by both fragments`,
      };
    }
  }
  for (const left of leftContract.task_catalog) {
    for (const right of rightContract.task_catalog) {
      const conflict = taskConflict(left, right);
      if (conflict !== null) return conflict;
    }
    const cross = left.depends_on.find((id) => rightTaskIds.has(id));
    if (cross !== undefined) {
      return {
        kind: 'DEPENDS_ON',
        reason: `task ${left.id} depends on ${cross} across fragments`,
      };
    }
  }
  for (const right of rightContract.task_catalog) {
    const cross = right.depends_on.find((id) => leftTaskIds.has(id));
    if (cross !== undefined) {
      return {
        kind: 'DEPENDS_ON',
        reason: `task ${right.id} depends on ${cross} across fragments`,
      };
    }
  }
  return null;
}

/** Deterministic merge of admitted fragments into one ephemeral Goal Contract. */
function mergeGoalFragments(fragments) {
  if (fragments.length === 1) {
    return { ok: true, raw: fragments[0].raw, contract: fragments[0].contract };
  }
  const list = (key) => [...new Set(fragments.flatMap((fragment) => fragment.contract[key]))];
  const budgets = fragments.map((fragment) => fragment.contract.budget);
  const merged = {
    GOAL: fragments[0].raw.GOAL,
    ACCEPTANCE_AUTHORITY: list('acceptance_authority'),
    PRESERVE: list('preserve'),
    AUTONOMOUSLY_ALLOWED: list('autonomously_allowed'),
    ESCALATE_IF: list('escalate_if'),
    STOP_WHEN: list('stop_when'),
    CRITERIA: fragments.flatMap((fragment) => fragment.raw.CRITERIA),
    TASK_CATALOG: fragments.flatMap((fragment) => fragment.raw.TASK_CATALOG),
    PLANNER: { enabled: BUILD_SELECTOR_CONTRACT.plannerEnabled },
    BUDGET: {
      max_iterations: Math.max(...budgets.map((budget) => budget.max_iterations)),
      max_tasks: budgets.reduce((sum, budget) => sum + budget.max_tasks, 0),
      max_wall_clock_ms: Math.max(...budgets.map((budget) => budget.max_wall_clock_ms)),
    },
  };
  const validation = validateGoalContract(merged);
  if (!validation.ok) {
    return {
      ok: false,
      reason: `merged batch Goal Contract is invalid (${validation.kind}): ${validation.errors.join('; ')}`,
    };
  }
  return { ok: true, raw: merged, contract: validation.contract };
}

/**
 * Deterministic validation of one selector decision. `ok: true` with a
 * `terminal` means the selector resolved a finite terminal; `ok: true` with a
 * `goal` means exactly one validated ephemeral Goal Contract may be handed to
 * run-goal. Every rejection is fail-closed and never substitutes another
 * authority file.
 */
export function validateFrontierDecision({
  decision,
  declaredAuthority,
  repositoryRoot,
  pin,
  options = {},
  deps = {},
  log = () => {},
}) {
  const reject = (reason) => ({ ok: false, terminal: BLOCKED_EXTERNAL, reason });
  if (!isPlainObject(decision)) return reject('selector decision is not a JSON object');
  if (!BUILD_SELECTOR_CONTRACT.statuses.includes(decision.status)) {
    return reject(`selector status must be one of ${BUILD_SELECTOR_CONTRACT.statuses.join(', ')}`);
  }
  if (!isNonEmptyString(decision.reason)) {
    return reject('selector reason must be a non-empty string');
  }
  const extraTop = Object.keys(decision).filter(
    (key) => !BUILD_SELECTOR_CONTRACT.topLevelFields.includes(key),
  );
  if (extraTop.length > 0) {
    return reject(`selector decision contains unsupported field(s): ${extraTop.join(', ')}`);
  }

  const rawAuthority = decision.authority_resolved;
  if (!Array.isArray(rawAuthority) || rawAuthority.length === 0) {
    return reject('authority_resolved must be a non-empty array of repo-relative paths');
  }
  for (const entry of rawAuthority) {
    if (!isSafeRepoPath(entry)) {
      return reject(
        `authority_resolved contains an invalid repo-relative path: ${JSON.stringify(entry)}`,
      );
    }
  }
  const authorityResolved = uniqueNormalizedPaths(rawAuthority);
  const resolution = resolveAuthorityPaths({
    repositoryRoot,
    ref: pin.fetchedSha,
    paths: authorityResolved,
  });
  const unreadableAuthority = resolution.filter((entry) => entry.objectType === null);
  if (unreadableAuthority.length > 0) {
    return reject(
      `authority_resolved path(s) are missing at live main ${pin.fetchedSha}: ` +
        `${unreadableAuthority.map((entry) => entry.path).join(', ')}`,
    );
  }
  const resolvedSet = new Set(authorityResolved);
  const undeclared = declaredAuthority.filter((path) => !resolvedSet.has(path));
  if (undeclared.length > 0) {
    return reject(
      `declared BUILD request authority path(s) were not resolved by the selector: ${undeclared.join(', ')}`,
    );
  }

  if (decision.status === 'HUMAN_DECISION_REQUIRED') {
    if (decision.selected != null) {
      return reject('HUMAN_DECISION_REQUIRED must not carry a selected frontier');
    }
    if (!isNonEmptyString(decision.escalation_token)) {
      return reject('HUMAN_DECISION_REQUIRED requires a non-empty escalation_token');
    }
    if (!HUMAN_ESCALATION_TOKENS.includes(decision.escalation_token.trim())) {
      return reject(
        `HUMAN_DECISION_REQUIRED escalation_token is not declared: ${decision.escalation_token}`,
      );
    }
    return {
      ok: true,
      terminal: HUMAN_DECISION_REQUIRED,
      reason: decision.reason.trim(),
      authorityResolved,
      escalationToken: decision.escalation_token.trim(),
    };
  }

  if (decision.status === 'NO_EXECUTABLE_FRONTIER' || decision.status === 'BLOCKED_EXTERNAL') {
    if (decision.selected != null) {
      return reject(`${decision.status} must not carry a selected frontier`);
    }
    if (decision.considered != null) {
      const considered = validateConsideredEntries({
        value: decision.considered,
        authorityResolved: resolvedSet,
        repositoryRoot,
        pin,
        declaredAuthority,
      });
      if (!considered.ok) return reject(considered.reason);
      for (const entry of considered.entries.filter((candidate) => candidate.satisfied)) {
        const verified = verifyEntrySatisfaction({
          entry,
          repositoryRoot,
          pin,
          options,
          deps,
          log,
        });
        if (!verified.ok) return reject(verified.reason);
      }
    }
    return {
      ok: true,
      terminal: decision.status,
      reason: decision.reason.trim(),
      authorityResolved,
    };
  }

  const considered = validateConsideredEntries({
    value: decision.considered,
    authorityResolved: resolvedSet,
    repositoryRoot,
    pin,
    declaredAuthority,
  });
  if (!considered.ok) return reject(considered.reason);

  for (const entry of considered.entries) {
    const historical = historicalViolations({
      paths: entry.criteria.flatMap((criterion) => criterion.authority),
      declaredAuthority,
    });
    if (historical.length > 0) {
      return reject(
        `historical documentation must not be frontier authority unless the BUILD REQUEST ` +
          `names it exactly: ${historical.join(', ')}`,
      );
    }
    const verified = verifyEntrySatisfaction({ entry, repositoryRoot, pin, options, deps, log });
    if (!verified.ok) return reject(verified.reason);
  }

  const semanticConflicts = considered.entries.filter(
    (entry) => !entry.satisfied && entry.gapClass === 'SEMANTIC_CONFLICT',
  );
  if (semanticConflicts.length > 0) {
    return {
      ok: false,
      terminal: HUMAN_DECISION_REQUIRED,
      reason:
        `considered frontier(s) ${semanticConflicts
          .map((entry) => entry.id)
          .join(', ')} are SEMANTIC_CONFLICT: current intended contract and current ` +
        'implementation contradict each other, so no autonomous frontier is selected',
    };
  }

  if (decision.status === 'ALREADY_SATISFIED') {
    if (decision.selected != null) {
      return reject('ALREADY_SATISFIED must not carry a selected frontier');
    }
    const unsatisfied = considered.entries.filter((entry) => !entry.satisfied);
    if (unsatisfied.length > 0) {
      return reject(
        `ALREADY_SATISFIED is inconsistent: considered frontier(s) ${unsatisfied
          .map((entry) => entry.id)
          .join(', ')} are not satisfied at live main`,
      );
    }
    return {
      ok: true,
      terminal: ALREADY_SATISFIED,
      reason: decision.reason.trim(),
      authorityResolved,
      considered: considered.entries,
    };
  }

  const selected = decision.selected;
  if (!isPlainObject(selected)) return reject('FRONTIER requires a selected object');
  const extraSelected = Object.keys(selected).filter(
    (key) => !BUILD_SELECTOR_CONTRACT.selectedFields.includes(key),
  );
  if (extraSelected.length > 0) {
    return reject(`selected contains unsupported field(s): ${extraSelected.join(', ')}`);
  }
  if (!Number.isInteger(selected.priority)) {
    return reject('selected.priority must be an integer');
  }
  const selectedEntry = considered.entries.find((entry) => entry.priority === selected.priority);
  if (selectedEntry === undefined) {
    return reject(`selected.priority ${selected.priority} does not match a considered frontier`);
  }
  if (!isNonEmptyString(selected.id) || selected.id.trim() !== selectedEntry.id) {
    return reject('selected.id must equal the considered frontier id at selected.priority');
  }
  if (!isNonEmptyString(selected.statement) || selected.statement.trim() !== selectedEntry.statement) {
    return reject(
      'selected.statement must equal the considered frontier statement at selected.priority',
    );
  }
  if (selectedEntry.satisfied) {
    return reject(`selected frontier ${selectedEntry.id} is already satisfied at live main`);
  }
  const skipped = considered.entries.filter(
    (entry) => entry.priority < selectedEntry.priority && !entry.satisfied,
  );
  if (skipped.length > 0) {
    return reject(
      `selected frontier ${selectedEntry.id} is not the highest-priority open frontier; ` +
        `still-open higher-priority frontier(s): ${skipped.map((entry) => entry.id).join(', ')}`,
    );
  }
  if (!isNonEmptyString(selected.why_selected)) {
    return reject('selected.why_selected must be a non-empty string');
  }
  if (!BUILD_SELECTOR_CONTRACT.kinds.includes(selected.kind)) {
    return reject(`selected.kind must be one of ${BUILD_SELECTOR_CONTRACT.kinds.join(', ')}`);
  }
  if (selected.kind !== selectedEntry.kind) {
    return reject(
      'selected.kind must equal the considered frontier kind at selected.priority',
    );
  }
  if (selected.kind === 'MAINTENANCE') {
    if (!isNonEmptyString(selected.maintenance_justification)) {
      return reject('MAINTENANCE selection requires a non-empty maintenance_justification');
    }
    const openProduct = considered.entries.filter(
      (entry) => entry.kind === 'PRODUCT' && !entry.satisfied,
    );
    if (openProduct.length > 0) {
      return reject(
        `MAINTENANCE is only allowed when no PRODUCT frontier is open; open PRODUCT ` +
          `frontier(s): ${openProduct.map((entry) => entry.id).join(', ')}`,
      );
    }
  }

  // Primary fragment: selected.goal, or the selected considered entry's own
  // fragment. When both are present they must be the same contract.
  if (selected.goal != null && !isPlainObject(selected.goal)) {
    return reject('selected.goal must be an object');
  }
  const primaryRaw = isPlainObject(selected.goal) ? selected.goal : selectedEntry.rawGoal;
  if (!isPlainObject(primaryRaw)) {
    return reject('selected.goal must be an object');
  }
  const primaryValidation = validateGeneratedGoal({
    goal: primaryRaw,
    selectedEntry,
    declaredAuthority,
    repositoryRoot,
    pin,
  });
  if (!primaryValidation.ok) return reject(primaryValidation.reason);
  if (isPlainObject(selected.goal) && selectedEntry.rawGoal != null) {
    const entryValidation = validateGeneratedGoal({
      goal: selectedEntry.rawGoal,
      selectedEntry,
      declaredAuthority,
      repositoryRoot,
      pin,
    });
    if (!entryValidation.ok) return reject(entryValidation.reason);
    if (
      JSON.stringify(entryValidation.contract) !== JSON.stringify(primaryValidation.contract)
    ) {
      return reject(
        'selected.goal and the selected considered frontier goal must be the same fragment',
      );
    }
  }

  // Deterministic bounded batch admission: start from the selected frontier and
  // add each higher-numbered independently closable open frontier in priority
  // order. Conflicting candidates stay for a later recomputation and are never
  // executed together.
  const fragments = [
    { entry: selectedEntry, raw: primaryRaw, contract: primaryValidation.contract },
  ];
  const deferred = [];
  for (const entry of considered.entries) {
    if (entry.priority === selectedEntry.priority || entry.satisfied) continue;
    if (entry.rawGoal == null) {
      deferred.push({ priority: entry.priority, id: entry.id, kind: 'NO_FRAGMENT', withId: null });
      continue;
    }
    const candidate = validateGeneratedGoal({
      goal: entry.rawGoal,
      selectedEntry: entry,
      declaredAuthority,
      repositoryRoot,
      pin,
    });
    if (!candidate.ok) {
      return reject(`considered frontier ${entry.id} goal fragment is invalid: ${candidate.reason}`);
    }
    if (fragments.length >= BUILD_SELECTOR_CONTRACT.maxBatchFrontiers) {
      deferred.push({
        priority: entry.priority,
        id: entry.id,
        kind: 'CONCURRENCY_LIMIT',
        withId: null,
      });
      continue;
    }
    let conflict = null;
    let conflictWith = null;
    for (const admitted of fragments) {
      conflict = fragmentConflict(admitted.contract, candidate.contract);
      if (conflict !== null) {
        conflictWith = admitted.entry.id;
        break;
      }
    }
    if (conflict !== null) {
      deferred.push({
        priority: entry.priority,
        id: entry.id,
        kind: conflict.kind,
        withId: conflictWith,
      });
      continue;
    }
    fragments.push({ entry, raw: entry.rawGoal, contract: candidate.contract });
  }

  const merged = mergeGoalFragments(fragments);
  if (!merged.ok) return reject(merged.reason);
  const mergedValidation = validateMergedGoal({
    goal: merged.raw,
    expectedCriteria: fragments.flatMap((fragment) => fragment.contract.criteria),
    declaredAuthority,
    repositoryRoot,
    pin,
  });
  if (!mergedValidation.ok) return reject(mergedValidation.reason);

  const blobPaths = new Set(
    resolution.filter((entry) => entry.objectType === 'blob').map((entry) => entry.path),
  );
  const requiredAcceptanceBlobs = [
    ...new Set([
      ...declaredAuthority,
      ...mergedValidation.contract.criteria.flatMap((criterion) => criterion.authority),
    ]),
  ].filter((path) => blobPaths.has(path));
  const missingDeclared = requiredAcceptanceBlobs.filter(
    (path) => !mergedValidation.contract.acceptance_authority.includes(path),
  );
  if (missingDeclared.length > 0) {
    return reject(
      `ACCEPTANCE_AUTHORITY must include every blob the BUILD REQUEST names and every criterion authority blob: ${missingDeclared.join(', ')}`,
    );
  }
  return {
    ok: true,
    terminal: null,
    reason: decision.reason.trim(),
    authorityResolved,
    considered: considered.entries,
    selected: {
      priority: selectedEntry.priority,
      id: selectedEntry.id,
      statement: selectedEntry.statement,
      kind: selected.kind,
      gapClass: selectedEntry.gapClass,
      whySelected: selected.why_selected.trim(),
      maintenanceJustification: isNonEmptyString(selected.maintenance_justification)
        ? selected.maintenance_justification.trim()
        : null,
      entry: selectedEntry,
    },
    batch: {
      admitted: fragments.map((fragment) => ({
        priority: fragment.entry.priority,
        id: fragment.entry.id,
        kind: fragment.entry.kind,
        gapClass: fragment.entry.gapClass,
      })),
      deferred,
    },
    goal: { raw: merged.raw, contract: mergedValidation.contract },
  };
}

/**
 * Map the existing run-goal terminal vocabulary to the BUILD terminal
 * vocabulary. A failed sibling publication never fails a frontier whose
 * criteria are all satisfied at live main.
 */
export function mapGoalResult(goalResult) {
  const status = goalResult?.status ?? null;
  const attempts = Array.isArray(goalResult?.attempts) ? goalResult.attempts : [];
  const reason = isNonEmptyString(goalResult?.reason) ? goalResult.reason.trim() : null;
  if (status === GOAL_SATISFIED) {
    const childCalls = Number.isInteger(goalResult?.childCalls)
      ? goalResult.childCalls
      : attempts.length;
    return childCalls > 0
      ? {
          status: FRONTIER_COMPLETE,
          reason: reason ?? 'all frontier criteria are satisfied at live main',
        }
      : {
          status: ALREADY_SATISFIED,
          reason: reason ?? 'every frontier criterion was already satisfied at live main',
        };
  }
  const publicationFailure = attempts.find((attempt) =>
    PUBLICATION_FAILURE_STATUSES.includes(attempt.childStatus),
  );
  if (publicationFailure !== undefined) {
    return {
      status: PUBLICATION_FAILED,
      reason:
        `task ${publicationFailure.taskId} publication failed with ${publicationFailure.childStatus}: ` +
        `${publicationFailure.childReason ?? 'no reason'}`,
    };
  }
  if (status === HUMAN_DECISION_REQUIRED) {
    return { status: HUMAN_DECISION_REQUIRED, reason: reason ?? 'human decision required' };
  }
  if (status === BLOCKED_EXTERNAL || status === INVALID_GOAL || status === INVALID_TASK) {
    return { status: BLOCKED_EXTERNAL, reason: reason ?? 'blocked external' };
  }
  if (status === NO_TASK_FOR_GAP) {
    return {
      status: NO_EXECUTABLE_FRONTIER,
      reason: reason ?? 'no declared catalog task closes the selected frontier',
    };
  }
  if (status === NO_PROGRESS || status === BUDGET_EXHAUSTED) {
    return {
      status: PROOF_FAILED,
      reason: reason ?? `frontier execution did not close the criteria (${status})`,
    };
  }
  return {
    status: BLOCKED_EXTERNAL,
    reason: reason ?? `frontier execution ended with an unmapped status: ${String(status)}`,
  };
}

function createBuildResult(options) {
  return {
    status: null,
    reason: null,
    mode: BUILD_MODE,
    nextFrontierSelected: false,
    repositoryRoot: resolve(options.repositoryRoot ?? process.cwd()),
    remote: options.remote ?? 'origin',
    request: {
      source: null,
      declaredAuthority: [],
    },
    observedMain: null,
    mainMovement: 'UNKNOWN',
    authority: { declared: [], canonical: [] },
    selector: {
      status: null,
      reason: null,
      changedPaths: [],
      workspaceCleanup: 'NOT_CREATED',
      executor: null,
    },
    decision: null,
    goal: null,
    goalResult: null,
    childCalls: 0,
    elapsedMs: 0,
  };
}

function evaluateDeclaredAuthority({ paths, repositoryRoot, ref }) {
  const resolved = resolveAuthorityPaths({ repositoryRoot, ref, paths });
  const missing = resolved.filter((entry) => entry.objectType === null).map((entry) => entry.path);
  return { resolved, missing };
}

/**
 * One BUILD invocation: one natural-language request, one selected frontier,
 * one run-goal call, one finite terminal. Never selects a second frontier.
 */
export function runBuild(options = {}, deps = {}) {
  const log = deps.log ?? ((message) => process.stderr.write(`${message}\n`));
  const now = deps.now ?? (() => Date.now());
  const result = createBuildResult(options);
  const repositoryRoot = result.repositoryRoot;
  const remote = result.remote;
  const startedAt = now();
  const finish = (status, reason) => {
    result.status = status;
    result.reason = reason;
    result.childCalls = result.goalResult?.childCalls ?? 0;
    result.elapsedMs = Math.max(0, now() - startedAt);
    return result;
  };

  const requestText = readRequestText(options);
  if (!requestText.ok) {
    return finish(INVALID_BUILD_REQUEST, requestText.error);
  }
  result.request.source = requestText.source;
  const parsedRequest = parseBuildRequest(requestText.text);
  if (!parsedRequest.ok) {
    return finish(INVALID_BUILD_REQUEST, parsedRequest.reason);
  }
  result.request.mode = parsedRequest.mode;
  result.request.body = parsedRequest.body;

  let pin;
  try {
    pin = pinLiveMain({
      repositoryRoot,
      remote,
      readLiveMain: deps.readLiveMain ?? readLiveRemoteMain,
      fetchLiveMain: deps.fetchLiveMain ?? fetchBaseline,
    });
    result.observedMain = {
      remoteSha: pin.remoteSha,
      fetchedSha: pin.fetchedSha,
      stable: pin.stable,
      observations: [...pin.observations],
    };
  } catch (error) {
    return finish(BLOCKED_EXTERNAL, `live main could not be observed: ${messageOf(error)}`);
  }

  const tree = gitCapture(repositoryRoot, ['ls-tree', '--name-only', pin.fetchedSha], {
    allowFailure: true,
  });
  if (!tree.ok) {
    return finish(
      BLOCKED_EXTERNAL,
      `live main tree could not be observed at ${pin.fetchedSha}: ${messageOf(tree.error)}`,
    );
  }
  const topLevelEntries = tree.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const declaredAuthority = extractDeclaredAuthorityPaths({
    tokens: parsedRequest.backtickedTokens,
    topLevelEntries,
  });
  result.request.declaredAuthority = [...declaredAuthority];

  const declared = evaluateDeclaredAuthority({
    paths: declaredAuthority,
    repositoryRoot,
    ref: pin.fetchedSha,
  });
  result.authority.declared = declared.resolved;
  if (declared.missing.length > 0) {
    return finish(
      INVALID_BUILD_REQUEST,
      `declared BUILD request authority is missing at live main ${pin.fetchedSha}: ` +
        `${declared.missing.join(', ')}; no substitute authority was selected`,
    );
  }

  const canonicalAuthority = resolveAuthorityPaths({
    repositoryRoot,
    ref: pin.fetchedSha,
    paths: CANONICAL_AUTHORITY_POINTERS,
  })
    .filter((entry) => entry.objectType !== null)
    .map((entry) => entry.path);
  result.authority.canonical = [...canonicalAuthority];

  const selector = runFrontierSelector({
    buildRequest: parsedRequest.body,
    declaredAuthority,
    canonicalAuthority,
    repositoryRoot,
    pin,
    options,
    deps,
    log,
  });
  result.selector = {
    status: selector.status,
    reason: selector.reason,
    changedPaths: [...selector.changedPaths],
    workspaceCleanup: selector.workspaceCleanup,
    executor: { ...selector.executor },
    outputTail: selector.outputTail,
  };
  if (selector.status !== 'DECISION') {
    return finish(BLOCKED_EXTERNAL, `frontier selector failed: ${selector.reason}`);
  }

  const validation = validateFrontierDecision({
    decision: selector.decision,
    declaredAuthority,
    repositoryRoot,
    pin,
    options,
    deps,
    log,
  });
  result.decision = validation.ok
    ? {
        status: selector.decision.status,
        reason: validation.reason,
        authorityResolved: [...validation.authorityResolved],
        considered: (validation.considered ?? []).map((entry) => ({
          priority: entry.priority,
          id: entry.id,
          statement: entry.statement,
          kind: entry.kind,
          satisfied: entry.satisfied,
          evidence: entry.evidence,
          gapClass: entry.gapClass,
        })),
        selected: validation.selected ?? null,
        batch: validation.batch ?? null,
        escalationToken: validation.escalationToken ?? null,
      }
    : { status: selector.decision.status, reason: validation.reason, rejected: true };
  if (!validation.ok) {
    return finish(validation.terminal ?? BLOCKED_EXTERNAL, validation.reason);
  }
  if (validation.terminal !== null) {
    return finish(validation.terminal, validation.reason);
  }

  result.goal = {
    frontierId: validation.selected.id,
    frontierPriority: validation.selected.priority,
    frontierIds: (validation.batch?.admitted ?? [{ id: validation.selected.id }]).map(
      (frontier) => frontier.id,
    ),
    raw: validation.goal.raw,
    contract: validation.goal.contract,
  };

  let goalResult;
  try {
    goalResult = runGoal(
      {
        goalText: JSON.stringify(validation.goal.raw, null, 2),
        repositoryRoot,
        remote,
        title: options.title ?? null,
        model: options.model ?? null,
        agent: options.agent ?? null,
        opencodeBin: options.opencodeBin ?? null,
        opencodeTimeoutMs: options.opencodeTimeoutMs ?? DEFAULT_OPENCODE_TIMEOUT_MS,
        proofTimeoutMs: options.proofTimeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS,
        ciTimeoutMs: options.ciTimeoutMs ?? DEFAULT_CI_TIMEOUT_MS,
        maxRebindAttempts: options.maxRebindAttempts ?? DEFAULT_MAX_REBIND_ATTEMPTS,
        githubRepository: options.githubRepository ?? null,
      },
      deps,
    );
  } catch (error) {
    return finish(BLOCKED_EXTERNAL, `goal execution failed to start: ${messageOf(error)}`);
  }
  result.goalResult = goalResult;
  result.childCalls = goalResult?.childCalls ?? 0;
  const goalStart = goalResult?.liveMain?.atStart?.fetchedSha ?? null;
  result.mainMovement =
    goalStart === null || result.observedMain === null
      ? 'UNKNOWN'
      : goalStart === result.observedMain.fetchedSha
        ? 'UNCHANGED'
        : 'MOVED';

  const mapped = mapGoalResult(goalResult);
  return finish(mapped.status, mapped.reason);
}

export const USAGE = [
  'usage: node scripts/agent/run-build.mjs --request <file> [--repo <dir>] [--remote <name>]',
  '',
  '  --request <file>            BUILD request text; omit to read stdin',
  '  --repo <dir>                canonical checkout root (default: current directory)',
  '  --remote <name>             remote observed for live main (default: origin)',
  '  --title <title>             optional OpenCode session title for child tasks',
  '  --model <provider/model>    optional OpenCode model override for child tasks',
  '  --agent <name>              optional OpenCode agent override for child tasks',
  '  --opencode-bin <path>       explicit OpenCode executable for child tasks',
  '  --opencode-timeout-ms <n>   child/selector opencode timeout in ms (default: 3600000)',
  '  --proof-timeout-ms <n>      child/proof timeout in ms (default: 1800000, 0 disables)',
  '  --ci-timeout-ms <n>         child required-check watch timeout in ms (default: 2700000)',
  '  --max-rebind-attempts <n>   child fresh-main rebind constructions (default: 2)',
  '  --github-repo <owner/name>  optional explicit GitHub repository for child publication',
  '',
  'BUILD request shape:',
  '  MODE: BUILD',
  '  <natural-language outcome, authority order, frontier priority, preserve,',
  '   escalation conditions, stop condition>',
  '',
  'Backticked concrete repo-relative paths whose first segment is an actual top-level entry of',
  'live main are the declared authority set; including one that does not exist at live main',
  'fails the run closed before any executor invocation. The written Goal Contract is',
  'ephemeral and never stored.',
  '',
  'Prints one deterministic JSON result to stdout. Exit code 0 only for',
  'FRONTIER_COMPLETE or ALREADY_SATISFIED.',
].join('\n');

export function parseArgs(argv) {
  const options = {
    requestFile: null,
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
    '--request': 'requestFile',
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
  return { ok: true, options };
}

export function main(
  argv,
  { env = process.env, stdout = process.stdout, stderr = process.stderr, deps = {} } = {},
) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr.write(`${parsed.error}\n${USAGE}\n`);
    stdout.write(
      `${JSON.stringify({ status: INVALID_BUILD_REQUEST, reason: parsed.error }, null, 2)}\n`,
    );
    return 1;
  }
  if (parsed.options.help) {
    stderr.write(`${USAGE}\n`);
    return 0;
  }
  const result = runBuild(parsed.options, { ...deps, env });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const summary = [
    `[run-build] STATUS ${result.status}`,
    `[run-build] LIVE_MAIN ${result.observedMain?.fetchedSha ?? 'unknown'}`,
    `[run-build] FRONTIER ${result.decision?.selected?.id ?? 'none'}`,
    `[run-build] CHILD_CALLS ${result.childCalls}`,
    `[run-build] NEXT_FRONTIER_SELECTED ${result.nextFrontierSelected ? 'YES' : 'NO'}`,
  ].join('\n');
  stderr.write(`${summary}\n`);
  return result.status === FRONTIER_COMPLETE || result.status === ALREADY_SATISFIED ? 0 : 1;
}

const invokedAsMainScript =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMainScript) {
  process.exitCode = main(process.argv.slice(2));
}
