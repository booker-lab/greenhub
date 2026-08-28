import { createSign } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROBE_RUN_ID = '33160672787';
export const PROBE_TIMESTAMP = '2026-08-28T09:45:46Z';
export const PROBE_WINDOW_START = '2026-08-28T09:44:46Z';
export const PROBE_WINDOW_END = '2026-08-28T09:46:46Z';
export const PROBE_CALLBACK = '/api/auth/callback/credentials';
export const PRODUCTION_FIREBASE_PROJECT = 'green-e4fe3';

export const ROOT_CAUSES = Object.freeze({
  AUTH_HEADER_SECRET_MISMATCH: 'AUTH_HEADER_SECRET_MISMATCH',
  CONSUMER_API_ORIGIN_MISMATCH: 'CONSUMER_API_ORIGIN_MISMATCH',
  TEST_CONSUMER_CREDENTIAL_INVALID: 'TEST_CONSUMER_CREDENTIAL_INVALID',
  TEST_CONSUMER_ROLE_MISMATCH: 'TEST_CONSUMER_ROLE_MISMATCH',
  AUTHJS_SESSION_COOKIE_CONTRACT_FAILURE: 'AUTHJS_SESSION_COOKIE_CONTRACT_FAILURE',
  OTHER_AUTH_RUNTIME_FAILURE: 'OTHER_AUTH_RUNTIME_FAILURE',
  NOT_CLASSIFIED: 'NOT_CLASSIFIED',
});

export const NEXT_GATES = Object.freeze({
  ACCOUNT_REPAIR: 'TEST_CONSUMER_ACCOUNT_REPAIR_GATE',
  SESSION_CONTRACT: 'AUTHJS_SESSION_CONTRACT_FIX_GATE',
  SECRET_ORIGIN: 'P2_BROWSER_CONSUMER_AUTH_SECRET_API_ORIGIN_DISCRIMINATION_GATE',
  READ_ACCESS: 'EXISTING_EVIDENCE_READ_ACCESS_REQUIRED',
  SAFETY: 'EXISTING_EVIDENCE_SAFETY_GATE_FAILED',
});

const REFRESH_TOKEN_UPDATED_CLASSES = Object.freeze({
  BEFORE_PROBE: 'BEFORE_PROBE',
  WITHIN_PROBE_WINDOW: 'WITHIN_PROBE_WINDOW',
  AFTER_PROBE: 'AFTER_PROBE',
  UNAVAILABLE: 'UNAVAILABLE',
});

const AUDIT_CLASSES = Object.freeze({
  NONE: 'NONE',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  SUSPENDED: 'SUSPENDED',
  OTHER: 'OTHER',
  AMBIGUOUS: 'AMBIGUOUS',
});

const ROLE_CLASSES = new Set(['consumer', 'admin', 'seller', 'driver']);
const AUTH_AUDIT_ACTIONS = new Set(['auth.login.failed', 'auth.login.suspended']);
const SAFE_FAILURE_REASONS = new Set(['user_not_found', 'wrong_password']);
const SAFE_ERROR_CODES = new Set([
  'EXISTING_EVIDENCE_READ_ACCESS_REQUIRED',
  'EXISTING_EVIDENCE_SAFETY_GATE_FAILED',
  'FIRESTORE_READ_ACCESS_REQUIRED',
  'FIRESTORE_CREDENTIAL_MALFORMED',
  'FIRESTORE_PROJECT_ID_MISSING',
  'PRODUCTION_FIREBASE_PROJECT_BLOCKED',
  'FIRESTORE_PROJECT_NOT_ALLOWED',
  'CONSUMER_EMAIL_REQUIRED',
]);
const FIRESTORE_API_ORIGIN = 'https://firestore.googleapis.com';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GOOGLE_DATASTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';

export class ExistingEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ExistingEvidenceError';
    this.code = code;
  }
}

function fail(code) {
  throw new ExistingEvidenceError(code);
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseCredentialObject(raw) {
  if (typeof raw !== 'string' || !raw.trim()) fail('FIRESTORE_CREDENTIAL_MALFORMED');
  try {
    const parsed = JSON.parse(raw.trim().replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail('FIRESTORE_CREDENTIAL_MALFORMED');
    }
    return parsed;
  } catch {
    fail('FIRESTORE_CREDENTIAL_MALFORMED');
  }
}

// project_id만 먼저 읽고 비운영 허용 경계를 통과한 뒤 개인 키를 사용한다.
export function parseServiceAccountProjectId(raw) {
  const parsed = parseCredentialObject(raw);
  const projectId = typeof parsed.project_id === 'string' ? parsed.project_id.trim() : '';
  if (!projectId) fail('FIRESTORE_PROJECT_ID_MISSING');
  return projectId;
}

export function validateReadOnlyEnvironment({ serviceAccountJson, consumerEmail, allowedProjects }) {
  const projectId = parseServiceAccountProjectId(serviceAccountJson);
  const allowed = splitList(allowedProjects);
  if (projectId === PRODUCTION_FIREBASE_PROJECT) fail('PRODUCTION_FIREBASE_PROJECT_BLOCKED');
  if (!allowed.includes(projectId)) fail('FIRESTORE_PROJECT_NOT_ALLOWED');
  if (typeof consumerEmail !== 'string' || !consumerEmail.trim()) fail('CONSUMER_EMAIL_REQUIRED');

  const parsed = parseCredentialObject(serviceAccountJson);
  if (
    typeof parsed.client_email !== 'string' ||
    !parsed.client_email.trim() ||
    typeof parsed.private_key !== 'string' ||
    !parsed.private_key.includes('BEGIN PRIVATE KEY')
  ) {
    fail('FIRESTORE_CREDENTIAL_MALFORMED');
  }
  return {
    projectId,
    clientEmail: parsed.client_email.trim(),
    privateKey: parsed.private_key,
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function createServiceAccountAssertion({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: clientEmail,
      scope: GOOGLE_DATASTORE_SCOPE,
      aud: GOOGLE_TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey, 'base64url')}`;
}

async function readJson(response, code) {
  if (!response || !response.ok || typeof response.json !== 'function') fail(code);
  try {
    return await response.json();
  } catch {
    fail(code);
  }
}

function firestoreUrl(projectId, pathName, query = {}) {
  const url = new URL(`/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents${pathName}`, FIRESTORE_API_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  return url;
}

function fieldPath(pathName) {
  return { fieldPath: pathName };
}

function stringValue(fields, name) {
  const value = fields?.[name];
  return typeof value?.stringValue === 'string' ? value.stringValue : null;
}

function booleanValue(fields, name) {
  const value = fields?.[name];
  return typeof value?.booleanValue === 'boolean' ? value.booleanValue : null;
}

function nestedMapFields(fields, name) {
  const value = fields?.[name];
  return value?.mapValue?.fields && typeof value.mapValue.fields === 'object' ? value.mapValue.fields : {};
}

function timestampValue(fields, name) {
  const value = fields?.[name];
  return typeof value?.timestampValue === 'string' ? value.timestampValue : null;
}

function documentId(document) {
  if (typeof document?.name !== 'string') return null;
  const parts = document.name.split('/');
  return parts.at(-1) || null;
}

function userFromDocument(document) {
  if (!document?.fields) return null;
  return {
    userId: stringValue(document.fields, 'id') ?? documentId(document),
    role: stringValue(document.fields, 'role'),
    suspended: booleanValue(document.fields, 'suspended'),
    driverApproved: booleanValue(document.fields, 'driverApproved'),
  };
}

function auditFromDocument(document, email) {
  const fields = document?.fields;
  if (!fields) return null;
  const detail = nestedMapFields(fields, 'detail');
  if (stringValue(detail, 'email') !== email) return null;
  const action = stringValue(fields, 'action');
  if (!AUTH_AUDIT_ACTIONS.has(action)) return null;
  return {
    action,
    reason: stringValue(detail, 'reason'),
    createdAt: timestampValue(fields, 'createdAt'),
  };
}

function normalizeDate(value) {
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof value === 'object' && Number.isInteger(value._seconds)) {
    return new Date(value._seconds * 1000 + Math.floor(Number(value._nanoseconds ?? 0) / 1e6));
  }
  return null;
}

export function safeIsoTimestamp(value) {
  const date = normalizeDate(value);
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export function createReadOnlyFirestoreFacade({ serviceAccountJson, consumerEmail, allowedProjects, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') fail('EXISTING_EVIDENCE_READ_ACCESS_REQUIRED');
  const credentials = validateReadOnlyEnvironment({ serviceAccountJson, consumerEmail, allowedProjects });
  let accessTokenPromise;

  async function accessToken() {
    if (!accessTokenPromise) {
      accessTokenPromise = (async () => {
        let assertion;
        try {
          assertion = createServiceAccountAssertion(credentials);
        } catch {
          fail('FIRESTORE_CREDENTIAL_MALFORMED');
        }
        const response = await fetchImpl(GOOGLE_TOKEN_URI, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
          }).toString(),
        });
        const data = await readJson(response, 'FIRESTORE_READ_ACCESS_REQUIRED');
        if (typeof data?.access_token !== 'string' || !data.access_token) {
          fail('FIRESTORE_READ_ACCESS_REQUIRED');
        }
        return data.access_token;
      })();
    }
    return accessTokenPromise;
  }

  async function firestoreRequest(method, pathName, body, query, allowNotFound = false) {
    const response = await fetchImpl(firestoreUrl(credentials.projectId, pathName, query), {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${await accessToken()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (allowNotFound && response.status === 404) return null;
    return readJson(response, 'FIRESTORE_READ_ACCESS_REQUIRED');
  }

  async function runQuery(structuredQuery) {
    const rows = await firestoreRequest('POST', ':runQuery', { structuredQuery });
    return Array.isArray(rows) ? rows : [];
  }

  return Object.freeze({
    async findUserByEmail(email) {
      const rows = await runQuery({
        from: [{ collectionId: 'users' }],
        where: {
          fieldFilter: {
            field: fieldPath('email'),
            op: 'EQUAL',
            value: { stringValue: email },
          },
        },
        select: { fields: [fieldPath('id'), fieldPath('role'), fieldPath('suspended'), fieldPath('driverApproved')] },
        limit: 1,
      });
      const document = rows.find((row) => row?.document)?.document;
      return document ? userFromDocument(document) : null;
    },

    async findMatchingAuthAuditLogs({ email, start, end }) {
      const rows = await runQuery({
        from: [{ collectionId: 'auditLogs' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              {
                fieldFilter: {
                  field: fieldPath('createdAt'),
                  op: 'GREATER_THAN_OR_EQUAL',
                  value: { timestampValue: new Date(start).toISOString() },
                },
              },
              {
                fieldFilter: {
                  field: fieldPath('createdAt'),
                  op: 'LESS_THAN_OR_EQUAL',
                  value: { timestampValue: new Date(end).toISOString() },
                },
              },
            ],
          },
        },
        select: {
          fields: [fieldPath('action'), fieldPath('detail.email'), fieldPath('detail.reason'), fieldPath('createdAt')],
        },
      });
      return rows
        .map((row) => (row?.document ? auditFromDocument(row.document, email) : null))
        .filter(Boolean);
    },

    async getRefreshTokenMetadata(userId) {
      if (typeof userId !== 'string' || !userId) return { exists: null, updatedAt: null };
      const document = await firestoreRequest(
        'GET',
        `/refreshTokens/${encodeURIComponent(userId)}`,
        undefined,
        { 'mask.fieldPaths': 'updatedAt' },
        true,
      );
      return {
        exists: Boolean(document),
        updatedAt: timestampValue(document?.fields, 'updatedAt'),
      };
    },
  });
}

function roleClass(role) {
  return ROLE_CLASSES.has(role) ? role : role ? 'other' : 'unavailable';
}

export function classifyRole(role) {
  return roleClass(role);
}

function auditRecordClass(record) {
  if (record.action === 'auth.login.suspended') return AUDIT_CLASSES.SUSPENDED;
  if (record.reason === 'user_not_found') return AUDIT_CLASSES.USER_NOT_FOUND;
  if (record.reason === 'wrong_password') return AUDIT_CLASSES.WRONG_PASSWORD;
  return AUDIT_CLASSES.OTHER;
}

function summarizeAuditRecords(records) {
  const safeRecords = (Array.isArray(records) ? records : [])
    .filter((record) => AUTH_AUDIT_ACTIONS.has(record?.action))
    .map((record) => {
      const reason = SAFE_FAILURE_REASONS.has(record.reason) ? record.reason : null;
      return {
        action: record.action,
        reason,
        createdAt: safeIsoTimestamp(record.createdAt),
        class: auditRecordClass({ ...record, reason }),
      };
    });
  const classes = [...new Set(safeRecords.map((record) => record.class))];
  const matchingAuthAuditClass =
    classes.length === 0 ? AUDIT_CLASSES.NONE : classes.length === 1 ? classes[0] : AUDIT_CLASSES.AMBIGUOUS;
  return {
    records: safeRecords,
    matchingAuthAuditClass,
    actionNames: [...new Set(safeRecords.map((record) => record.action))],
    failureReasons: [...new Set(safeRecords.map((record) => record.reason).filter(Boolean))],
    createdAt: safeRecords.map((record) => record.createdAt).filter(Boolean),
  };
}

export function classifyRefreshTokenUpdatedAt({ exists, updatedAt }) {
  if (exists !== true) return REFRESH_TOKEN_UPDATED_CLASSES.UNAVAILABLE;
  const value = normalizeDate(updatedAt);
  const start = new Date(PROBE_WINDOW_START);
  const end = new Date(PROBE_WINDOW_END);
  if (!value || Number.isNaN(value.getTime())) return REFRESH_TOKEN_UPDATED_CLASSES.UNAVAILABLE;
  if (value < start) return REFRESH_TOKEN_UPDATED_CLASSES.BEFORE_PROBE;
  if (value <= end) return REFRESH_TOKEN_UPDATED_CLASSES.WITHIN_PROBE_WINDOW;
  return REFRESH_TOKEN_UPDATED_CLASSES.AFTER_PROBE;
}

function unresolvedClassification() {
  return {
    status: 'EXISTING_EVIDENCE_INSUFFICIENT',
    rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
    safeSubtype: 'SECRET_OR_API_ORIGIN_BOUNDARY_REMAINS',
    nextGate: NEXT_GATES.SECRET_ORIGIN,
    eliminatedCandidates: [],
    remainingCandidates: [ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH, ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH],
    controlTowerSignal: 'CONSUMER_AUTH_SECRET_ORIGIN_DISCRIMINATION_REQUIRED',
  };
}

function narrowedClassification(rootCauseClass, safeSubtype, nextGate, eliminatedCandidates = []) {
  return {
    status: 'CONSUMER_AUTH_EXISTING_EVIDENCE_NARROWED',
    rootCauseClass,
    safeSubtype,
    nextGate,
    eliminatedCandidates,
    remainingCandidates: [],
    controlTowerSignal: 'CONSUMER_AUTH_ROOT_CAUSE_NARROWED',
  };
}

export function classifyExistingEvidence({ testConsumer, auditRecords, refreshTokenMetadata }) {
  const exists = Boolean(testConsumer);
  const role = roleClass(testConsumer?.role);
  const refreshTokenUpdatedClass = classifyRefreshTokenUpdatedAt(refreshTokenMetadata ?? {});
  const audit = summarizeAuditRecords(auditRecords);
  const auditConflictWithRefresh =
    refreshTokenUpdatedClass === REFRESH_TOKEN_UPDATED_CLASSES.WITHIN_PROBE_WINDOW &&
    audit.matchingAuthAuditClass !== AUDIT_CLASSES.NONE;

  if (!exists) {
    return {
      audit,
      refreshTokenUpdatedClass,
      ...narrowedClassification(
        ROOT_CAUSES.TEST_CONSUMER_CREDENTIAL_INVALID,
        'TEST_CONSUMER_ACCOUNT_MISSING',
        NEXT_GATES.ACCOUNT_REPAIR,
      ),
    };
  }

  if (auditConflictWithRefresh || audit.matchingAuthAuditClass === AUDIT_CLASSES.AMBIGUOUS) {
    return { audit, refreshTokenUpdatedClass, ...unresolvedClassification() };
  }

  if (audit.matchingAuthAuditClass === AUDIT_CLASSES.USER_NOT_FOUND) {
    return {
      audit,
      refreshTokenUpdatedClass,
      ...narrowedClassification(
        ROOT_CAUSES.TEST_CONSUMER_CREDENTIAL_INVALID,
        'TEST_CONSUMER_EMAIL_NOT_FOUND',
        NEXT_GATES.ACCOUNT_REPAIR,
        [ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH],
      ),
    };
  }
  if (audit.matchingAuthAuditClass === AUDIT_CLASSES.WRONG_PASSWORD) {
    return {
      audit,
      refreshTokenUpdatedClass,
      ...narrowedClassification(
        ROOT_CAUSES.TEST_CONSUMER_CREDENTIAL_INVALID,
        'TEST_CONSUMER_PASSWORD_INVALID',
        NEXT_GATES.ACCOUNT_REPAIR,
        [ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH],
      ),
    };
  }
  if (audit.matchingAuthAuditClass === AUDIT_CLASSES.SUSPENDED) {
    return {
      audit,
      refreshTokenUpdatedClass,
      ...narrowedClassification(
        ROOT_CAUSES.OTHER_AUTH_RUNTIME_FAILURE,
        'TEST_CONSUMER_ACCOUNT_SUSPENDED',
        NEXT_GATES.ACCOUNT_REPAIR,
        [ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH],
      ),
    };
  }

  if (refreshTokenUpdatedClass === REFRESH_TOKEN_UPDATED_CLASSES.WITHIN_PROBE_WINDOW) {
    if (role === 'consumer' || role === 'admin') {
      return {
        audit,
        refreshTokenUpdatedClass,
        ...narrowedClassification(
          ROOT_CAUSES.OTHER_AUTH_RUNTIME_FAILURE,
          'API_LOGIN_SUCCEEDED_BUT_AUTHJS_CREDENTIALS_REJECTED',
          NEXT_GATES.SESSION_CONTRACT,
          [
            ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH,
            ROOT_CAUSES.CONSUMER_API_ORIGIN_MISMATCH,
            ROOT_CAUSES.TEST_CONSUMER_CREDENTIAL_INVALID,
            ROOT_CAUSES.TEST_CONSUMER_ROLE_MISMATCH,
          ],
        ),
      };
    }
    if (role !== 'unavailable') {
      return {
        audit,
        refreshTokenUpdatedClass,
        ...narrowedClassification(
          ROOT_CAUSES.TEST_CONSUMER_ROLE_MISMATCH,
          'TEST_CONSUMER_ROLE_NOT_ALLOWED_FOR_CONSUMER_AUTH',
          NEXT_GATES.ACCOUNT_REPAIR,
          [ROOT_CAUSES.AUTH_HEADER_SECRET_MISMATCH, ROOT_CAUSES.TEST_CONSUMER_CREDENTIAL_INVALID],
        ),
      };
    }
  }

  return { audit, refreshTokenUpdatedClass, ...unresolvedClassification() };
}

function runtimeEvidence() {
  return {
    csrf: { status: 200, result: 'CSRF_BOOTSTRAP_PASS' },
    callback: {
      path: PROBE_CALLBACK,
      status: 302,
      error: 'CredentialsSignin',
      result: 'CALLBACK_CREDENTIALS_REJECTED',
      sessionCookieIssued: false,
    },
    authorizeFailureBoundary: 'YES',
    apiOriginBinding: 'API_ORIGIN_BINDING_NOT_PROVEN',
  };
}

function externalMutationControl() {
  return {
    newAuthRequest: false,
    browserE2eRerun: false,
    consumerAuthProbeRerun: false,
    applicationChanged: false,
    evidenceV2Changed: false,
    mainChanged: false,
    pr56Changed: false,
    vercelChanged: false,
    railwayChanged: false,
    firebaseWrites: false,
    testUserChanged: false,
    passwordReset: false,
    secretChanged: false,
    aligoChanged: false,
    actualAligoSend: false,
    sensitiveValueExposed: false,
  };
}

function makeSafeResult({ testConsumer, refreshTokenMetadata, classification }) {
  const userExists = Boolean(testConsumer);
  const role = roleClass(testConsumer?.role);
  return {
    ready: true,
    source: 'existing-evidence-only',
    probeRunId: PROBE_RUN_ID,
    probeTimestamp: PROBE_TIMESTAMP,
    newAuthRequestPerformed: false,
    browserE2eRedispatched: false,
    consumerAuthProbeRerun: false,
    aligoStatus: 'BLOCKED_UNTIL_BROWSER_PASS',
    actualAligoSend: false,
    consumerRuntimeEvidence: runtimeEvidence(),
    testConsumerExists: userExists,
    testConsumerRoleClass: role,
    testConsumerSuspended: userExists ? testConsumer.suspended === true : null,
    testConsumerDriverApproved:
      role === 'driver' ? (testConsumer.driverApproved === true ? 'YES' : 'NO') : 'NOT_APPLICABLE',
    matchingAuthAuditCount: classification.audit.records.length,
    matchingAuthAuditClass: classification.audit.matchingAuthAuditClass,
    matchingAuthAuditActionNames: classification.audit.actionNames,
    matchingAuthAuditFailureReasons: classification.audit.failureReasons,
    matchingAuthAuditCreatedAt: classification.audit.createdAt,
    refreshTokenDocumentExists: refreshTokenMetadata?.exists ?? null,
    refreshTokenUpdatedClass: classification.refreshTokenUpdatedClass,
    railwayLoginRequestObserved: 'RAILWAY_RUNTIME_LOGS_NOT_AVAILABLE',
    rootCauseClass: classification.rootCauseClass,
    safeSubtype: classification.safeSubtype,
    nextGate: classification.nextGate,
    status: classification.status,
    eliminatedCandidates: classification.eliminatedCandidates,
    remainingCandidates: classification.remainingCandidates,
    externalMutation: externalMutationControl(),
    controlTowerSignal: classification.controlTowerSignal,
  };
}

export async function collectExistingEvidence({ firestore, consumerEmail }) {
  if (!firestore || typeof firestore.findUserByEmail !== 'function' || typeof firestore.findMatchingAuthAuditLogs !== 'function') {
    fail('EXISTING_EVIDENCE_READ_ACCESS_REQUIRED');
  }
  const testConsumer = await firestore.findUserByEmail(consumerEmail);
  const auditRecords = await firestore.findMatchingAuthAuditLogs({
    email: consumerEmail,
    start: PROBE_WINDOW_START,
    end: PROBE_WINDOW_END,
  });
  const refreshTokenMetadata = testConsumer?.userId && typeof firestore.getRefreshTokenMetadata === 'function'
    ? await firestore.getRefreshTokenMetadata(testConsumer.userId)
    : { exists: null, updatedAt: null };
  const classification = classifyExistingEvidence({ testConsumer, auditRecords, refreshTokenMetadata });
  return makeSafeResult({ testConsumer, refreshTokenMetadata, classification });
}

export function buildUnavailableResult(errorCode) {
  const safeCode = SAFE_ERROR_CODES.has(errorCode) ? errorCode : 'EXISTING_EVIDENCE_READ_ACCESS_REQUIRED';
  const isSafety = ['EXISTING_EVIDENCE_SAFETY_GATE_FAILED', 'PRODUCTION_FIREBASE_PROJECT_BLOCKED', 'FIRESTORE_PROJECT_NOT_ALLOWED'].includes(safeCode);
  return {
    ready: false,
    source: 'existing-evidence-only',
    probeRunId: PROBE_RUN_ID,
    probeTimestamp: PROBE_TIMESTAMP,
    newAuthRequestPerformed: false,
    browserE2eRedispatched: false,
    consumerAuthProbeRerun: false,
    aligoStatus: 'BLOCKED_UNTIL_BROWSER_PASS',
    actualAligoSend: false,
    consumerRuntimeEvidence: runtimeEvidence(),
    testConsumerExists: null,
    testConsumerRoleClass: 'unavailable',
    testConsumerSuspended: null,
    testConsumerDriverApproved: 'unavailable',
    matchingAuthAuditCount: 0,
    matchingAuthAuditClass: 'UNAVAILABLE',
    matchingAuthAuditActionNames: [],
    matchingAuthAuditFailureReasons: [],
    matchingAuthAuditCreatedAt: [],
    refreshTokenDocumentExists: null,
    refreshTokenUpdatedClass: 'UNAVAILABLE',
    railwayLoginRequestObserved: 'RAILWAY_RUNTIME_LOGS_NOT_AVAILABLE',
    rootCauseClass: ROOT_CAUSES.NOT_CLASSIFIED,
    safeSubtype: safeCode,
    nextGate: isSafety ? NEXT_GATES.SAFETY : NEXT_GATES.READ_ACCESS,
    status: isSafety ? 'EXISTING_EVIDENCE_SAFETY_GATE_FAILED' : 'EXISTING_EVIDENCE_READ_ACCESS_REQUIRED',
    eliminatedCandidates: [],
    remainingCandidates: [],
    externalMutation: externalMutationControl(),
    controlTowerSignal: 'CONTROL_TOWER_STOP_REQUIRED',
  };
}

async function main() {
  let result;
  try {
    const serviceAccountJson = process.env.ROUND_DIRECT_E2E_FIREBASE_SERVICE_ACCOUNT_JSON;
    const consumerEmail = process.env.ROUND_DIRECT_E2E_CONSUMER_EMAIL_CHROMIUM;
    const allowedProjects = process.env.ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS;
    const firestore = createReadOnlyFirestoreFacade({ serviceAccountJson, consumerEmail, allowedProjects });
    result = await collectExistingEvidence({ firestore, consumerEmail });
  } catch (error) {
    result = buildUnavailableResult(error?.code);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ready) process.exitCode = 1;
}

const isDirectExecution = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) void main();
