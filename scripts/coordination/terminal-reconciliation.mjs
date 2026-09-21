// Bounded read+derive owner: GREENHUB-COORDINATION-TERMINAL-RECONCILIATION-GF04.
// Surface: scripts/coordination/*terminal-reconciliation* (this module + its
// proof spec) ONLY: no store.mjs capability, no new durable artifact, no new
// durable directory, no new JSON domain, no durable reconciliation stage.
//
// Boundary closed here:
//   CLAIMED EXECUTION
//     -> RESULT_DELIVERED (existing canonical result authority)
//     -> repository/publication evidence recomputation WHEN the claimed result
//        requires repository mutation
//     -> derived terminal reconciliation verdict.
//
// First principle: Git/GitHub is the repository/publication truth. This module
// NEVER duplicates live-main SHA / PR merge state / merge SHA / branch or ref
// existence / changed files / ancestry / CI status into coordination durable
// state. It re-reads Git when a verdict needs publication truth and returns a
// DERIVED, non-durable verdict:
//   current durable coordination bytes + fresh Git reads -> verdict.
//
// Reused canonical authorities (never re-authored):
//   - runnable occurrence projection + admission-bound claim winner binding:
//     store.readRunnableOccurrence / runnable-occurrence.mjs (GF-03),
//   - canonical Task Envelope: store.readTask (taskKind / mutationBoundary /
//     ownedSurface; the durable semantic-intent binding),
//   - canonical Result Envelope: store.readResult,
//   - admission-bound claim token recomputation:
//     buildAdmissionBoundClaimToken (attribution of the delivered result to the
//     exact admission-bound claim winner),
//   - the single Git publication-comparison authority:
//     scripts/git/publication-admission.mjs evaluatePublicationAdmission /
//     resolveRef / readOwnedBlobs (exact owned-path blob equality; ancestry is
//     never used alone; candidate SHA != merge SHA is handled by content).
//
// Verdicts (derived-only; never a new durable stage):
//   READ_ONLY_TERMINAL            no repository semantic mutation obligation:
//                                 READ_ONLY task, or a mutation task whose
//                                 delivered result does not claim a successful
//                                 mutation. No Git read is performed.
//   PUBLISHED_TERMINAL            mutation claimed and the task's effective
//                                 owned delta is proven present on live main
//                                 (zero remaining owned-path delta at fresh
//                                 candidate/live-main read-back).
//   RESULT_DELIVERED_NOT_PUBLISHED mutation claimed, owned delta still differs
//                                 on live main: no terminal convergence and no
//                                 automatic publication (publication remains an
//                                 explicit, separately admitted action).
//   PUBLICATION_UNKNOWN           publication evidence is absent, unresolvable,
//                                 or circular (candidate ref missing, live main
//                                 unresolvable, candidate == live main snapshot,
//                                 evidence read failure). UNKNOWN is NEVER a
//                                 permission to publish, retry, or converge.
//   PUBLICATION_CONFLICT          the reused publication gate cannot resolve the
//                                 comparison (semantic-owner review required);
//                                 automatic judgment is refused.
//   executor self-report alone NEVER produces PUBLISHED_TERMINAL: the mutation
//   claim triggers direct Git recomputation, and only proven effective-delta
//   publication converges to a terminal verdict.
//
// Explicitly OUT OF SCOPE (must NOT be implemented here):
//   publication registry, merged-SHA registry, Git mirror store, terminal
//   scheduler state, reconciliation queue/daemon/polling, retry/backoff/resend,
//   automatic publication/merge/push/deploy, branch/ref lifecycle, checkout
//   occupation, new durable occurrence/result/terminal records, new fencing or
//   scheduler generation, worker/executor registry, Control Tower decision
//   invention, successor task creation, actual executor invocation (OpenCode /
//   Codex / Astra).
//
// Read-only contract: this module performs zero durable writes and zero Git
// mutations. The caller supplies the durable store and the fresh Git refs; the
// module returns a frozen verdict value. Freshness of liveMainRef (fetch before
// call) and the choice of candidateRef provenance (PR head / candidate / merge
// commit) remain explicit caller responsibilities.

import {
  COMPLETE_ALREADY_PUBLISHED as PUBLICATION_ADMISSION_COMPLETE_ALREADY_PUBLISHED,
  evaluatePublicationAdmission,
  PRE_MERGE_PHASE,
  PUBLICATION_ALLOWED as PUBLICATION_ADMISSION_ALLOWED,
  readOwnedBlobs,
  resolveRef,
  SEMANTIC_OWNER_REVIEW_REQUIRED as PUBLICATION_ADMISSION_SEMANTIC_OWNER_REVIEW_REQUIRED,
  SUPERSEDED_ALREADY_PUBLISHED as PUBLICATION_ADMISSION_SUPERSEDED_ALREADY_PUBLISHED,
} from '../git/publication-admission.mjs';
import { buildAdmissionBoundClaimToken } from './admission-bound-claim.mjs';
import { DEFAULT_EMISSION_SLOT } from './next-task-emission.mjs';
import {
  assertValidRunnableOccurrenceSlot,
  RUNNABLE_OCCURRENCE_ID_PREFIX,
  RUNNABLE_OCCURRENCE_STATE_TERMINAL,
  validateRunnableOccurrenceRecord,
} from './runnable-occurrence.mjs';
import {
  RESULT_STATUS_SUCCEEDED,
  RESULT_STATUSES,
  TASK_ID_PATTERN,
  TASK_KIND_BOUNDED_MUTATION,
  TASK_KINDS,
} from './task-envelope.mjs';

export const TERMINAL_RECONCILIATION_SCHEMA_VERSION = '1';

export const TERMINAL_RECONCILIATION_READ_ONLY_TERMINAL = 'READ_ONLY_TERMINAL';
export const TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL = 'PUBLISHED_TERMINAL';
export const TERMINAL_RECONCILIATION_RESULT_DELIVERED_NOT_PUBLISHED =
  'RESULT_DELIVERED_NOT_PUBLISHED';
export const TERMINAL_RECONCILIATION_PUBLICATION_UNKNOWN = 'PUBLICATION_UNKNOWN';
export const TERMINAL_RECONCILIATION_PUBLICATION_CONFLICT = 'PUBLICATION_CONFLICT';

export const TERMINAL_RECONCILIATION_VERDICTS = Object.freeze([
  TERMINAL_RECONCILIATION_READ_ONLY_TERMINAL,
  TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL,
  TERMINAL_RECONCILIATION_RESULT_DELIVERED_NOT_PUBLISHED,
  TERMINAL_RECONCILIATION_PUBLICATION_UNKNOWN,
  TERMINAL_RECONCILIATION_PUBLICATION_CONFLICT,
]);

// Exact derived verdict shape, in fixed order. The record is a value returned
// to the caller (Control Tower intake): it is never persisted, never a durable
// family, and never a second publication authority.
export const TERMINAL_RECONCILIATION_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'verdict',
  'sourceTaskId',
  'emissionSlot',
  'occurrenceId',
  'occurrenceState',
  'taskId',
  'taskKind',
  'resultId',
  'resultStatus',
  'mutationClaimed',
  'ownedPaths',
  'liveMainRef',
  'liveMainSha',
  'candidateRef',
  'candidateSha',
  'publicationStatus',
  'remainingDelta',
]);

// The reused publication-gate statuses that mean "the owned delta already
// exists on live main" (PRE_MERGE phase). They are exposed verbatim for
// provenance; the verdict vocabulary above stays terminal-reconciliation-owned.
export const TERMINAL_RECONCILIATION_PUBLISHED_STATUSES = Object.freeze([
  PUBLICATION_ADMISSION_COMPLETE_ALREADY_PUBLISHED,
  PUBLICATION_ADMISSION_SUPERSEDED_ALREADY_PUBLISHED,
]);

export const TERMINAL_RECONCILIATION_PUBLICATION_STATUSES = Object.freeze([
  PUBLICATION_ADMISSION_ALLOWED,
  PUBLICATION_ADMISSION_COMPLETE_ALREADY_PUBLISHED,
  PUBLICATION_ADMISSION_SUPERSEDED_ALREADY_PUBLISHED,
  PUBLICATION_ADMISSION_SEMANTIC_OWNER_REVIEW_REQUIRED,
]);

export const MAX_TERMINAL_RECONCILIATION_JSON_BYTES = 16 * 1024;
export const MAX_TERMINAL_RECONCILIATION_REF_LENGTH = 512;

// Fields that must never appear in a derived verdict. They indicate durable
// Git mirroring, a publication/merge registry, scheduler/queue smuggling,
// automatic publication authority, or embedded bodies.
export const BLOCKED_TERMINAL_RECONCILIATION_FIELDS = Object.freeze([
  'durableRecord',
  'reconciliationRecord',
  'registry',
  'publicationRegistry',
  'mergedShaRegistry',
  'gitMirror',
  'mirror',
  'mirrorStore',
  'queue',
  'reconciliationQueue',
  'scheduler',
  'schedule',
  'cron',
  'daemon',
  'polling',
  'watchdog',
  'retry',
  'backoff',
  'resend',
  'autoMerge',
  'autoPublish',
  'publish',
  'deploy',
  'mergeAuthority',
  'push',
  'branch',
  'publicationBranch',
  'transportRef',
  'checkout',
  'worktree',
  'chatHistory',
  'transcript',
  'messages',
  'docsDump',
  'docsBody',
  'resultsDump',
  'fullSsot',
  'ssot',
  'ssotBody',
  'taskBody',
  'resultBody',
  'createdAt',
  'updatedAt',
  'readAt',
  'timestamp',
  'wallClock',
  'clock',
  'mtime',
  'pid',
  'hostname',
  'random',
  'uuid',
]);

export const CORRUPT_TERMINAL_RECONCILIATION = 'CORRUPT_TERMINAL_RECONCILIATION';
export const INVALID_TERMINAL_RECONCILIATION_STORE = 'INVALID_TERMINAL_RECONCILIATION_STORE';
export const INVALID_TERMINAL_RECONCILIATION_INPUT = 'INVALID_TERMINAL_RECONCILIATION_INPUT';
export const TERMINAL_RECONCILIATION_OCCURRENCE_NOT_TERMINAL =
  'TERMINAL_RECONCILIATION_OCCURRENCE_NOT_TERMINAL';
export const TERMINAL_RECONCILIATION_BINDING_MISMATCH = 'TERMINAL_RECONCILIATION_BINDING_MISMATCH';
export const TERMINAL_RECONCILIATION_EVIDENCE_INVALID = 'TERMINAL_RECONCILIATION_EVIDENCE_INVALID';

export class TerminalReconciliationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TerminalReconciliationError';
    this.code = details.code ?? CORRUPT_TERMINAL_RECONCILIATION;
    this.taskId = details.taskId ?? null;
  }
}

function fail(message, details = {}) {
  throw new TerminalReconciliationError(message, details);
}

function assertValidTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`taskId must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, {
      code: INVALID_TERMINAL_RECONCILIATION_INPUT,
    });
  }
}

function assertValidEmissionSlot(emissionSlot) {
  try {
    assertValidRunnableOccurrenceSlot(emissionSlot);
  } catch (error) {
    fail(`emissionSlot is invalid (fail-closed): ${error?.message}`, {
      code: INVALID_TERMINAL_RECONCILIATION_INPUT,
    });
  }
}

function assertNonEmptyString(
  value,
  fieldName,
  { maxLength = MAX_TERMINAL_RECONCILIATION_REF_LENGTH } = {},
) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${fieldName} must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    fail(`${fieldName} exceeds ${maxLength} chars.`, { code: 'CONTEXT_BUDGET_EXCEEDED' });
  }
}

function assertOptionalRefOrNull(value, fieldName) {
  if (value === null) return;
  assertNonEmptyString(value, fieldName);
}

function assertOptionalShaOrNull(value, fieldName) {
  if (value === null) return;
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    fail(`${fieldName} must be a 40-hex commit SHA or null.`);
  }
}

function assertNoBlockedVerdictFields(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const field of BLOCKED_TERMINAL_RECONCILIATION_FIELDS) {
    if (Object.hasOwn(value, field)) {
      fail(
        `${where} must not contain "${field}": the terminal reconciliation verdict is derived-only ` +
          'and must not smuggle a durable Git mirror, publication/merge registry, scheduler/queue, ' +
          'automatic publication authority, clock/process entropy, or embedded bodies.',
        { code: 'CONTEXT_BUDGET_EXCEEDED' },
      );
    }
  }
}

/**
 * Validate one derived terminal reconciliation verdict. Returns a frozen typed
 * copy. Fail-closed, no repair:
 *   1. blocked-field absence and exact field shape/order,
 *   2. schemaVersion / verdict vocabulary,
 *   3. occurrence identity and TERMINAL state,
 *   4. attribution fields (task kind / result status / mutationClaimed),
 *   5. verdict-specific evidence invariants (published vs not-published vs
 *      unknown vs conflict must carry exactly the evidence that justifies the
 *      verdict and never more).
 */
export function validateTerminalReconciliationVerdict(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('terminal reconciliation verdict must be an object.');
  }
  assertNoBlockedVerdictFields(record, 'terminal reconciliation verdict');
  const keys = Object.keys(record);
  if (keys.length !== TERMINAL_RECONCILIATION_RECORD_FIELDS.length) {
    fail(
      `terminal reconciliation verdict must carry exactly ${TERMINAL_RECONCILIATION_RECORD_FIELDS.length} fields (${TERMINAL_RECONCILIATION_RECORD_FIELDS.join(', ')}).`,
    );
  }
  for (let index = 0; index < TERMINAL_RECONCILIATION_RECORD_FIELDS.length; index += 1) {
    if (keys[index] !== TERMINAL_RECONCILIATION_RECORD_FIELDS[index]) {
      fail(
        `terminal reconciliation verdict key order/shape mismatch at position ${index}: expected "${TERMINAL_RECONCILIATION_RECORD_FIELDS[index]}" got "${keys[index]}".`,
      );
    }
  }
  if (record.schemaVersion !== TERMINAL_RECONCILIATION_SCHEMA_VERSION) {
    fail(
      `terminal reconciliation schemaVersion must be ${JSON.stringify(TERMINAL_RECONCILIATION_SCHEMA_VERSION)}.`,
      { code: 'INVALID_SCHEMA_VERSION' },
    );
  }
  if (!TERMINAL_RECONCILIATION_VERDICTS.includes(record.verdict)) {
    fail(
      `verdict must be one of ${TERMINAL_RECONCILIATION_VERDICTS.join(', ')} (got ${JSON.stringify(record.verdict)}).`,
    );
  }
  assertValidTaskId(record.sourceTaskId);
  assertValidEmissionSlot(record.emissionSlot);
  if (
    typeof record.occurrenceId !== 'string' ||
    record.occurrenceId.length > 128 ||
    !record.occurrenceId.startsWith(RUNNABLE_OCCURRENCE_ID_PREFIX)
  ) {
    fail('occurrenceId must be the derived runnable-occurrence identity.');
  }
  if (record.occurrenceState !== RUNNABLE_OCCURRENCE_STATE_TERMINAL) {
    fail(
      `occurrenceState must be ${RUNNABLE_OCCURRENCE_STATE_TERMINAL} (got ${JSON.stringify(record.occurrenceState)}).`,
    );
  }
  assertValidTaskId(record.taskId);
  if (!TASK_KINDS.includes(record.taskKind)) {
    fail(`taskKind must be one of ${TASK_KINDS.join(', ')}.`);
  }
  assertNonEmptyString(record.resultId, 'resultId', { maxLength: 128 });
  if (!RESULT_STATUSES.includes(record.resultStatus)) {
    fail(`resultStatus must be one of ${RESULT_STATUSES.join(', ')}.`);
  }
  if (typeof record.mutationClaimed !== 'boolean') {
    fail('mutationClaimed must be boolean.');
  }
  if (!Array.isArray(record.ownedPaths)) {
    fail('ownedPaths must be an array of repo-relative path strings.');
  }
  for (const path of record.ownedPaths) {
    assertNonEmptyString(path, 'ownedPaths[]');
    if (path.startsWith('/') || path.includes('..')) {
      fail('ownedPaths entries must be repo-relative paths without ".." or leading "/".');
    }
  }
  assertOptionalRefOrNull(record.liveMainRef, 'liveMainRef');
  assertOptionalShaOrNull(record.liveMainSha, 'liveMainSha');
  assertOptionalRefOrNull(record.candidateRef, 'candidateRef');
  assertOptionalShaOrNull(record.candidateSha, 'candidateSha');
  if (
    record.publicationStatus !== null &&
    !TERMINAL_RECONCILIATION_PUBLICATION_STATUSES.includes(record.publicationStatus)
  ) {
    fail(
      `publicationStatus must be null or one of ${TERMINAL_RECONCILIATION_PUBLICATION_STATUSES.join(', ')}.`,
    );
  }
  if (!Array.isArray(record.remainingDelta)) {
    fail('remainingDelta must be an array of repo-relative path strings.');
  }
  for (const path of record.remainingDelta) {
    if (!record.ownedPaths.includes(path)) {
      fail(`remainingDelta entry "${path}" is not one of the task owned paths.`);
    }
  }

  if (
    record.taskKind === TASK_KIND_BOUNDED_MUTATION &&
    record.resultStatus === RESULT_STATUS_SUCCEEDED &&
    record.mutationClaimed !== true
  ) {
    fail('a SUCCEEDED BOUNDED_MUTATION result must carry mutationClaimed=true.');
  }
  if (record.taskKind !== TASK_KIND_BOUNDED_MUTATION && record.mutationClaimed === true) {
    fail('only a BOUNDED_MUTATION task may claim a repository mutation candidate.');
  }
  if (record.resultStatus !== RESULT_STATUS_SUCCEEDED && record.mutationClaimed === true) {
    fail('only a SUCCEEDED result may claim a repository mutation candidate.');
  }

  const noEvidence =
    record.liveMainRef === null &&
    record.liveMainSha === null &&
    record.candidateRef === null &&
    record.candidateSha === null &&
    record.publicationStatus === null;
  const fullEvidence =
    record.liveMainRef !== null &&
    record.liveMainSha !== null &&
    record.candidateRef !== null &&
    record.candidateSha !== null &&
    record.publicationStatus !== null;

  if (record.verdict === TERMINAL_RECONCILIATION_READ_ONLY_TERMINAL) {
    if (record.mutationClaimed !== false) {
      fail('READ_ONLY_TERMINAL must not claim a repository mutation candidate.');
    }
    if (!noEvidence || record.remainingDelta.length !== 0) {
      fail('READ_ONLY_TERMINAL must not carry publication evidence or remaining delta.');
    }
  } else if (!record.mutationClaimed) {
    fail(`${record.verdict} requires mutationClaimed=true.`);
  } else if (record.verdict === TERMINAL_RECONCILIATION_PUBLICATION_UNKNOWN) {
    if (record.publicationStatus !== null || record.remainingDelta.length !== 0) {
      fail('PUBLICATION_UNKNOWN must not carry a publication status or remaining delta.');
    }
  } else if (!fullEvidence) {
    fail(`${record.verdict} requires complete publication evidence.`);
  } else if (record.verdict === TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL) {
    if (!TERMINAL_RECONCILIATION_PUBLISHED_STATUSES.includes(record.publicationStatus)) {
      fail(
        `PUBLISHED_TERMINAL requires publicationStatus in ${TERMINAL_RECONCILIATION_PUBLISHED_STATUSES.join(', ')}.`,
      );
    }
    if (record.remainingDelta.length !== 0) {
      fail('PUBLISHED_TERMINAL requires zero remaining owned delta.');
    }
  } else if (record.verdict === TERMINAL_RECONCILIATION_RESULT_DELIVERED_NOT_PUBLISHED) {
    if (record.publicationStatus !== PUBLICATION_ADMISSION_ALLOWED) {
      fail(
        `RESULT_DELIVERED_NOT_PUBLISHED requires publicationStatus ${PUBLICATION_ADMISSION_ALLOWED}.`,
      );
    }
    if (record.remainingDelta.length === 0) {
      fail('RESULT_DELIVERED_NOT_PUBLISHED requires a non-empty remaining owned delta.');
    }
  } else if (record.verdict === TERMINAL_RECONCILIATION_PUBLICATION_CONFLICT) {
    if (record.publicationStatus !== PUBLICATION_ADMISSION_SEMANTIC_OWNER_REVIEW_REQUIRED) {
      fail(
        `PUBLICATION_CONFLICT requires publicationStatus ${PUBLICATION_ADMISSION_SEMANTIC_OWNER_REVIEW_REQUIRED}.`,
      );
    }
  }

  const json = JSON.stringify(record);
  if (json.length > MAX_TERMINAL_RECONCILIATION_JSON_BYTES) {
    fail(
      `terminal reconciliation verdict JSON is ${json.length} bytes (> ${MAX_TERMINAL_RECONCILIATION_JSON_BYTES}): use bounded refs, never embedded bodies.`,
      { code: 'CONTEXT_BUDGET_EXCEEDED' },
    );
  }
  return Object.freeze({
    schemaVersion: TERMINAL_RECONCILIATION_SCHEMA_VERSION,
    verdict: record.verdict,
    sourceTaskId: record.sourceTaskId,
    emissionSlot: record.emissionSlot,
    occurrenceId: record.occurrenceId,
    occurrenceState: RUNNABLE_OCCURRENCE_STATE_TERMINAL,
    taskId: record.taskId,
    taskKind: record.taskKind,
    resultId: record.resultId,
    resultStatus: record.resultStatus,
    mutationClaimed: record.mutationClaimed,
    ownedPaths: Object.freeze([...record.ownedPaths]),
    liveMainRef: record.liveMainRef,
    liveMainSha: record.liveMainSha,
    candidateRef: record.candidateRef,
    candidateSha: record.candidateSha,
    publicationStatus: record.publicationStatus,
    remainingDelta: Object.freeze([...record.remainingDelta]),
  });
}

function buildVerdict(input) {
  return validateTerminalReconciliationVerdict({
    schemaVersion: TERMINAL_RECONCILIATION_SCHEMA_VERSION,
    verdict: input.verdict,
    sourceTaskId: input.occurrence.sourceTaskId,
    emissionSlot: input.occurrence.emissionSlot,
    occurrenceId: input.occurrence.occurrenceId,
    occurrenceState: input.occurrence.occurrenceState,
    taskId: input.task.taskId,
    taskKind: input.task.taskKind,
    resultId: input.result.resultId,
    resultStatus: input.result.status,
    mutationClaimed: input.mutationClaimed,
    ownedPaths: input.ownedPaths,
    liveMainRef: input.liveMainRef,
    liveMainSha: input.liveMainSha,
    candidateRef: input.candidateRef,
    candidateSha: input.candidateSha,
    publicationStatus: input.publicationStatus,
    remainingDelta: input.remainingDelta,
  });
}

function assertReconciliationStoreCapabilities(store) {
  if (
    !store ||
    typeof store.readRunnableOccurrence !== 'function' ||
    typeof store.readTask !== 'function' ||
    typeof store.readResult !== 'function'
  ) {
    fail(
      'terminal reconciliation requires a caller-supplied store exposing readRunnableOccurrence / readTask / readResult (pure read composition only; the caller supplies the store explicitly and this module never writes durable state).',
      { code: INVALID_TERMINAL_RECONCILIATION_STORE },
    );
  }
}

function assertEvidenceShape(evidence) {
  const valid =
    evidence &&
    typeof evidence === 'object' &&
    !Array.isArray(evidence) &&
    (evidence.liveMainSha === null || /^[0-9a-f]{40}$/i.test(evidence.liveMainSha)) &&
    (evidence.candidateSha === null || /^[0-9a-f]{40}$/i.test(evidence.candidateSha)) &&
    (evidence.liveMainBlobs === null ||
      (typeof evidence.liveMainBlobs === 'object' && !Array.isArray(evidence.liveMainBlobs))) &&
    (evidence.candidateBlobs === null ||
      (typeof evidence.candidateBlobs === 'object' && !Array.isArray(evidence.candidateBlobs)));
  if (!valid) {
    fail(
      'publication evidence is malformed (fail-closed): expected { liveMainSha, candidateSha, liveMainBlobs, candidateBlobs } with 40-hex SHAs or null and plain blob maps or null.',
      { code: TERMINAL_RECONCILIATION_EVIDENCE_INVALID },
    );
  }
  return evidence;
}

/**
 * Default fresh Git evidence reader: read-only `git rev-parse` / `git ls-tree`
 * over the caller-supplied refs and owned paths. Missing refs/paths resolve to
 * null instead of fabricating values; it never touches the worktree, index,
 * checkout branch, or remote state.
 */
export function readGitPublicationEvidence({
  repositoryRoot,
  liveMainRef,
  candidateRef,
  ownedPaths,
}) {
  let liveMainSha = null;
  try {
    liveMainSha = resolveRef({ repositoryRoot, ref: liveMainRef });
  } catch {
    liveMainSha = null;
  }
  let candidateSha = null;
  if (liveMainSha !== null) {
    try {
      candidateSha = resolveRef({ repositoryRoot, ref: candidateRef });
    } catch {
      candidateSha = null;
    }
  }
  const liveMainBlobs =
    liveMainSha === null ? null : readOwnedBlobs({ repositoryRoot, ref: liveMainSha, ownedPaths });
  const candidateBlobs =
    candidateSha === null
      ? null
      : readOwnedBlobs({ repositoryRoot, ref: candidateSha, ownedPaths });
  return { liveMainSha, candidateSha, liveMainBlobs, candidateBlobs };
}

/**
 * Derive the terminal reconciliation verdict for one exact
 * (sourceTaskId, emissionSlot) occurrence.
 *
 * Derivation (read-only, zero durable writes, zero Git mutation):
 *  1. store capabilities + input validation (fail closed before any read),
 *  2. canonical runnable occurrence read + re-validation; anything but
 *     TERMINAL fails closed (reconciliation never advances or repairs the
 *     occurrence),
 *  3. canonical task + result read and strongest-available attribution:
 *     result.taskId must be the occurrence child, and the result must
 *     recompose the admission-bound claim token of the durable claim winner
 *     (workerId / claimGeneration / claimToken),
 *  4. no mutation claim -> READ_ONLY_TERMINAL with zero Git reads,
 *  5. mutation claim (BOUNDED_MUTATION + allowsWrite + SUCCEEDED result) ->
 *     fresh Git evidence read and exact owned-path comparison through the
 *     single canonical publication gate:
 *       zero remaining owned delta       -> PUBLISHED_TERMINAL
 *       remaining owned delta            -> RESULT_DELIVERED_NOT_PUBLISHED
 *       unresolvable/circular evidence   -> PUBLICATION_UNKNOWN
 *       gate cannot resolve              -> PUBLICATION_CONFLICT
 *
 * The returned verdict is frozen and non-durable. UNKNOWN is never a
 * permission to publish, retry, or converge; NOT_PUBLISHED is never a
 * publication execution authority.
 */
export async function reconcileTerminalResult({
  store,
  sourceTaskId,
  emissionSlot = DEFAULT_EMISSION_SLOT,
  repositoryRoot,
  liveMainRef,
  candidateRef,
  readEvidence = readGitPublicationEvidence,
} = {}) {
  assertReconciliationStoreCapabilities(store);
  assertValidTaskId(sourceTaskId);
  assertValidEmissionSlot(emissionSlot);
  if (typeof readEvidence !== 'function') {
    fail('readEvidence must be a function when supplied.', {
      code: INVALID_TERMINAL_RECONCILIATION_INPUT,
    });
  }

  const occurrence = validateRunnableOccurrenceRecord(
    store.readRunnableOccurrence({ sourceTaskId, emissionSlot }),
  );
  if (occurrence.occurrenceState !== RUNNABLE_OCCURRENCE_STATE_TERMINAL) {
    fail(
      `occurrence is not terminal (state=${occurrence.occurrenceState}): terminal reconciliation applies only to a delivered result and never advances, retries, or repairs the occurrence.`,
      {
        code: TERMINAL_RECONCILIATION_OCCURRENCE_NOT_TERMINAL,
        taskId: occurrence.nextTaskId,
      },
    );
  }

  const taskId = occurrence.nextTaskId;
  const task = store.readTask(taskId);
  if (task?.taskId !== taskId) {
    fail(
      `task read does not bind to the occurrence child (expected ${taskId} got ${String(task?.taskId)}).`,
      { code: TERMINAL_RECONCILIATION_BINDING_MISMATCH, taskId },
    );
  }
  const result = store.readResult(taskId);
  if (result?.taskId !== taskId) {
    fail(
      `canonical result does not bind to the occurrence child (expected ${taskId} got ${String(result?.taskId)}).`,
      { code: TERMINAL_RECONCILIATION_BINDING_MISMATCH, taskId },
    );
  }

  // Strongest-available attribution: the canonical result must recompose the
  // admission-bound claim token of the exact durable claim winner (claim
  // generation fencing stays owned by the existing claim authority).
  let expectedClaimToken;
  try {
    expectedClaimToken = buildAdmissionBoundClaimToken({
      admissionId: occurrence.admissionId,
      nextTaskId: taskId,
      workerId: occurrence.claim.workerId,
    });
  } catch (error) {
    fail(
      `admission-bound claim token could not be recomposed from the occurrence binding (fail-closed): ${error?.message}`,
      { code: TERMINAL_RECONCILIATION_BINDING_MISMATCH, taskId },
    );
  }
  if (
    result.claimToken !== expectedClaimToken ||
    result.workerId !== occurrence.claim.workerId ||
    result.claimGeneration !== occurrence.claim.claimGeneration
  ) {
    fail(
      `canonical result does not bind to the admission-bound claim winner (fail-closed): result ${result.resultId} worker/generation/token do not match the durable claim authority.`,
      { code: TERMINAL_RECONCILIATION_BINDING_MISMATCH, taskId },
    );
  }

  const ownedPaths = [...task.ownedSurface];
  // A repository mutation candidate is claimed exactly when the durable task
  // kind is BOUNDED_MUTATION and the executor-authored result status is
  // SUCCEEDED. The claim is never inferred from proofRefs/evidenceRefs text and
  // is never accepted as its own publication proof.
  const mutationClaimed =
    task.taskKind === TASK_KIND_BOUNDED_MUTATION && result.status === RESULT_STATUS_SUCCEEDED;

  if (!mutationClaimed) {
    return buildVerdict({
      verdict: TERMINAL_RECONCILIATION_READ_ONLY_TERMINAL,
      occurrence,
      task,
      result,
      mutationClaimed: false,
      ownedPaths,
      liveMainRef: null,
      liveMainSha: null,
      candidateRef: null,
      candidateSha: null,
      publicationStatus: null,
      remainingDelta: [],
    });
  }

  const unknown = (liveMainRefValue, candidateRefValue) =>
    buildVerdict({
      verdict: TERMINAL_RECONCILIATION_PUBLICATION_UNKNOWN,
      occurrence,
      task,
      result,
      mutationClaimed: true,
      ownedPaths,
      liveMainRef: liveMainRefValue,
      liveMainSha: null,
      candidateRef: candidateRefValue,
      candidateSha: null,
      publicationStatus: null,
      remainingDelta: [],
    });

  const hasGitInputs =
    typeof repositoryRoot === 'string' &&
    repositoryRoot.trim() &&
    typeof liveMainRef === 'string' &&
    liveMainRef.trim() &&
    typeof candidateRef === 'string' &&
    candidateRef.trim();
  if (!hasGitInputs) {
    // No publication evidence was supplied: the mutation claim cannot be
    // verified, so no terminal convergence and no automatic publication.
    return unknown(
      typeof liveMainRef === 'string' && liveMainRef.trim() ? liveMainRef : null,
      typeof candidateRef === 'string' && candidateRef.trim() ? candidateRef : null,
    );
  }

  let evidence;
  try {
    evidence = await readEvidence({ repositoryRoot, liveMainRef, candidateRef, ownedPaths });
  } catch {
    evidence = null;
  }
  if (evidence === null || evidence === undefined) {
    return unknown(liveMainRef, candidateRef);
  }
  const shaped = assertEvidenceShape(evidence);
  if (shaped.liveMainSha === null || shaped.candidateSha === null) {
    return unknown(liveMainRef, candidateRef);
  }
  if (shaped.candidateSha === shaped.liveMainSha) {
    // Comparing a ref with itself is circular and proves no prior publication:
    // supply the pre-merge candidate/PR-head ref, or a merge commit SHA once
    // live main has moved past it.
    return unknown(liveMainRef, candidateRef);
  }

  const decision = evaluatePublicationAdmission({
    ownedPaths,
    candidateBlobs: shaped.candidateBlobs,
    liveMainBlobs: shaped.liveMainBlobs,
    phase: PRE_MERGE_PHASE,
  });

  let verdict;
  let publicationStatus;
  let remainingDelta;
  if (TERMINAL_RECONCILIATION_PUBLISHED_STATUSES.includes(decision.status)) {
    verdict = TERMINAL_RECONCILIATION_PUBLISHED_TERMINAL;
    publicationStatus = decision.status;
    remainingDelta = [];
  } else if (decision.status === PUBLICATION_ADMISSION_ALLOWED) {
    verdict = TERMINAL_RECONCILIATION_RESULT_DELIVERED_NOT_PUBLISHED;
    publicationStatus = decision.status;
    remainingDelta = [...decision.remainingDelta];
  } else if (decision.status === PUBLICATION_ADMISSION_SEMANTIC_OWNER_REVIEW_REQUIRED) {
    verdict = TERMINAL_RECONCILIATION_PUBLICATION_CONFLICT;
    publicationStatus = decision.status;
    remainingDelta = [...decision.remainingDelta];
  } else {
    fail(`publication gate returned an unknown status (fail-closed): ${String(decision.status)}`, {
      code: TERMINAL_RECONCILIATION_EVIDENCE_INVALID,
      taskId,
    });
  }

  return buildVerdict({
    verdict,
    occurrence,
    task,
    result,
    mutationClaimed: true,
    ownedPaths,
    liveMainRef,
    liveMainSha: shaped.liveMainSha,
    candidateRef,
    candidateSha: shaped.candidateSha,
    publicationStatus,
    remainingDelta,
  });
}
