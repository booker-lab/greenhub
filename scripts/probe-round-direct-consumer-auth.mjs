import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APPLICATION_SHA = '9fda1a0909644cb77a223941f28266f7af69cdf9';
export const EVIDENCE_CANDIDATE_REF = 'codex/p2-security-after-pay01';
export const EXPECTED_CONSUMER_DEPLOYMENT_ID = 'dpl_HxPNRSfPztdLxCKp9Tr5d271C4kn';
export const EXPECTED_CONSUMER_PROJECT_ID = 'prj_ttIlOxV4e2Xb1sf1xhpSXibzph2w';
export const EXPECTED_CONSUMER_PROJECT_NAME = 'greenhubconsumer';
export const EXPECTED_API_ORIGIN = 'https://api-staging-94af.up.railway.app';
export const DIRECT_API_LOGIN_PROBE_RESULT = 'DIRECT_API_LOGIN_PROBE_MUTATION_NOT_ALLOWED';

export const CALLBACK_CLASSIFICATIONS = Object.freeze({
  CREDENTIALS_REJECTED: 'CALLBACK_CREDENTIALS_REJECTED',
  SESSION_ISSUED: 'CALLBACK_SESSION_ISSUED',
  SUCCESS_WITHOUT_SESSION_COOKIE: 'CALLBACK_SUCCESS_WITHOUT_SESSION_COOKIE',
  HTTP_FAILURE: 'CALLBACK_HTTP_FAILURE',
  UNEXPECTED_REDIRECT: 'CALLBACK_UNEXPECTED_REDIRECT',
});

const API_ORIGIN_RESULTS = Object.freeze({
  MATCH: 'API_ORIGIN_MATCH',
  MISMATCH: 'CONSUMER_API_ORIGIN_MISMATCH',
  NOT_PROVEN: 'API_ORIGIN_BINDING_NOT_PROVEN',
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SESSION_COOKIE_PATTERN = /authjs\.session-token(?:\.\d+)?$/;
const CSRF_COOKIE_PATTERN = /authjs\.csrf-token$/;
const SAFE_AUTH_ERROR_CODES = new Set([
  'AccessDenied',
  'CallbackRouteError',
  'CredentialsSignin',
  'EmailSignin',
  'OAuthAccountNotLinked',
  'OAuthCallback',
  'OAuthSignin',
  'SessionRequired',
  'credentials',
]);
const API_MARKERS = ['/auth/login', '/auth/refresh', '/auth/kakao-login'];
const MAX_PUBLIC_BUILD_TEXT = 4 * 1024 * 1024;
const MAX_PUBLIC_BUILD_SCRIPTS = 32;
const MAX_BYPASS_REDIRECTS = 5;

export class ProbeContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProbeContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProbeContractError(code, message);
}

export function assertExpectedSha(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    fail('EXPECTED_SHA_REQUIRED', 'expected SHA가 필요합니다.');
  }
  const normalized = String(value).trim();
  if (!SHA_PATTERN.test(normalized)) {
    fail('EXPECTED_SHA_MALFORMED', 'expected SHA 형식이 잘못되었습니다.');
  }
  if (normalized !== APPLICATION_SHA) {
    fail('EXPECTED_SHA_MISMATCH', '애플리케이션 authority SHA와 다릅니다.');
  }
  return normalized;
}

function requireSecret(value, code) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(code, '필수 인증 입력이 없습니다.');
  }
  return value;
}

function normalizeTargetUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('EXACT_V2_EVIDENCE_TARGET_MISSING', 'exact V2 evidence의 Consumer URL이 없습니다.');
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    fail('EXACT_V2_EVIDENCE_TARGET_MALFORMED', 'exact V2 evidence의 Consumer URL 형식이 잘못되었습니다.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !url.hostname.endsWith('.vercel.app')
  ) {
    fail('EXACT_V2_EVIDENCE_TARGET_MALFORMED', 'exact V2 evidence의 direct deployment URL이 아닙니다.');
  }
  return url.toString().replace(/\/$/, '');
}

export function validateExactV2Evidence(evidence, expectedSha) {
  const sha = assertExpectedSha(expectedSha);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('EXACT_V2_EVIDENCE_MALFORMED', 'exact V2 evidence가 객체가 아닙니다.');
  }
  if (
    evidence.ready !== true ||
    evidence.source !== 'github-status+vercel-api' ||
    evidence.expectedSha !== sha ||
    evidence.candidateRef !== EVIDENCE_CANDIDATE_REF ||
    evidence.railway?.ready !== true ||
    !Array.isArray(evidence.apps)
  ) {
    fail('EXACT_V2_EVIDENCE_NOT_READY', 'exact V2 evidence가 ready 상태가 아닙니다.');
  }

  const consumer = evidence.apps.find((app) => app?.app === 'consumer');
  if (
    !consumer ||
    consumer.ready !== true ||
    consumer.deploymentId !== EXPECTED_CONSUMER_DEPLOYMENT_ID ||
    consumer.projectId !== EXPECTED_CONSUMER_PROJECT_ID ||
    consumer.projectName !== EXPECTED_CONSUMER_PROJECT_NAME ||
    consumer.deploymentSha !== sha ||
    consumer.state !== 'READY'
  ) {
    fail('EXACT_V2_EVIDENCE_CONSUMER_MISMATCH', 'Consumer exact V2 deployment evidence가 예상값과 다릅니다.');
  }

  return {
    targetUrl: normalizeTargetUrl(consumer.targetUrl),
  };
}

function splitCombinedSetCookie(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(/,(?=\s*(?:__Host-|__Secure-)?[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSetCookieInput(input) {
  if (Array.isArray(input)) {
    return input.flatMap((item) => normalizeSetCookieInput(item));
  }
  if (typeof input === 'string') return splitCombinedSetCookie(input);
  return [];
}

function parseSetCookieLine(line) {
  const firstPart = String(line).split(';', 1)[0] ?? '';
  const equalsIndex = firstPart.indexOf('=');
  if (equalsIndex <= 0) return null;
  const name = firstPart.slice(0, equalsIndex).trim();
  if (!COOKIE_NAME_PATTERN.test(name)) return null;
  const value = firstPart.slice(equalsIndex + 1);
  const attributes = String(line)
    .split(';')
    .slice(1)
    .map((item) => item.trim().toLowerCase());
  const deleted = value === '' || attributes.some((attribute) => attribute === 'max-age=0');
  return { name, value, deleted };
}

function readHeader(response, name) {
  const headers = response?.headers;
  if (typeof headers?.get === 'function') {
    const value = headers.get(name);
    if (value !== null && value !== undefined) return String(value);
  }
  if (typeof response?.headersArray === 'function') {
    const match = response.headersArray().find((header) => header.name?.toLowerCase() === name);
    if (match) return String(match.value ?? '');
  }
  if (typeof headers?.raw === 'function') {
    const raw = headers.raw();
    const values = raw?.[name] ?? raw?.[name.toLowerCase()];
    if (Array.isArray(values)) return values.join(', ');
    if (values !== undefined) return String(values);
  }
  return null;
}

function readSetCookieLines(response) {
  const headers = response?.headers;
  if (typeof headers?.getSetCookie === 'function') {
    return normalizeSetCookieInput(headers.getSetCookie());
  }
  if (typeof response?.headersArray === 'function') {
    return response
      .headersArray()
      .filter((header) => header.name?.toLowerCase() === 'set-cookie')
      .flatMap((header) => normalizeSetCookieInput(header.value));
  }
  if (typeof headers?.raw === 'function') {
    const raw = headers.raw();
    if (Array.isArray(raw?.['set-cookie'])) return normalizeSetCookieInput(raw['set-cookie']);
  }
  return normalizeSetCookieInput(readHeader(response, 'set-cookie'));
}

function readCookieRecords(response) {
  return readSetCookieLines(response).map(parseSetCookieLine).filter(Boolean);
}

export function extractCookieNames(setCookieHeaders) {
  return [...new Set(normalizeSetCookieInput(setCookieHeaders).map(parseSetCookieLine).filter(Boolean).map(({ name }) => name))];
}

function applyCookieRecords(jar, records) {
  for (const record of records) {
    if (record.deleted) jar.delete(record.name);
    else jar.set(record.name, record.value);
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function hasCookie(jar, pattern) {
  return [...jar.entries()].some(([name, value]) => pattern.test(name) && value !== '');
}

function safeStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function responseClass(status) {
  if (!Number.isInteger(status)) return null;
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return null;
}

function safeLocation(value, baseUrl) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return { origin: url.origin, path: url.pathname || '/' };
  } catch {
    return null;
  }
}

function captureResponse(response, jar, baseUrl) {
  const records = readCookieRecords(response);
  applyCookieRecords(jar, records);
  const status = safeStatus(response?.status);
  const locationHeader = readHeader(response, 'location');
  return {
    status,
    responseClass: responseClass(status),
    location: safeLocation(locationHeader, baseUrl),
    setCookieCount: records.length,
    cookieNames: [...new Set(records.map(({ name }) => name))],
    _cookieRecords: records,
    _locationHeader: locationHeader,
  };
}

function publicResponseSummary(summary) {
  return {
    status: summary.status,
    responseClass: summary.responseClass,
    location: summary.location,
    setCookieCount: summary.setCookieCount,
    cookieNames: summary.cookieNames,
  };
}

async function readJson(response) {
  if (typeof response?.json === 'function') {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  if (typeof response?.text === 'function') {
    try {
      const text = await response.text();
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return null;
}

export function extractSafeAuthErrorCode(...locations) {
  for (const location of locations) {
    if (typeof location !== 'string' || !location.trim()) continue;
    let url;
    try {
      url = new URL(location, 'https://probe.invalid');
    } catch {
      continue;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (error && SAFE_AUTH_ERROR_CODES.has(error)) return error;
    if (code && SAFE_AUTH_ERROR_CODES.has(code)) return code;
  }
  return null;
}

function isExpectedCallbackLocation(location, callbackUrl) {
  if (!location || !callbackUrl) return false;
  try {
    const expected = new URL(callbackUrl);
    return location.origin === expected.origin && location.path === (expected.pathname || '/');
  } catch {
    return false;
  }
}

export function classifyCallback({ status, location, callbackUrl, errorCode, sessionCookiePresent }) {
  const normalizedStatus = safeStatus(status);
  if (normalizedStatus === null) return CALLBACK_CLASSIFICATIONS.HTTP_FAILURE;
  if (errorCode === 'CredentialsSignin' || errorCode === 'credentials') {
    return CALLBACK_CLASSIFICATIONS.CREDENTIALS_REJECTED;
  }
  if (normalizedStatus >= 400) return CALLBACK_CLASSIFICATIONS.HTTP_FAILURE;
  if (normalizedStatus >= 300 && normalizedStatus < 400) {
    if (!isExpectedCallbackLocation(location, callbackUrl)) {
      return CALLBACK_CLASSIFICATIONS.UNEXPECTED_REDIRECT;
    }
    return sessionCookiePresent
      ? CALLBACK_CLASSIFICATIONS.SESSION_ISSUED
      : CALLBACK_CLASSIFICATIONS.SUCCESS_WITHOUT_SESSION_COOKIE;
  }
  if (normalizedStatus >= 200 && normalizedStatus < 300) {
    return sessionCookiePresent
      ? CALLBACK_CLASSIFICATIONS.SESSION_ISSUED
      : CALLBACK_CLASSIFICATIONS.SUCCESS_WITHOUT_SESSION_COOKIE;
  }
  return CALLBACK_CLASSIFICATIONS.HTTP_FAILURE;
}

export function buildCallbackRequestInit({ email, password, csrfToken, callbackUrl, testSecret, cookies }) {
  return {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-e2e-test-token': testSecret,
      Cookie: cookies,
    },
    body: new URLSearchParams({
      email,
      password,
      csrfToken,
      callbackUrl,
      json: 'true',
    }).toString(),
  };
}

function safeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function unescapePublicText(text) {
  return String(text).replaceAll('\\/', '/');
}

function extractOrigins(text) {
  const origins = new Set();
  const normalized = unescapePublicText(text);
  for (const match of normalized.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g)) {
    const origin = safeOrigin(`${match[0]}/`);
    if (origin) origins.add(origin);
  }
  return origins;
}

function apiMarkerSnippets(text) {
  const normalized = unescapePublicText(text);
  const snippets = [];
  for (const marker of API_MARKERS) {
    let startAt = 0;
    while (true) {
      const index = normalized.indexOf(marker, startAt);
      if (index < 0) break;
      snippets.push(normalized.slice(Math.max(0, index - 4096), index + marker.length + 1024));
      startAt = index + marker.length;
    }
  }
  return snippets;
}

export function classifyApiOriginEvidence(texts, expectedOrigin = EXPECTED_API_ORIGIN) {
  const expected = safeOrigin(expectedOrigin);
  if (!expected || !Array.isArray(texts)) {
    return { apiOriginMatch: false, result: API_ORIGIN_RESULTS.NOT_PROVEN };
  }

  const markerOrigins = new Set();
  let markerFound = false;
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    const snippets = apiMarkerSnippets(text);
    if (snippets.length > 0) markerFound = true;
    for (const snippet of snippets) {
      for (const origin of extractOrigins(snippet)) markerOrigins.add(origin);
    }
  }

  if (markerFound && markerOrigins.has(expected)) {
    return { apiOriginMatch: true, result: API_ORIGIN_RESULTS.MATCH };
  }
  if (markerFound && markerOrigins.size === 1 && !markerOrigins.has(expected)) {
    return { apiOriginMatch: false, result: API_ORIGIN_RESULTS.MISMATCH };
  }
  return { apiOriginMatch: false, result: API_ORIGIN_RESULTS.NOT_PROVEN };
}

function extractScriptSources(html, baseUrl) {
  const sources = [];
  for (const match of String(html).matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1], baseUrl);
      const base = new URL(baseUrl);
      if (url.origin !== base.origin || !url.pathname.startsWith('/_next/static/')) continue;
      sources.push(url.toString());
    } catch {
      continue;
    }
    if (sources.length >= MAX_PUBLIC_BUILD_SCRIPTS) break;
  }
  return [...new Set(sources)];
}

async function readText(response) {
  if (typeof response?.text !== 'function') return null;
  try {
    const text = await response.text();
    return typeof text === 'string' ? text.slice(0, MAX_PUBLIC_BUILD_TEXT) : null;
  } catch {
    return null;
  }
}

export async function inspectConsumerPublicBuild({ targetUrl, jar, fetchImpl = fetch }) {
  const texts = [];
  const headers = {
    Accept: 'text/html,application/xhtml+xml',
  };
  const cookies = cookieHeader(jar);
  if (cookies) headers.Cookie = cookies;

  let rootResponse;
  try {
    rootResponse = await fetchImpl(`${targetUrl}/`, { method: 'GET', redirect: 'manual', headers });
  } catch {
    return { apiOriginMatch: false, result: API_ORIGIN_RESULTS.NOT_PROVEN };
  }
  if (responseClass(safeStatus(rootResponse?.status)) !== '2xx') {
    return { apiOriginMatch: false, result: API_ORIGIN_RESULTS.NOT_PROVEN };
  }
  const rootText = await readText(rootResponse);
  if (!rootText) return { apiOriginMatch: false, result: API_ORIGIN_RESULTS.NOT_PROVEN };
  texts.push(rootText);

  for (const source of extractScriptSources(rootText, targetUrl)) {
    try {
      const response = await fetchImpl(source, {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'application/javascript,text/javascript' },
      });
      if (responseClass(safeStatus(response?.status)) !== '2xx') continue;
      const text = await readText(response);
      if (text) texts.push(text);
    } catch {
      continue;
    }
  }
  return classifyApiOriginEvidence(texts);
}

function baseProbeResult() {
  return {
    vercelBypassCookiePresent: false,
    csrfCookiePresent: false,
    authenticatedSessionPresent: false,
    apiOriginMatch: false,
    apiOriginResult: API_ORIGIN_RESULTS.NOT_PROVEN,
    directApiLoginProbe: DIRECT_API_LOGIN_PROBE_RESULT,
  };
}

async function request(fetchImpl, url, init, output, failureCode) {
  try {
    return await fetchImpl(url, init);
  } catch {
    output.failureCode ??= failureCode;
    return null;
  }
}

async function addApiOriginEvidence(output, targetUrl, jar, fetchImpl) {
  const result = await inspectConsumerPublicBuild({ targetUrl, jar, fetchImpl });
  output.apiOriginMatch = result.apiOriginMatch;
  output.apiOriginResult = result.result;
}

async function acquireBypassCookie({ targetUrl, bypassSecret, jar, fetchImpl, output }) {
  let currentUrl = `${targetUrl}/?x-vercel-protection-bypass=${encodeURIComponent(bypassSecret)}&x-vercel-set-bypass-cookie=true`;
  let lastSummary = null;
  const targetOrigin = new URL(targetUrl).origin;

  for (let attempt = 0; attempt <= MAX_BYPASS_REDIRECTS; attempt++) {
    const response = await request(
      fetchImpl,
      currentUrl,
      {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'text/html', ...(cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}) },
      },
      output,
      'VERCEL_BYPASS_REQUEST_FAILED',
    );
    if (!response) return null;
    lastSummary = captureResponse(response, jar, targetUrl);
    if (lastSummary.responseClass !== '3xx') break;
    const locationHeader = lastSummary._locationHeader;
    if (!locationHeader) break;
    let nextUrl;
    try {
      nextUrl = new URL(locationHeader, currentUrl);
    } catch {
      break;
    }
    if (nextUrl.origin !== targetOrigin) break;
    currentUrl = nextUrl.toString();
  }
  return lastSummary;
}

export async function runProbe({
  expectedSha,
  evidence,
  bypassSecret,
  testSecret,
  email,
  password,
  fetchImpl = fetch,
}) {
  const sha = assertExpectedSha(expectedSha);
  const { targetUrl } = validateExactV2Evidence(evidence, sha);
  const bypass = requireSecret(bypassSecret, 'CONSUMER_BYPASS_SECRET_REQUIRED');
  const e2eSecret = requireSecret(testSecret, 'E2E_TEST_SECRET_REQUIRED');
  const consumerEmail = requireSecret(email, 'CONSUMER_EMAIL_REQUIRED');
  const consumerPassword = requireSecret(password, 'CONSUMER_PASSWORD_REQUIRED');
  const output = baseProbeResult();
  const jar = new Map();

  const bypassSummary = await acquireBypassCookie({
    targetUrl,
    bypassSecret: bypass,
    jar,
    fetchImpl,
    output,
  });
  if (!bypassSummary) {
    await addApiOriginEvidence(output, targetUrl, jar, fetchImpl);
    return output;
  }
  output.vercelBypassCookiePresent = hasCookie(jar, /^_vercel_jwt$/);
  output.bypass = publicResponseSummary(bypassSummary);

  const csrfResponse = await request(
    fetchImpl,
    `${targetUrl}/api/auth/csrf`,
    {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'application/json', 'x-e2e-test-token': e2eSecret, Cookie: cookieHeader(jar) },
    },
    output,
    'CSRF_REQUEST_FAILED',
  );
  if (!csrfResponse) {
    await addApiOriginEvidence(output, targetUrl, jar, fetchImpl);
    return output;
  }
  const csrfSummary = captureResponse(csrfResponse, jar, targetUrl);
  output.csrf = publicResponseSummary(csrfSummary);
  output.csrfCookiePresent = hasCookie(jar, CSRF_COOKIE_PATTERN);
  const csrfBody = responseClass(csrfSummary.status) === '2xx' ? await readJson(csrfResponse) : null;
  const csrfToken = typeof csrfBody?.csrfToken === 'string' && csrfBody.csrfToken ? csrfBody.csrfToken : null;
  if (!csrfToken) {
    output.failureCode ??= 'CSRF_NOT_AVAILABLE';
    await addApiOriginEvidence(output, targetUrl, jar, fetchImpl);
    return output;
  }

  const callbackResponse = await request(
    fetchImpl,
    `${targetUrl}/api/auth/callback/credentials`,
    buildCallbackRequestInit({
      email: consumerEmail,
      password: consumerPassword,
      csrfToken,
      callbackUrl: targetUrl,
      testSecret: e2eSecret,
      cookies: cookieHeader(jar),
    }),
    output,
    'CALLBACK_REQUEST_FAILED',
  );
  if (callbackResponse) {
    const callbackSummary = captureResponse(callbackResponse, jar, targetUrl);
    const callbackBody = responseClass(callbackSummary.status) === '2xx' ? await readJson(callbackResponse) : null;
    const bodyLocation = typeof callbackBody?.url === 'string' ? callbackBody.url : null;
    const errorCode = extractSafeAuthErrorCode(callbackSummary._locationHeader, bodyLocation);
    const sessionCookiePresent = callbackSummary._cookieRecords.some(
      ({ name, value, deleted }) => SESSION_COOKIE_PATTERN.test(name) && value !== '' && !deleted,
    );
    const callbackLocation = safeLocation(callbackSummary._locationHeader ?? bodyLocation, targetUrl);
    output.callback = {
      ...publicResponseSummary(callbackSummary),
      authErrorCode: errorCode,
      sessionCookiePresent,
      classification: classifyCallback({
        status: callbackSummary.status,
        location: callbackLocation,
        callbackUrl: targetUrl,
        errorCode,
        sessionCookiePresent,
      }),
    };

    const sessionResponse = await request(
      fetchImpl,
      `${targetUrl}/api/auth/session`,
      {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'application/json', Cookie: cookieHeader(jar) },
      },
      output,
      'SESSION_REQUEST_FAILED',
    );
    if (sessionResponse) {
      const sessionSummary = captureResponse(sessionResponse, jar, targetUrl);
      output.session = publicResponseSummary(sessionSummary);
      const sessionBody = responseClass(sessionSummary.status) === '2xx' ? await readJson(sessionResponse) : null;
      const role = sessionBody?.user?.role;
      if (
        responseClass(sessionSummary.status) === '2xx' &&
        (role === 'consumer' || role === 'admin')
      ) {
        output.authenticatedSessionPresent = true;
        output.sessionRole = role;
      }
    }
  }

  await addApiOriginEvidence(output, targetUrl, jar, fetchImpl);
  return output;
}

function readEvidenceFile(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    fail('EVIDENCE_FILE_REQUIRED', 'exact V2 evidence 파일이 필요합니다.');
  }
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    fail('EXACT_V2_EVIDENCE_UNREADABLE', 'exact V2 evidence 파일을 읽을 수 없습니다.');
  }
  try {
    return JSON.parse(text);
  } catch {
    fail('EXACT_V2_EVIDENCE_MALFORMED', 'exact V2 evidence JSON 형식이 잘못되었습니다.');
  }
}

function parseArgs(args) {
  const expectedArgument = args.find((arg) => arg.startsWith('--expected-sha='));
  const evidenceArgument = args.find((arg) => arg.startsWith('--evidence-file='));
  if (!expectedArgument) fail('EXPECTED_SHA_REQUIRED', 'expected SHA가 필요합니다.');
  if (!evidenceArgument) fail('EVIDENCE_FILE_REQUIRED', 'exact V2 evidence 파일이 필요합니다.');
  return {
    expectedSha: expectedArgument.slice('--expected-sha='.length).trim(),
    evidenceFile: evidenceArgument.slice('--evidence-file='.length).trim(),
  };
}

function safeFailureResult(error) {
  const output = baseProbeResult();
  output.failureCode = error instanceof ProbeContractError ? error.code : 'PROBE_FAILED';
  return output;
}

async function main() {
  let output;
  try {
    const { expectedSha, evidenceFile } = parseArgs(process.argv.slice(2));
    const evidence = readEvidenceFile(evidenceFile);
    output = await runProbe({
      expectedSha,
      evidence,
      bypassSecret: process.env.ROUND_DIRECT_E2E_CONSUMER_BYPASS_SECRET,
      testSecret: process.env.ROUND_DIRECT_E2E_TEST_SECRET,
      email: process.env.ROUND_DIRECT_E2E_CONSUMER_EMAIL_CHROMIUM,
      password: process.env.ROUND_DIRECT_E2E_CONSUMER_PASSWORD_CHROMIUM,
    });
  } catch (error) {
    output = safeFailureResult(error);
    const code = output.failureCode;
    console.error(`[probe-round-direct-consumer-auth] ${code}`);
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.failureCode) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
