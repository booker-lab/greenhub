// Canonical owner: docs/specs/ops/development-authority.md sections 2, 6, 8, 9
// and AGENTS.md section 0 (bounded semantic task, nearest faithful proof,
// Git-native publication, thin stateless automation).
//
// BUILD-mode natural-language front door for the existing Goal-Constrained
// Development Loop. One invocation owns exactly one coherent product frontier:
//
//   BUILD request (MODE: BUILD + natural language)
//   -> fresh live `main` pin
//   -> declared-authority resolution at that exact SHA
//   -> one read-only frontier-selector invocation in a disposable workspace
//   -> deterministic validation of the selector decision
//   -> ephemeral Goal Contract (in memory, never a durable queue/registry)
//   -> the existing run-goal loop (run-once / run-publish-once / 5-way batch)
//   -> one finite BUILD terminal
//   -> stop, never select a next frontier
//
// This module owns composition of the natural-language front door only. It does
// not reimplement execution, admission, publication, or semantic-overlap
// detection; all of those stay with scripts/agent/run-goal.mjs,
// scripts/agent/run-once.mjs, and scripts/agent/run-publish-once.mjs.
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
  GOAL_CONTRACT_FIELDS,
  GOAL_SATISFIED,
  GOAL_TASK_FIELDS,
  HUMAN_DECISION_REQUIRED,
  HUMAN_ESCALATION_TOKENS,
  INVALID_GOAL,
  INVALID_TASK,
  isSafeRepoPath,
  MAX_BATCH_CONCURRENCY,
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

// ---------------------------------------------------------------------------
// Authoritative selector contract
// ---------------------------------------------------------------------------
// The generator-visible contract (`buildFrontierPrompt`) and the deterministic
// validators (`validateFrontierDecision` / `validateGeneratedGoal`) are both
// derived from the declarations below. A constraint must never be stated only
// in the prompt or enforced only by a validator literal: the prompt prints
// these exact field sets and limits, and the validator enforces exactly them.
// Malformed output stays fail closed; this layer never relaxes validation to
// raise the selector success rate.

export const SELECTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const SELECTOR_STATEMENT_MAX_CHARS = 2000;
export const SELECTOR_EVIDENCE_MAX_CHARS = 2000;
export const SELECTOR_WHY_SELECTED_MAX_CHARS = 2000;
export const SELECTOR_REASON_MAX_CHARS = 4000;
export const SELECTOR_GOAL_TEXT_MAX_CHARS = 20000;
export const SELECTOR_TASK_OUTCOME_MAX_CHARS = 2000;

// Ephemeral current-evidence classification (development-authority 9.2).
export const SELECTOR_RECONCILIATIONS = Object.freeze([
  'IMPLEMENTATION_GAP',
  'STALE_SPEC',
  'SEMANTIC_CONFLICT',
]);

export const SELECTOR_FIELD_SETS = Object.freeze({
  decision: Object.freeze([
    'status',
    'reason',
    'authority_resolved',
    'considered',
    'selected',
    'batch',
    'escalation_token',
  ]),
  considered: Object.freeze([
    'priority',
    'id',
    'statement',
    'kind',
    'criteria',
    'satisfied',
    'evidence',
    'reconciliation',
    'maintenance_justification',
  ]),
  selected: Object.freeze([
    'priority',
    'id',
    'statement',
    'kind',
    'why_selected',
    'maintenance_justification',
    'goal',
  ]),
  batchEntry: Object.freeze([
    'priority',
    'id',
    'kind',
    'why_selected',
    'maintenance_justification',
    'goal',
  ]),
  criterionByCheck: Object.freeze({
    PATH_PRESENT: Object.freeze(['id', 'statement', 'authority', 'check', 'class', 'path']),
    PATH_ABSENT: Object.freeze(['id', 'statement', 'authority', 'check', 'class', 'path']),
    DOC_TOKEN: Object.freeze(['id', 'statement', 'authority', 'check', 'class', 'path', 'token']),
    PROOF_AT_MAIN: Object.freeze(['id', 'statement', 'authority', 'check', 'class', 'command']),
  }),
  goal: GOAL_CONTRACT_FIELDS,
  task: GOAL_TASK_FIELDS,
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

function selectorContractLines() {
  return [
    '## Field contract (authoritative: the validator enforces exactly this)',
    `- identifier pattern for every frontier/criterion/task id: ${SELECTOR_ID_PATTERN.source}`,
    `- text limits (characters): statement <= ${SELECTOR_STATEMENT_MAX_CHARS},`,
    `  evidence <= ${SELECTOR_EVIDENCE_MAX_CHARS}, why_selected <= ${SELECTOR_WHY_SELECTED_MAX_CHARS},`,
    `  reason <= ${SELECTOR_REASON_MAX_CHARS}, goal GOAL <= ${SELECTOR_GOAL_TEXT_MAX_CHARS},`,
    `  task outcome <= ${SELECTOR_TASK_OUTCOME_MAX_CHARS}`,
    `- considered frontiers: 1..${MAX_CONSIDERED_FRONTIERS} entries, priorities exactly 1..N with no`,
    '  gaps and no duplicate ids',
    `- batch candidates: 0..${MAX_CONSIDERED_FRONTIERS - 1} entries; priorities strictly`,
    '  increasing and greater than selected.priority; selected + batch <=',
    `  ${MAX_CONSIDERED_FRONTIERS}`,
    `- decision fields: ${SELECTOR_FIELD_SETS.decision.join(', ')}`,
    `- considered entry fields: ${SELECTOR_FIELD_SETS.considered.join(', ')}`,
    `- selected fields: ${SELECTOR_FIELD_SETS.selected.join(', ')}`,
    `- batch entry fields: ${SELECTOR_FIELD_SETS.batchEntry.join(', ')}`,
    '- frontier independence: candidates are admitted in priority order; a candidate whose',
    '  tasks share semantic_owner, mutation allow surface, proof_owner against a sibling',
    '  mutation surface, or depends_on with an already-admitted candidate is deferred to the',
    '  next live-main recomputation instead of starting concurrently',
    '- criterion fields by check:',
    ...BUILD_CRITERION_CHECKS.map(
      (check) => `  - ${check}: ${SELECTOR_FIELD_SETS.criterionByCheck[check].join(', ')}`,
    ),
    `- goal contract fields: ${SELECTOR_FIELD_SETS.goal.join(', ')}`,
    `- task fields: ${SELECTOR_FIELD_SETS.task.join(', ')}`,
    '- selected.kind must equal the considered frontier kind',
    '- goal CRITERIA must be exactly the selected considered frontier criteria (same ids,',
    '  statements, authorities, checks, and check-specific fields)',
    '- each task: allow declares at least one path, closes at least one criterion, proof at',
    '  least one command; proof_owner is index-positional with proof when present',
    '- AUTONOMOUSLY_ALLOWED declares at least one path; BUDGET values are non-negative integers',
    `- reconciliation is required when satisfied is false and must be one of: ${SELECTOR_RECONCILIATIONS.join(', ')}`,
    '- unknown fields at any level reject the decision (there is no tolerant extra-field mode)',
  ];
}

/**
 * The exact Goal Contract the build layer must consult. The generator (selector
 * prompt) and this validator see the same field set.
 */
export function buildFrontierPrompt({ buildRequest, declaredAuthority, canonicalAuthority, pin }) {
  const sha = pin.fetchedSha;
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
    'Read the current authority in this workspace and select exactly one currently-open',
    'product frontier that is autonomously closable inside the BUILD request boundaries.',
    '',
    '## Rules',
    `1. Authority is current truth only: files that exist at live main ${sha}.`,
    '   Never promote a historical TODO, backlog, report, completed plan, archive, or',
    '   discussion into frontier authority. Historical paths are docs/archive/**,',
    '   docs/discussions/**, docs/plans/**, docs/reports/**, and any PLAN_*/REPORT_*/',
    '   PROMPT_* file. They must not appear in ACCEPTANCE_AUTHORITY, criterion authority,',
    '   task allow, task semantic_owner, or task proof_owner unless the BUILD REQUEST',
    '   names that exact path.',
    '2. A frontier is open only when live main does not already satisfy it. Its criteria',
    '   are deterministic checks; the runner re-evaluates every satisfied/unsatisfied',
    '   claim at live main and rejects a mismatch, then does not invoke any executor.',
    '3. The BUILD REQUEST priority list is a ranking, not one frontier per entry. Group it',
    `   into at most ${MAX_CONSIDERED_FRONTIERS} considered frontiers, preserving the same`,
    '   relative order when the request names more than that many priorities. Considered',
    '   priorities must be exactly 1..N with no gaps and must not exceed',
    `   ${MAX_CONSIDERED_FRONTIERS}, and the selected frontier must be the lowest-numbered`,
    '   considered frontier whose criteria are not all satisfied.',
    '4. A considered frontier is PRODUCT by default. selected.kind must equal the considered',
    '   frontier kind. MAINTENANCE is allowed only when every considered PRODUCT frontier is',
    '   already satisfied and the selected maintenance_justification names the real blocker.',
    '5. Semantic gate. Return HUMAN_DECISION_REQUIRED instead of a frontier when closing',
    '   it would create new product meaning, choose a UX/product policy fork, decide',
    '   security/privacy authority, decide clinical/safety/financial/legal policy, perform',
    '   an irreversible external action, or change acceptance meaning.',
    '6. Reconcile current evidence before declaring a frontier open. For every considered',
    `   frontier, compare the current authority against the current implementation and the`,
    '   nearest faithful direct proof, then set reconciliation to exactly one of:',
    '   - IMPLEMENTATION_GAP: the intended contract has a real implementation or proof gap.',
    '   - STALE_SPEC: current spec text, current implementation, and direct proof all point',
    '     at the same contract and only the spec wording is behind. STALE_SPEC is not a',
    '     product gap; a selected STALE_SPEC frontier closes by syncing the authoritative',
    '     spec line and must not change runtime behavior. STALE_SPEC requires an evidence',
    '     string naming the implementation and the direct proof that already exist.',
    '   - SEMANTIC_CONFLICT: spec and implementation claim different contracts. Do not',
    '     choose this as a frontier; return HUMAN_DECISION_REQUIRED instead.',
    '   Existing code alone never makes a spec stale, and an existing test alone never',
    '   changes the intended contract. All three sources must agree.',
    '7. Criteria use only the checks PATH_PRESENT, PATH_ABSENT, DOC_TOKEN, PROOF_AT_MAIN and',
    '   class AUTONOMOUS. Every criterion authority path must already exist at live main,',
    '   and authority_resolved must list every authority path the BUILD REQUEST names plus',
    '   every criterion authority path. A DOC_TOKEN criterion declares both its path and its',
    '   token. A PROOF_AT_MAIN command runs in a disposable live-main worktree with no',
    '   installed project dependencies, so it must be self-contained (for example',
    '   `node --test` against a dependency-free spec). A behavior check that needs the',
    '   project toolchain belongs in a task `proof` command instead: task proof runs in the',
    '   task workspace after the task may have installed what it needs.',
    '8. Every task must declare publication "required", at least one proof command, and',
    '   non-empty commit_message and pr_title. Its allow, semantic_owner, and proof_owner',
    '   paths must all stay inside AUTONOMOUSLY_ALLOWED, and the union of task closes must',
    '   be exactly the selected criteria.',
    '9. PLANNER.enabled must be false. The runner never enables a second generator.',
    '10. Every ACCEPTANCE_AUTHORITY path must exist as a file (blob) at live main.',
    '    ACCEPTANCE_AUTHORITY must include every path the BUILD REQUEST names and every',
    '    criterion authority path that exists as a blob at live main.',
    '11. Do not invent fields. Unknown fields at any level reject the decision.',
    '12. Batch candidates. You may add up to 4 additional open frontiers to "batch" so one',
    '    invocation can close several independent frontiers in one bounded batch. Batch',
    '    priorities must strictly increase and stay greater than selected.priority. The runner',
    '    computes pairwise independence from declared semantic_owner, mutation allow surface,',
    '    proof_owner, and depends_on: a candidate overlapping an already-admitted candidate is',
    '    not started in this batch and stays for the next live-main recomputation, and it is',
    '    never failed for being deferred. Do not propose a candidate whose tasks depend on',
    '    another proposed frontier. A failing candidate never cancels an already-started',
    '    independent sibling. Every batch entry uses the same goal contract shape as selected.',
    '',
    '## Required output',
    'Return exactly one JSON object and nothing else: no markdown fence, no commentary, no',
    'second payload. Allowed shapes:',
    '{"status":"FRONTIER","reason":"...","authority_resolved":["repo/path"],"considered":[{"priority":1,"id":"...","statement":"...","kind":"PRODUCT","criteria":[{"id":"...","statement":"...","authority":["repo/path"],"check":"PATH_PRESENT","class":"AUTONOMOUS","path":"repo/path"}],"satisfied":false,"reconciliation":"IMPLEMENTATION_GAP"}],"selected":{"priority":1,"id":"...","statement":"...","kind":"PRODUCT","why_selected":"...","goal":{"GOAL":"...","ACCEPTANCE_AUTHORITY":["repo/path"],"PRESERVE":["..."],"AUTONOMOUSLY_ALLOWED":["repo/path"],"ESCALATE_IF":["PRODUCT_POLICY_FORK"],"STOP_WHEN":["..."],"CRITERIA":[{"id":"...","statement":"...","authority":["repo/path"],"check":"PATH_PRESENT","class":"AUTONOMOUS","path":"repo/path"}],"TASK_CATALOG":[{"id":"...","outcome":"...","preserve":"...","closes":["criterion-id"],"allow":["repo/path"],"proof":["node --test ..."],"proof_owner":[["repo/path"]],"semantic_owner":["repo/path"],"publication":"required","commit_message":"...","pr_title":"...","escalate_only_if":[],"depends_on":[]}],"PLANNER":{"enabled":false},"BUDGET":{"max_iterations":2,"max_tasks":3}}}}',
    '{"status":"ALREADY_SATISFIED","reason":"...","authority_resolved":["repo/path"],"considered":[{"priority":1,"id":"...","statement":"...","kind":"PRODUCT","criteria":[...],"satisfied":true,"evidence":"..."}]}',
    '{"status":"NO_EXECUTABLE_FRONTIER","reason":"...","authority_resolved":["repo/path"]}',
    '{"status":"HUMAN_DECISION_REQUIRED","reason":"...","escalation_token":"...","authority_resolved":["repo/path"]}',
    '{"status":"BLOCKED_EXTERNAL","reason":"...","authority_resolved":["repo/path"]}',
    'Optional additional independent candidates on a FRONTIER decision:',
    '"batch":[{"priority":2,"id":"...","kind":"PRODUCT","why_selected":"...","goal":{...same goal contract as selected...}}]',
    '',
    ...selectorContractLines(),
    '',
    'A considered entry with satisfied true must carry a non-empty "evidence" string.',
    'A STALE_SPEC considered entry must also carry its contradiction evidence string.',
    'HUMAN_DECISION_REQUIRED escalation_token must be one of: ' +
      HUMAN_ESCALATION_TOKENS.join(', ') +
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

function unknownFieldReason(value, allowed, field) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  return extra.length > 0 ? `${field} contains unsupported field(s): ${extra.join(', ')}` : null;
}

function selectorIdentifierReason(value, field) {
  if (typeof value !== 'string' || !SELECTOR_ID_PATTERN.test(value.trim())) {
    return `${field} must match ${SELECTOR_ID_PATTERN.source}`;
  }
  return null;
}

function textLimitReason(value, limit, field) {
  if (typeof value === 'string' && value.length > limit) {
    return `${field} must be at most ${limit} characters`;
  }
  return null;
}

/** Unknown fields on a criterion are rejected by its check's field set. */
function strictCriterionFieldReason(criteria, field) {
  if (!Array.isArray(criteria)) return null;
  for (let index = 0; index < criteria.length; index += 1) {
    const criterion = criteria[index];
    if (!isPlainObject(criterion)) continue;
    const allowed = SELECTOR_FIELD_SETS.criterionByCheck[criterion.check];
    if (allowed === undefined) continue;
    const reason = unknownFieldReason(criterion, allowed, `${field}[${index}]`);
    if (reason !== null) return reason;
  }
  return null;
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
  if (!synthetic.ok) return null;
  return [...synthetic.contract.criteria].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

function validateCriterionSet({ criteria, field }) {
  const strictReason = strictCriterionFieldReason(criteria, field);
  if (strictReason !== null) return { ok: false, reason: strictReason };
  const normalized = canonicalCriteria(criteria);
  if (normalized === null) {
    return { ok: false, reason: `${field} contains invalid criterion entries` };
  }
  if (normalized.length === 0) {
    return { ok: false, reason: `${field} must declare at least one criterion` };
  }
  for (const criterion of normalized) {
    if (criterion.class !== 'AUTONOMOUS') {
      return {
        ok: false,
        reason: `${field} criterion ${criterion.id} must be class AUTONOMOUS for a BUILD frontier`,
      };
    }
    if (!BUILD_CRITERION_CHECKS.includes(criterion.check)) {
      return {
        ok: false,
        reason: `${field} criterion ${criterion.id} check must be one of ${BUILD_CRITERION_CHECKS.join(', ')}`,
      };
    }
  }
  return { ok: true, criteria: normalized };
}

function validateConsideredEntries({ value, authorityResolved }) {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, reason: 'considered must be a non-empty array' };
  }
  if (value.length > MAX_CONSIDERED_FRONTIERS) {
    return {
      ok: false,
      reason: `considered must contain at most ${MAX_CONSIDERED_FRONTIERS} frontiers`,
    };
  }
  const entries = [];
  const ids = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    const label = `considered[${index}]`;
    if (!isPlainObject(raw)) return { ok: false, reason: `${label} must be an object` };
    const extra = unknownFieldReason(raw, SELECTOR_FIELD_SETS.considered, label);
    if (extra !== null) return { ok: false, reason: extra };
    if (raw.priority !== index + 1) {
      return {
        ok: false,
        reason: `${label} priority must be ${index + 1} in request priority order`,
      };
    }
    const idReason = selectorIdentifierReason(raw.id, `${label} id`);
    if (idReason !== null) return { ok: false, reason: idReason };
    if (ids.has(raw.id.trim()))
      return { ok: false, reason: `${label} id is duplicated: ${raw.id}` };
    ids.add(raw.id.trim());
    if (!isNonEmptyString(raw.statement)) {
      return { ok: false, reason: `${label} statement must be a non-empty string` };
    }
    const statementReason = textLimitReason(
      raw.statement,
      SELECTOR_STATEMENT_MAX_CHARS,
      `${label} statement`,
    );
    if (statementReason !== null) return { ok: false, reason: statementReason };
    if (!FRONTIER_KINDS.includes(raw.kind)) {
      return { ok: false, reason: `${label} kind must be one of ${FRONTIER_KINDS.join(', ')}` };
    }
    if (typeof raw.satisfied !== 'boolean') {
      return { ok: false, reason: `${label} satisfied must be a boolean` };
    }
    if (raw.satisfied && !isNonEmptyString(raw.evidence)) {
      return { ok: false, reason: `${label} requires a non-empty evidence string when satisfied` };
    }
    const evidenceReason = textLimitReason(
      raw.evidence,
      SELECTOR_EVIDENCE_MAX_CHARS,
      `${label} evidence`,
    );
    if (evidenceReason !== null) return { ok: false, reason: evidenceReason };
    if (raw.kind === 'MAINTENANCE' && !isNonEmptyString(raw.maintenance_justification)) {
      return { ok: false, reason: `${label} MAINTENANCE requires a maintenance_justification` };
    }
    const reconciliation = raw.reconciliation;
    if (raw.satisfied === false) {
      if (!SELECTOR_RECONCILIATIONS.includes(reconciliation)) {
        return {
          ok: false,
          reason:
            `${label} reconciliation must be one of ${SELECTOR_RECONCILIATIONS.join(', ')} ` +
            'when satisfied is false',
        };
      }
    } else if (reconciliation != null && !SELECTOR_RECONCILIATIONS.includes(reconciliation)) {
      return {
        ok: false,
        reason: `${label} reconciliation must be one of ${SELECTOR_RECONCILIATIONS.join(', ')}`,
      };
    }
    if (raw.satisfied !== false && reconciliation === 'STALE_SPEC') {
      return { ok: false, reason: `${label} STALE_SPEC cannot be satisfied at live main` };
    }
    if (reconciliation === 'STALE_SPEC' && !isNonEmptyString(raw.evidence)) {
      return {
        ok: false,
        reason:
          `${label} STALE_SPEC requires an evidence string naming the current implementation ` +
          'and direct proof that contradict the spec text',
      };
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
    entries.push({
      priority: raw.priority,
      id: raw.id.trim(),
      statement: raw.statement.trim(),
      kind: raw.kind,
      criteria: criteriaValidation.criteria,
      satisfied: raw.satisfied,
      evidence: isNonEmptyString(raw.evidence) ? raw.evidence.trim() : null,
      reconciliation: reconciliation ?? null,
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

export function validateGeneratedGoal({
  goal,
  selectedEntry,
  declaredAuthority,
  repositoryRoot,
  pin,
}) {
  const reject = (reason) => ({ ok: false, reason });
  if (!isPlainObject(goal)) return reject('ephemeral Goal Contract must be a JSON object');
  const extraGoalFields = unknownFieldReason(goal, SELECTOR_FIELD_SETS.goal, 'Goal Contract');
  if (extraGoalFields !== null) return reject(extraGoalFields);
  const goalTextReason = textLimitReason(
    goal.GOAL,
    SELECTOR_GOAL_TEXT_MAX_CHARS,
    'Goal Contract GOAL',
  );
  if (goalTextReason !== null) return reject(goalTextReason);
  const criterionFieldsReason = strictCriterionFieldReason(goal.CRITERIA, 'Goal Contract CRITERIA');
  if (criterionFieldsReason !== null) return reject(criterionFieldsReason);
  if (Array.isArray(goal.TASK_CATALOG)) {
    for (let index = 0; index < goal.TASK_CATALOG.length; index += 1) {
      const task = goal.TASK_CATALOG[index];
      if (!isPlainObject(task)) continue;
      const taskExtra = unknownFieldReason(task, SELECTOR_FIELD_SETS.task, `task[${index}]`);
      if (taskExtra !== null) return reject(taskExtra);
      const taskIdReason = selectorIdentifierReason(task.id, `task[${index}] id`);
      if (taskIdReason !== null) return reject(taskIdReason);
      const outcomeReason = textLimitReason(
        task.outcome,
        SELECTOR_TASK_OUTCOME_MAX_CHARS,
        `task ${task.id ?? index} outcome`,
      );
      if (outcomeReason !== null) return reject(outcomeReason);
    }
  }
  const validation = validateGoalContract(goal);
  if (!validation.ok) {
    return reject(
      `ephemeral Goal Contract is invalid (${validation.kind}): ${validation.errors.join('; ')}`,
    );
  }
  const contract = validation.contract;
  const core = validateBuildContractCore({
    contract,
    declaredAuthority,
    repositoryRoot,
    pin,
    expectedCriteria: selectedEntry.criteria,
  });
  if (!core.ok) return core;
  return { ok: true, contract };
}

/**
 * Shared BUILD-mode contract core: criterion/task shape, closure, declared
 * boundaries, historical-path exclusion, and live-main blob existence. When
 * `expectedCriteria` is provided, the contract criteria must be exactly them
 * (one frontier); a composed batch contract passes `null` because the union is
 * already the validated concatenation of per-frontier criteria.
 */
function validateBuildContractCore({
  contract,
  declaredAuthority,
  repositoryRoot,
  pin,
  expectedCriteria = null,
}) {
  const reject = (reason) => ({ ok: false, reason });
  if (contract.criteria.length === 0) {
    return reject('ephemeral Goal Contract must declare at least one criterion');
  }
  for (const criterion of contract.criteria) {
    const criterionIdReason = selectorIdentifierReason(criterion.id, `criterion ${criterion.id} id`);
    if (criterionIdReason !== null) return reject(criterionIdReason);
    if (criterion.class !== 'AUTONOMOUS') {
      return reject(`criterion ${criterion.id} must be class AUTONOMOUS for a BUILD frontier`);
    }
    if (!BUILD_CRITERION_CHECKS.includes(criterion.check)) {
      return reject(
        `criterion ${criterion.id} check must be one of ${BUILD_CRITERION_CHECKS.join(', ')}`,
      );
    }
  }
  if (contract.task_catalog.length === 0) {
    return reject('ephemeral Goal Contract must declare at least one task');
  }
  if (contract.planner.enabled) {
    return reject('ephemeral Goal Contract must not enable PLANNER');
  }
  if (contract.autonomously_allowed.length === 0) {
    return reject('AUTONOMOUSLY_ALLOWED must declare at least one path');
  }
  if (expectedCriteria !== null) {
    const expected = JSON.stringify(
      [...expectedCriteria].sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      ),
    );
    const actual = JSON.stringify(
      [...contract.criteria].sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      ),
    );
    if (actual !== expected) {
      return reject('CRITERIA must be exactly the selected considered frontier criteria');
    }
  }
  const criterionIds = new Set(contract.criteria.map((criterion) => criterion.id));
  const closed = new Set();
  for (const task of contract.task_catalog) {
    if (task.publication !== 'required') {
      return reject(`task ${task.id} must declare publication "required" in BUILD mode`);
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
  return { ok: true };
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function acceptanceCompletenessReason({ goalContract, declaredAuthority, resolution }) {
  const blobPaths = new Set(
    resolution.filter((entry) => entry.objectType === 'blob').map((entry) => entry.path),
  );
  const required = [
    ...new Set([
      ...declaredAuthority,
      ...goalContract.criteria.flatMap((criterion) => criterion.authority),
    ]),
  ].filter((path) => blobPaths.has(path));
  const missing = required.filter((path) => !goalContract.acceptance_authority.includes(path));
  if (missing.length === 0) return null;
  return (
    'ACCEPTANCE_AUTHORITY must include every blob the BUILD REQUEST names and every criterion ' +
    `authority blob: ${missing.join(', ')}`
  );
}

/**
 * Deterministic frontier-level admission for one bounded batch. Candidates are
 * evaluated in priority order and the same declared-overlap contract the task
 * batch uses (`semantic_owner`, mutation allow surface, `proof_owner` against a
 * sibling mutation surface, `depends_on`) decides whether a candidate may start
 * with the already-admitted ones. Deferred candidates are reported with the
 * exact dimension and stay for the next live-main recomputation; they are never
 * failed for being deferred.
 */
export function admitFrontierBatch({ candidates, maxFrontiers = MAX_BATCH_CONCURRENCY }) {
  const admitted = [];
  const deferred = [];
  for (const candidate of candidates) {
    if (admitted.length >= maxFrontiers) {
      deferred.push({
        priority: candidate.priority,
        id: candidate.id,
        kind: 'CONCURRENCY_LIMIT',
        withPriority: null,
        withId: null,
        reason: `frontier batch limit ${maxFrontiers} reached`,
      });
      continue;
    }
    let conflict = null;
    for (const existing of admitted) {
      for (const task of candidate.goal.task_catalog) {
        for (const sibling of existing.goal.task_catalog) {
          const found = taskConflict(task, sibling);
          if (found !== null) {
            conflict = { ...found, withPriority: existing.priority, withId: existing.id };
            break;
          }
        }
        if (conflict !== null) break;
      }
      if (conflict !== null) break;
    }
    if (conflict === null) {
      admitted.push(candidate);
    } else {
      deferred.push({
        priority: candidate.priority,
        id: candidate.id,
        kind: conflict.kind,
        withPriority: conflict.withPriority,
        withId: conflict.withId,
        reason: conflict.reason,
      });
    }
  }
  return { admitted, deferred };
}

/**
 * Compose the single ephemeral Goal Contract for one admitted frontier batch.
 * Every admitted candidate already passed per-frontier validation; the union
 * re-validates the combined criteria/task ids, boundaries, historical paths,
 * and live-main blobs before anything is handed to run-goal.
 */
function composeBatchGoal({ admitted, declaredAuthority, repositoryRoot, pin }) {
  const raw = {
    GOAL: admitted.map((candidate) => `[${candidate.id}] ${candidate.goal.goal}`).join('\n'),
    ACCEPTANCE_AUTHORITY: uniqueStrings(
      admitted.flatMap((candidate) => candidate.goal.acceptance_authority),
    ),
    PRESERVE: uniqueStrings(admitted.flatMap((candidate) => candidate.goal.preserve)),
    AUTONOMOUSLY_ALLOWED: uniqueStrings(
      admitted.flatMap((candidate) => candidate.goal.autonomously_allowed),
    ),
    ESCALATE_IF: uniqueStrings(admitted.flatMap((candidate) => candidate.goal.escalate_if)),
    STOP_WHEN: uniqueStrings(admitted.flatMap((candidate) => candidate.goal.stop_when)),
    CRITERIA: admitted.flatMap((candidate) => candidate.goal.criteria),
    TASK_CATALOG: admitted.flatMap((candidate) => candidate.goal.task_catalog),
    PLANNER: { enabled: false },
    BUDGET: {
      max_iterations: admitted.reduce(
        (total, candidate) => total + candidate.goal.budget.max_iterations,
        0,
      ),
      max_tasks: admitted.reduce((total, candidate) => total + candidate.goal.budget.max_tasks, 0),
      max_wall_clock_ms: admitted.reduce(
        (longest, candidate) => Math.max(longest, candidate.goal.budget.max_wall_clock_ms),
        0,
      ),
    },
  };
  const composedGoalTextReason = textLimitReason(
    raw.GOAL,
    SELECTOR_GOAL_TEXT_MAX_CHARS,
    'composed Goal Contract GOAL',
  );
  if (composedGoalTextReason !== null) return { ok: false, reason: composedGoalTextReason };
  const validation = validateGoalContract(raw);
  if (!validation.ok) {
    return {
      ok: false,
      reason: `composed batch Goal Contract is invalid (${validation.kind}): ${validation.errors.join('; ')}`,
    };
  }
  const core = validateBuildContractCore({
    contract: validation.contract,
    declaredAuthority,
    repositoryRoot,
    pin,
  });
  if (!core.ok) return core;
  return { ok: true, raw, contract: validation.contract };
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
  if (!SELECTOR_DECISIONS.includes(decision.status)) {
    return reject(`selector status must be one of ${SELECTOR_DECISIONS.join(', ')}`);
  }
  if (!isNonEmptyString(decision.reason)) {
    return reject('selector reason must be a non-empty string');
  }
  const reasonReason = textLimitReason(
    decision.reason,
    SELECTOR_REASON_MAX_CHARS,
    'selector reason',
  );
  if (reasonReason !== null) return reject(reasonReason);
  const extraTop = unknownFieldReason(decision, SELECTOR_FIELD_SETS.decision, 'selector decision');
  if (extraTop !== null) return reject(extraTop);

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
    if (decision.batch != null) {
      return reject('HUMAN_DECISION_REQUIRED must not carry a frontier batch');
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
    if (decision.batch != null) {
      return reject(`${decision.status} must not carry a frontier batch`);
    }
    if (decision.considered != null) {
      const considered = validateConsideredEntries({
        value: decision.considered,
        authorityResolved: resolvedSet,
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

  if (decision.status === 'ALREADY_SATISFIED') {
    if (decision.selected != null) {
      return reject('ALREADY_SATISFIED must not carry a selected frontier');
    }
    if (decision.batch != null) {
      return reject('ALREADY_SATISFIED must not carry a frontier batch');
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
  const extraSelected = unknownFieldReason(selected, SELECTOR_FIELD_SETS.selected, 'selected');
  if (extraSelected !== null) return reject(extraSelected);
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
  const whySelectedReason = textLimitReason(
    selected.why_selected,
    SELECTOR_WHY_SELECTED_MAX_CHARS,
    'selected.why_selected',
  );
  if (whySelectedReason !== null) return reject(whySelectedReason);
  if (!FRONTIER_KINDS.includes(selected.kind)) {
    return reject(`selected.kind must be one of ${FRONTIER_KINDS.join(', ')}`);
  }
  if (selected.kind !== selectedEntry.kind) {
    return reject(
      `selected.kind ${selected.kind} must equal the considered frontier kind ${selectedEntry.kind}`,
    );
  }
  if (selectedEntry.reconciliation === 'SEMANTIC_CONFLICT') {
    return {
      ok: true,
      terminal: HUMAN_DECISION_REQUIRED,
      reason:
        `considered frontier ${selectedEntry.id} is classified SEMANTIC_CONFLICT: current spec ` +
        'and current implementation claim different contracts, which is a human decision',
      authorityResolved,
      escalationToken: 'ACCEPTANCE_MEANING_CHANGE',
    };
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
  if (!isPlainObject(selected.goal)) {
    return reject('selected.goal must be an object');
  }
  const goalValidation = validateGeneratedGoal({
    goal: selected.goal,
    selectedEntry,
    declaredAuthority,
    repositoryRoot,
    pin,
  });
  if (!goalValidation.ok) return reject(goalValidation.reason);
  const selectedCompleteness = acceptanceCompletenessReason({
    goalContract: goalValidation.contract,
    declaredAuthority,
    resolution,
  });
  if (selectedCompleteness !== null) return reject(selectedCompleteness);
  const selectedCandidate = {
    priority: selectedEntry.priority,
    id: selectedEntry.id,
    kind: selected.kind,
    whySelected: selected.why_selected.trim(),
    maintenanceJustification: isNonEmptyString(selected.maintenance_justification)
      ? selected.maintenance_justification.trim()
      : null,
    entry: selectedEntry,
    goal: goalValidation.contract,
    rawGoal: selected.goal,
  };

  const batchValidation = validateBatchCandidates({
    value: decision.batch,
    consideredEntries: considered.entries,
    selectedEntry,
    declaredAuthority,
    resolution,
    repositoryRoot,
    pin,
  });
  if (!batchValidation.ok) {
    if (batchValidation.terminal !== undefined) {
      return {
        ok: true,
        terminal: batchValidation.terminal,
        reason: batchValidation.reason,
        authorityResolved,
        escalationToken: batchValidation.escalationToken ?? null,
      };
    }
    return reject(batchValidation.reason);
  }

  const admission = admitFrontierBatch({
    candidates: [selectedCandidate, ...batchValidation.candidates],
  });
  const composed = composeBatchGoal({
    admitted: admission.admitted,
    declaredAuthority,
    repositoryRoot,
    pin,
  });
  if (!composed.ok) return reject(composed.reason);

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
      whySelected: selected.why_selected.trim(),
      maintenanceJustification: selectedCandidate.maintenanceJustification,
      entry: selectedEntry,
    },
    batch: batchValidation.candidates.map((candidate) => ({
      priority: candidate.priority,
      id: candidate.id,
      kind: candidate.kind,
      entry: candidate.entry,
    })),
    admission: {
      admitted: admission.admitted.map((candidate) => ({
        priority: candidate.priority,
        id: candidate.id,
        kind: candidate.kind,
      })),
      deferred: admission.deferred,
    },
    goal: {
      raw: composed.raw,
      contract: composed.contract,
      frontierIds: admission.admitted.map((candidate) => candidate.id),
    },
  };
}

/**
 * Validate the optional `batch` candidate list on a FRONTIER decision. Each
 * entry names an open considered frontier and carries the same validated goal
 * contract shape as `selected`. Structural violations fail closed; a
 * SEMANTIC_CONFLICT candidate resolves to a human-decision terminal instead.
 */
function validateBatchCandidates({
  value,
  consideredEntries,
  selectedEntry,
  declaredAuthority,
  resolution,
  repositoryRoot,
  pin,
}) {
  if (value == null) return { ok: true, candidates: [] };
  if (!Array.isArray(value)) return { ok: false, reason: 'batch must be an array when present' };
  if (value.length > MAX_CONSIDERED_FRONTIERS - 1) {
    return {
      ok: false,
      reason: `batch must contain at most ${MAX_CONSIDERED_FRONTIERS - 1} candidates`,
    };
  }
  const candidates = [];
  let previousPriority = selectedEntry.priority;
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    const label = `batch[${index}]`;
    if (!isPlainObject(raw)) return { ok: false, reason: `${label} must be an object` };
    const extra = unknownFieldReason(raw, SELECTOR_FIELD_SETS.batchEntry, label);
    if (extra !== null) return { ok: false, reason: extra };
    if (!Number.isInteger(raw.priority) || raw.priority <= previousPriority) {
      return {
        ok: false,
        reason: `${label} priority must be an integer greater than the previous candidate priority`,
      };
    }
    previousPriority = raw.priority;
    const entry = consideredEntries.find((candidate) => candidate.priority === raw.priority);
    if (entry === undefined) {
      return {
        ok: false,
        reason: `${label} priority ${raw.priority} does not match a considered frontier`,
      };
    }
    if (!isNonEmptyString(raw.id) || raw.id.trim() !== entry.id) {
      return { ok: false, reason: `${label} id must equal the considered frontier id at its priority` };
    }
    if (entry.satisfied) {
      return { ok: false, reason: `${label} frontier ${entry.id} is already satisfied at live main` };
    }
    if (!isNonEmptyString(raw.why_selected)) {
      return { ok: false, reason: `${label} why_selected must be a non-empty string` };
    }
    const whyReason = textLimitReason(
      raw.why_selected,
      SELECTOR_WHY_SELECTED_MAX_CHARS,
      `${label} why_selected`,
    );
    if (whyReason !== null) return { ok: false, reason: whyReason };
    if (!FRONTIER_KINDS.includes(raw.kind)) {
      return { ok: false, reason: `${label} kind must be one of ${FRONTIER_KINDS.join(', ')}` };
    }
    if (raw.kind !== entry.kind) {
      return {
        ok: false,
        reason: `${label} kind ${raw.kind} must equal the considered frontier kind ${entry.kind}`,
      };
    }
    if (raw.kind === 'MAINTENANCE') {
      if (!isNonEmptyString(raw.maintenance_justification)) {
        return { ok: false, reason: `${label} MAINTENANCE requires a maintenance_justification` };
      }
      const openProduct = consideredEntries.filter(
        (candidate) => candidate.kind === 'PRODUCT' && !candidate.satisfied,
      );
      if (openProduct.length > 0) {
        return {
          ok: false,
          reason: `${label} MAINTENANCE is only allowed when no PRODUCT frontier is open`,
        };
      }
    }
    if (entry.reconciliation === 'SEMANTIC_CONFLICT') {
      return {
        ok: false,
        terminal: HUMAN_DECISION_REQUIRED,
        reason:
          `batch candidate ${entry.id} is classified SEMANTIC_CONFLICT: current spec and ` +
          'current implementation claim different contracts, which is a human decision',
        escalationToken: 'ACCEPTANCE_MEANING_CHANGE',
      };
    }
    if (!isPlainObject(raw.goal)) {
      return { ok: false, reason: `${label} goal must be an object` };
    }
    const goalValidation = validateGeneratedGoal({
      goal: raw.goal,
      selectedEntry: entry,
      declaredAuthority,
      repositoryRoot,
      pin,
    });
    if (!goalValidation.ok) return { ok: false, reason: goalValidation.reason };
    const completeness = acceptanceCompletenessReason({
      goalContract: goalValidation.contract,
      declaredAuthority,
      resolution,
    });
    if (completeness !== null) return { ok: false, reason: completeness };
    candidates.push({
      priority: entry.priority,
      id: entry.id,
      kind: raw.kind,
      whySelected: raw.why_selected.trim(),
      maintenanceJustification: isNonEmptyString(raw.maintenance_justification)
        ? raw.maintenance_justification.trim()
        : null,
      entry,
      goal: goalValidation.contract,
      rawGoal: raw.goal,
    });
  }
  return { ok: true, candidates };
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
    batch: { admitted: [], deferred: [] },
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
          reconciliation: entry.reconciliation,
        })),
        selected: validation.selected ?? null,
        batch: (validation.batch ?? []).map((candidate) => ({
          priority: candidate.priority,
          id: candidate.id,
          kind: candidate.kind,
        })),
        escalationToken: validation.escalationToken ?? null,
      }
    : { status: selector.decision.status, reason: validation.reason, rejected: true };
  if (!validation.ok) {
    return finish(validation.terminal ?? BLOCKED_EXTERNAL, validation.reason);
  }
  if (validation.terminal !== null) {
    return finish(validation.terminal, validation.reason);
  }

  result.batch = {
    admitted: (validation.admission?.admitted ?? []).map((candidate) => ({ ...candidate })),
    deferred: (validation.admission?.deferred ?? []).map((candidate) => ({ ...candidate })),
  };
  result.goal = {
    frontierId: validation.selected.id,
    frontierPriority: validation.selected.priority,
    frontierIds: [...(validation.goal.frontierIds ?? [validation.selected.id])],
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
  'One selector decision may propose up to five open frontiers (selected + batch); the runner',
  'admits only pairwise-independent candidates into the existing bounded batch executor and',
  'leaves overlapping candidates for the next live-main recomputation.',
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
    `[run-build] BATCH admitted=${result.batch?.admitted?.length ?? 0} deferred=${result.batch?.deferred?.length ?? 0}`,
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
