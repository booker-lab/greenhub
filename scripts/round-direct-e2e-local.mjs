#!/usr/bin/env node
/**
 * 회차 E2E 로컬 대상 모드 실행기.
 *
 * 원격 회차 E2E(.github/workflows/e2e-round-direct.yml)와 같은 순서·인자로, Vercel Preview 대신
 * 대상 SHA를 로컬 `next build && next start`로 띄운 consumer·seller·driver를 검증한다.
 * 데이터 대상은 원격과 같은 스테이징 API와 E2E Firebase 프로젝트다.
 *
 *   node scripts/round-direct-e2e-local.mjs [--sha=<ref|40hex>] [--target-env=<경로>] [--dry-run]
 *
 * 단계: env 검증 → 임시 git worktree(대상 SHA, .env.local 없음) → pnpm install → 허용 env만으로
 * 세 앱 빌드 → 빌드 산출물의 운영 식별자 검사 → 앱별 루프백 호스트로 next start → readiness →
 * fixture seed/verify → Playwright 52건·판정 → 세션 수명주기 12건·판정.
 * 성공·실패·예외 모두에서 fixture cleanup, 서버 종료, 임시 worktree 제거를 수행하고 실패를 숨기지 않는다.
 *
 * 사용법과 필요한 env 이름: apps/e2e/README.md
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import {
  evaluateFirebaseTarget,
  inspectFirebaseServiceAccount,
  LOCAL_TARGET_MODE,
  LOCAL_TARGET_ORIGINS,
} from './check-round-direct-e2e-readiness.mjs';

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_TARGET_REF = 'origin/main';
export const DEFAULT_ENV_FILE = 'apps/e2e/.env.local-target';

// 원격 회차 E2E와 같은 비운영 데이터 대상. 실행기가 고정하며 env 파일로 바꿀 수 없다.
export const LOCAL_E2E_API_ORIGIN = 'https://api-staging-94af.up.railway.app';
export const LOCAL_E2E_FIREBASE_PROJECT = 'greenhub-round-direct-e2e';
export const LOCAL_E2E_AUTH_DOMAIN = `${LOCAL_E2E_FIREBASE_PROJECT}.firebaseapp.com`;
export const LOCAL_E2E_ALLOWED_BUCKETS = Object.freeze([
  `${LOCAL_E2E_FIREBASE_PROJECT}.firebasestorage.app`,
  `${LOCAL_E2E_FIREBASE_PROJECT}.appspot.com`,
]);

export const LOCAL_APPS = Object.freeze(
  ['consumer', 'seller', 'driver'].map((name) => {
    const url = new URL(LOCAL_TARGET_ORIGINS[name]);
    return Object.freeze({ name, origin: url.origin, host: url.hostname, port: Number(url.port) });
  }),
);

// 빌드 산출물에 나타나면 운영 설정이 섞였다는 뜻인 문자열.
export const FORBIDDEN_BUILD_MARKERS = Object.freeze(['green-e4fe3', 'api-production-13e7']);
// seller·driver의 운영 Firebase 차단 가드가 소스에 직접 쓰는 리터럴. `new Set([...])` 원소일 때만 허용한다.
const GUARD_LITERALS = new Set([
  'green-e4fe3',
  'green-e4fe3.appspot.com',
  'green-e4fe3.firebasestorage.app',
  'green-e4fe3.firebaseapp.com',
]);
const GUARD_SET_PREFIX = /new Set\(\[\s*(?:(["'`])[^"'`\n]*\1\s*,\s*)*$/;
const SCANNED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.rsc',
  '.txt',
  '.map',
  '.body',
  '.meta',
]);

export const REQUIRED_ENV_NAMES = Object.freeze([
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
]);
// 둘 중 정확히 하나. FILE은 env 파일 위치 기준 상대 경로도 허용한다.
export const SERVICE_ACCOUNT_ENV_NAMES = Object.freeze([
  'FIREBASE_SERVICE_ACCOUNT_FILE',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
]);
export const OPTIONAL_ENV_NAMES = Object.freeze([
  'ROUND_DIRECT_E2E_RUN_ID',
  'NEXT_PUBLIC_PORTONE_STORE_ID',
  'NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY',
  'NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY',
]);
const KNOWN_ENV_NAMES = new Set([
  ...REQUIRED_ENV_NAMES,
  ...SERVICE_ACCOUNT_ENV_NAMES,
  ...OPTIONAL_ENV_NAMES,
]);
// 결제 SDK는 테스트가 브라우저 stub으로 바꾸고 provider egress를 막으므로 값은 비어 있지만 않으면 된다.
const PORTONE_PLACEHOLDERS = Object.freeze({
  NEXT_PUBLIC_PORTONE_STORE_ID: 'store-round-direct-local-e2e',
  NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY: 'channel-key-round-direct-local-e2e-kakaopay',
  NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY: 'channel-key-round-direct-local-e2e-naverpay',
});
const UNUSED_OAUTH_PLACEHOLDER = 'round-direct-local-e2e-unused';

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{6,46}[a-z0-9]$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PROJECTS = ['chromium', 'mobile'];
const ROLES = ['consumer', 'seller', 'driver'];

// 하위 프로세스에 넘기는 OS 기본 env. 이 밖의 상위 env(NEXT_PUBLIC_*, FIREBASE_*, VERCEL_* 등)는 넘기지 않는다.
const PASSTHROUGH_ENV_NAMES = new Set(
  [
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'COMMONPROGRAMFILES',
    'USERNAME',
    'USER',
    'LOGNAME',
    'SHELL',
    'LANG',
    'LC_ALL',
    'TERM',
    'OS',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'PNPM_HOME',
    'XDG_CACHE_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'PLAYWRIGHT_BROWSERS_PATH',
  ].map((name) => name.toUpperCase()),
);

export class LocalE2EError extends Error {
  constructor(message, { code = 'LOCAL_E2E_FAILED', cause } = {}) {
    super(message, { cause });
    this.name = 'LocalE2EError';
    this.code = code;
  }
}

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseArgs(argv) {
  const options = {
    targetRef: DEFAULT_TARGET_REF,
    envFile: DEFAULT_ENV_FILE,
    dryRun: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--sha=') && arg.length > '--sha='.length)
      options.targetRef = arg.slice(6);
    else if (arg.startsWith('--target-env=') && arg.length > '--target-env='.length) {
      options.envFile = arg.slice('--target-env='.length);
    } else {
      throw new LocalE2EError(`알 수 없는 인자입니다: ${arg}`, { code: 'USAGE' });
    }
  }
  return options;
}

/**
 * env 파일 값을 검증한다. 결과에는 env 이름과 실패 코드만 담고 값은 담지 않는다.
 */
export function validateLocalEnv(
  fileEnv,
  { envFileDir = REPOSITORY_ROOT, readFile = fs.readFileSync } = {},
) {
  const failures = [];
  const add = (code, message, names = []) => failures.push({ code, message, names });
  const env = Object.fromEntries(
    Object.entries(fileEnv ?? {}).map(([name, value]) => [name, String(value ?? '').trim()]),
  );

  const unknown = Object.keys(env)
    .filter((name) => !KNOWN_ENV_NAMES.has(name))
    .sort();
  if (unknown.length > 0) {
    add('UNKNOWN_ENV_NAME', 'env 파일에 로컬 대상 모드가 쓰지 않는 이름이 있습니다.', unknown);
  }

  const missing = REQUIRED_ENV_NAMES.filter((name) => !hasValue(env[name]));
  const serviceAccountNames = SERVICE_ACCOUNT_ENV_NAMES.filter((name) => hasValue(env[name]));
  if (serviceAccountNames.length === 0) missing.push(SERVICE_ACCOUNT_ENV_NAMES[0]);
  if (serviceAccountNames.length > 1) {
    add('SERVICE_ACCOUNT_AMBIGUOUS', '서비스 계정은 FILE과 JSON 중 하나만 지정해야 합니다.', [
      ...SERVICE_ACCOUNT_ENV_NAMES,
    ]);
  }
  if (missing.length > 0) add('ENV_MISSING', '필수 env가 없습니다.', missing);

  let serviceAccountJson = '';
  if (serviceAccountNames.length === 1) {
    if (serviceAccountNames[0] === 'FIREBASE_SERVICE_ACCOUNT_FILE') {
      try {
        serviceAccountJson = String(
          readFile(path.resolve(envFileDir, env.FIREBASE_SERVICE_ACCOUNT_FILE), 'utf8'),
        );
      } catch {
        add('SERVICE_ACCOUNT_FILE_UNREADABLE', '서비스 계정 파일을 읽을 수 없습니다.', [
          'FIREBASE_SERVICE_ACCOUNT_FILE',
        ]);
      }
    } else {
      serviceAccountJson = env.FIREBASE_SERVICE_ACCOUNT_JSON;
    }
  }

  const productionNames = [...KNOWN_ENV_NAMES].filter((name) =>
    FORBIDDEN_BUILD_MARKERS.some((marker) => String(env[name] ?? '').includes(marker)),
  );
  if (FORBIDDEN_BUILD_MARKERS.some((marker) => serviceAccountJson.includes(marker))) {
    productionNames.push(serviceAccountNames[0]);
  }
  if (productionNames.length > 0) {
    add('PRODUCTION_VALUE_DETECTED', '운영 Firebase·API 식별자가 들어 있습니다.', [
      ...new Set(productionNames),
    ]);
  }

  if (
    hasValue(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) &&
    env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== LOCAL_E2E_FIREBASE_PROJECT
  ) {
    add(
      'FIREBASE_WEB_PROJECT_MISMATCH',
      `웹 Firebase project는 ${LOCAL_E2E_FIREBASE_PROJECT}여야 합니다.`,
      ['NEXT_PUBLIC_FIREBASE_PROJECT_ID'],
    );
  }
  if (
    hasValue(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) &&
    env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN !== LOCAL_E2E_AUTH_DOMAIN
  ) {
    add(
      'FIREBASE_AUTH_DOMAIN_MISMATCH',
      `웹 Firebase authDomain은 ${LOCAL_E2E_AUTH_DOMAIN}여야 합니다.`,
      ['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'],
    );
  }

  // 원격 fixture·readiness와 같은 Firebase 대상 가드를 그대로 재사용한다.
  const storageBucket = env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '';
  const target = evaluateFirebaseTarget(
    {
      firebaseProjectId: LOCAL_E2E_FIREBASE_PROJECT,
      allowedFirebaseProjects: [LOCAL_E2E_FIREBASE_PROJECT],
      serviceAccount: inspectFirebaseServiceAccount(serviceAccountJson),
      storageBucket,
      allowedStorageBuckets: [...LOCAL_E2E_ALLOWED_BUCKETS],
    },
    { requireServiceAccount: true },
  );
  for (const failure of target.failures) {
    if (
      failure.code === 'FIREBASE_SERVICE_ACCOUNT_MISSING' &&
      missing.includes(SERVICE_ACCOUNT_ENV_NAMES[0])
    ) {
      continue;
    }
    if (
      ['STORAGE_BUCKET_MISSING', 'STORAGE_BUCKET_NOT_ALLOWED'].includes(failure.code) &&
      missing.includes('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET')
    ) {
      continue;
    }
    add(
      failure.code,
      failure.message,
      failure.code.includes('STORAGE')
        ? ['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET']
        : serviceAccountNames.slice(0, 1),
    );
  }

  if (hasValue(env.ROUND_DIRECT_E2E_RUN_ID) && !RUN_ID_PATTERN.test(env.ROUND_DIRECT_E2E_RUN_ID)) {
    add('RUN_ID_INVALID', '실행 ID 형식이 올바르지 않습니다.', ['ROUND_DIRECT_E2E_RUN_ID']);
  }

  return {
    ok: failures.length === 0,
    missing,
    unknown,
    failures,
    values: failures.length === 0 ? env : null,
    serviceAccountJson: failures.length === 0 ? serviceAccountJson : null,
  };
}

export function createRunId(sha, now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return `local-${sha.slice(0, 8)}-${stamp}`;
}

function randomSecret() {
  return randomBytes(32).toString('hex');
}

/**
 * 실행마다 새 E2E 계정 자격과 로컬 전용 secret을 만든다. fixture seed가 이 이메일로 계정을 만든다.
 */
export function createRunCredentials(runId, { secret = randomSecret } = {}) {
  const accounts = {};
  for (const project of PROJECTS) {
    for (const role of ROLES) {
      const roleName = role.toUpperCase();
      const projectName = project.toUpperCase();
      accounts[`TEST_${roleName}_EMAIL_${projectName}`] =
        `rd-${runId}-${role}-${project}@example.com`;
      accounts[`TEST_${roleName}_PASSWORD_${projectName}`] = `Rd1!${secret().slice(0, 32)}`;
    }
  }
  return {
    accounts,
    authSecret: secret(),
    e2eTestSecret: secret(),
    sharedSecret: secret(),
  };
}

export function sanitizedBaseEnv(baseEnv = process.env) {
  return Object.fromEntries(
    Object.entries(baseEnv).filter(
      ([name, value]) => typeof value === 'string' && PASSTHROUGH_ENV_NAMES.has(name.toUpperCase()),
    ),
  );
}

/**
 * 앱 빌드·실행 env. 운영 Preview 대신 로컬 next start가 Preview 전용 Credentials 게이트를 통과하도록
 * VERCEL_ENV=preview를 흉내 낸다(driver 게이트 조건). next start는 NODE_ENV=production이라
 * 로컬 파일럿 Credentials 우회는 꺼진 상태를 유지한다.
 */
export function buildAppEnv(app, { values, credentials }) {
  const common = {
    NEXT_TELEMETRY_DISABLED: '1',
    VERCEL_ENV: 'preview',
    NEXT_PUBLIC_API_URL: LOCAL_E2E_API_ORIGIN,
    AUTH_SECRET: credentials.authSecret,
    KAKAO_CLIENT_ID: UNUSED_OAUTH_PLACEHOLDER,
    KAKAO_CLIENT_SECRET: UNUSED_OAUTH_PLACEHOLDER,
    ...Object.fromEntries(REQUIRED_ENV_NAMES.map((name) => [name, values[name]])),
  };
  if (app === 'consumer') {
    return {
      ...common,
      E2E_TEST_SECRET: credentials.e2eTestSecret,
      ...Object.fromEntries(
        Object.entries(PORTONE_PLACEHOLDERS).map(([name, fallback]) => [
          name,
          hasValue(values[name]) ? values[name] : fallback,
        ]),
      ),
    };
  }
  if (app === 'seller') return { ...common, E2E_TEST_SECRET: credentials.e2eTestSecret };
  if (app === 'driver') {
    return {
      ...common,
      ROUND_DIRECT_E2E_ENABLED: 'true',
      ROUND_DIRECT_E2E_SHARED_SECRET: credentials.sharedSecret,
      ROUND_DIRECT_E2E_DRIVER_EMAILS: PROJECTS.map(
        (project) => credentials.accounts[`TEST_DRIVER_EMAIL_${project.toUpperCase()}`],
      ).join(','),
    };
  }
  throw new LocalE2EError(`알 수 없는 앱입니다: ${app}`);
}

export function buildRunPaths({ worktreeDir, outputDir, runId }) {
  const evidenceRoot = path.join(worktreeDir, '.artifacts', 'round-direct', runId);
  return {
    worktreeDir,
    outputDir,
    evidenceRoot,
    evidenceDir: path.join(evidenceRoot, 'evidence'),
    manifest: (project) => path.join(evidenceRoot, project, 'manifest.json'),
    playwrightJson: path.join(evidenceRoot, 'playwright-raw.json'),
    sessionJson: path.join(evidenceRoot, 'playwright-session-raw.json'),
    logDir: path.join(outputDir, 'logs'),
  };
}

/**
 * readiness·fixture·Playwright 실행 env. 워크플로 job env를 로컬 대상 모드로 옮긴 것이다.
 * ROUND_DIRECT_E2E_ENV=preview는 "비운영 E2E 데이터 대상(스테이징 API·E2E Firebase)" 표식이라 원격과 같다.
 */
export function buildRunnerEnv({ runId, sha, values, serviceAccountJson, credentials, paths }) {
  const relativeManifest = (project) => `.artifacts/round-direct/${runId}/${project}/manifest.json`;
  const targetUrls = Object.fromEntries(LOCAL_APPS.map(({ name, origin }) => [name, origin]));
  const runner = {
    ROUND_DIRECT_E2E_ENABLED: 'true',
    ROUND_DIRECT_E2E_ENV: 'preview',
    ROUND_DIRECT_E2E_TARGET_MODE: LOCAL_TARGET_MODE,
    ROUND_DIRECT_E2E_EXPECTED_SHA: sha,
    ROUND_DIRECT_E2E_RUN_ID: runId,
    ROUND_DIRECT_E2E_RUN_ATTEMPT: '1',
    ROUND_DIRECT_E2E_EVENT_NAME: 'local',
    ROUND_DIRECT_E2E_PROVIDER_MODE: 'stub',
    ROUND_DIRECT_E2E_FIXTURE_PROJECTS: PROJECTS.join(','),
    ROUND_DIRECT_E2E_CLEANUP_CONFIGURED: 'true',
    ROUND_DIRECT_E2E_API_ORIGIN: LOCAL_E2E_API_ORIGIN,
    ROUND_DIRECT_E2E_ALLOWED_API_ORIGINS: LOCAL_E2E_API_ORIGIN,
    FIREBASE_PROJECT_ID: LOCAL_E2E_FIREBASE_PROJECT,
    ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: LOCAL_E2E_FIREBASE_PROJECT,
    FIREBASE_STORAGE_BUCKET: values.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    ROUND_DIRECT_E2E_ALLOWED_STORAGE_BUCKETS: LOCAL_E2E_ALLOWED_BUCKETS.join(','),
    ROUND_DIRECT_E2E_STORAGE_PREFIX: `e2e/round-direct/${runId}/`,
    ROUND_DIRECT_E2E_STORE_ID: `round-direct-e2e-${runId}-chromium-store`,
    ROUND_DIRECT_E2E_FIXTURE_MANIFEST: relativeManifest('chromium'),
    ROUND_DIRECT_E2E_PROVIDER_EGRESS_HOSTS: '',
    PLAYWRIGHT_JSON_OUTPUT_FILE: paths.playwrightJson,
    // 원격에서는 wait-preview-deploy가 Vercel deployment SHA·URL을 만든다. 로컬은 worktree HEAD를
    // 확인한 대상 SHA와 앱별 고정 루프백 origin으로 대체한다.
    ROUND_DIRECT_E2E_DEPLOYMENT_SHAS_JSON: JSON.stringify({
      consumer: sha,
      seller: sha,
      driver: sha,
    }),
    ROUND_DIRECT_E2E_TARGET_URLS_JSON: JSON.stringify(targetUrls),
    CONSUMER_BASE: targetUrls.consumer,
    SELLER_BASE: targetUrls.seller,
    DRIVER_BASE: targetUrls.driver,
    E2E_TEST_SECRET: credentials.e2eTestSecret,
    ROUND_DIRECT_E2E_SHARED_SECRET: credentials.sharedSecret,
    ...credentials.accounts,
  };
  return {
    runner,
    // 워크플로와 같이 서비스 계정은 readiness·fixture·세션 수명주기 단계에만 넘긴다.
    withServiceAccount: { ...runner, FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccountJson },
  };
}

const PLAYWRIGHT_COMMON_ARGS = [
  '--project=chromium',
  '--project=mobile',
  '--workers=1',
  '--retries=0',
  '--reporter=list,json',
];
// 워크플로 "소비자·셀러·드라이버 52건 실행"·"세션 수명주기 12건 실행"과 같은 인자.
export const PLAYWRIGHT_ROUND_ARGS = Object.freeze([
  '--filter',
  'e2e',
  'exec',
  'playwright',
  'test',
  'consumer-round-direct',
  'seller-sale-rounds',
  'driver-direct-delivery',
  ...PLAYWRIGHT_COMMON_ARGS,
]);
export const PLAYWRIGHT_SESSION_ARGS = Object.freeze([
  '--filter',
  'e2e',
  'exec',
  'playwright',
  'test',
  'auth-session-lifecycle',
  ...PLAYWRIGHT_COMMON_ARGS,
]);
export const EXPECTED_ROUND_TESTS = 52;
export const EXPECTED_SESSION_TESTS = 12;

/** 워크플로의 jq 무건너뜀 판정과 같은 조건. */
export function evaluatePlaywrightStats(report, expected) {
  const stats = report?.stats ?? {};
  const summary = {
    expected: stats.expected ?? null,
    skipped: stats.skipped ?? null,
    unexpected: stats.unexpected ?? null,
    flaky: stats.flaky ?? null,
  };
  return {
    ok:
      summary.expected === expected &&
      summary.skipped === 0 &&
      summary.unexpected === 0 &&
      summary.flaky === 0,
    summary,
  };
}

/**
 * 빌드 산출물 검사. 운영 식별자는 seller·driver 차단 가드의 `new Set([...])` 리터럴일 때만 허용하고,
 * 스테이징 API origin이 인라인됐는지도 확인한다.
 */
export function scanBuildFiles(files, { requiredMarker = LOCAL_E2E_API_ORIGIN } = {}) {
  const findings = [];
  let requiredFound = false;
  for (const { file, content } of files) {
    if (content.includes(requiredMarker)) requiredFound = true;
    for (const marker of FORBIDDEN_BUILD_MARKERS) {
      let index = content.indexOf(marker);
      while (index !== -1) {
        if (!isGuardLiteral(content, index, marker)) {
          findings.push({ file, marker });
          break;
        }
        index = content.indexOf(marker, index + marker.length);
      }
    }
  }
  return { ok: findings.length === 0 && requiredFound, findings, requiredFound };
}

function isGuardLiteral(content, index, marker) {
  const quote = content[index - 1];
  if (!['"', "'", '`'].includes(quote)) return false;
  const end = content.indexOf(quote, index);
  if (end === -1) return false;
  const literal = content.slice(index, end);
  if (!literal.startsWith(marker) || !GUARD_LITERALS.has(literal)) return false;
  return GUARD_SET_PREFIX.test(content.slice(Math.max(0, index - 1 - 400), index - 1));
}

function listScannableFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listScannableFiles(fullPath));
    else if (SCANNED_EXTENSIONS.has(path.extname(entry.name))) result.push(fullPath);
  }
  return result;
}

export function scanAppBuild(appDir) {
  const roots = ['static', 'server'].map((name) => path.join(appDir, '.next', name));
  const files = roots.flatMap(listScannableFiles).map((file) => ({
    file: path.relative(appDir, file),
    content: fs.readFileSync(file, 'utf8'),
  }));
  if (files.length === 0) return { ok: false, findings: [], requiredFound: false, empty: true };
  return scanBuildFiles(files);
}

export function findEnvFiles(worktreeDir) {
  const dirs = [
    '.',
    ...['apps', 'packages'].flatMap((parent) => {
      const parentDir = path.join(worktreeDir, parent);
      return fs.existsSync(parentDir)
        ? fs
            .readdirSync(parentDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(parent, entry.name))
        : [];
    }),
  ];
  return dirs.flatMap((dir) =>
    fs
      .readdirSync(path.join(worktreeDir, dir))
      .filter((name) => name.startsWith('.env') && name !== '.env.example')
      .map((name) => path.join(dir, name)),
  );
}

/**
 * 대상 SHA checkout이 로컬 대상 모드를 지원하는지 확인한다. readiness·fixture·Playwright는 대상 SHA의
 * 코드로 실행되므로, 이 모드가 들어오기 전 SHA는 빌드 전에 이유를 밝히고 멈춘다.
 */
export function checkCheckoutContract(root, { readFile = fs.readFileSync } = {}) {
  const problems = [];
  const read = (relativePath) => {
    try {
      return String(readFile(path.join(root, relativePath), 'utf8'));
    } catch {
      problems.push(`${relativePath} 없음`);
      return '';
    }
  };
  for (const { name } of LOCAL_APPS) {
    const source = read(`apps/${name}/package.json`);
    if (!source) continue;
    const scripts = JSON.parse(source).scripts ?? {};
    if (scripts.start !== 'next start' || !hasValue(scripts.build)) {
      problems.push(`${name} start가 next start가 아니거나 build가 없음`);
    }
  }
  const targetUrl = read('apps/e2e/tests/_helpers/target-url.ts');
  const readiness = read('scripts/check-round-direct-e2e-readiness.mjs');
  if (
    (targetUrl && !targetUrl.includes('ROUND_DIRECT_LOCAL_TARGET_ORIGINS')) ||
    (readiness && !readiness.includes('LOCAL_TARGET_ORIGINS'))
  ) {
    problems.push(
      '대상 SHA가 로컬 대상 모드를 지원하지 않음(target-url·readiness의 local 표식 없음)',
    );
  }
  return problems;
}

/** 계획 출력용 단계 목록. 값·secret은 담지 않는다. */
export function describePlan({ sha, runId, envFile, worktreeDir, outputDir }) {
  return {
    targetSha: sha,
    runId,
    envFile,
    worktreeDir,
    outputDir,
    targets: Object.fromEntries(LOCAL_APPS.map(({ name, origin }) => [name, origin])),
    apiOrigin: LOCAL_E2E_API_ORIGIN,
    firebaseProject: LOCAL_E2E_FIREBASE_PROJECT,
    steps: [
      `git worktree add --detach <임시>/repo ${sha}`,
      'pnpm install --frozen-lockfile --prefer-offline',
      'pnpm --filter @greenhub/shared build',
      ...LOCAL_APPS.map(({ name }) => `pnpm --filter ${name} build (허용 env만)`),
      `빌드 산출물 검사: ${FORBIDDEN_BUILD_MARKERS.join(', ')} 금지, ${LOCAL_E2E_API_ORIGIN} 필수`,
      ...LOCAL_APPS.map(
        ({ name, host, port }) => `${name}: next start -H ${host} -p ${port} → /login 200 대기`,
      ),
      'node scripts/check-round-direct-e2e-readiness.mjs (local 대상 모드)',
      'pnpm --filter e2e exec playwright install chromium',
      ...PROJECTS.flatMap((project) => [
        `node scripts/round-direct-e2e-fixtures.mjs seed --project=${project}`,
        `node scripts/round-direct-e2e-fixtures.mjs verify --project=${project}`,
      ]),
      `pnpm ${PLAYWRIGHT_ROUND_ARGS.join(' ')} → ${EXPECTED_ROUND_TESTS}건 무건너뜀 판정`,
      `pnpm ${PLAYWRIGHT_SESSION_ARGS.join(' ')} → ${EXPECTED_SESSION_TESTS}건 무건너뜀 판정`,
      '항상: fixture cleanup(chromium·mobile) → 서버 종료 → 임시 worktree 제거',
    ],
  };
}

class StepFailure extends Error {
  constructor(step, detail) {
    super(`${step} 실패${detail ? `: ${detail}` : ''}`);
    this.name = 'StepFailure';
    this.step = step;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * 실행 본체. 외부 효과는 모두 ops를 거치므로 spec에서 가짜 ops로 cleanup 경로를 검증한다.
 * 반환: { ok, failures: string[], cleanupFailures: string[] }
 */
export async function runLocalRoundDirectE2E(context, ops) {
  const { sha, runId, values, serviceAccountJson, credentials, paths } = context;
  const failures = [];
  const cleanupFailures = [];
  const servers = [];
  let worktreeAttempted = false;
  const log = ops.log ?? (() => {});
  const base = ops.baseEnv ?? {};
  const { runner, withServiceAccount } = buildRunnerEnv({
    runId,
    sha,
    values,
    serviceAccountJson,
    credentials,
    paths,
  });
  const root = paths.worktreeDir;

  const assertNotInterrupted = () => {
    if (ops.interrupted?.()) throw new StepFailure('중단 요청', '사용자가 실행을 멈췄습니다');
  };
  const step = async (name, command, args, { cwd = root, env = base, stdoutFile } = {}) => {
    assertNotInterrupted();
    log(`▶ ${name}`);
    const code = await ops.run({ name, command, args, cwd, env, stdoutFile });
    if (code !== 0) throw new StepFailure(name, `종료 코드 ${code}`);
  };
  // Playwright는 실패해도 JSON 요약을 남긴 뒤 판정한다(워크플로의 요약 단계와 같음).
  const playwright = async (name, args, env, jsonFile, expected, summaryName) => {
    let runError = null;
    try {
      await pnpm(name, args, { env });
    } catch (error) {
      runError = error;
    }
    const verdict = ops.exists(jsonFile)
      ? evaluatePlaywrightStats(ops.readJson(jsonFile), expected)
      : { ok: false, summary: { status: 'not-run' } };
    writeJsonSafe(ops, path.join(paths.evidenceDir, summaryName), verdict.summary);
    if (runError) throw runError;
    if (!verdict.ok) {
      throw new StepFailure(`${expected}건 무건너뜀 판정`, JSON.stringify(verdict.summary));
    }
  };
  const pnpm = (name, args, options) => step(name, 'pnpm', args, options);
  const node = (name, args, options) => step(name, 'node', args, options);

  try {
    worktreeAttempted = true;
    await ops.createWorktree({ sha, dir: root });
    const headSha = await ops.readHeadSha(root);
    if (headSha !== sha) throw new StepFailure('worktree SHA 확인', 'HEAD가 대상 SHA와 다릅니다');
    const envFiles = ops.findEnvFiles(root);
    if (envFiles.length > 0) {
      throw new StepFailure('깨끗한 checkout 확인', `env 파일이 있습니다: ${envFiles.join(', ')}`);
    }
    const contractProblems = ops.checkCheckoutContract(root);
    if (contractProblems.length > 0) {
      throw new StepFailure('대상 SHA 계약 확인', contractProblems.join('; '));
    }

    await pnpm('의존성 설치', ['install', '--frozen-lockfile', '--prefer-offline']);
    await pnpm('shared 빌드', ['--filter', '@greenhub/shared', 'build']);
    for (const { name } of LOCAL_APPS) {
      await pnpm(`${name} 빌드`, ['--filter', name, 'build'], {
        env: { ...base, ...buildAppEnv(name, { values, credentials }) },
      });
    }
    for (const { name } of LOCAL_APPS) {
      const scan = ops.scanAppBuild(path.join(root, 'apps', name));
      if (!scan.ok) {
        const detail =
          scan.findings.length > 0
            ? scan.findings.map(({ file, marker }) => `${file}(${marker})`).join(', ')
            : `${LOCAL_E2E_API_ORIGIN} 인라인을 찾지 못했습니다`;
        throw new StepFailure(`${name} 빌드 산출물 검사`, detail);
      }
    }

    for (const app of LOCAL_APPS) {
      await ops.assertPortFree(app);
    }
    for (const app of LOCAL_APPS) {
      assertNotInterrupted();
      log(`▶ ${app.name} 시작 ${app.origin}`);
      servers.push(
        await ops.startServer({
          app,
          cwd: path.join(root, 'apps', app.name),
          env: { ...base, ...buildAppEnv(app.name, { values, credentials }) },
          logFile: path.join(paths.logDir, `${app.name}.log`),
        }),
      );
    }
    for (const server of servers) await ops.waitForLogin(server);

    await node('비운영 readiness 확인', ['scripts/check-round-direct-e2e-readiness.mjs'], {
      env: { ...base, ...withServiceAccount },
      stdoutFile: path.join(paths.evidenceDir, 'readiness.json'),
    });
    await pnpm('Playwright chromium 설치', [
      '--filter',
      'e2e',
      'exec',
      'playwright',
      'install',
      'chromium',
    ]);

    for (const project of PROJECTS) {
      for (const action of ['seed', 'verify']) {
        const rawFile = path.join(paths.evidenceRoot, `${action}-${project}-raw.json`);
        await node(
          `${project} fixture ${action}`,
          [
            'scripts/round-direct-e2e-fixtures.mjs',
            action,
            `--project=${project}`,
            `--manifest=${paths.manifest(project)}`,
          ],
          { env: { ...base, ...withServiceAccount }, stdoutFile: rawFile },
        );
      }
    }

    await playwright(
      `소비자·셀러·드라이버 ${EXPECTED_ROUND_TESTS}건 실행`,
      [...PLAYWRIGHT_ROUND_ARGS],
      { ...base, ...runner },
      paths.playwrightJson,
      EXPECTED_ROUND_TESTS,
      'playwright-summary.json',
    );
    // 로그아웃·정지는 같은 계정의 다른 세션에 영향을 주므로 52건이 모두 통과한 뒤에만 실행한다.
    await playwright(
      `세션 수명주기 ${EXPECTED_SESSION_TESTS}건 실행`,
      [...PLAYWRIGHT_SESSION_ARGS],
      { ...base, ...withServiceAccount, PLAYWRIGHT_JSON_OUTPUT_FILE: paths.sessionJson },
      paths.sessionJson,
      EXPECTED_SESSION_TESTS,
      'session-lifecycle-summary.json',
    );
  } catch (error) {
    failures.push(
      error instanceof StepFailure ? error.message : `예외: ${error?.message ?? error}`,
    );
  } finally {
    // 1) fixture cleanup — manifest가 있는 project만(워크플로와 같음). 서버·worktree보다 먼저 한다.
    for (const project of PROJECTS) {
      const manifest = paths.manifest(project);
      if (!worktreeAttempted || !ops.exists(manifest)) continue;
      const rawFile = path.join(paths.evidenceRoot, `cleanup-${project}-raw.json`);
      try {
        log(`▶ ${project} fixture cleanup`);
        const code = await ops.run({
          name: `${project} fixture cleanup`,
          command: 'node',
          args: [
            'scripts/round-direct-e2e-fixtures.mjs',
            'cleanup',
            `--project=${project}`,
            `--manifest=${manifest}`,
          ],
          cwd: root,
          env: { ...base, ...withServiceAccount },
          stdoutFile: rawFile,
        });
        const result = ops.exists(rawFile) ? ops.readJson(rawFile) : null;
        const remaining = {
          remainingDocumentCount: result?.remainingDocuments?.length ?? null,
          remainingObjectCount: result?.remainingObjects?.length ?? null,
        };
        writeJsonSafe(ops, path.join(paths.evidenceDir, `cleanup-${project}.json`), {
          action: 'cleanup',
          project,
          ready: result?.ready ?? false,
          ...remaining,
        });
        if (code !== 0 || result?.ready !== true) {
          cleanupFailures.push(
            `${project} fixture cleanup 실패(종료 코드 ${code}, 남은 문서 ${remaining.remainingDocumentCount}, 남은 객체 ${remaining.remainingObjectCount}) — manifest: ${manifest}`,
          );
        }
      } catch (error) {
        cleanupFailures.push(
          `${project} fixture cleanup 예외: ${error?.message ?? error} — manifest: ${manifest}`,
        );
      }
    }
    // 2) 띄운 서버 종료 — 실행기가 시작한 프로세스만.
    for (const server of servers.reverse()) {
      try {
        await ops.stopServer(server);
      } catch (error) {
        cleanupFailures.push(`${server.app.name} 서버 종료 실패: ${error?.message ?? error}`);
      }
    }
    // 3) 비민감 요약을 보존 위치로 복사한 뒤 임시 worktree 제거.
    if (worktreeAttempted) {
      try {
        ops.preserveEvidence(paths);
      } catch (error) {
        cleanupFailures.push(`증거 요약 복사 실패: ${error?.message ?? error}`);
      }
      try {
        await ops.removeWorktree(root);
      } catch (error) {
        cleanupFailures.push(`임시 worktree 제거 실패(${root}): ${error?.message ?? error}`);
      }
    }
  }
  return { ok: failures.length === 0 && cleanupFailures.length === 0, failures, cleanupFailures };
}

function writeJsonSafe(ops, file, value) {
  (ops.writeJson ?? writeJson)(file, value);
}

// ───────────────────────── 실제 ops (Windows·POSIX) ─────────────────────────

const SAFE_SHELL_ARG = /^[A-Za-z0-9@/._:=,+-]+$/;

function resolveCommand(command, args, platform = process.platform) {
  if (command === 'node') return { file: process.execPath, args, shell: false };
  if (command === 'pnpm' && platform === 'win32') {
    // Windows의 pnpm은 .cmd라 shell이 필요하다. 인자는 안전 문자만 허용하고 한 줄 명령으로 넘긴다.
    for (const arg of args) {
      if (!SAFE_SHELL_ARG.test(arg))
        throw new LocalE2EError(`shell 인자에 허용되지 않는 문자가 있습니다: ${arg}`);
    }
    return { file: ['pnpm.cmd', ...args].join(' '), args: [], shell: true };
  }
  return { file: command, args, shell: false };
}

let currentChild = null;

function runProcess({ command, args, cwd, env, stdoutFile }) {
  return new Promise((resolve, reject) => {
    const resolved = resolveCommand(command, args);
    let fd = null;
    if (stdoutFile) {
      fs.mkdirSync(path.dirname(stdoutFile), { recursive: true });
      fd = fs.openSync(stdoutFile, 'w');
    }
    const child = spawn(resolved.file, resolved.args, {
      cwd,
      env,
      shell: resolved.shell,
      stdio: ['ignore', fd ?? 'inherit', 'inherit'],
      windowsHide: true,
    });
    currentChild = child;
    child.once('error', (error) => {
      if (fd !== null) fs.closeSync(fd);
      currentChild = null;
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (fd !== null) fs.closeSync(fd);
      currentChild = null;
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function git(args, cwd = REPOSITORY_ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new LocalE2EError(`git ${args[0]} 실패: ${(result.stderr || '').trim()}`);
  }
  return result.stdout.trim();
}

export function resolveTargetSha(ref, { fetch: shouldFetch = false } = {}) {
  if (shouldFetch && ref === DEFAULT_TARGET_REF) git(['fetch', 'origin', 'main', '--quiet']);
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!SHA_PATTERN.test(sha)) throw new LocalE2EError('대상 SHA를 확인할 수 없습니다.');
  return sha;
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // 이미 종료된 프로세스 그룹은 아래 생존 확인에서 판정한다.
    }
    for (let i = 0; i < 50 && processAlive(child.pid); i += 1) await delay(100);
    if (processAlive(child.pid)) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // 생존 확인에서 판정한다.
      }
    }
  }
  for (let i = 0; i < 50 && processAlive(child.pid); i += 1) await delay(100);
}

function copyDirIfExists(from, to) {
  if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
}

export function createRealOps({ outputDir, interrupted = () => false }) {
  return {
    log: (message) => console.log(message),
    interrupted,
    baseEnv: sanitizedBaseEnv(),
    run: runProcess,
    exists: (file) => fs.existsSync(file),
    readJson,
    writeJson,
    findEnvFiles,
    scanAppBuild,
    async createWorktree({ sha, dir }) {
      git(['worktree', 'add', '--detach', dir, sha]);
    },
    async readHeadSha(dir) {
      return git(['rev-parse', 'HEAD'], dir);
    },
    checkCheckoutContract,
    async assertPortFree({ name, host, port }) {
      if (await portOpen(host, port)) {
        throw new StepFailure(
          `${name} 포트 확인`,
          `${host}:${port}를 이미 다른 프로세스가 사용 중입니다`,
        );
      }
    },
    async startServer({ app, cwd, env, logFile }) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const fd = fs.openSync(logFile, 'w');
      // 앱 start 스크립트(next start)에 호스트·포트만 더한다.
      const resolved = resolveCommand('pnpm', [
        'exec',
        'next',
        'start',
        '-H',
        app.host,
        '-p',
        String(app.port),
      ]);
      const child = spawn(resolved.file, resolved.args, {
        cwd,
        env,
        shell: resolved.shell,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      fs.closeSync(fd);
      const server = { app, child, logFile, exited: false };
      child.once('exit', () => {
        server.exited = true;
      });
      child.once('error', () => {
        server.exited = true;
      });
      return server;
    },
    async waitForLogin(server, { timeoutMs = 180_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (server.exited) {
          throw new StepFailure(
            `${server.app.name} 시작`,
            `서버가 종료됐습니다(로그: ${server.logFile})`,
          );
        }
        try {
          const response = await fetch(`${server.app.origin}/login`, {
            redirect: 'manual',
            signal: AbortSignal.timeout(5000),
          });
          if (response.status === 200) return;
        } catch {
          // 아직 기동 중
        }
        await delay(1000);
      }
      throw new StepFailure(
        `${server.app.name} 시작`,
        `/login 200 대기 시간 초과(로그: ${server.logFile})`,
      );
    },
    async stopServer(server) {
      await killTree(server.child);
      if (server.child?.pid && processAlive(server.child.pid)) {
        throw new LocalE2EError(`프로세스 ${server.child.pid}가 아직 살아 있습니다`);
      }
      if (await portOpen(server.app.host, server.app.port)) {
        throw new LocalE2EError(`${server.app.host}:${server.app.port}가 아직 열려 있습니다`);
      }
    },
    preserveEvidence(paths) {
      copyDirIfExists(paths.evidenceDir, path.join(outputDir, 'evidence'));
      copyDirIfExists(
        path.join(paths.worktreeDir, 'apps', 'e2e', 'test-results'),
        path.join(outputDir, 'test-results'),
      );
    },
    async removeWorktree(dir) {
      const removed = spawnSync('git', ['worktree', 'remove', '--force', dir], {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        windowsHide: true,
      });
      if (removed.status !== 0 && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      }
      git(['worktree', 'prune']);
      if (fs.existsSync(dir)) throw new LocalE2EError('디렉터리가 남아 있습니다');
      const listed = git(['worktree', 'list', '--porcelain'])
        .split(/\r?\n/)
        .some(
          (line) =>
            line.startsWith('worktree ') && path.resolve(line.slice(9)) === path.resolve(dir),
        );
      if (listed) throw new LocalE2EError('git worktree 목록에 남아 있습니다');
    },
  };
}

function loadEnvFile(envFile) {
  if (!fs.existsSync(envFile)) return null;
  return parseDotenv(fs.readFileSync(envFile));
}

function printValidation(result, envFile) {
  console.error(`env 검증 실패: ${envFile}`);
  for (const { code, message, names } of result.failures) {
    console.error(`  - ${code}: ${message}${names.length > 0 ? ` [${names.join(', ')}]` : ''}`);
  }
}

function usage() {
  return [
    '사용법: node scripts/round-direct-e2e-local.mjs [--sha=<ref|40hex>] [--target-env=<경로>] [--dry-run]',
    `  --sha       대상 커밋(기본 ${DEFAULT_TARGET_REF}, 기본값일 때만 실행 전에 fetch)`,
    `  --target-env  env 파일(기본 ${DEFAULT_ENV_FILE})`,
    '  --dry-run   env 검증과 실행 계획만 출력(빌드·외부 호출 없음)',
    '자세한 내용: apps/e2e/README.md',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const envFile = path.resolve(REPOSITORY_ROOT, options.envFile);
  const fileEnv = loadEnvFile(envFile);
  const validation = fileEnv
    ? validateLocalEnv(fileEnv, { envFileDir: path.dirname(envFile) })
    : {
        ok: false,
        failures: [
          {
            code: 'ENV_FILE_MISSING',
            message: 'env 파일이 없습니다. 필요한 이름은 아래와 같습니다.',
            names: [...REQUIRED_ENV_NAMES, `${SERVICE_ACCOUNT_ENV_NAMES.join(' 또는 ')}`],
          },
        ],
      };
  if (!validation.ok) {
    printValidation(validation, envFile);
    return 2;
  }

  let sha;
  try {
    sha = resolveTargetSha(options.targetRef, { fetch: !options.dryRun });
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const runId = validation.values.ROUND_DIRECT_E2E_RUN_ID || createRunId(sha);

  if (options.dryRun) {
    const plan = describePlan({
      sha,
      runId,
      envFile,
      worktreeDir: path.join(os.tmpdir(), 'greenhub-rd-local-<임의>', 'repo'),
      outputDir: path.join(os.tmpdir(), 'greenhub-rd-local-<임의>', 'output'),
    });
    console.log(JSON.stringify({ dryRun: true, envValid: true, ...plan }, null, 2));
    return 0;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'greenhub-rd-local-'));
  const outputDir = path.join(tempRoot, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const paths = buildRunPaths({ worktreeDir: path.join(tempRoot, 'repo'), outputDir, runId });
  console.log(
    JSON.stringify(
      describePlan({ sha, runId, envFile, worktreeDir: paths.worktreeDir, outputDir }),
      null,
      2,
    ),
  );

  let interrupted = false;
  const onSignal = () => {
    if (interrupted) return;
    interrupted = true;
    console.error('중단 요청 — 현재 단계를 멈추고 cleanup을 진행합니다.');
    if (currentChild) void killTree(currentChild);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const credentials = createRunCredentials(runId);
  let result;
  try {
    result = await runLocalRoundDirectE2E(
      {
        sha,
        runId,
        values: validation.values,
        serviceAccountJson: validation.serviceAccountJson,
        credentials,
        paths,
      },
      createRealOps({ outputDir, interrupted: () => interrupted }),
    );
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  writeJson(path.join(outputDir, 'result.json'), {
    ok: result.ok,
    targetSha: sha,
    runId,
    failures: result.failures,
    cleanupFailures: result.cleanupFailures,
  });
  for (const failure of result.failures) console.error(`실패: ${failure}`);
  for (const failure of result.cleanupFailures) console.error(`cleanup 실패: ${failure}`);
  console.log(`${result.ok ? '통과' : '실패'} — 결과·로그: ${outputDir}`);
  return result.ok ? 0 : 1;
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
