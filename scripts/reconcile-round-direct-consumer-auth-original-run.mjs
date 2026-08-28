import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createReadOnlyFirestoreFacade,
  safeIsoTimestamp,
} from './read-round-direct-consumer-auth-existing-evidence.mjs';

export const ORIGINAL_BROWSER_RUN = '33150113440';
export const APPLICATION_SHA = '9fda1a0909644cb77a223941f28266f7af69cdf9';
export const EVIDENCE_V2_SHA = 'ff351b79ae2e00ce8b111a906ea0cf1ee8b3d114';
export const DIAGNOSTIC_PARENT_SHA = '74d7417f1b32139c575ca3d7ece699ab2ac3eec1';
export const ORIGINAL_DIAGNOSTIC_PROBE_SHA = '5b9da01c40cf5039042f3e25eeb146bc8680c298';
export const DIAGNOSTIC_BRIDGE_SHA = '8fca8f87f6d688ab9fca9547a371c6a60916a888';
export const ORIGINAL_WINDOW_START = '2026-08-28T07:06:40Z';
export const ORIGINAL_WINDOW_END = '2026-08-28T07:07:02Z';
export const FIXTURE_PROJECT = 'greenhub-round-direct-e2e';
export const API_ORIGIN = 'https://api-staging-94af.up.railway.app';
export const STORAGE_BUCKET = 'greenhub-round-direct-e2e.firebasestorage.app';
export const RUN_ID = 'task-6-7-33150113440-1';
export const CONSUMER_ID = `${'round-direct-e2e'}-${RUN_ID}-chromium-consumer`;

const AUTH_ACTIONS = new Set(['auth.login.failed', 'auth.login.suspended']);
const SAFE_REASONS = new Set(['user_not_found', 'wrong_password']);

function normalizeDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof value === 'object' && Number.isInteger(value._seconds)) {
    return new Date(value._seconds * 1000 + Math.floor(Number(value._nanoseconds ?? 0) / 1e6));
  }
  return null;
}

export function classifyRefreshTokenUpdatedAt({ exists, updatedAt }) {
  if (exists !== true) return 'UNAVAILABLE';
  const value = normalizeDate(updatedAt);
  if (!value) return 'UNAVAILABLE';
  const start = new Date(ORIGINAL_WINDOW_START);
  const end = new Date(ORIGINAL_WINDOW_END);
  if (value < start) return 'BEFORE_ORIGINAL_RUN';
  if (value <= end) return 'WITHIN_ORIGINAL_LOGIN_WINDOW';
  return 'AFTER_ORIGINAL_RUN';
}

export function summarizeAuditRecords(records) {
  const safeRecords = (Array.isArray(records) ? records : [])
    .filter((record) => AUTH_ACTIONS.has(record?.action))
    .map((record) => ({
      action: record.action,
      reason: SAFE_REASONS.has(record.reason) ? record.reason : null,
      createdAt: safeIsoTimestamp(record.createdAt),
    }));
  const reasons = new Set(safeRecords.map((record) => record.reason).filter(Boolean));
  let classification = 'NONE';
  if (safeRecords.some((record) => record.action === 'auth.login.suspended')) classification = 'SUSPENDED';
  else if (reasons.size === 1) classification = [...reasons][0] === 'user_not_found' ? 'USER_NOT_FOUND' : 'WRONG_PASSWORD';
  else if (reasons.size > 1) classification = 'AMBIGUOUS';
  else if (safeRecords.length > 0) classification = 'OTHER';
  return {
    records: safeRecords,
    classification,
    actionNames: [...new Set(safeRecords.map((record) => record.action))],
    failureReasons: [...reasons],
    createdAt: safeRecords.map((record) => record.createdAt).filter(Boolean),
  };
}

function bindingCandidates() {
  return [
    'CONSUMER_API_ORIGIN_MISMATCH',
    'API_RUNTIME_FIREBASE_CONFIGURATION_DRIFT',
    'INTENDED_RAILWAY_FIREBASE_BINDING_MISMATCH',
  ];
}

function classifyOriginalEvidence({ auditRecords, refreshTokenMetadata }) {
  const audit = summarizeAuditRecords(auditRecords);
  const refreshTokenUpdatedClass = classifyRefreshTokenUpdatedAt(refreshTokenMetadata ?? {});
  const eliminatedCandidates = [
    'TEST_CONSUMER_ACCOUNT_MISSING',
    'TEST_CONSUMER_ACCOUNT_REPAIR_GATE',
  ];

  if (audit.classification === 'USER_NOT_FOUND') {
    return {
      rootCauseClass: 'API_FIXTURE_DATA_PLANE_MISMATCH',
      safeSubtype: 'ORIGINAL_API_USER_NOT_FOUND_IN_FIXTURE_DATA_PLANE',
      nextGate: 'P2_BROWSER_CONSUMER_API_FIREBASE_BINDING_DISCRIMINATION_GATE',
      eliminatedCandidates: [...eliminatedCandidates, 'AUTH_HEADER_SECRET_MISMATCH', 'TEST_CONSUMER_ROLE_MISMATCH'],
      remainingCandidates: bindingCandidates(),
    };
  }
  if (audit.classification === 'WRONG_PASSWORD') {
    return {
      rootCauseClass: 'API_OBSERVED_CREDENTIAL_STATE_MISMATCH',
      safeSubtype: 'ORIGINAL_API_WRONG_PASSWORD_AGAINST_FIXTURE_SECRET',
      nextGate: 'P2_BROWSER_CONSUMER_API_FIREBASE_BINDING_DISCRIMINATION_GATE',
      eliminatedCandidates: [...eliminatedCandidates, 'AUTH_HEADER_SECRET_MISMATCH', 'TEST_CONSUMER_ROLE_MISMATCH'],
      remainingCandidates: bindingCandidates(),
    };
  }
  if (audit.classification === 'SUSPENDED') {
    return {
      rootCauseClass: 'API_OBSERVED_ACCOUNT_STATE_MISMATCH',
      safeSubtype: 'ORIGINAL_API_ACCOUNT_SUSPENDED',
      nextGate: 'P2_BROWSER_CONSUMER_API_FIREBASE_BINDING_DISCRIMINATION_GATE',
      eliminatedCandidates: [...eliminatedCandidates, 'AUTH_HEADER_SECRET_MISMATCH', 'TEST_CONSUMER_ROLE_MISMATCH'],
      remainingCandidates: bindingCandidates(),
    };
  }
  if (audit.classification === 'AMBIGUOUS') {
    return {
      rootCauseClass: 'NOT_CLASSIFIED',
      safeSubtype: 'ORIGINAL_AUTH_AUDIT_AMBIGUOUS',
      nextGate: 'P2_BROWSER_CONSUMER_API_FIREBASE_BINDING_DISCRIMINATION_GATE',
      eliminatedCandidates: eliminatedCandidates,
      remainingCandidates: bindingCandidates(),
    };
  }
  if (refreshTokenUpdatedClass === 'WITHIN_ORIGINAL_LOGIN_WINDOW') {
    return {
      rootCauseClass: 'OTHER_AUTH_RUNTIME_FAILURE',
      safeSubtype: 'ORIGINAL_API_LOGIN_SUCCEEDED_BUT_AUTHJS_REJECTED',
      nextGate: 'AUTHJS_SESSION_CONTRACT_FIX_GATE',
      eliminatedCandidates: [
        ...eliminatedCandidates,
        'AUTH_HEADER_SECRET_MISMATCH',
        'CONSUMER_API_ORIGIN_MISMATCH',
        'TEST_CONSUMER_CREDENTIAL_INVALID',
        'TEST_CONSUMER_ROLE_MISMATCH',
      ],
      remainingCandidates: [],
    };
  }
  return {
    rootCauseClass: 'NOT_CLASSIFIED',
    safeSubtype: 'ORIGINAL_AUTH_REQUEST_NOT_OBSERVED',
    nextGate: 'P2_BROWSER_CONSUMER_AUTH_SECRET_ORIGIN_DISCRIMINATION_GATE',
    eliminatedCandidates: [],
    remainingCandidates: ['AUTH_HEADER_SECRET_MISMATCH', 'CONSUMER_API_ORIGIN_MISMATCH'],
  };
}

export function classifyOriginalRunEvidence(input) {
  const audit = summarizeAuditRecords(input.auditRecords);
  const refreshTokenUpdatedClass = classifyRefreshTokenUpdatedAt(input.refreshTokenMetadata ?? {});
  const classification = classifyOriginalEvidence(input);
  return { audit, refreshTokenUpdatedClass, ...classification };
}

function resultStatus(classification) {
  if (classification.rootCauseClass === 'API_FIXTURE_DATA_PLANE_MISMATCH'
    || classification.rootCauseClass === 'API_OBSERVED_CREDENTIAL_STATE_MISMATCH'
    || classification.rootCauseClass === 'API_OBSERVED_ACCOUNT_STATE_MISMATCH') {
    return 'API_FIXTURE_BINDING_BOUNDARY_IDENTIFIED';
  }
  if (classification.rootCauseClass === 'OTHER_AUTH_RUNTIME_FAILURE') return 'ORIGINAL_AUTH_FAILURE_NARROWED';
  if (classification.nextGate === 'P2_BROWSER_CONSUMER_AUTH_SECRET_ORIGIN_DISCRIMINATION_GATE') {
    return 'SECRET_ORIGIN_BOUNDARY_REMAINS';
  }
  return 'ORIGINAL_EVIDENCE_INSUFFICIENT';
}

function mutationCheck() {
  return {
    newAuthRequest: false,
    testConsumerCreate: false,
    passwordReset: false,
    firebaseWrite: false,
    browserE2eRerun: false,
    consumerAuthProbeRerun: false,
    applicationChanged: false,
    evidenceV2Changed: false,
    mainChanged: false,
    vercelChanged: false,
    railwayChanged: false,
    secretChanged: false,
    aligoChanged: false,
    actualAligoSend: false,
  };
}

export async function collectOriginalRunEvidence({ firestore, consumerEmail }) {
  const [postCleanupConsumer, auditRecords, refreshTokenMetadata] = await Promise.all([
    firestore.findUserByEmail(consumerEmail),
    firestore.findMatchingAuthAuditLogs({
      email: consumerEmail,
      start: ORIGINAL_WINDOW_START,
      end: ORIGINAL_WINDOW_END,
    }),
    firestore.getRefreshTokenMetadata(CONSUMER_ID),
  ]);
  const classification = classifyOriginalRunEvidence({ auditRecords, refreshTokenMetadata });
  return {
    ready: true,
    status: resultStatus(classification),
    authority: {
      applicationSha: APPLICATION_SHA,
      evidenceV2Sha: EVIDENCE_V2_SHA,
      diagnosticSha: DIAGNOSTIC_PARENT_SHA,
      originalDiagnosticProbeSha: ORIGINAL_DIAGNOSTIC_PROBE_SHA,
      diagnosticBridgeSha: DIAGNOSTIC_BRIDGE_SHA,
      originalBrowserRun: ORIGINAL_BROWSER_RUN,
    },
    timeline: {
      chromiumSeed: '2026-08-28T07:05:36Z/2026-08-28T07:06:02Z',
      chromiumVerify: '2026-08-28T07:06:02Z/2026-08-28T07:06:11Z',
      e2eStart: '2026-08-28T07:06:47Z',
      e2eFailure: '2026-08-28T07:07:02Z',
      chromiumCleanupStart: '2026-08-28T07:07:02Z',
    },
    priorClassificationCorrection: {
      postCleanupConsumerMissing: postCleanupConsumer === null,
      causalForOriginalFailure: false,
      consumerAccountRepairGate: 'WITHHELD',
      postCleanupStateClassification: 'POST_CLEANUP_STATE_NOT_CAUSAL',
    },
    originalFixtureEvidence: {
      consumerDocumentSeeded: true,
      consumerDocumentVerifiedPresent: true,
      expectedRole: 'consumer',
      deterministicConsumerId: CONSUMER_ID,
    },
    originalRuntimeEvidence: {
      apiOrigin: API_ORIGIN,
      fixtureFirebaseProject: FIXTURE_PROJECT,
      storageBucketClassification: 'NON_PRODUCTION_FIXTURE_BUCKET',
      deploymentShaMatch: true,
      consumerAuthReadinessClass: 'CONFIGURED_VERIFIED_CONSUMER',
      consumerBuildApiOriginEvidence: 'API_ORIGIN_BINDING_NOT_PROVEN',
      matchingAuthAuditCount: classification.audit.records.length,
      matchingAuthAudit: classification.audit.records,
      matchingAuthAuditActionNames: classification.audit.actionNames,
      matchingAuthAuditFailureReasons: classification.audit.failureReasons,
      matchingAuthAuditCreatedAt: classification.audit.createdAt,
      refreshTokenDocumentExists: refreshTokenMetadata?.exists ?? null,
      refreshTokenUpdatedClass: classification.refreshTokenUpdatedClass,
      railwayRuntimeBinding: 'RAILWAY_RUNTIME_BINDING_NOT_READABLE',
    },
    rootCauseClass: classification.rootCauseClass,
    safeSubtype: classification.safeSubtype,
    eliminatedCandidates: classification.eliminatedCandidates,
    remainingCandidates: classification.remainingCandidates,
    nextGate: classification.nextGate,
    mutationCheck: mutationCheck(),
    finalControlTowerSignal: classification.rootCauseClass === 'NOT_CLASSIFIED'
      ? 'CONTROL_TOWER_STOP_REQUIRED'
      : 'ORIGINAL_BROWSER_AUTH_CAUSE_RECONCILED',
  };
}

function unavailableResult(errorCode = 'ORIGINAL_EVIDENCE_READ_ACCESS_REQUIRED') {
  return {
    ready: false,
    status: 'ORIGINAL_EVIDENCE_READ_ACCESS_REQUIRED',
    safeError: errorCode === 'FIRESTORE_PROJECT_NOT_ALLOWED' || errorCode === 'PRODUCTION_FIREBASE_PROJECT_BLOCKED'
      ? errorCode
      : 'ORIGINAL_EVIDENCE_READ_ACCESS_REQUIRED',
    authority: {
      applicationSha: APPLICATION_SHA,
      evidenceV2Sha: EVIDENCE_V2_SHA,
      diagnosticSha: DIAGNOSTIC_PARENT_SHA,
      originalDiagnosticProbeSha: ORIGINAL_DIAGNOSTIC_PROBE_SHA,
      diagnosticBridgeSha: DIAGNOSTIC_BRIDGE_SHA,
      originalBrowserRun: ORIGINAL_BROWSER_RUN,
    },
    rootCauseClass: 'NOT_CLASSIFIED',
    nextGate: 'NONE_EVIDENCE_INSUFFICIENT',
    mutationCheck: mutationCheck(),
    finalControlTowerSignal: 'CONTROL_TOWER_STOP_REQUIRED',
  };
}

export async function main() {
  try {
    const firestore = createReadOnlyFirestoreFacade({
      serviceAccountJson: process.env.ROUND_DIRECT_E2E_FIREBASE_SERVICE_ACCOUNT_JSON,
      consumerEmail: process.env.ROUND_DIRECT_E2E_CONSUMER_EMAIL_CHROMIUM,
      allowedProjects: process.env.ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS,
    });
    const result = await collectOriginalRunEvidence({
      firestore,
      consumerEmail: process.env.ROUND_DIRECT_E2E_CONSUMER_EMAIL_CHROMIUM,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    const result = unavailableResult(error?.code);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return result;
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) void main();
