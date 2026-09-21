// Bounded mutation owner: GREENHUB-COORDINATION-OPERATOR-CLI-35
// + GREENHUB-COORDINATION-USER-APPROVED-READONLY-INTAKE-GF06 (the `intake`
//   subcommand and the authority-compatible `run` resolution ONLY)
// + GREENHUB-COORDINATION-CONTROL-TOWER-RESULT-INTAKE-GF07 (the `return`
//   subcommand and the automatic post-delivery Control Tower intake step
//   inside `run`, both composing control-tower-result-intake.mjs ONLY)
// + GREENHUB-COORDINATION-SHARED-CONTROL-TOWER-RESULT-RELAY-GF08 (the `relay`
//   subcommand and the automatic post-intake relay attempt inside `run`, both
//   composing control-tower-result-relay.mjs ONLY; the GitHub relay is a
//   non-canonical projection and never changes canonical coordination truth).
// + GREENHUB-COORDINATION-SHARED-CONTROL-TOWER-DISPOSITION-RETURN-GF09 (the
//   `disposition` subcommand: reads the Control Tower-authored verdict from the
//   non-canonical shared surface and adopts it through the EXISTING local
//   disposition authority. It authors no verdict, invokes no executor, and
//   leaves canonical truth unchanged on transport failure/stale/conflict.)
// Surface: scripts/coordination/operator-cli.mjs ONLY (+ the seven
// package.json operator commands coordination:run / coordination:return /
// coordination:relay / coordination:disposition / coordination:status /
// coordination:inspect / coordination:intake).
//
// Thin operator-facing composition over the EXISTING durable coordination
// authorities. This module owns NO durable semantics and creates NO durable
// state, namespace, database, or index:
//   status  = read-only projection over existing task lifecycle truth
//             (<home>/tasks/** + the append-stable sequence);
//   inspect = read-only projection over ONE task's existing durable records
//             (task/claim/result/disposition/materialization/ACK/consumed, the
//             user-approved intake authority when present, and the relevant
//             durable executor result receipt);
//   intake  = ONE explicit operator-supplied user-approved READ_ONLY task spec
//             through the EXISTING intake authority chain:
//             explicit approval -> canonical task identity -> durable intake
//             authority -> task create -> READY. It never claims, never
//             dispatches, never invokes an executor, never scans READY tasks,
//             and never creates a successor;
//   run     = ONE explicit operator-named task through the EXISTING chain:
//             pre-execution authority resolution (emission admission OR
//             user-approved intake, never created here) -> claim -> dispatch
//             attempt -> transport request -> receiver acceptance ->
//             invocation attempt -> durable pre-invocation fence -> durable
//             executor result receipt -> canonical result delivery ->
//             AUTOMATIC Control Tower result intake (generation 1
//             PENDING_DISPOSITION over the existing disposition authority).
//             The executor boundary is fenced BEFORE the adapter can run, so
//             concurrent/restarted operators never cross it twice for one
//             dispatchId and a durable outcome/receipt is always replayed
//             without re-invoking the executor.
//   return  = ONE explicit operator-named delivered task through the EXISTING
//             Control Tower result intake: canonical result/task/claim/
//             authority binding verification -> durable generation 1
//             PENDING_DISPOSITION (idempotent; an existing pending intake OR a
//             later Control Tower verdict converges read-only). It never
//             invokes an executor, never authors a verdict, never emits a
//             successor.
//   relay   = ONE explicit operator-named delivered task through the EXISTING
//             canonical result + EXISTING PENDING/later disposition, projected
//             to the configured shared GitHub relay issue. The relay is
//             NON-CANONICAL: it never writes durable coordination bytes, never
//             invokes an executor, never claims, never authors a verdict, and
//             never emits a successor. GitHub unavailable/unauthenticated
//             reports RELAY_PENDING with canonical truth untouched.
//   disposition
//           = ONE explicit operator-named delivered task whose Control
//             Tower-authored verdict was written to the shared surface. Reads
//             the shared decision read-only, validates the exact task/result/
//             resultBinding/current disposition generation binding, and adopts
//             it as exactly ONE legal immutable next disposition generation
//             through the EXISTING local disposition authority. It invents no
//             verdict, invokes no executor, reruns no source task, emits no
//             successor, and leaves canonical truth unchanged when GitHub is
//             unavailable or the decision is stale/conflicting.
//
// Explicitly NOT implemented here (and asserted absent by the proof spec):
//   scheduler, READY scan for work selection, queue polling, daemon, cron,
//   watchdog, timer, background loop, retry, backoff, resend, fallback
//   executor, executor/worker registry, executor selection, fan-out,
//   recursive successor execution, automatic DROP/WATCH/CHANGE invention,
//   mutation-capable executor, production deploy.
//
// run requires an operator-named task id. It never scans READY tasks, never
// picks oldest/newest, and never executes more than one task boundary. When
// --source is omitted, the requested task's canonical admission is resolved by
// a bounded identity lookup (exact nextTaskId match over existing admission
// records); that is authority resolution for the named task, not work
// selection. If no canonical admission binds the named task, run fails closed.
//
// Executor capability is READ_ONLY ONLY: a task whose canonical envelope is
// not taskKind=READ_ONLY / mutationBoundary.allowsWrite=false is refused with
// an explicit unsupported-capability error BEFORE any claim or durable
// mutation. The default executor is the ONE concrete OpenCode CLI
// structured-result executor (structurally read-only agent: no write/edit/bash
// tool and deny permissions injected outside the task payload); no fallback
// and no executor selection exist.
//
// coordination home resolution is the existing coordination-home contract
// (GREENHUB_COORDINATION_HOME env, then the OS user-home path): durable runtime
// state never lives inside the repository worktree.
//
// Machine output: `--json` prints a read-only projection of the same durable
// state. JSON is never durable authority (status and inspect write nothing at
// all; run writes only the same durable records the composed engine owns).

import nodeFs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';import { buildClaimBoundDispatchId } from './claim-bound-dispatch-envelope.mjs';
import { COORDINATION_HOME_ENV_KEY } from './coordination-home.mjs';
import {
  CONTROL_TOWER_RESULT_INTAKE_NOT_DELIVERED,
  INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY,
  performControlTowerResultIntake,
} from './control-tower-result-intake.mjs';
import {
  CONTROL_TOWER_DISPOSITION_RETURN_DECISION_CONFLICT,
  CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE,
  CONTROL_TOWER_DISPOSITION_RETURN_DISPOSITION_NOT_FOUND,
  CONTROL_TOWER_DISPOSITION_RETURN_NOT_CONFIGURED,
  CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY,
  CONTROL_TOWER_DISPOSITION_RETURN_STATUS_PENDING,
  CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED,
  CONTROL_TOWER_DISPOSITION_RETURN_SURFACE_AMBIGUOUS,
  CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT_UNAVAILABLE,
  performControlTowerDispositionReturn,
} from './control-tower-disposition-return.mjs';
import {
  CONTROL_TOWER_RELAY_REPO_ENV_KEY,
  CONTROL_TOWER_RESULT_RELAY_DISPOSITION_NOT_FOUND,
  CONTROL_TOWER_RESULT_RELAY_PROJECTION_BINDING_MISMATCH,
  CONTROL_TOWER_RESULT_RELAY_PROJECTION_CORRUPT,
  CONTROL_TOWER_RESULT_RELAY_REPOSITORY_INVALID,
  CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY,
  CONTROL_TOWER_RESULT_RELAY_STATUS_NOT_CONFIGURED,
  CONTROL_TOWER_RESULT_RELAY_STATUS_PENDING,
  CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED,
  CONTROL_TOWER_RESULT_RELAY_TRANSPORT_UNAVAILABLE,
  ControlTowerResultRelayTransportError,
  INVALID_CONTROL_TOWER_RESULT_RELAY_TRANSPORT,
  performControlTowerResultRelay,
  redactControlTowerRelayText,
  resolveConfiguredControlTowerRelayTransport,
} from './control-tower-result-relay.mjs';
import { dispositionRef } from './disposition.mjs';
import { persistExecutorInvocationAttempt } from './dispatch-executor-invocation-attempt.mjs';
import { invokeExecutorWithInvocationFence } from './dispatch-executor-invocation-fence.mjs';
import { acceptReceiverDispatch } from './dispatch-receiver-acceptance.mjs';
import { prepareDispatchTransportRequest } from './dispatch-transport-contract.mjs';
import { validateAdmissionRecord } from './emission-admission.mjs';
import { deliverExecutorResultReceipt } from './executor-result-delivery.mjs';
import { EXECUTOR_RESULT_RECEIPTS_DIRNAME } from './executor-result-receipt.mjs';
import { createOpenCodeCliStructuredResultExecutor } from './opencode-cli-executor-adapter.mjs';
import { CoordinationStore } from './store.mjs';
import {
  TASK_ID_PATTERN,
  TASK_KIND_READ_ONLY,
  TASK_STATUS_RESULT_DELIVERED,
} from './task-envelope.mjs';
import {
  AUTHORITY_KIND_EMISSION_ADMISSION,
  AUTHORITY_KIND_USER_APPROVED_INTAKE,
  USER_APPROVED_INTAKE_DISPATCH_SLOT,
} from './user-approved-intake.mjs';
import { prepareUserApprovedIntakeDispatchTransportRequest } from './user-approved-intake-transport.mjs';

export const OPERATOR_PROJECTION_SCHEMA_VERSION = '1';
export const OPERATOR_STATUS_PROJECTION = 'operator-status';
export const OPERATOR_INSPECTION_PROJECTION = 'operator-inspection';
export const OPERATOR_RUN_PROJECTION = 'operator-run';
export const OPERATOR_INTAKE_PROJECTION = 'operator-intake';
export const OPERATOR_RETURN_PROJECTION = 'operator-control-tower-return';
export const OPERATOR_RELAY_PROJECTION = 'operator-control-tower-relay';
export const OPERATOR_DISPOSITION_RETURN_PROJECTION =
  'operator-control-tower-disposition-return';

export const OPERATOR_ARGUMENT_INVALID = 'OPERATOR_ARGUMENT_INVALID';
export const OPERATOR_TASK_ADMISSION_NOT_FOUND = 'OPERATOR_TASK_ADMISSION_NOT_FOUND';
export const OPERATOR_TASK_ADMISSION_AMBIGUOUS = 'OPERATOR_TASK_ADMISSION_AMBIGUOUS';
export const OPERATOR_TASK_AUTHORITY_AMBIGUOUS = 'OPERATOR_TASK_AUTHORITY_AMBIGUOUS';
export const OPERATOR_INTAKE_SPEC_INVALID = 'OPERATOR_INTAKE_SPEC_INVALID';
export const OPERATOR_INTAKE_HOME_INVALID = 'OPERATOR_INTAKE_HOME_INVALID';
export const OPERATOR_EXECUTOR_NOT_CONFIGURED = 'OPERATOR_EXECUTOR_NOT_CONFIGURED';
export const OPERATOR_RECEIPT_AMBIGUOUS = 'OPERATOR_RECEIPT_AMBIGUOUS';
export const OPERATOR_STAGE_FAILED = 'OPERATOR_STAGE_FAILED';
export const UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY =
  'UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY';

export const RUN_OUTCOME_EXECUTED = 'EXECUTED';
export const RUN_OUTCOME_EXECUTOR_REJECTED = 'EXECUTOR_REJECTED';
export const RUN_OUTCOME_EXECUTOR_UNKNOWN = 'EXECUTOR_UNKNOWN';
export const RUN_OUTCOME_ALREADY_TERMINAL = 'ALREADY_TERMINAL';

export const DEFAULT_OPERATOR_WORKER_ID = 'operator-cli';
export const DEFAULT_OPERATOR_RECORDER_ID = 'operator-cli';
export const DEFAULT_OPERATOR_LEASE_MS = 15 * 60_000;
export const OPENCODE_CLI_PATH_ENV_KEY = 'GREENHUB_OPENCODE_CLI_PATH';
export const OPENCODE_MODEL_ENV_KEY = 'GREENHUB_OPENCODE_MODEL';

// Mirrors the durable store layout (store.mjs taskFilePaths /
// emission-admission paths): used only to RESOLVE the operator-named task's
// canonical admission; the authoritative read is the store primitive.
const TASK_EMISSION_ADMISSIONS_DIRNAME = 'emission-admissions';

// Exact operator intake request file shape: the explicit approval signal, the
// approval provenance, and ONE bounded READ_ONLY task spec. Executable /
// cwd / environment / claim / dispatch / executor options are structurally
// impossible here.
const OPERATOR_INTAKE_REQUEST_FIELDS = Object.freeze(['userApproved', 'approval', 'taskSpec']);

// The source checkout this CLI module belongs to. Used ONLY to fail closed when
// an operator tries to configure the coordination runtime home inside the
// repository worktree (runtime state is external local durable state).
const MODULE_DIRECTORY = nodePath.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = nodePath.resolve(MODULE_DIRECTORY, '..', '..');

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

const COMMANDS = Object.freeze(['status', 'inspect', 'run', 'intake', 'return', 'relay', 'disposition']);

const MAX_ERROR_MESSAGE_LENGTH = 512;

export class OperatorCliError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OperatorCliError';
    this.code = details.code ?? OPERATOR_STAGE_FAILED;
    this.taskId = details.taskId ?? null;
    this.stage = details.stage ?? null;
    this.nextAction = details.nextAction ?? null;
  }
}

function fail(message, details = {}) {
  throw new OperatorCliError(message, details);
}

function assertOperatorTaskId(taskId, stage = 'arguments') {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    fail(`task id must match ${String(TASK_ID_PATTERN)} (got ${JSON.stringify(taskId)}).`, {
      code: OPERATOR_ARGUMENT_INVALID,
      stage,
      nextAction: 'pass the exact task id shown by `pnpm coordination:status`',
    });
  }
  return taskId;
}

function readJsonDocument(filePath) {
  let raw;
  try {
    raw = nodeFs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing' };
    throw error;
  }
  try {
    return { state: 'present', document: JSON.parse(raw) };
  } catch {
    return { state: 'corrupt' };
  }
}

function listDirectoryNames(directory) {
  try {
    return nodeFs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function listDurableTaskIds(home) {
  return listDirectoryNames(nodePath.join(home, 'tasks'))
    .filter((entry) => entry.isDirectory() && TASK_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

// Read one optional later-stage record. Only the record's own NOT_FOUND code is
// treated as absent: corruption/drift always fails closed with its exact code.
function optionalRead(readFn, notFoundCode) {
  try {
    return readFn();
  } catch (error) {
    if (error?.code === notFoundCode) return null;
    throw error;
  }
}

/**
 * Read-only summary of one performed (or converged) Control Tower result
 * intake. Carries the existing durable disposition pointer and the derived
 * intake envelope (which embeds the exact canonical result); it is a
 * projection, never a second authority.
 */
function buildControlTowerIntakeSummary(performed) {
  if (performed === null || performed === undefined) return null;
  const { intake, disposition } = performed;
  return Object.freeze({
    intakeId: intake.intakeId,
    taskId: intake.taskId,
    resultId: intake.resultId,
    dispositionRef: dispositionRef(intake.taskId, disposition.dispositionGeneration),
    dispositionGeneration: disposition.dispositionGeneration,
    dispositionState: disposition.state,
    newlyIntaken: performed.newlyIntaken === true,
    exactReplay: performed.exactReplay === true,
    intake,
  });
}

/**
 * Projection for the explicit `coordination:return` handover: the exact
 * canonical result plus its verified provenance binding and the durable
 * Control Tower disposition pointer. Nothing here is durable authority.
 */
export function buildControlTowerReturnProjection({ taskId, resolved, performed }) {
  return Object.freeze({
    schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
    projection: OPERATOR_RETURN_PROJECTION,
    taskId,
    authorityKind: resolved.authorityKind,
    authorityId: resolved.authorityId,
    sourceTaskId: resolved.sourceTaskId,
    emissionSlot: resolved.emissionSlot,
    newlyIntaken: performed.newlyIntaken === true,
    exactReplay: performed.exactReplay === true,
    disposition: Object.freeze({
      dispositionRef: dispositionRef(taskId, performed.disposition.dispositionGeneration),
      dispositionGeneration: performed.disposition.dispositionGeneration,
      state: performed.disposition.state,
      decidedAt: performed.disposition.decidedAt,
    }),
    intake: performed.intake,
  });
}

/**
 * Bounded read-only summary of one attempted (or converged) shared Control
 * Tower result relay. The status is an external projection/transport meaning
 * ONLY: it is never durable authority and never a canonical task lifecycle
 * state. GitHub deletion/duplication/failure leaves canonical truth unchanged.
 */
function buildControlTowerRelaySummary(performed) {
  if (performed === null || performed === undefined) return null;
  return Object.freeze({
    status: performed.status,
    relayId: performed.relayId ?? null,
    marker: performed.marker ?? null,
    issueNumber: performed.issue?.issueNumber ?? null,
    issueUrl: performed.issue?.url ?? null,
    commentId: performed.comment?.commentId ?? null,
    commentUrl: performed.comment?.url ?? null,
    duplicateProjectionCount: performed.duplicateProjectionCount ?? 0,
    failureCode: performed.failureCode ?? null,
    failureMessage: performed.failureMessage ?? null,
  });
}

/**
 * A transport whose first use fails closed with the EXISTING configuration
 * error. Used when the relay environment binding is malformed: the automatic
 * best-effort relay step must report the configuration failure instead of
 * blocking the canonical execution path it follows.
 */
function createUnavailableRelayTransport(error) {
  const throwTransportError = () => {
    throw new ControlTowerResultRelayTransportError(
      error?.message ?? 'the relay transport is not configured correctly.',
      { code: error?.code ?? INVALID_CONTROL_TOWER_RESULT_RELAY_TRANSPORT },
    );
  };
  return Object.freeze({
    ensureRelayIssue: throwTransportError,
    findProjections: throwTransportError,
    createProjection: throwTransportError,
  });
}

/**
 * Automatic post-intake relay attempt for `coordination:run`. This is a
 * best-effort NON-CANONICAL projection: no transport means RELAY_NOT_CONFIGURED
 * (visible in the projection, not an execution failure), and any relay error
 * converges to RELAY_PENDING with canonical truth untouched. It never invokes
 * an executor, never writes durable coordination bytes, and never authors a
 * verdict.
 */
async function attemptControlTowerResultRelay({ store, taskId, authority, relayTransport }) {
  if (!relayTransport) {
    return Object.freeze({
      status: CONTROL_TOWER_RESULT_RELAY_STATUS_NOT_CONFIGURED,
      taskId,
      relayId: null,
      marker: null,
      issue: null,
      comment: null,
      duplicateProjectionCount: 0,
      failureCode: CONTROL_TOWER_RESULT_RELAY_STATUS_NOT_CONFIGURED,
      failureMessage: `no shared relay transport is configured; set ${CONTROL_TOWER_RELAY_REPO_ENV_KEY}=owner/name to enable the automatic Control Tower relay`,
    });
  }
  try {
    return await performControlTowerResultRelay({ store, taskId, authority, transport: relayTransport });
  } catch (error) {
    return Object.freeze({
      status: CONTROL_TOWER_RESULT_RELAY_STATUS_PENDING,
      taskId,
      relayId: null,
      marker: null,
      issue: null,
      comment: null,
      duplicateProjectionCount: 0,
      failureCode:
        typeof error?.code === 'string' && error.code ? error.code : OPERATOR_STAGE_FAILED,
      failureMessage: redactControlTowerRelayText(error?.message ?? String(error)),
    });
  }
}

/**
 * Projection for the explicit `coordination:relay` command: the canonical
 * provenance binding, the transport status, the shared issue/comment identity,
 * and the exact projected (non-canonical) relay document. Nothing here is
 * durable authority.
 */
export function buildControlTowerRelayProjection({ taskId, resolved, performed }) {
  return Object.freeze({
    schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
    projection: OPERATOR_RELAY_PROJECTION,
    taskId,
    authorityKind: resolved.authorityKind,
    authorityId: resolved.authorityId,
    sourceTaskId: resolved.sourceTaskId,
    emissionSlot: resolved.emissionSlot,
    status: performed.status,
    newlyRelayed: performed.status === CONTROL_TOWER_RESULT_RELAY_STATUS_RELAYED,
    exactReplay: performed.status === CONTROL_TOWER_RESULT_RELAY_STATUS_EXACT_REPLAY,
    relayId: performed.relayId ?? null,
    marker: performed.marker ?? null,
    issue: performed.issue ?? null,
    comment: performed.comment ?? null,
    duplicateProjectionCount: performed.duplicateProjectionCount ?? 0,
    failureCode: performed.failureCode ?? null,
    failureMessage: performed.failureMessage ?? null,
    disposition:
      performed.document === null || performed.document === undefined
        ? null
        : Object.freeze({
            dispositionRef: performed.document.dispositionRef,
            dispositionState: performed.document.dispositionState,
          }),
    document: performed.document ?? null,
  });
}

/**
 * Projection for the explicit `coordination:disposition` command: the canonical
 * provenance binding, the shared-surface decision identity, and the exact
 * canonical disposition generation the validated decision returned/converged to.
 * The shared decision surface is NON-CANONICAL; this projection is read-only
 * output and never a second authority.
 */
export function buildControlTowerDispositionReturnProjection({ taskId, resolved, performed }) {
  return Object.freeze({
    schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
    projection: OPERATOR_DISPOSITION_RETURN_PROJECTION,
    taskId,
    authorityKind: resolved.authorityKind,
    authorityId: resolved.authorityId,
    sourceTaskId: resolved.sourceTaskId,
    emissionSlot: resolved.emissionSlot,
    status: performed.status,
    newlyReturned: performed.status === CONTROL_TOWER_DISPOSITION_RETURN_STATUS_RETURNED,
    exactReplay: performed.status === CONTROL_TOWER_DISPOSITION_RETURN_STATUS_EXACT_REPLAY,
    resultId: performed.resultId,
    resultBinding: performed.resultBinding,
    surface: performed.surface ?? null,
    decision: performed.decision ?? null,
    decisionSource: performed.decisionSource ?? null,
    duplicateDecisionSourceCount: performed.duplicateDecisionSourceCount ?? 0,
    observedDisposition: performed.observedDisposition ?? null,
    returnedDisposition: performed.returnedDisposition ?? null,
    canonicalWrites: performed.canonicalWrites ?? 0,
    executorInvocations: performed.executorInvocations ?? 0,
    manualCopyPasteRequired: performed.manualCopyPasteRequired === true,
    failureCode: performed.failureCode ?? null,
    failureMessage: performed.failureMessage ?? null,
  });
}

function deriveNextAction(code) {
  if (code === 'TASK_NOT_FOUND') {
    return 'verify the task id from `pnpm coordination:status`';
  }
  if (code === 'LEASE_ACTIVE') {
    return 'the task is claimed with an active lease; wait for lease expiry or use the current owner worker id';
  }
  if (code === 'TASK_TERMINAL') {
    return 'the task is already terminal; no execution is possible through this command';
  }
  if (code === 'TASK_NOT_READY') {
    return 'the emitted child is not READY/CLAIMED yet; admit it first (store.admitEmittedTask) and rerun';
  }
  if (code === 'TASK_NOT_CLAIMED') {
    return 'the dispatch envelope requires a CLAIMED child; rerun and let claimAdmittedTask converge it';
  }
  if (code === UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY) {
    return 'this task requires mutation capability; the operator CLI executes READ_ONLY tasks only — route it to a mutation-capable executor';
  }
  if (code === OPERATOR_TASK_ADMISSION_NOT_FOUND) {
    return 'only emission-admitted tasks can run; emit and admit the task first, or pass --source/--slot explicitly';
  }
  if (code === OPERATOR_TASK_ADMISSION_AMBIGUOUS) {
    return 'multiple canonical admissions bind this task; pass --source and --slot explicitly';
  }
  if (code === OPERATOR_TASK_AUTHORITY_AMBIGUOUS) {
    return 'both an emission admission and a user-approved intake authority bind this task; stop and inspect the durable state manually';
  }
  if (code === OPERATOR_INTAKE_SPEC_INVALID) {
    return 'fix the intake spec file (userApproved: true, approval { approvedBy, approvalRef }, and a bounded READ_ONLY taskSpec) and rerun `pnpm coordination:intake --spec <PATH>`';
  }
  if (code === 'INTAKE_NOT_FOUND') {
    return 'intake the task first with `pnpm coordination:intake --spec <PATH>` (the operator CLI never creates an intake authority)';
  }
  if (code === OPERATOR_EXECUTOR_NOT_CONFIGURED) {
    return `set ${OPENCODE_CLI_PATH_ENV_KEY} and ${OPENCODE_MODEL_ENV_KEY}, or pass --opencode <absolute path> --model <provider/model> (READ_ONLY executor only)`;
  }
  if (code === OPERATOR_RECEIPT_AMBIGUOUS) {
    return 'multiple durable receipts bind this task; stop and inspect the durable state manually';
  }
  if (code === CONTROL_TOWER_RESULT_INTAKE_NOT_DELIVERED) {
    return 'the task has no delivered canonical result; run the task to delivery first, then rerun `pnpm coordination:return <TASK_ID>`';
  }
  if (code === INVALID_CONTROL_TOWER_RESULT_INTAKE_AUTHORITY) {
    return 'the requested task has no single canonical pre-execution authority binding; inspect the durable state and pass --source/--slot explicitly for emission-admitted tasks';
  }
  if (code === CONTROL_TOWER_RESULT_RELAY_DISPOSITION_NOT_FOUND) {
    return 'the task has no Control Tower disposition pointer yet; run `pnpm coordination:return <TASK_ID>` first, then rerun `pnpm coordination:relay <TASK_ID>`';
  }
  if (code === INVALID_CONTROL_TOWER_RESULT_RELAY_TRANSPORT) {
    return `set ${CONTROL_TOWER_RELAY_REPO_ENV_KEY} to the explicit owner/name relay repository (the external relay is never inferred)`;
  }
  if (code === CONTROL_TOWER_RESULT_RELAY_REPOSITORY_INVALID) {
    return `fix ${CONTROL_TOWER_RELAY_REPO_ENV_KEY}: it must be an explicit "owner/name" GitHub repository`;
  }
  if (code === CONTROL_TOWER_RESULT_RELAY_STATUS_NOT_CONFIGURED) {
    return `set ${CONTROL_TOWER_RELAY_REPO_ENV_KEY}=owner/name to enable the shared Control Tower relay, then rerun \`pnpm coordination:relay <TASK_ID>\``;
  }
  if (code === CONTROL_TOWER_RESULT_RELAY_TRANSPORT_UNAVAILABLE) {
    return 'GitHub is unavailable or unauthenticated; the canonical result and disposition are unchanged — rerun `pnpm coordination:relay <TASK_ID>` when the transport is available (never retry the executor)';
  }
  if (
    code === CONTROL_TOWER_RESULT_RELAY_PROJECTION_BINDING_MISMATCH ||
    code === CONTROL_TOWER_RESULT_RELAY_PROJECTION_CORRUPT
  ) {
    return 'the shared relay projection conflicts with canonical truth; stop and review manually — never rewrite or delete the projection automatically';
  }
  if (code === CONTROL_TOWER_DISPOSITION_RETURN_NOT_CONFIGURED) {
    return `set ${CONTROL_TOWER_RELAY_REPO_ENV_KEY}=owner/name to enable the shared Control Tower decision surface, then rerun \`pnpm coordination:disposition <TASK_ID>\``;
  }
  if (code === CONTROL_TOWER_DISPOSITION_RETURN_DISPOSITION_NOT_FOUND) {
    return 'the task has no Control Tower disposition pointer yet; run `pnpm coordination:return <TASK_ID>` first, then wait for the Control Tower decision and rerun `pnpm coordination:disposition <TASK_ID>`';
  }
  if (code === CONTROL_TOWER_DISPOSITION_RETURN_TRANSPORT_UNAVAILABLE) {
    return 'GitHub is unavailable or unauthenticated; the canonical result and disposition are unchanged — rerun `pnpm coordination:disposition <TASK_ID>` when the transport is available (never rerun the executor)';
  }
  if (code === CONTROL_TOWER_DISPOSITION_RETURN_DECISION_STALE) {
    return 'the shared decision is stale against the canonical disposition; the Control Tower must author a new decision bound to the current dispositionRef — canonical state is never rewound';
  }
  if (code === CONTROL_TOWER_DISPOSITION_RETURN_DECISION_CONFLICT) {
    return 'multiple conflicting shared decisions exist; stop and review the shared surface manually — canonical adoption never uses last-writer-wins';
  }
  if (code === CONTROL_TOWER_DISPOSITION_RETURN_SURFACE_AMBIGUOUS) {
    return 'multiple relay issues carry the exact shared surface title; resolve the ambiguous non-canonical surface manually before adopting any decision';
  }
  if (code === 'EXECUTOR_INVOCATION_FENCE_UNCERTAIN') {
    return 'a prior or concurrent invocation may already have crossed the executor boundary and no durable outcome/receipt proves its disposition; do NOT retry automatically — inspect the durable state and decide manually';
  }
  if (
    typeof code === 'string' &&
    (code.startsWith('CORRUPT_') || code.endsWith('_MISMATCH') || code.endsWith('_CONFLICT'))
  ) {
    return 'durable authority is corrupt or drifted; stop and inspect — never repair by rewriting durable bytes';
  }
  return 'run `pnpm coordination:inspect <TASK_ID>` and decide the next manual action';
}

async function atStage(stage, taskId, action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof OperatorCliError) throw error;
    const code = typeof error?.code === 'string' && error.code ? error.code : OPERATOR_STAGE_FAILED;
    throw new OperatorCliError(error?.message ?? String(error), {
      code,
      taskId: error?.taskId ?? taskId,
      stage,
      nextAction: deriveNextAction(code),
    });
  }
}

function atSyncStage(stage, taskId, action) {
  try {
    return action();
  } catch (error) {
    if (error instanceof OperatorCliError) throw error;
    const code = typeof error?.code === 'string' && error.code ? error.code : OPERATOR_STAGE_FAILED;
    throw new OperatorCliError(error?.message ?? String(error), {
      code,
      taskId: error?.taskId ?? taskId,
      stage,
      nextAction: deriveNextAction(code),
    });
  }
}

function canonicalTaskOrder(left, right) {
  const leftPosition = left.sequencePosition ?? Number.MAX_SAFE_INTEGER;
  const rightPosition = right.sequencePosition ?? Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0;
}

/**
 * Read-only status overview. Durable-state read ONLY: no write, no repair, no
 * reconciliation, no cursor migration, no new status database.
 */
export function collectStatusOverview({ store } = {}) {
  if (
    !store ||
    typeof store.readTask !== 'function' ||
    typeof store.readSequenceEntries !== 'function'
  ) {
    fail('status requires a durable coordination store (read-only composition).', {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'status',
      nextAction: 'use the package.json coordination:status command',
    });
  }
  const home = store.home;
  return atSyncStage('status', null, () => {
    const sequenceEntries = store.readSequenceEntries();
    const sequencePosition = new Map(
      sequenceEntries.map((entry) => [entry.taskId, entry.sequenceNumber]),
    );
    const tasks = listDurableTaskIds(home)
      .map((taskId) => {
        const task = store.readTask(taskId);
        const claim = optionalRead(() => store.readClaim(taskId), 'CLAIM_NOT_FOUND');
        const result = optionalRead(() => store.readResult(taskId), 'RESULT_NOT_FOUND');
        const disposition = optionalRead(
          () => store.readCurrentDisposition(taskId),
          'DISPOSITION_NOT_FOUND',
        );
        return {
          sequencePosition: sequencePosition.get(taskId) ?? null,
          taskId,
          taskKind: task.taskKind,
          status: task.status,
          updatedAt: task.updatedAt ?? task.createdAt,
          claim: claim !== null,
          canonicalResult: result !== null,
          disposition: disposition?.state ?? null,
          consumed: store.isConsumed(taskId),
        };
      })
      .sort(canonicalTaskOrder);
    const statusCounts = { CREATED: 0, READY: 0, CLAIMED: 0, RESULT_DELIVERED: 0 };
    for (const task of tasks) {
      if (Object.hasOwn(statusCounts, task.status)) statusCounts[task.status] += 1;
    }
    return Object.freeze({
      schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
      projection: OPERATOR_STATUS_PROJECTION,
      home,
      taskCount: tasks.length,
      statusCounts,
      tasks,
    });
  });
}

function findExecutorResultReceiptForTask({ home, taskId }) {
  const directory = nodePath.join(home, EXECUTOR_RESULT_RECEIPTS_DIRNAME);
  const matches = [];
  for (const entry of listDirectoryNames(directory).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const found = readJsonDocument(nodePath.join(directory, entry.name));
    if (found.state === 'missing') continue;
    if (found.state === 'corrupt') {
      fail(`executor result receipt is corrupt (fail-closed, no auto-repair): ${entry.name}`, {
        code: 'CORRUPT_EXECUTOR_RESULT_RECEIPT',
        taskId,
        stage: 'inspect',
        nextAction: deriveNextAction('CORRUPT_EXECUTOR_RESULT_RECEIPT'),
      });
    }
    const document = found.document;
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      fail(`executor result receipt has an invalid shape (fail-closed): ${entry.name}`, {
        code: 'CORRUPT_EXECUTOR_RESULT_RECEIPT',
        taskId,
        stage: 'inspect',
        nextAction: deriveNextAction('CORRUPT_EXECUTOR_RESULT_RECEIPT'),
      });
    }
    if (document.taskId === taskId) matches.push(document);
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    fail(`multiple durable executor result receipts bind task ${taskId} (fail-closed).`, {
      code: OPERATOR_RECEIPT_AMBIGUOUS,
      taskId,
      stage: 'inspect',
      nextAction: deriveNextAction(OPERATOR_RECEIPT_AMBIGUOUS),
    });
  }
  return matches[0];
}

/**
 * Read-only inspection of one task's existing durable records. Missing optional
 * later-stage records are reported as null (rendered as absent); present
 * records are returned exactly as durable authority stores them; corrupt
 * authority fails closed with its canonical code.
 */
export function collectTaskInspection({ store, taskId } = {}) {
  if (!store || typeof store.readTask !== 'function') {
    fail('inspect requires a durable coordination store (read-only composition).', {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'inspect',
      nextAction: 'use the package.json coordination:inspect command',
    });
  }
  assertOperatorTaskId(taskId, 'inspect');
  return atSyncStage('inspect', taskId, () => {
    const task = store.readTask(taskId);
    const claim = optionalRead(() => store.readClaim(taskId), 'CLAIM_NOT_FOUND');
    const canonicalResult = optionalRead(() => store.readResult(taskId), 'RESULT_NOT_FOUND');
    const disposition = optionalRead(
      () => store.readCurrentDisposition(taskId),
      'DISPOSITION_NOT_FOUND',
    );
    const materialization = optionalRead(
      () => store.readMaterialization(taskId),
      'MATERIALIZATION_NOT_FOUND',
    );
    const ack = optionalRead(() => store.readAck(taskId), 'ACK_NOT_FOUND');
    const consumed = optionalRead(() => store.readConsumed(taskId), 'CONSUMED_NOT_FOUND');
    const intake =
      typeof store.readUserApprovedIntake === 'function'
        ? optionalRead(() => store.readUserApprovedIntake({ taskId }), 'INTAKE_NOT_FOUND')
        : null;
    const executorResultReceipt = findExecutorResultReceiptForTask({ home: store.home, taskId });
    return Object.freeze({
      schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
      projection: OPERATOR_INSPECTION_PROJECTION,
      home: store.home,
      taskId,
      task,
      claim,
      canonicalResult,
      disposition,
      materialization,
      ack,
      consumed,
      intake,
      executorResultReceipt,
    });
  });
}

/**
 * Bounded identity resolution of the operator-named task's canonical
 * pre-execution authority:
 *   - explicit (sourceTaskId, emissionSlot) -> authoritative emission-admission
 *     store read (unchanged);
 *   - otherwise exact nextTaskId match over EXISTING emission admission records
 *     (identity resolution only: never a READY scan, never oldest/newest,
 *     never priority/fairness);
 *   - if no emission admission binds the task, the exact user-approved intake
 *     authority for that taskId is read (read-only, never created here).
 * Both authority sources binding the same task fails closed as ambiguous.
 * Absent -> null; ambiguous -> fail closed; corruption -> fail closed.
 */
export function resolveTaskAdmission({ store, taskId, sourceTaskId, emissionSlot = 'next' } = {}) {
  assertOperatorTaskId(taskId, 'resolve-admission');
  if (typeof sourceTaskId === 'string' && sourceTaskId.trim()) {
    assertOperatorTaskId(sourceTaskId, 'resolve-admission');
    const admission = store.readEmissionAdmission({ sourceTaskId, emissionSlot });
    if (admission.nextTaskId !== taskId) {
      fail(
        `canonical admission ${sourceTaskId}@${emissionSlot} binds task ${admission.nextTaskId}, not the requested ${taskId} (fail-closed).`,
        {
          code: OPERATOR_TASK_ADMISSION_NOT_FOUND,
          taskId,
          stage: 'resolve-admission',
          nextAction: deriveNextAction(OPERATOR_TASK_ADMISSION_NOT_FOUND),
        },
      );
    }
    return {
      authorityKind: AUTHORITY_KIND_EMISSION_ADMISSION,
      authorityId: admission.admissionId,
      sourceTaskId,
      emissionSlot,
      admission,
      intake: null,
    };
  }
  const tasksDirectory = nodePath.join(store.home, 'tasks');
  const matches = [];
  for (const taskEntry of listDirectoryNames(tasksDirectory)) {
    if (!taskEntry.isDirectory() || !TASK_ID_PATTERN.test(taskEntry.name)) continue;
    const admissionsDirectory = nodePath.join(
      tasksDirectory,
      taskEntry.name,
      TASK_EMISSION_ADMISSIONS_DIRNAME,
    );
    for (const admissionEntry of listDirectoryNames(admissionsDirectory).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      if (!admissionEntry.isFile() || !admissionEntry.name.endsWith('.json')) continue;
      const slot = admissionEntry.name.slice(0, -'.json'.length);
      const found = readJsonDocument(nodePath.join(admissionsDirectory, admissionEntry.name));
      if (found.state === 'missing') continue;
      if (found.state === 'corrupt') {
        fail(
          `admission record is corrupt (fail-closed, no auto-repair): ${taskEntry.name}@${slot}`,
          {
            code: 'CORRUPT_ADMISSION',
            taskId,
            stage: 'resolve-admission',
            nextAction: deriveNextAction('CORRUPT_ADMISSION'),
          },
        );
      }
      const document = found.document;
      if (document === null || typeof document !== 'object' || Array.isArray(document)) {
        fail(`admission record is invalid (fail-closed): ${taskEntry.name}@${slot}`, {
          code: 'CORRUPT_ADMISSION',
          taskId,
          stage: 'resolve-admission',
          nextAction: deriveNextAction('CORRUPT_ADMISSION'),
        });
      }
      if (document.nextTaskId !== taskId) continue;
      let record;
      try {
        record = validateAdmissionRecord(document);
      } catch (error) {
        fail(
          `admission record is invalid (fail-closed): ${taskEntry.name}@${slot}: ${error?.message}`,
          {
            code: typeof error?.code === 'string' && error.code ? error.code : 'CORRUPT_ADMISSION',
            taskId,
            stage: 'resolve-admission',
            nextAction: deriveNextAction('CORRUPT_ADMISSION'),
          },
        );
      }
      if (record.sourceTaskId !== taskEntry.name || record.emissionSlot !== slot) {
        fail(`admission identity/path mismatch (fail-closed): ${taskEntry.name}@${slot}`, {
          code: 'CORRUPT_ADMISSION',
          taskId,
          stage: 'resolve-admission',
          nextAction: deriveNextAction('CORRUPT_ADMISSION'),
        });
      }
      matches.push({ sourceTaskId: taskEntry.name, emissionSlot: slot, admission: record });
    }
  }
  if (matches.length > 1) {
    fail(`multiple canonical admissions bind task ${taskId} (fail-closed, no selection).`, {
      code: OPERATOR_TASK_ADMISSION_AMBIGUOUS,
      taskId,
      stage: 'resolve-admission',
      nextAction: deriveNextAction(OPERATOR_TASK_ADMISSION_AMBIGUOUS),
    });
  }
  const intake =
    typeof store.readUserApprovedIntake === 'function'
      ? optionalRead(() => store.readUserApprovedIntake({ taskId }), 'INTAKE_NOT_FOUND')
      : null;
  if (matches.length === 1 && intake !== null) {
    fail(
      `both an emission admission and a user-approved intake authority bind task ${taskId} (fail-closed, authority sources are never merged).`,
      {
        code: OPERATOR_TASK_AUTHORITY_AMBIGUOUS,
        taskId,
        stage: 'resolve-admission',
        nextAction: deriveNextAction(OPERATOR_TASK_AUTHORITY_AMBIGUOUS),
      },
    );
  }
  if (matches.length === 0 && intake === null) return null;
  if (intake !== null) {
    return {
      authorityKind: AUTHORITY_KIND_USER_APPROVED_INTAKE,
      authorityId: intake.intakeId,
      sourceTaskId: taskId,
      emissionSlot: USER_APPROVED_INTAKE_DISPATCH_SLOT,
      admission: null,
      intake,
    };
  }
  const match = matches[0];
  // Re-read through the authoritative store primitive (full binding check).
  const admission = store.readEmissionAdmission({
    sourceTaskId: match.sourceTaskId,
    emissionSlot: match.emissionSlot,
  });
  return {
    authorityKind: AUTHORITY_KIND_EMISSION_ADMISSION,
    authorityId: admission.admissionId,
    sourceTaskId: match.sourceTaskId,
    emissionSlot: match.emissionSlot,
    admission,
    intake: null,
  };
}

/**
 * Execute exactly ONE explicit operator-named READ_ONLY task boundary through
 * the existing chain. No scheduler, no READY scan, no retry, no fallback, no
 * successor execution, no automatic disposition.
 *
 * The executor boundary is crossed at most once per dispatchId through the
 * durable pre-invocation fence; an existing durable receipt/invocation outcome
 * is replayed without re-invoking the executor, and a fenced boundary without
 * durable evidence fails closed (never automatic retry).
 */
export async function executeOperatorTask({
  store,
  taskId,
  sourceTaskId,
  emissionSlot = 'next',
  workerId = DEFAULT_OPERATOR_WORKER_ID,
  leaseDurationMs = DEFAULT_OPERATOR_LEASE_MS,
  executor,
  relayTransport = null,
} = {}) {
  if (!store || typeof store.readTask !== 'function') {
    fail('run requires a durable coordination store (composition only).', {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'run',
      nextAction: 'use the package.json coordination:run command',
    });
  }
  assertOperatorTaskId(taskId, 'run');
  if (typeof executor !== 'function') {
    fail(
      'a READ_ONLY structured-result executor must be supplied (no registry, no auto-selection, no fallback executor).',
      {
        code: OPERATOR_EXECUTOR_NOT_CONFIGURED,
        taskId,
        stage: 'executor-config',
        nextAction: deriveNextAction(OPERATOR_EXECUTOR_NOT_CONFIGURED),
      },
    );
  }
  if (typeof workerId !== 'string' || !workerId.trim()) {
    fail('worker id must be a non-empty string.', {
      code: OPERATOR_ARGUMENT_INVALID,
      taskId,
      stage: 'arguments',
      nextAction: 'pass --worker <WORKER_ID>',
    });
  }

  const task = await atStage('capability-gate', taskId, async () => store.readTask(taskId));
  if (task.taskKind !== TASK_KIND_READ_ONLY || task.mutationBoundary?.allowsWrite !== false) {
    fail(
      `the requested task requires mutation capability (taskKind=${task.taskKind} allowsWrite=${task.mutationBoundary?.allowsWrite}); the current executor capability is READ_ONLY and no mutation-capable or fallback executor exists.`,
      {
        code: UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY,
        taskId,
        stage: 'capability-gate',
        nextAction: deriveNextAction(UNSUPPORTED_OPERATOR_EXECUTION_CAPABILITY),
      },
    );
  }
  if (task.status === 'CREATED') {
    fail(
      `task ${taskId} is CREATED, not READY; the operator CLI never admits implicitly (ADMISSION_AUTHORITY -> READY is owned by admitEmittedTask).`,
      {
        code: 'TASK_NOT_READY',
        taskId,
        stage: 'capability-gate',
        nextAction: deriveNextAction('TASK_NOT_READY'),
      },
    );
  }

  const resolved = await atStage('resolve-admission', taskId, async () => {
    const found = resolveTaskAdmission({ store, taskId, sourceTaskId, emissionSlot });
    if (found === null) {
      fail(
        `no canonical pre-execution authority (emission admission or user-approved intake) binds task ${taskId} (fail-closed): the operator CLI never creates an authority and runs only authority-bound tasks.`,
        {
          code: OPERATOR_TASK_ADMISSION_NOT_FOUND,
          taskId,
          stage: 'resolve-admission',
          nextAction: deriveNextAction(OPERATOR_TASK_ADMISSION_NOT_FOUND),
        },
      );
    }
    return found;
  });
  const authorityKind = resolved.authorityKind ?? AUTHORITY_KIND_EMISSION_ADMISSION;
  const authorityId = resolved.authorityId;
  const boundSourceTaskId = resolved.sourceTaskId;
  const boundEmissionSlot = resolved.emissionSlot;
  const intakeAuthorized = authorityKind === AUTHORITY_KIND_USER_APPROVED_INTAKE;

  const claimed = await atStage('claim', taskId, async () =>
    intakeAuthorized
      ? store.claimUserApprovedIntakeTask({ taskId, workerId, leaseDurationMs })
      : store.claimAdmittedTask({
          sourceTaskId: boundSourceTaskId,
          emissionSlot: boundEmissionSlot,
          workerId,
          leaseDurationMs,
        }),
  );
  const claim = claimed.claim;

  if (claimed.terminal === true) {
    const dispatchId = buildClaimBoundDispatchId({
      admissionId: authorityId,
      nextTaskId: taskId,
      workerId: claim.workerId,
      claimGeneration: claim.generation,
    });
    const receipt = await atStage('terminal-read-back', taskId, async () =>
      store.readExecutorResultReceipt(dispatchId),
    );
    const canonicalResult = optionalRead(() => store.readResult(taskId), 'RESULT_NOT_FOUND');
    const controlTowerIntake =
      claimed.child.status === TASK_STATUS_RESULT_DELIVERED
        ? await atStage('control-tower-intake', taskId, async () =>
            performControlTowerResultIntake({
              store,
              taskId,
              authority: {
                authorityKind,
                authorityId,
                sourceTaskId: boundSourceTaskId,
                emissionSlot: boundEmissionSlot,
              },
            }),
          )
        : null;
    // GF-08: the intaken result is projected to the shared Control Tower relay
    // (non-canonical; best-effort). A missing/failed transport never changes
    // canonical truth and never blocks terminal convergence.
    const controlTowerRelay =
      controlTowerIntake === null
        ? null
        : await atStage('control-tower-relay', taskId, async () =>
            attemptControlTowerResultRelay({
              store,
              taskId,
              authority: {
                authorityKind,
                authorityId,
                sourceTaskId: boundSourceTaskId,
                emissionSlot: boundEmissionSlot,
              },
              relayTransport,
            }),
          );
    return Object.freeze({
      schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
      projection: OPERATOR_RUN_PROJECTION,
      outcome: RUN_OUTCOME_ALREADY_TERMINAL,
      terminal: true,
      executorInvocations: 0,
      taskId,
      authorityKind,
      sourceTaskId: boundSourceTaskId,
      emissionSlot: boundEmissionSlot,
      workerId: claim.workerId,
      claimGeneration: claim.generation,
      dispatchId,
      executorOutcome: null,
      receipt,
      delivery: null,
      resultId: canonicalResult?.resultId ?? null,
      taskStatus: claimed.child.status,
      controlTowerIntake: buildControlTowerIntakeSummary(controlTowerIntake),
      controlTowerRelay: buildControlTowerRelaySummary(controlTowerRelay),
    });
  }

  const attempt = await atStage('dispatch-attempt', taskId, async () =>
    intakeAuthorized
      ? store.persistUserApprovedIntakeDispatchAttempt({ taskId, workerId })
      : store.persistDispatchAttempt({
          sourceTaskId: boundSourceTaskId,
          emissionSlot: boundEmissionSlot,
          workerId,
        }),
  );
  const dispatchId = attempt.dispatchId;

  const request = await atStage('transport-request', taskId, async () =>
    intakeAuthorized
      ? prepareUserApprovedIntakeDispatchTransportRequest({
          store,
          taskId: boundSourceTaskId,
          dispatchId,
        })
      : prepareDispatchTransportRequest({ store, sourceTaskId: boundSourceTaskId, dispatchId }),
  );
  await atStage('receiver-acceptance', taskId, async () =>
    acceptReceiverDispatch({ request, store }),
  );
  await atStage('invocation-attempt', taskId, async () =>
    persistExecutorInvocationAttempt({ dispatchId, store }),
  );
  const receiptOutcome = await atStage('executor-invocation-fence', taskId, async () =>
    invokeExecutorWithInvocationFence({ dispatchId, store, executor }),
  );

  let delivery = null;
  if (receiptOutcome.receipt !== null) {
    delivery = await atStage('result-delivery', taskId, async () =>
      deliverExecutorResultReceipt({ dispatchId, store }),
    );
  }
  const finalTask = store.readTask(taskId);
  // GF-07: the delivered canonical result is automatically handed to the
  // Control Tower result intake (generation 1 PENDING_DISPOSITION over the
  // existing disposition authority). A crash between delivery and intake is
  // recovered by the next run/return replay through the same convergence.
  const controlTowerIntake =
    finalTask.status === TASK_STATUS_RESULT_DELIVERED
      ? await atStage('control-tower-intake', taskId, async () =>
          performControlTowerResultIntake({
            store,
            taskId,
            authority: {
              authorityKind,
              authorityId,
              sourceTaskId: boundSourceTaskId,
              emissionSlot: boundEmissionSlot,
            },
          }),
        )
      : null;
  // GF-08: automatic non-canonical relay attempt after the Control Tower
  // intake. Best-effort only: no transport -> RELAY_NOT_CONFIGURED, transport
  // failure -> RELAY_PENDING, canonical result/disposition always unchanged.
  const controlTowerRelay =
    controlTowerIntake === null
      ? null
      : await atStage('control-tower-relay', taskId, async () =>
          attemptControlTowerResultRelay({
            store,
            taskId,
            authority: {
              authorityKind,
              authorityId,
              sourceTaskId: boundSourceTaskId,
              emissionSlot: boundEmissionSlot,
            },
            relayTransport,
          }),
        );
  const outcome =
    receiptOutcome.outcome === 'ACCEPTED'
      ? RUN_OUTCOME_EXECUTED
      : receiptOutcome.outcome === 'REJECTED'
        ? RUN_OUTCOME_EXECUTOR_REJECTED
        : RUN_OUTCOME_EXECUTOR_UNKNOWN;
  return Object.freeze({
    schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
    projection: OPERATOR_RUN_PROJECTION,
    outcome,
    terminal: false,
    executorInvocations: receiptOutcome.executorInvoked === true ? 1 : 0,
    taskId,
    authorityKind,
    sourceTaskId: boundSourceTaskId,
    emissionSlot: boundEmissionSlot,
    workerId: claim.workerId,
    claimGeneration: claim.generation,
    dispatchId,
    executorOutcome: receiptOutcome.outcome,
    receipt: receiptOutcome.receipt,
    delivery:
      delivery === null
        ? null
        : {
            resultId: delivery.resultId,
            newlyDelivered: delivery.newlyDelivered,
            exactReplay: delivery.exactReplay === true,
          },
    resultId: delivery?.resultId ?? null,
    taskStatus: finalTask.status,
    controlTowerIntake: buildControlTowerIntakeSummary(controlTowerIntake),
    controlTowerRelay: buildControlTowerRelaySummary(controlTowerRelay),
  });
}

export function parseOperatorArgv(argv = []) {
  const options = {
    command: null,
    taskId: null,
    json: false,
    help: false,
    sourceTaskId: null,
    emissionSlot: 'next',
    workerId: DEFAULT_OPERATOR_WORKER_ID,
    leaseDurationMs: DEFAULT_OPERATOR_LEASE_MS,
    opencodePath: null,
    model: null,
    workdir: null,
    specPath: null,
    recorderId: DEFAULT_OPERATOR_RECORDER_ID,
  };
  const positionals = [];
  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`option ${flag} requires a value.`, {
        code: OPERATOR_ARGUMENT_INVALID,
        stage: 'arguments',
        nextAction: 'run `node scripts/coordination/operator-cli.mjs --help`',
      });
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (!argument.startsWith('-')) {
      positionals.push(argument);
      continue;
    }
    switch (argument) {
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--source':
        options.sourceTaskId = readValue(argument, index);
        index += 1;
        break;
      case '--slot':
        options.emissionSlot = readValue(argument, index);
        index += 1;
        break;
      case '--worker':
        options.workerId = readValue(argument, index);
        index += 1;
        break;
      case '--lease-ms': {
        const value = readValue(argument, index);
        index += 1;
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          fail(`--lease-ms must be a positive integer (got ${JSON.stringify(value)}).`, {
            code: OPERATOR_ARGUMENT_INVALID,
            stage: 'arguments',
            nextAction: 'pass --lease-ms <MILLISECONDS>',
          });
        }
        options.leaseDurationMs = parsed;
        break;
      }
      case '--opencode':
        options.opencodePath = readValue(argument, index);
        index += 1;
        break;
      case '--model':
        options.model = readValue(argument, index);
        index += 1;
        break;
      case '--workdir':
        options.workdir = readValue(argument, index);
        index += 1;
        break;
      case '--spec':
        options.specPath = readValue(argument, index);
        index += 1;
        break;
      case '--recorder':
        options.recorderId = readValue(argument, index);
        index += 1;
        break;
      default:
        fail(`unknown option: ${argument}`, {
          code: OPERATOR_ARGUMENT_INVALID,
          stage: 'arguments',
          nextAction: 'run `node scripts/coordination/operator-cli.mjs --help`',
        });
    }
  }
  const command = positionals[0] ?? null;
  if (command !== null && !COMMANDS.includes(command)) {
    fail(`unknown command: ${command}`, {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'arguments',
      nextAction: `choose one of ${COMMANDS.join(', ')}`,
    });
  }
  options.command = command;
  if (
    command === 'inspect' ||
    command === 'run' ||
    command === 'return' ||
    command === 'relay' ||
    command === 'disposition'
  ) {
    if (positionals.length < 2) {
      fail(`${command} requires an explicit <TASK_ID>.`, {
        code: OPERATOR_ARGUMENT_INVALID,
        stage: 'arguments',
        nextAction: `run \`pnpm coordination:${command} <TASK_ID>\``,
      });
    }
    options.taskId = positionals[1];
    assertOperatorTaskId(options.taskId, 'arguments');
    if (positionals.length > 2) {
      fail(`unexpected argument(s): ${positionals.slice(2).join(' ')}`, {
        code: OPERATOR_ARGUMENT_INVALID,
        stage: 'arguments',
        nextAction: 'run `node scripts/coordination/operator-cli.mjs --help`',
      });
    }
  } else if (command === 'intake') {
    if (positionals.length > 2) {
      fail(`unexpected argument(s): ${positionals.slice(2).join(' ')}`, {
        code: OPERATOR_ARGUMENT_INVALID,
        stage: 'arguments',
        nextAction: 'run `node scripts/coordination/operator-cli.mjs --help`',
      });
    }
    if (positionals.length === 2) {
      // Optional cross-check only: the spec file remains the task identity.
      options.taskId = positionals[1];
      assertOperatorTaskId(options.taskId, 'arguments');
    }
    if (typeof options.specPath !== 'string' || !options.specPath.trim()) {
      fail('intake requires --spec <ABSOLUTE_JSON_PATH> carrying the explicit user approval and the bounded READ_ONLY task spec.', {
        code: OPERATOR_ARGUMENT_INVALID,
        stage: 'arguments',
        nextAction: 'run `pnpm coordination:intake --spec <ABSOLUTE_JSON_PATH>`',
      });
    }
  } else if (positionals.length > (command === null ? 0 : 1)) {
    fail(`unexpected argument(s): ${positionals.slice(1).join(' ')}`, {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'arguments',
      nextAction: 'run `node scripts/coordination/operator-cli.mjs --help`',
    });
  }
  return Object.freeze(options);
}

export function renderUsage() {
  return [
    'usage:',
    '  pnpm coordination:status  [--json]',
    '  pnpm coordination:inspect <TASK_ID> [--json]',
    '  pnpm coordination:run <TASK_ID> [--source <SOURCE_TASK_ID>] [--slot <EMISSION_SLOT>]',
    '      [--worker <WORKER_ID>] [--lease-ms <MILLISECONDS>] [--opencode <ABSOLUTE_PATH>]',
    '      [--model <PROVIDER/MODEL>] [--workdir <ABSOLUTE_PATH>] [--json]',
    '  pnpm coordination:return <TASK_ID> [--source <SOURCE_TASK_ID>] [--slot <EMISSION_SLOT>] [--json]',
    '  pnpm coordination:relay <TASK_ID> [--source <SOURCE_TASK_ID>] [--slot <EMISSION_SLOT>] [--json]',
    '  pnpm coordination:disposition <TASK_ID> [--source <SOURCE_TASK_ID>] [--slot <EMISSION_SLOT>] [--json]',
    '  pnpm coordination:intake --spec <ABSOLUTE_JSON_PATH> [<TASK_ID>] [--recorder <ID>] [--json]',
    '',
    'notes:',
    '  run executes exactly one operator-named READ_ONLY task boundary through its existing pre-execution authority (emission admission or user-approved intake), automatically hands the delivered canonical result to the Control Tower result intake (generation 1 PENDING_DISPOSITION), and then attempts the shared Control Tower result relay.',
    `  the executor is the read-only OpenCode CLI structured-result executor; ${OPENCODE_CLI_PATH_ENV_KEY} and ${OPENCODE_MODEL_ENV_KEY} (or --opencode/--model) are required.`,
    '  return hands ONE already delivered canonical result to the Control Tower result intake (idempotent; no executor invocation, no verdict, no successor).',
    `  relay projects ONE already delivered canonical result (existing PENDING/later disposition) to the configured shared GitHub relay issue; set ${CONTROL_TOWER_RELAY_REPO_ENV_KEY}=owner/name to enable it. The relay is non-canonical: it never invokes an executor, never writes durable coordination bytes, and never authors a verdict.`,
    `  disposition reads the Control Tower-authored verdict from the shared decision surface and adopts it as exactly ONE legal next canonical disposition generation; set ${CONTROL_TOWER_RELAY_REPO_ENV_KEY}=owner/name to enable the shared surface. It authors no verdict, invokes no executor, reruns no source task, and fails closed on stale/conflicting decisions or an unavailable surface.`,
    '  intake intakes exactly ONE explicitly user-approved READ_ONLY task spec (userApproved: true + approval + bounded taskSpec) to READY; it never claims, dispatches, or invokes an executor.',
    '  status/inspect never write. JSON output is a read-only projection, never durable authority.',
    '',
  ].join('\n');
}

export function renderOperatorError(error) {
  const code = typeof error?.code === 'string' && error.code ? error.code : OPERATOR_STAGE_FAILED;
  const taskId = error?.taskId ?? '(none)';
  const stage = error?.stage ?? '(unknown)';
  const nextAction = error?.nextAction ?? deriveNextAction(code);
  const message = String(error?.message ?? error)
    .split('\n')[0]
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
  return [
    'ERROR',
    `  code:   ${code}`,
    `  task:   ${taskId}`,
    `  stage:  ${stage}`,
    `  detail: ${message}`,
    `  next:   ${nextAction}`,
    '',
  ].join('\n');
}

function renderRow(columns, widths) {
  return columns
    .map((value, index) => String(value ?? '').padEnd(widths[index]))
    .join('  ')
    .trimEnd();
}

export function renderStatus(projection) {
  const widths = [4, 40, 18, 20, 9, 6, 7, 14, 24];
  const lines = [
    'greenhub coordination status',
    `home:  ${projection.home}`,
    `tasks: ${projection.taskCount} (CREATED ${projection.statusCounts.CREATED}, READY ${projection.statusCounts.READY}, CLAIMED ${projection.statusCounts.CLAIMED}, RESULT_DELIVERED ${projection.statusCounts.RESULT_DELIVERED})`,
    '',
    renderRow(
      ['seq', 'task', 'kind', 'status', 'consumed', 'claim', 'result', 'disposition', 'updated'],
      widths,
    ),
    renderRow(
      widths.map((width) => '-'.repeat(width)),
      widths,
    ),
  ];
  if (projection.tasks.length === 0) {
    lines.push('(no durable tasks)');
  }
  for (const task of projection.tasks) {
    lines.push(
      renderRow(
        [
          task.sequencePosition ?? '-',
          task.taskId,
          task.taskKind,
          task.status,
          task.consumed ? 'yes' : 'no',
          task.claim ? 'yes' : 'no',
          task.canonicalResult ? 'yes' : 'no',
          task.disposition ?? '-',
          task.updatedAt,
        ],
        widths,
      ),
    );
  }
  lines.push('');
  return lines.join('\n');
}

function describePresence(record, fields) {
  if (record === null) return '(absent)';
  const parts = fields
    .filter(([key]) => record[key] !== undefined)
    .map(([key]) => `${key}=${String(record[key])}`);
  return `present  ${parts.join(' ')}`;
}

export function renderInspection(projection) {
  const lines = [
    `greenhub coordination inspect ${projection.taskId}`,
    `home: ${projection.home}`,
    '',
    `task:           ${describePresence(projection.task, [
      ['taskKind', 'taskKind'],
      ['status', 'status'],
      ['updatedAt', 'updatedAt'],
      ['desiredExitState', 'desiredExitState'],
    ])}`,
    `claim:          ${describePresence(projection.claim, [
      ['workerId', 'workerId'],
      ['generation', 'generation'],
      ['claimedAt', 'claimedAt'],
      ['leaseExpiresAt', 'leaseExpiresAt'],
    ])}`,
    `canonical:      ${describePresence(projection.canonicalResult, [
      ['resultId', 'resultId'],
      ['status', 'status'],
      ['summary', 'summary'],
      ['deliveredAt', 'deliveredAt'],
    ])}`,
    `disposition:    ${describePresence(projection.disposition, [
      ['dispositionGeneration', 'generation'],
      ['state', 'state'],
      ['decidedAt', 'decidedAt'],
    ])}`,
    `materialization:${describePresence(projection.materialization, [
      ['materializationId', 'materializationId'],
      ['dispositionGeneration', 'dispositionGeneration'],
      ['materializedAt', 'materializedAt'],
    ])}`,
    `ack:            ${describePresence(projection.ack, [
      ['ackId', 'ackId'],
      ['ackedAt', 'ackedAt'],
    ])}`,
    `consumed:       ${describePresence(projection.consumed, [
      ['consumedId', 'consumedId'],
      ['consumedAt', 'consumedAt'],
    ])}`,
    `intake:         ${describePresence(projection.intake, [
      ['intakeId', 'intakeId'],
      ['recorderId', 'recorderId'],
      ['recordedAt', 'recordedAt'],
    ])}`,
    `receipt:        ${describePresence(projection.executorResultReceipt, [
      ['dispatchId', 'dispatchId'],
      ['status', 'status'],
      ['summary', 'summary'],
    ])}`,
    '',
  ];
  return lines.join('\n');
}

export function renderRunResult(projection) {
  const lines = [
    `greenhub coordination run ${projection.taskId}`,
    `authority: ${projection.authorityKind ?? AUTHORITY_KIND_EMISSION_ADMISSION}`,
    `outcome:  ${projection.outcome}`,
    `source:   ${projection.sourceTaskId} (slot=${projection.emissionSlot})`,
    `worker:   ${projection.workerId} generation=${projection.claimGeneration}`,
    `dispatch: ${projection.dispatchId}`,
  ];
  if (projection.terminal === true) {
    lines.push('executed: no (task already RESULT_DELIVERED; no new executor invocation)');
  } else {
    lines.push(
      `receipt:  ${projection.receipt === null ? '(none)' : `status=${projection.receipt.status} summary=${JSON.stringify(projection.receipt.summary)}`}`,
    );
    lines.push(
      `result:   ${projection.delivery === null ? '(none)' : `${projection.delivery.resultId} (${projection.delivery.newlyDelivered ? 'newly delivered' : 'exact replay'})`}`,
    );
  }
  lines.push(`task:     ${projection.taskStatus}`);
  if (projection.controlTowerIntake !== null && projection.controlTowerIntake !== undefined) {
    lines.push(
      `return:   ${projection.controlTowerIntake.intakeId} disposition=${projection.controlTowerIntake.dispositionRef} ${projection.controlTowerIntake.dispositionState} (${projection.controlTowerIntake.newlyIntaken ? 'newly intaken' : 'exact replay'})`,
    );
  }
  if (projection.controlTowerRelay !== null && projection.controlTowerRelay !== undefined) {
    lines.push(
      `relay:    ${projection.controlTowerRelay.status}${projection.controlTowerRelay.commentId ? ` comment=${projection.controlTowerRelay.commentId}` : ''}${projection.controlTowerRelay.failureCode ? ` (${projection.controlTowerRelay.failureCode})` : ''}`,
    );
  }
  if (projection.outcome === RUN_OUTCOME_EXECUTOR_REJECTED) {
    lines.push(
      'next:     executor boundary exited non-zero; no retry exists — inspect the task and decide manually',
    );
  } else if (projection.outcome === RUN_OUTCOME_EXECUTOR_UNKNOWN) {
    lines.push(
      'next:     executor exit status was unobservable; UNKNOWN is not a retry permission — inspect the task',
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function buildConfiguredExecutor(
  { opencodePath, model, workdir, taskId = null },
  env = process.env,
) {
  const envPath =
    typeof env?.[OPENCODE_CLI_PATH_ENV_KEY] === 'string'
      ? env[OPENCODE_CLI_PATH_ENV_KEY].trim()
      : '';
  const executablePath = opencodePath ?? (envPath.length > 0 ? envPath : null);
  const envModel =
    typeof env?.[OPENCODE_MODEL_ENV_KEY] === 'string' ? env[OPENCODE_MODEL_ENV_KEY].trim() : '';
  const resolvedModel = model ?? (envModel.length > 0 ? envModel : null);
  if (executablePath === null || resolvedModel === null) {
    fail(
      `no READ_ONLY executor is configured: ${OPENCODE_CLI_PATH_ENV_KEY} / ${OPENCODE_MODEL_ENV_KEY} are unset and --opencode / --model were not both provided (no registry, no auto-selection, no fallback executor).`,
      {
        code: OPERATOR_EXECUTOR_NOT_CONFIGURED,
        taskId,
        stage: 'executor-config',
        nextAction: deriveNextAction(OPERATOR_EXECUTOR_NOT_CONFIGURED),
      },
    );
  }
  const resolvedWorkdir = workdir ?? process.cwd();
  try {
    return createOpenCodeCliStructuredResultExecutor({
      executablePath,
      workdir: resolvedWorkdir,
      model: resolvedModel,
    });
  } catch (error) {
    fail(error?.message ?? String(error), {
      code:
        typeof error?.code === 'string' && error.code
          ? error.code
          : OPERATOR_EXECUTOR_NOT_CONFIGURED,
      taskId,
      stage: 'executor-config',
      nextAction: deriveNextAction(OPERATOR_EXECUTOR_NOT_CONFIGURED),
    });
  }
  return null;
}

/**
 * Read ONE operator intake request file: the explicit approval signal, the
 * approval provenance, and ONE bounded READ_ONLY task spec. The file is
 * INPUT ONLY: it is never runtime state, and unknown fields fail closed.
 */
export function readOperatorIntakeRequest({ specPath } = {}) {
  if (typeof specPath !== 'string' || !specPath.trim()) {
    fail('intake requires --spec <ABSOLUTE_JSON_PATH>.', {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'intake',
      nextAction: 'run `pnpm coordination:intake --spec <ABSOLUTE_JSON_PATH>`',
    });
  }
  let raw;
  try {
    raw = nodeFs.readFileSync(specPath, 'utf8');
  } catch (error) {
    fail(`intake spec file could not be read (fail-closed): ${specPath}: ${error?.message}`, {
      code: OPERATOR_INTAKE_SPEC_INVALID,
      stage: 'intake',
      nextAction: deriveNextAction(OPERATOR_INTAKE_SPEC_INVALID),
    });
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    fail(`intake spec file is not valid JSON (fail-closed): ${specPath}: ${error?.message}`, {
      code: OPERATOR_INTAKE_SPEC_INVALID,
      stage: 'intake',
      nextAction: deriveNextAction(OPERATOR_INTAKE_SPEC_INVALID),
    });
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    fail(`intake spec file must contain a JSON object (fail-closed): ${specPath}`, {
      code: OPERATOR_INTAKE_SPEC_INVALID,
      stage: 'intake',
      nextAction: deriveNextAction(OPERATOR_INTAKE_SPEC_INVALID),
    });
  }
  for (const key of Object.keys(document)) {
    if (!OPERATOR_INTAKE_REQUEST_FIELDS.includes(key)) {
      fail(
        `intake spec file must carry exactly (${OPERATOR_INTAKE_REQUEST_FIELDS.join(', ')}); unknown field "${key}" fails closed.`,
        {
          code: OPERATOR_INTAKE_SPEC_INVALID,
          stage: 'intake',
          nextAction: deriveNextAction(OPERATOR_INTAKE_SPEC_INVALID),
        },
      );
    }
  }
  return Object.freeze({
    userApproved: document.userApproved,
    approval: document.approval,
    taskSpec: document.taskSpec,
  });
}

/**
 * Intake exactly ONE explicitly user-approved bounded READ_ONLY task spec into
 * the canonical durable intake authority and converge it to READY. This is the
 * ONLY operator intake entry: it never claims, never dispatches, never invokes
 * an executor, never scans READY tasks, and never creates a successor.
 * The durable store primitive owns all authority semantics; this composition
 * validates the request boundary and the operator-named task cross-check only.
 */
export function performUserApprovedIntake({
  store,
  request,
  taskId = null,
  recorderId = DEFAULT_OPERATOR_RECORDER_ID,
} = {}) {
  if (!store || typeof store.intakeUserApprovedReadOnlyTask !== 'function') {
    fail('intake requires a durable coordination store exposing intakeUserApprovedReadOnlyTask (composition only).', {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'intake',
      nextAction: 'use the package.json coordination:intake command',
    });
  }
  if (typeof store.home !== 'string' || !store.home.trim()) {
    fail('intake requires a resolved coordination home.', {
      code: OPERATOR_INTAKE_SPEC_INVALID,
      stage: 'intake',
      nextAction: deriveNextAction(OPERATOR_INTAKE_SPEC_INVALID),
    });
  }
  if (isSamePathOrDescendant(store.home, REPOSITORY_ROOT)) {
    fail(
      `the coordination runtime home must never live inside the repository worktree (got ${store.home}); runtime state is external local durable state. Set ${COORDINATION_HOME_ENV_KEY} to an external directory.`,
      {
        code: OPERATOR_INTAKE_HOME_INVALID,
        stage: 'intake',
        nextAction: `set ${COORDINATION_HOME_ENV_KEY} to an external durable directory outside the repository worktree`,
      },
    );
  }
  if (typeof recorderId !== 'string' || !recorderId.trim()) {
    fail('recorder id must be a non-empty string.', {
      code: OPERATOR_ARGUMENT_INVALID,
      stage: 'intake',
      nextAction: 'pass --recorder <ID>',
    });
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    fail('intake request must be the exact { userApproved, approval, taskSpec } object.', {
      code: OPERATOR_INTAKE_SPEC_INVALID,
      stage: 'intake',
      nextAction: deriveNextAction(OPERATOR_INTAKE_SPEC_INVALID),
    });
  }
  if (taskId !== null && request.taskSpec?.taskId !== taskId) {
    fail(
      `intake positional taskId ${JSON.stringify(taskId)} does not match the spec taskSpec.taskId ${JSON.stringify(request.taskSpec?.taskId)} (fail-closed).`,
      {
        code: OPERATOR_INTAKE_SPEC_INVALID,
        stage: 'intake',
        taskId,
        nextAction: deriveNextAction(OPERATOR_INTAKE_SPEC_INVALID),
      },
    );
  }
  const result = atSyncStage('intake', request.taskSpec?.taskId ?? null, () =>
    store.intakeUserApprovedReadOnlyTask({
      userApproved: request.userApproved,
      approval: request.approval,
      taskSpec: request.taskSpec,
      recorderId,
    }),
  );
  return Object.freeze({
    schemaVersion: OPERATOR_PROJECTION_SCHEMA_VERSION,
    projection: OPERATOR_INTAKE_PROJECTION,
    authorityKind: AUTHORITY_KIND_USER_APPROVED_INTAKE,
    intakeId: result.record.intakeId,
    taskId: result.record.taskId,
    taskKind: result.record.taskSpec.taskKind,
    desiredExitState: result.record.taskSpec.desiredExitState,
    intakeSpecBinding: result.record.intakeSpecBinding,
    approval: result.record.approval,
    duplicate: result.duplicate === true,
    taskStatus: result.task.status,
  });
}

export function renderIntakeResult(projection) {
  return [
    `greenhub coordination intake ${projection.taskId}`,
    `intake:   ${projection.intakeId} (${projection.duplicate ? 'exact replay' : 'newly recorded'})`,
    `approval: ${projection.approval.approvedBy} ref=${JSON.stringify(projection.approval.approvalRef)}`,
    `binding:  ${projection.intakeSpecBinding}`,
    `task:     ${projection.taskKind} ${projection.taskStatus}`,
    'next:     pnpm coordination:run ' + projection.taskId,
    '',
  ].join('\n');
}

export function renderControlTowerReturn(projection) {
  return [
    `greenhub coordination return ${projection.taskId}`,
    `authority:  ${projection.authorityKind} ${projection.authorityId}`,
    `intake:     ${projection.intake.intakeId} (${projection.newlyIntaken ? 'newly intaken' : 'exact replay'})`,
    `disposition: ${projection.disposition.dispositionRef} ${projection.disposition.state}`,
    `result:     ${projection.intake.resultId} status=${projection.intake.result.status}`,
    `summary:    ${JSON.stringify(projection.intake.result.summary)}`,
    'next:       Control Tower canonical state recompute / live-main re-read / publication classification (no manual copy/paste)',
    '',
  ].join('\n');
}

export function renderControlTowerRelay(projection) {
  const lines = [
    `greenhub coordination relay ${projection.taskId}`,
    `authority:   ${projection.authorityKind} ${projection.authorityId}`,
    `status:      ${projection.status}`,
  ];
  if (projection.relayId !== null) lines.push(`relay:       ${projection.relayId}`);
  if (projection.issue !== null && projection.issue !== undefined) {
    lines.push(
      `issue:       #${projection.issue.issueNumber} ${projection.issue.url ?? ''} (${projection.issue.created ? 'created' : 'reused'})`.trimEnd(),
    );
  }
  if (projection.comment !== null && projection.comment !== undefined) {
    lines.push(
      `comment:     ${projection.comment.commentId ?? '(unknown)'} ${projection.comment.url ?? ''}`.trimEnd(),
    );
  }
  if (projection.duplicateProjectionCount > 1) {
    lines.push(
      `duplicates:  ${projection.duplicateProjectionCount} identical projections converged read-only (no rewrite, no delete)`,
    );
  }
  if (projection.disposition !== null && projection.disposition !== undefined) {
    lines.push(
      `disposition: ${projection.disposition.dispositionRef} ${projection.disposition.dispositionState}`,
    );
  }
  if (projection.failureCode !== null) {
    lines.push(`failure:     ${projection.failureCode}: ${projection.failureMessage ?? ''}`.trimEnd());
  }
  lines.push(
    'next:        Control Tower reads the shared relay; canonical truth remains local (no manual copy/paste)',
  );
  lines.push('');
  return lines.join('\n');
}

export function renderControlTowerDispositionReturn(projection) {
  const lines = [
    `greenhub coordination disposition ${projection.taskId}`,
    `authority:   ${projection.authorityKind} ${projection.authorityId}`,
    `status:      ${projection.status}`,
  ];
  if (projection.surface !== null && projection.surface !== undefined) {
    lines.push(
      `surface:     issue #${projection.surface.issueNumber} ${projection.surface.url ?? ''}`.trimEnd(),
    );
  }
  if (projection.decision !== null && projection.decision !== undefined) {
    lines.push(`decision:    ${projection.decision.decisionId}`);
    lines.push(
      `verdict:     ${projection.decision.dispositionRef} ${projection.decision.dispositionState} -> ${projection.decision.targetDispositionState} (decidedAt ${projection.decision.decidedAt})`,
    );
  }
  if (projection.observedDisposition !== null && projection.observedDisposition !== undefined) {
    lines.push(
      `observed:    ${projection.observedDisposition.dispositionRef} ${projection.observedDisposition.state}`,
    );
  }
  if (projection.returnedDisposition !== null && projection.returnedDisposition !== undefined) {
    lines.push(
      `canonical:   ${projection.returnedDisposition.dispositionRef} ${projection.returnedDisposition.state}`,
    );
  }
  if (projection.failureCode !== null) {
    lines.push(`failure:     ${projection.failureCode}: ${projection.failureMessage ?? ''}`.trimEnd());
  }
  lines.push(
    'next:        canonical truth is local; the shared decision surface remains non-canonical (no manual copy/paste)',
  );
  lines.push('');
  return lines.join('\n');
}

export async function runOperatorCli({
  argv = [],
  env = process.env,
  platform = process.platform,
  stdout = process.stdout,
  stderr = process.stderr,
  store,
  executor,
  relayTransport,
  dispositionTransport,
} = {}) {
  let options;
  try {
    options = parseOperatorArgv(argv);
  } catch (error) {
    stderr.write(renderOperatorError(error));
    return error?.code === OPERATOR_ARGUMENT_INVALID ? 2 : 1;
  }
  if (options.help || options.command === null) {
    stdout.write(renderUsage());
    return 0;
  }
  const activeStore = store ?? new CoordinationStore({ env, platform });
  try {
    if (options.command === 'status') {
      const projection = collectStatusOverview({ store: activeStore });
      stdout.write(
        options.json ? `${JSON.stringify(projection, null, 2)}\n` : renderStatus(projection),
      );
      return 0;
    }
    if (options.command === 'inspect') {
      const projection = collectTaskInspection({ store: activeStore, taskId: options.taskId });
      stdout.write(
        options.json ? `${JSON.stringify(projection, null, 2)}\n` : renderInspection(projection),
      );
      return 0;
    }
    if (options.command === 'intake') {
      const request = readOperatorIntakeRequest({ specPath: options.specPath });
      const projection = performUserApprovedIntake({
        store: activeStore,
        request,
        taskId: options.taskId,
        recorderId: options.recorderId,
      });
      stdout.write(
        options.json ? `${JSON.stringify(projection, null, 2)}\n` : renderIntakeResult(projection),
      );
      return 0;
    }
    if (options.command === 'return') {
      const projection = atSyncStage('control-tower-intake', options.taskId, () => {
        const resolved = resolveTaskAdmission({
          store: activeStore,
          taskId: options.taskId,
          sourceTaskId: options.sourceTaskId ?? undefined,
          emissionSlot: options.emissionSlot,
        });
        if (resolved === null) {
          fail(
            `no canonical pre-execution authority (emission admission or user-approved intake) binds task ${options.taskId} (fail-closed): the operator CLI never creates an authority and returns only authority-bound results.`,
            {
              code: OPERATOR_TASK_ADMISSION_NOT_FOUND,
              taskId: options.taskId,
              stage: 'control-tower-intake',
              nextAction: deriveNextAction(OPERATOR_TASK_ADMISSION_NOT_FOUND),
            },
          );
        }
        const performed = performControlTowerResultIntake({
          store: activeStore,
          taskId: options.taskId,
          authority: {
            authorityKind: resolved.authorityKind,
            authorityId: resolved.authorityId,
            sourceTaskId: resolved.sourceTaskId,
            emissionSlot: resolved.emissionSlot,
          },
        });
        return buildControlTowerReturnProjection({
          taskId: options.taskId,
          resolved,
          performed,
        });
      });
      stdout.write(
        options.json
          ? `${JSON.stringify(projection, null, 2)}\n`
          : renderControlTowerReturn(projection),
      );
      return 0;
    }
    if (options.command === 'relay') {
      const resolvedTransport =
        relayTransport ?? resolveConfiguredControlTowerRelayTransport({ env });
      if (resolvedTransport === null) {
        fail(
          `no shared relay transport is configured (fail-closed): set ${CONTROL_TOWER_RELAY_REPO_ENV_KEY}=owner/name to enable the non-canonical GitHub relay.`,
          {
            code: CONTROL_TOWER_RESULT_RELAY_STATUS_NOT_CONFIGURED,
            taskId: options.taskId,
            stage: 'control-tower-relay',
            nextAction: deriveNextAction(CONTROL_TOWER_RESULT_RELAY_STATUS_NOT_CONFIGURED),
          },
        );
      }
      const projection = await atStage('control-tower-relay', options.taskId, async () => {
        const resolved = resolveTaskAdmission({
          store: activeStore,
          taskId: options.taskId,
          sourceTaskId: options.sourceTaskId ?? undefined,
          emissionSlot: options.emissionSlot,
        });
        if (resolved === null) {
          fail(
            `no canonical pre-execution authority (emission admission or user-approved intake) binds task ${options.taskId} (fail-closed): the operator CLI never creates an authority and relays only authority-bound results.`,
            {
              code: OPERATOR_TASK_ADMISSION_NOT_FOUND,
              taskId: options.taskId,
              stage: 'control-tower-relay',
              nextAction: deriveNextAction(OPERATOR_TASK_ADMISSION_NOT_FOUND),
            },
          );
        }
        const performed = await performControlTowerResultRelay({
          store: activeStore,
          taskId: options.taskId,
          authority: {
            authorityKind: resolved.authorityKind,
            authorityId: resolved.authorityId,
            sourceTaskId: resolved.sourceTaskId,
            emissionSlot: resolved.emissionSlot,
          },
          transport: resolvedTransport,
        });
        return buildControlTowerRelayProjection({
          taskId: options.taskId,
          resolved,
          performed,
        });
      });
      stdout.write(
        options.json
          ? `${JSON.stringify(projection, null, 2)}\n`
          : renderControlTowerRelay(projection),
      );
      return projection.status === CONTROL_TOWER_RESULT_RELAY_STATUS_PENDING ? 1 : 0;
    }
    if (options.command === 'disposition') {
      const resolvedTransport =
        dispositionTransport ?? resolveConfiguredControlTowerRelayTransport({ env });
      if (resolvedTransport === null) {
        fail(
          `no shared Control Tower decision surface is configured (fail-closed): set ${CONTROL_TOWER_RELAY_REPO_ENV_KEY}=owner/name to enable the non-canonical shared surface.`,
          {
            code: CONTROL_TOWER_DISPOSITION_RETURN_NOT_CONFIGURED,
            taskId: options.taskId,
            stage: 'control-tower-disposition-return',
            nextAction: deriveNextAction(CONTROL_TOWER_DISPOSITION_RETURN_NOT_CONFIGURED),
          },
        );
      }
      const projection = await atStage(
        'control-tower-disposition-return',
        options.taskId,
        async () => {
          const resolved = resolveTaskAdmission({
            store: activeStore,
            taskId: options.taskId,
            sourceTaskId: options.sourceTaskId ?? undefined,
            emissionSlot: options.emissionSlot,
          });
          if (resolved === null) {
            fail(
              `no canonical pre-execution authority (emission admission or user-approved intake) binds task ${options.taskId} (fail-closed): the operator CLI never creates an authority and adopts only authority-bound decisions.`,
              {
                code: OPERATOR_TASK_ADMISSION_NOT_FOUND,
                taskId: options.taskId,
                stage: 'control-tower-disposition-return',
                nextAction: deriveNextAction(OPERATOR_TASK_ADMISSION_NOT_FOUND),
              },
            );
          }
          const performed = await performControlTowerDispositionReturn({
            store: activeStore,
            taskId: options.taskId,
            authority: {
              authorityKind: resolved.authorityKind,
              authorityId: resolved.authorityId,
              sourceTaskId: resolved.sourceTaskId,
              emissionSlot: resolved.emissionSlot,
            },
            transport: resolvedTransport,
          });
          return buildControlTowerDispositionReturnProjection({
            taskId: options.taskId,
            resolved,
            performed,
          });
        },
      );
      stdout.write(
        options.json
          ? `${JSON.stringify(projection, null, 2)}\n`
          : renderControlTowerDispositionReturn(projection),
      );
      return projection.status === CONTROL_TOWER_DISPOSITION_RETURN_STATUS_PENDING ? 1 : 0;
    }
    const activeExecutor = executor ?? buildConfiguredExecutor(options, env);
    // GF-08 automatic relay transport: explicit injection wins; otherwise the
    // explicit environment binding. A malformed binding must not block the
    // canonical execution path, so it degrades to a transport that reports
    // RELAY_PENDING with the configuration code.
    let activeRelayTransport = relayTransport ?? null;
    if (activeRelayTransport === null) {
      try {
        activeRelayTransport = resolveConfiguredControlTowerRelayTransport({ env });
      } catch (error) {
        activeRelayTransport = createUnavailableRelayTransport(error);
      }
    }
    const projection = await executeOperatorTask({
      store: activeStore,
      taskId: options.taskId,
      sourceTaskId: options.sourceTaskId ?? undefined,
      emissionSlot: options.emissionSlot,
      workerId: options.workerId,
      leaseDurationMs: options.leaseDurationMs,
      executor: activeExecutor,
      relayTransport: activeRelayTransport,
    });
    stdout.write(
      options.json ? `${JSON.stringify(projection, null, 2)}\n` : renderRunResult(projection),
    );
    return projection.outcome === RUN_OUTCOME_EXECUTED ||
      projection.outcome === RUN_OUTCOME_ALREADY_TERMINAL
      ? 0
      : 1;
  } catch (error) {
    stderr.write(renderOperatorError(error));
    return 1;
  }
}

const invokedAsMainScript =
  process.argv[1] != null && nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMainScript) {
  process.exitCode = await runOperatorCli({ argv: process.argv.slice(2) });
}
