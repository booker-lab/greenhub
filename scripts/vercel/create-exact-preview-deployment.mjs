/**
 * Provider-native exact-SHA targeted Preview deployment capability
 * (PILOT-AUTH-EXACT-SHA-VERCEL-TARGETED-PREVIEW-CAPABILITY-44A).
 *
 * Problem closed: `provision-exact-preview` relies on
 * `Git ref push -> Vercel Git auto-trigger`, which 42C proved does NOT
 * create Consumer/Seller deployments (`VERCEL_DEPLOYMENT_NOT_CREATED`
 * before the ignore-build stage). This module uses the Vercel-official
 * provider-native path instead:
 *
 *   POST /v13/deployments?teamId=<team>&forceNew=1&skipAutoDetectionConfirmation=1
 *   { name, project, gitSource: { type:'github', org, repo, ref: sha, sha } }
 *   // `target` is OMITTED so Vercel infers `preview` (null).
 *
 * Why this path:
 * - Git source provenance stays provider-readable: the created deployment
 *   carries `meta.githubCommitSha` / `gitSource.sha` equal to the requested
 *   exact SHA. File-upload (`files:`) provenance is NOT used.
 * - No `preview-exact/*` ref push is required, no merge commit is faked,
 *   no tree-equality substitutes for SHA-equality, no `main`/`preview`
 *   ref is mutated, no production target is reachable.
 * - `both` = consumer + seller only; `driver` is an independent single scope.
 *
 * Authority (single source, never duplicated):
 * - Project allowlist + team + API origin are imported from
 *   `scripts/wait-preview-deploy.mjs` (`PREVIEW_APPS`, `VERCEL_TEAM_ID`,
 *   `VERCEL_API_ORIGIN`). If the provider reports a different project,
 *   creation fails closed (`VERCEL_PROJECT_MISMATCH`).
 * - Commit existence uses `commitExists` from
 *   `scripts/vercel/provision-exact-preview.mjs` (git `cat-file -e`).
 * - Final READY + exact-SHA proof stays in `wait-preview-deploy.mjs`
 *   strict predicate. This module never weakens it; creation IDs are
 *   passed straight into that waiter.
 *
 * Credential model (values are NEVER logged) — 45B project-scoped convergence:
 * - Canonical exact-preview credential is PER APP, each scoped to ONE Vercel
 *   project only:
 *     consumer -> VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN
 *     seller   -> VERCEL_EXACT_PREVIEW_SELLER_TOKEN
 *     driver   -> VERCEL_EXACT_PREVIEW_DRIVER_TOKEN
 *   `app=both` requires the consumer token + the seller token together; the
 *   driver token is never consumed and never fanned out to another project.
 * - One project token is used for BOTH that app's exact Preview creation POST
 *   and the pinned deployment metadata readback of that creation. Vercel has
 *   no operation-level create-only/read-only scope, so credential scope and
 *   the application guard below are SEPARATE defense lines.
 * - Project-scoped requests send NO `teamId` query: the credential itself
 *   carries the project/team context. The legacy team-scoped creation secret
 *   (`VERCEL_EXACT_PREVIEW_DEPLOY_TOKEN` + `?teamId=`) stays only as an
 *   explicit opt-in (`credentialMode: 'legacy-team-scoped'`); credential type
 *   is never guessed from token shape.
 * - Token travels only in the `Authorization: Bearer` header. It is never
 *   placed in URL, body, logs, artifacts, or return values.
 * - Missing per-app token fails with that app's own fail-closed code
 *   (`VERCEL_CONSUMER_PROJECT_TOKEN_REQUIRED` /
 *   `VERCEL_SELLER_PROJECT_TOKEN_REQUIRED` /
 *   `VERCEL_DRIVER_PROJECT_TOKEN_REQUIRED`) BEFORE any provider POST.
 * - Minimal permission: create Preview deployments on the allowlisted
 *   project(s) of its own app. No production deploy/promote/alias, no env/secret mutation.
 *
 * Result contract (per app):
 * - project / projectId exact match, deployment ID present (`dpl_*`),
 *   deployment URL present, provider Git SHA == requested SHA when the
 *   provider reports one, target is Preview (`null`/absent), state is
 *   tracked (`READY` vs `BUILDING`/`QUEUED` pending vs `ERROR`/`CANCELED` fail).
 * - Creation responses are usually `QUEUED`/`BUILDING`; `READY` is proven
 *   by polling the canonical GET (`wait-preview-deploy.mjs`), not by
 *   assuming creation == ready.
 * - Failure codes:
 *   - `EXACT_SHA_MALFORMED` / `UNKNOWN_TARGETED_APP` / `PRODUCTION_TARGET_REFUSED`
 *   - `UNKNOWN_COMMIT_SHA` (no such commit object)
 *   - `VERCEL_CONSUMER_PROJECT_TOKEN_REQUIRED` /
 *     `VERCEL_SELLER_PROJECT_TOKEN_REQUIRED` /
 *     `VERCEL_DRIVER_PROJECT_TOKEN_REQUIRED` (per-app project token missing)
 *   - `VERCEL_DEPLOY_TOKEN_REQUIRED` (legacy team-scoped secret missing)
 *   - `PROVIDER_TARGETED_DEPLOYMENT_FAILED` (POST / HTTP / JSON failure)
 *   - `MISSING_DEPLOYMENT_ID` / `VERCEL_PROJECT_MISMATCH`
 *   - `PRODUCTION_SAFETY_VIOLATION` (provider target is production/staging)
 *   - `EXACT_PROVIDER_SHA_BINDING_FAILED` (provider SHA present but != requested)
 *   - `VERCEL_NOT_READY` (ERROR/CANCELED at creation inspection)
 *
 * Runtime needs: `node` + `git` (existence check) + `fetch` (injected in tests).
 * No dependencies, no install step, no Git ref push, no CLI required.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXACT_PREVIEW_CREDENTIAL_MODE_PROJECT_SCOPED,
  EXACT_PREVIEW_TOKEN_REQUIRED_BY_APP,
  EXACT_PREVIEW_TOKENS_BY_APP,
  PREVIEW_APPS,
  VERCEL_API_ORIGIN,
  VERCEL_TEAM_ID,
} from '../wait-preview-deploy.mjs';
import { commitExists as provisionCommitExists } from './provision-exact-preview.mjs';

export const REPO = 'booker-lab/greenhub';
export const REPO_ORG = 'booker-lab';
export const REPO_NAME = 'greenhub';

/**
 * Canonical 45B creation credential modes. `project-scoped` (default) uses one
 * token per app with no `teamId` query. `legacy-team-scoped` keeps the single
 * team secret + `?teamId=` path for explicit opt-in only.
 */
export const CREATE_CREDENTIAL_MODE_PROJECT_SCOPED = EXACT_PREVIEW_CREDENTIAL_MODE_PROJECT_SCOPED;
export const CREATE_CREDENTIAL_MODE_LEGACY_TEAM = 'legacy-team-scoped';

/** Per-app project-scoped creation token env names (canonical 45B). */
export const VERCEL_EXACT_PREVIEW_CONSUMER_TOKEN = EXACT_PREVIEW_TOKENS_BY_APP.consumer;
export const VERCEL_EXACT_PREVIEW_SELLER_TOKEN = EXACT_PREVIEW_TOKENS_BY_APP.seller;
export const VERCEL_EXACT_PREVIEW_DRIVER_TOKEN = EXACT_PREVIEW_TOKENS_BY_APP.driver;
export const EXACT_PREVIEW_CREATE_TOKENS_BY_APP = EXACT_PREVIEW_TOKENS_BY_APP;
/** Per-app fail-closed codes for a missing project token. */
export const EXACT_PREVIEW_CREATE_TOKEN_REQUIRED_BY_APP = EXACT_PREVIEW_TOKEN_REQUIRED_BY_APP;

/**
 * Legacy single-secret creation credential (team-scoped). Deprecated for the
 * 44A exact-preview path; retained for explicit `legacy-team-scoped` opt-in.
 */
export const VERCEL_CREATE_CREDENTIAL_ENV = 'VERCEL_EXACT_PREVIEW_DEPLOY_TOKEN';
export const VERCEL_READ_CREDENTIAL_ENV = 'ROUND_DIRECT_E2E_VERCEL_READ_TOKEN';

/** Caller app selection. `both` = consumer + seller only. */
export const TARGETED_APP_ALLOWLIST = Object.freeze(['consumer', 'seller', 'driver', 'both']);

export const TARGETED_SCOPE_TO_APPS = Object.freeze({
  consumer: Object.freeze(['consumer']),
  seller: Object.freeze(['seller']),
  driver: Object.freeze(['driver']),
  both: Object.freeze(['consumer', 'seller']),
});

export const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const RETRYABLE_CREATION_STATES = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);
const FAILED_CREATION_STATES = new Set(['ERROR', 'CANCELED']);

export class TargetedDeploymentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetedDeploymentError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TargetedDeploymentError(code, message);
}

function redactCheck(value, token) {
  if (typeof token !== 'string' || token.length < 4) return;
  if (typeof value === 'string' && value.includes(token)) {
    fail('SECRET_REDACTION_VIOLATION', 'credential value must never appear in messages or payloads.');
  }
}

/** Strict lowercase full 40-char SHA, verbatim (no silent normalization). */
export function assertExactSha(value) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    fail('EXACT_SHA_MALFORMED', 'exact SHA는 40자리 소문자 16진수여야 합니다.');
  }
  return value;
}

/** App selection guard. Production/main/preview are impossible here. */
export function assertTargetedApp(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!TARGETED_APP_ALLOWLIST.includes(normalized)) {
    fail(
      'UNKNOWN_TARGETED_APP',
      `알 수 없는 targeted 앱입니다: ${JSON.stringify(value)} (consumer|seller|driver|both만 허용)`,
    );
  }
  return normalized;
}

export function resolveTargetedApps(app) {
  const scope = assertTargetedApp(app);
  return [...TARGETED_SCOPE_TO_APPS[scope]];
}

/** Only null/undefined/preview (or empty) are accepted. Anything else fails closed. */
export function assertNonProductionTarget(target) {
  if (target === undefined || target === null) return null;
  const normalized = String(target).trim().toLowerCase();
  if (normalized === '' || normalized === 'preview' || normalized === 'null') return null;
  fail('PRODUCTION_TARGET_REFUSED', 'targeted deployment target은 Preview(non-production)만 허용됩니다.');
}

function assertNoProductionLeak(body) {
  const serialized = JSON.stringify(body);
  // Production surface must not exist in the outbound creation body.
  for (const forbidden of ['"production"', '"staging"', '"alias"', '"promote"']) {
    if (serialized.includes(forbidden)) {
      fail('PRODUCTION_SAFETY_VIOLATION', 'creation body에 production/staging/alias/promote 경로가 포함되어 실행을 차단합니다.');
    }
  }
  if (Object.hasOwn(body, 'target') && body.target !== undefined && body.target !== null) {
    fail('PRODUCTION_SAFETY_VIOLATION', 'creation body target은 생략(Preview 추론)만 허용됩니다.');
  }
  if (Object.hasOwn(body, 'files')) {
    fail('PRODUCTION_SAFETY_VIOLATION', 'file-upload provenance는 허용되지 않습니다 (gitSource만 사용).');
  }
  if (Object.hasOwn(body, 'deploymentId')) {
    fail('PRODUCTION_SAFETY_VIOLATION', 'redeploy(deploymentId) 경로는 허용되지 않습니다 (exact SHA gitSource만 사용).');
  }
}

/** Canonical project authority comes from wait-preview-deploy PREVIEW_APPS. */
export function getProjectConfig(app) {
  const config = PREVIEW_APPS.find((entry) => entry.app === app);
  if (!config) {
    fail('VERCEL_PROJECT_MISMATCH', `allowlist에 없는 앱입니다: ${JSON.stringify(app)}`);
  }
  return config;
}

export function assertProjectAllowlist(apps) {
  for (const app of apps) {
    getProjectConfig(app);
  }
  return true;
}

/**
 * Build the Vercel POST body for one app. `target` is intentionally omitted
 * so Vercel infers `preview` (null). `ref` and `sha` are BOTH the exact SHA:
 * no branch ambiguity, no merge commit, no ref push.
 */
export function buildVercelCreateBody({ app, sha }) {
  const validSha = assertExactSha(sha);
  const normalizedApp = assertTargetedApp(app);
  if (normalizedApp === 'both') {
    fail('UNKNOWN_TARGETED_APP', 'both는 fan-out 선택자이며 단일 project body로 만들 수 없습니다.');
  }
  const config = getProjectConfig(normalizedApp);
  const body = Object.freeze({
    name: config.project,
    project: config.projectId,
    gitSource: Object.freeze({
      type: 'github',
      org: REPO_ORG,
      repo: REPO_NAME,
      ref: validSha,
      sha: validSha,
    }),
    meta: Object.freeze({
      exactPreviewSha: validSha,
      exactPreviewApp: normalizedApp,
    }),
  });
  assertNoProductionLeak(body);
  return body;
}

/** Legacy team-scoped POST path (explicit opt-in only; 45B canonical path omits teamId). */
export function vercelCreatePath(teamId = VERCEL_TEAM_ID) {
  if (typeof teamId !== 'string' || !teamId.trim()) {
    fail('VERCEL_PROJECT_MISMATCH', 'Vercel team scope가 비어 있어 실행을 차단합니다.');
  }
  const query = new URLSearchParams({
    teamId: teamId.trim(),
    forceNew: '1',
    skipAutoDetectionConfirmation: '1',
  });
  return `/v13/deployments?${query}`;
}

/**
 * Canonical 45B project-scoped POST path: NO `teamId` query is forced. The
 * per-app project token itself carries the project/team context.
 */
export function vercelCreateProjectScopedPath() {
  const query = new URLSearchParams({
    forceNew: '1',
    skipAutoDetectionConfirmation: '1',
  });
  const pathname = `/v13/deployments?${query}`;
  if (pathname.includes('teamId')) {
    fail('SECRET_REDACTION_VIOLATION', 'project-scoped creation path must never force teamId.');
  }
  return pathname;
}

export function assertCreateCredentialMode(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    normalized !== CREATE_CREDENTIAL_MODE_PROJECT_SCOPED &&
    normalized !== CREATE_CREDENTIAL_MODE_LEGACY_TEAM
  ) {
    fail(
      'UNKNOWN_CREDENTIAL_MODE',
      `알 수 없는 credential mode입니다: ${JSON.stringify(value)} (project-scoped|legacy-team-scoped만 허용)`,
    );
  }
  return normalized;
}

/** Env name holding the project-scoped creation token for one app. */
export function exactPreviewCreateTokenEnvForApp(app) {
  const env = EXACT_PREVIEW_CREATE_TOKENS_BY_APP[app];
  if (!env) {
    fail('VERCEL_PROJECT_MISMATCH', `allowlist에 없는 앱입니다: ${JSON.stringify(app)}`);
  }
  return env;
}

/** Fail-closed code when one app's project token is missing. */
export function exactPreviewCreateTokenRequiredCode(app) {
  const code = EXACT_PREVIEW_CREATE_TOKEN_REQUIRED_BY_APP[app];
  if (!code) {
    fail('VERCEL_PROJECT_MISMATCH', `allowlist에 없는 앱입니다: ${JSON.stringify(app)}`);
  }
  return code;
}

function readProjectScopedCreateTokenFromEnv(app) {
  const value = process.env?.[exactPreviewCreateTokenEnvForApp(app)];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Resolve ONE app's project-scoped creation token. No cross-app reuse: a
 * missing token for `app` fails with that app's own code even when another
 * app's token is present. Explicit `tokensByApp` entries win; absent entries
 * fall back to their own per-app env var only.
 */
export function resolveAppProjectToken(app, tokensByApp = null) {
  const normalizedApp = assertTargetedApp(app);
  if (normalizedApp === 'both') {
    fail('UNKNOWN_TARGETED_APP', 'both는 fan-out 선택자이며 단일 project token으로 해석할 수 없습니다.');
  }
  getProjectConfig(normalizedApp);
  const explicit = tokensByApp?.[normalizedApp];
  const token =
    typeof explicit === 'string' && explicit.trim()
      ? explicit.trim()
      : readProjectScopedCreateTokenFromEnv(normalizedApp);
  if (!token) {
    fail(
      exactPreviewCreateTokenRequiredCode(normalizedApp),
      `${exactPreviewCreateTokenEnvForApp(normalizedApp)}가 없어 ${normalizedApp} Preview deployment를 생성할 수 없습니다 (타 앱 token으로 대체 불가).`,
    );
  }
  return token;
}

/**
 * Resolve every app in scope to its OWN project token BEFORE any provider
 * POST, so a missing token fails with POST 0회. `both` resolves consumer +
 * seller independently; the driver token is never consulted for `both`.
 * Returns a frozen app -> token map.
 */
export function resolveProjectScopedTokensForScope(scope, tokensByApp = null) {
  const apps = resolveTargetedApps(scope);
  const resolved = {};
  for (const app of apps) {
    resolved[app] = resolveAppProjectToken(app, tokensByApp);
  }
  return Object.freeze(resolved);
}

function vercelCreateHeaders(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Legacy single-secret resolver (team-scoped). Retained for explicit
 * `legacy-team-scoped` opt-in; the canonical 45B path resolves per-app tokens
 * via `resolveProjectScopedTokensForScope` instead.
 */
export function resolveCreateToken(explicitToken) {
  const fromArg = typeof explicitToken === 'string' && explicitToken.trim() ? explicitToken.trim() : null;
  const fromEnv =
    typeof process.env?.[VERCEL_CREATE_CREDENTIAL_ENV] === 'string' &&
    process.env[VERCEL_CREATE_CREDENTIAL_ENV].trim()
      ? process.env[VERCEL_CREATE_CREDENTIAL_ENV].trim()
      : null;
  const token = fromArg ?? fromEnv;
  if (!token) {
    fail(
      'VERCEL_DEPLOY_TOKEN_REQUIRED',
      `${VERCEL_CREATE_CREDENTIAL_ENV}가 없어 provider-native Preview deployment를 생성할 수 없습니다 (read-only token으로 대체 불가).`,
    );
  }
  return token;
}

/**
 * Provider-native creation POST for one app. `fetchImpl` is injectable for
 * deterministic tests. Token is header-only, never in URL/body/logs.
 * `credentialMode` selects the POST path explicitly: `project-scoped`
 * (default, no `teamId` query) or `legacy-team-scoped` (`?teamId=`).
 * Callers must pass THIS app's own project token; cross-app reuse is refused
 * by the fan-out wrapper (`createExactPreviewDeployments`), never here.
 */
export async function requestVercelCreateDeployment({ app, sha, token, fetchImpl = fetch, credentialMode = CREATE_CREDENTIAL_MODE_PROJECT_SCOPED }) {
  const validSha = assertExactSha(sha);
  const config = getProjectConfig(assertTargetedApp(app));
  const mode = assertCreateCredentialMode(credentialMode);
  if (typeof token !== 'string' || !token.trim()) {
    if (mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM) {
      fail(
        'VERCEL_DEPLOY_TOKEN_REQUIRED',
        `${VERCEL_CREATE_CREDENTIAL_ENV}가 없어 provider-native Preview deployment를 생성할 수 없습니다.`,
      );
    }
    fail(
      exactPreviewCreateTokenRequiredCode(config.app),
      `${exactPreviewCreateTokenEnvForApp(config.app)}가 없어 provider-native Preview deployment를 생성할 수 없습니다.`,
    );
  }
  const cleanToken = token.trim();
  const body = buildVercelCreateBody({ app: config.app, sha: validSha });
  // Fail closed if caller accidentally passes the read-only token VALUE as creation token?
  // We cannot know the read token value here; the workflow documents non-substitutability.
  const url =
    mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM
      ? `${VERCEL_API_ORIGIN}${vercelCreatePath()}`
      : `${VERCEL_API_ORIGIN}${vercelCreateProjectScopedPath()}`;
  if (url.includes(cleanToken) || JSON.stringify(body).includes(cleanToken)) {
    fail('SECRET_REDACTION_VIOLATION', 'credential value must never appear in URL or body.');
  }
  if (url.includes('teamId=') === (mode === CREATE_CREDENTIAL_MODE_PROJECT_SCOPED)) {
    fail(
      'SECRET_REDACTION_VIOLATION',
      mode === CREATE_CREDENTIAL_MODE_PROJECT_SCOPED
        ? 'project-scoped creation request must not force teamId.'
        : 'legacy-team-scoped creation request must carry teamId.',
    );
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: vercelCreateHeaders(cleanToken),
      body: JSON.stringify(body),
    });
  } catch {
    fail('PROVIDER_TARGETED_DEPLOYMENT_FAILED', `${config.app} Vercel creation 요청에 실패했습니다.`);
  }

  if (!response?.ok) {
    const status = Number(response?.status);
    const suffix = Number.isInteger(status) && status > 0 ? `_${status}` : '';
    let providerHint = '';
    try {
      const errorPayload = await response.json();
      const hint =
        errorPayload?.error?.message ?? errorPayload?.error?.code ?? errorPayload?.message ?? '';
      if (typeof hint === 'string' && hint.trim()) {
        providerHint = `: ${hint.trim().slice(0, 200)}`;
        redactCheck(providerHint, cleanToken);
      }
    } catch {
      // Ignore provider error-body parse failures; keep fail-closed code.
    }
    fail(
      'PROVIDER_TARGETED_DEPLOYMENT_FAILED',
      `${config.app} Vercel creation API가 성공 응답을 반환하지 않았습니다${suffix ? ` (HTTP ${status})` : ''}${providerHint}.`,
    );
  }

  try {
    const payload = await response.json();
    redactCheck(JSON.stringify(payload), cleanToken);
    return payload;
  } catch {
    fail('PROVIDER_TARGETED_DEPLOYMENT_FAILED', `${config.app} Vercel creation JSON 응답이 잘못되었습니다.`);
  }
}

function creationDeploymentId(payload) {
  const id = payload?.id ?? payload?.deployment?.id ?? payload?.uid;
  if (typeof id !== 'string' || !DEPLOYMENT_ID_PATTERN.test(id)) return null;
  return id;
}

function creationProjectId(payload) {
  return payload?.projectId ?? payload?.project?.id ?? payload?.deployment?.projectId ?? null;
}

function creationProjectName(payload) {
  return (
    payload?.project?.name ?? payload?.deployment?.project?.name ?? payload?.name ?? payload?.deployment?.name ?? null
  );
}

function creationTarget(payload) {
  const deployment = payload?.deployment && typeof payload.deployment === 'object' ? payload.deployment : payload;
  return Object.hasOwn(deployment ?? {}, 'target') ? deployment.target : null;
}

function creationProviderSha(payload) {
  return (
    payload?.meta?.githubCommitSha ??
    payload?.deployment?.meta?.githubCommitSha ??
    payload?.gitSource?.sha ??
    payload?.deployment?.gitSource?.sha ??
    null
  );
}

function creationState(payload) {
  const deployment = payload?.deployment && typeof payload.deployment === 'object' ? payload.deployment : payload;
  const state = typeof deployment?.state === 'string' ? deployment.state : null;
  const readyState = typeof deployment?.readyState === 'string' ? deployment.readyState : null;
  const status = typeof deployment?.status === 'string' ? deployment.status : null;
  const values = [state, readyState, status].filter(Boolean);
  return {
    state: state ?? readyState ?? status ?? 'missing',
    readyState: readyState ?? null,
    hasState: values.length > 0,
    ready: values.length > 0 && values.every((value) => value === 'READY'),
    retryable: values.length > 0 && values.every((value) => RETRYABLE_CREATION_STATES.has(value)),
    failed: values.some((value) => FAILED_CREATION_STATES.has(value)),
  };
}

/**
 * Inspect one creation payload fail-closed. Allows `BUILDING`/`QUEUED` as
 * pending (waiter proves READY later); fails `ERROR`/`CANCELED`, production
 * target, wrong project, missing ID, and provider SHA mismatch.
 */
export function inspectTargetedCreationResult({ app, requestedSha, payload }) {
  const validSha = assertExactSha(requestedSha);
  const config = getProjectConfig(assertTargetedApp(app));
  const base = Object.freeze({
    app: config.app,
    project: creationProjectName(payload),
    projectId: creationProjectId(payload),
    expectedSha: validSha,
    deploymentId: creationDeploymentId(payload),
    deploymentUrl: typeof payload?.url === 'string' ? payload.url : (payload?.deployment?.url ?? null),
    providerSha: creationProviderSha(payload),
    target: creationTarget(payload),
    state: creationState(payload).state,
    readyState: creationState(payload).readyState,
    ready: false,
    retryable: false,
    failureCode: null,
    failureMessage: null,
  });

  const failed = (code, message, retryable = false) =>
    Object.freeze({ ...base, ready: false, retryable, failureCode: code, failureMessage: message });

  if (!payload || typeof payload !== 'object') {
    return failed('PROVIDER_TARGETED_DEPLOYMENT_FAILED', `${config.app} Vercel creation 응답이 없습니다.`);
  }
  if (!base.deploymentId) {
    return failed('MISSING_DEPLOYMENT_ID', `${config.app} Vercel creation 응답에 deployment ID가 없습니다.`);
  }
  if (base.projectId !== config.projectId || base.project !== config.project) {
    return failed('VERCEL_PROJECT_MISMATCH', `${config.app} Vercel project identity가 예상값과 다릅니다.`);
  }
  if (base.target === 'production' || base.target === 'staging') {
    return failed('PRODUCTION_SAFETY_VIOLATION', `${config.app} Vercel creation target이 production/staging이라 차단합니다.`);
  }
  if (base.target !== null && base.target !== undefined) {
    return failed('VERCEL_TARGET_NOT_PREVIEW', `${config.app} Vercel creation target이 Preview가 아닙니다.`);
  }
  if (base.providerSha !== null && base.providerSha !== undefined && base.providerSha !== validSha) {
    return failed(
      'EXACT_PROVIDER_SHA_BINDING_FAILED',
      `${config.app} provider Git SHA가 requested exact SHA와 다릅니다.`,
    );
  }
  const state = creationState(payload);
  if (!state.hasState) {
    // Creation responses without state are pending; waiter readback decides READY.
    return Object.freeze({ ...base, ready: false, retryable: true, failureCode: null, failureMessage: null });
  }
  if (state.ready) {
    // READY at creation still needs waiter exact binding (meta readback).
    // Mark ready-possible here; canonical proof remains wait-preview-deploy.
    if (base.providerSha !== null && base.providerSha !== validSha) {
      return failed(
        'EXACT_PROVIDER_SHA_BINDING_FAILED',
        `${config.app} provider Git SHA가 requested exact SHA와 다릅니다.`,
      );
    }
    return Object.freeze({ ...base, ready: true, retryable: false, failureCode: null, failureMessage: null });
  }
  if (state.failed) {
    return failed('VERCEL_NOT_READY', `${config.app} Vercel creation이 ERROR/CANCELED입니다.`, false);
  }
  if (state.retryable) {
    return Object.freeze({ ...base, ready: false, retryable: true, failureCode: null, failureMessage: null });
  }
  return failed('VERCEL_NOT_READY', `${config.app} Vercel creation이 READY가 아닙니다.`, false);
}

/**
 * Pure fan-out planner: validates SHA/app/target + commit existence context
 * and returns one creation plan per app. No network, no Git mutation.
 */
export function buildTargetedDeploymentPlan({ sha, app, target = null }) {
  const validSha = assertExactSha(sha);
  const scope = assertTargetedApp(app);
  assertNonProductionTarget(target);
  const apps = [...TARGETED_SCOPE_TO_APPS[scope]];
  assertProjectAllowlist(apps);
  const plans = apps.map((singleApp) => {
    const config = getProjectConfig(singleApp);
    return Object.freeze({
      app: singleApp,
      project: config.project,
      projectId: config.projectId,
      sha: validSha,
      requestedSha: validSha,
      target: null,
      production: false,
      body: buildVercelCreateBody({ app: singleApp, sha: validSha }),
    });
  });
  return Object.freeze({
    repository: REPO,
    sha: validSha,
    requestedSha: validSha,
    app: scope,
    scope,
    apps: Object.freeze([...apps]),
    target: null,
    production: false,
    gitRefPushRequired: false,
    plans: Object.freeze(plans),
  });
}

function resolveRepositoryRoot(scriptDir) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: scriptDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return path.resolve(scriptDir, '..', '..');
  }
}

/**
 * End-to-end creation for one scope (consumer|seller|driver|both).
 * Validates provenance (commit object must exist), then POSTs one deployment
 * per app — each POST carrying ONLY that app's own project-scoped token.
 * `both` resolves consumer + seller independently and never touches the
 * driver token. All required tokens resolve BEFORE the first POST (POST 0회
 * on missing). Explicit `credentialMode: 'legacy-team-scoped'` with a single
 * `token` keeps the deprecated single-secret path; otherwise `tokensByApp`
 * (or per-app env vars) is required. Returns per-app creation evidence for
 * the strict waiter.
 */
export async function createExactPreviewDeployments({
  sha,
  app,
  target = null,
  token = null,
  tokensByApp = null,
  credentialMode = CREATE_CREDENTIAL_MODE_PROJECT_SCOPED,
  fetchImpl = fetch,
  repositoryRoot = null,
}) {
  const plan = buildTargetedDeploymentPlan({ sha, app, target });
  const mode = assertCreateCredentialMode(credentialMode);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = repositoryRoot ?? resolveRepositoryRoot(scriptDir);
  let exists = false;
  try {
    exists = provisionCommitExists({ repositoryRoot: root, sha: plan.sha });
  } catch (error) {
    if (error?.code === 'EXACT_SHA_MALFORMED') throw error;
    exists = false;
  }
  if (!exists) {
    fail('UNKNOWN_COMMIT_SHA', 'repository에 존재하지 않는 commit SHA이므로 targeted deployment를 거부합니다.');
  }
  // Resolve ALL credentials before any network: missing token => POST 0회.
  const scopedTokens =
    mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM
      ? null
      : resolveProjectScopedTokensForScope(plan.scope, tokensByApp);
  const legacyToken = mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM ? resolveCreateToken(token) : null;
  const results = [];
  for (const item of plan.plans) {
    const appToken = mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM ? legacyToken : scopedTokens[item.app];
    if (typeof appToken !== 'string' || !appToken.trim()) {
      fail(
        exactPreviewCreateTokenRequiredCode(item.app),
        `${exactPreviewCreateTokenEnvForApp(item.app)}가 없어 ${item.app} Preview deployment를 생성할 수 없습니다.`,
      );
    }
    const payload = await requestVercelCreateDeployment({
      app: item.app,
      sha: item.sha,
      token: appToken,
      fetchImpl,
      credentialMode: mode,
    });
    const inspected = inspectTargetedCreationResult({
      app: item.app,
      requestedSha: item.sha,
      payload,
    });
    results.push(inspected);
  }
  return Object.freeze({
    repository: REPO,
    requestedSha: plan.sha,
    scope: plan.scope,
    apps: plan.apps,
    target: null,
    production: false,
    gitRefPushRequired: false,
    credentialMode: mode,
    credentialEnv:
      mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM ? VERCEL_CREATE_CREDENTIAL_ENV : null,
    credentialEnvs:
      mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM
        ? null
        : Object.freeze(Object.fromEntries(plan.apps.map((name) => [name, exactPreviewCreateTokenEnvForApp(name)]))),
    credentialValueRecorded: false,
    deployments: Object.freeze(results),
  });
}

function parseArgs(argv) {
  const out = { sha: null, app: null, target: null, dryRun: false, repo: null, credentialMode: CREATE_CREDENTIAL_MODE_PROJECT_SCOPED };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sha' && index + 1 < argv.length) out.sha = argv[(index += 1)];
    else if (arg.startsWith('--sha=')) out.sha = arg.slice('--sha='.length);
    else if (arg === '--app' && index + 1 < argv.length) out.app = argv[(index += 1)];
    else if (arg.startsWith('--app=')) out.app = arg.slice('--app='.length);
    else if (arg === '--target' && index + 1 < argv.length) out.target = argv[(index += 1)];
    else if (arg.startsWith('--target=')) out.target = arg.slice('--target='.length);
    else if (arg === '--repo' && index + 1 < argv.length) out.repo = argv[(index += 1)];
    else if (arg.startsWith('--repo=')) out.repo = arg.slice('--repo='.length);
    else if (arg === '--credential-mode' && index + 1 < argv.length) out.credentialMode = argv[(index += 1)];
    else if (arg.startsWith('--credential-mode=')) out.credentialMode = arg.slice('--credential-mode='.length);
    else if (arg === '--dry-run' || arg === '--dryRun') out.dryRun = true;
  }
  return out;
}

const invokedAsMainScript =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMainScript) {
  const { sha, app, target, dryRun, repo, credentialMode } = parseArgs(process.argv.slice(2));
  try {
    const mode = assertCreateCredentialMode(credentialMode);
    const plan = buildTargetedDeploymentPlan({ sha, app, target });
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const repositoryRoot = repo ?? resolveRepositoryRoot(scriptDir);
    let exists = false;
    try {
      exists = provisionCommitExists({ repositoryRoot, sha: plan.sha });
    } catch (error) {
      if (error?.code === 'EXACT_SHA_MALFORMED') throw error;
      exists = false;
    }
    if (!exists) {
      fail('UNKNOWN_COMMIT_SHA', 'repository에 존재하지 않는 commit SHA이므로 targeted deployment를 거부합니다.');
    }
    if (dryRun) {
      // Dry-run prints the plan plus credential NAMES only — never values.
      const safe = {
        ...plan,
        credentialMode: mode,
        credentialEnvs:
          mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM
            ? { legacy: VERCEL_CREATE_CREDENTIAL_ENV }
            : Object.fromEntries(plan.apps.map((name) => [name, exactPreviewCreateTokenEnvForApp(name)])),
        plans: plan.plans.map((item) => ({ ...item })),
      };
      process.stdout.write(`${JSON.stringify(safe)}\n`);
    } else {
      // Resolve ALL required tokens before any POST (missing => POST 0회).
      const scopedTokens =
        mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM
          ? null
          : resolveProjectScopedTokensForScope(plan.scope, null);
      const legacyToken = mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM ? resolveCreateToken(null) : null;
      const tokensByApp =
        mode === CREATE_CREDENTIAL_MODE_LEGACY_TEAM ? null : Object.fromEntries(plan.apps.map((name) => [name, scopedTokens[name]]));
      createExactPreviewDeployments({
        sha: plan.sha,
        app: plan.scope,
        target,
        token: legacyToken,
        tokensByApp,
        credentialMode: mode,
        repositoryRoot,
      })
        .then((result) => {
          process.stdout.write(`${JSON.stringify(result)}\n`);
        })
        .catch((error) => {
          const code = error instanceof TargetedDeploymentError ? error.code : 'PROVIDER_TARGETED_DEPLOYMENT_FAILED';
          const message = error instanceof Error ? error.message : String(error);
          for (const name of plan.apps) {
            redactCheck(message, process.env?.[exactPreviewCreateTokenEnvForApp(name)] ?? '');
          }
          redactCheck(message, process.env?.[VERCEL_CREATE_CREDENTIAL_ENV] ?? '');
          process.stderr.write(`[create-exact-preview-deployment] ${code}: ${message}\n`);
          process.exit(1);
        });
    }
  } catch (error) {
    const code = error instanceof TargetedDeploymentError ? error.code : 'PROVIDER_TARGETED_DEPLOYMENT_FAILED';
    process.stderr.write(`[create-exact-preview-deployment] ${code}: ${error.message}\n`);
    process.exit(1);
  }
}
