import {
  execFile as nativeExecFile,
  spawn as nativeSpawn,
  spawnSync as nativeSpawnSync,
} from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { dirname, posix as posixPath, resolve, win32 as windowsPath } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../../..');

export const LOCAL_RUNTIME_CONTRACT = Object.freeze({
  projectId: 'greenhub-local',
  storageBucket: 'greenhub-local.appspot.com',
  ports: Object.freeze({
    api: 3000,
    consumer: 3001,
    sellerAdmin: 3002,
    driver: 3003,
    auth: 9099,
    firestore: 8080,
    storage: 9199,
  }),
  requiredMarkers: Object.freeze({
    GREENHUB_LOCAL_RUNTIME: 'true',
    NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME: 'true',
    NODE_ENV: 'development',
    GREENHUB_SCHEDULES_ENABLED: 'false',
  }),
});

export const JAVA_RUNTIME_CONTRACT = Object.freeze({
  minimumMajorVersion: 21,
  explicitOverrideKey: 'GREENHUB_JAVA_HOME',
  currentJavaHomeKey: 'JAVA_HOME',
});

export const FIXED_PORTS = Object.freeze([
  LOCAL_RUNTIME_CONTRACT.ports.api,
  LOCAL_RUNTIME_CONTRACT.ports.consumer,
  LOCAL_RUNTIME_CONTRACT.ports.sellerAdmin,
  LOCAL_RUNTIME_CONTRACT.ports.driver,
  LOCAL_RUNTIME_CONTRACT.ports.firestore,
  LOCAL_RUNTIME_CONTRACT.ports.auth,
  LOCAL_RUNTIME_CONTRACT.ports.storage,
]);

export const READINESS_HTTP_TARGETS = Object.freeze([
  Object.freeze({
    name: 'api-health',
    url: `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.api}/health`,
    requiresOkStatus: true,
  }),
  Object.freeze({
    name: 'consumer-login',
    url: `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.consumer}/login`,
    requiresOkStatus: false,
  }),
  Object.freeze({
    name: 'seller-login',
    url: `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.sellerAdmin}/login`,
    requiresOkStatus: false,
  }),
  Object.freeze({
    name: 'driver-login',
    url: `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.driver}/login`,
    requiresOkStatus: false,
  }),
]);

export const READINESS_LISTENER_PORTS = Object.freeze([
  LOCAL_RUNTIME_CONTRACT.ports.auth,
  LOCAL_RUNTIME_CONTRACT.ports.firestore,
  LOCAL_RUNTIME_CONTRACT.ports.storage,
]);

export const LOCAL_BROWSER_URLS = Object.freeze([
  `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.consumer}/login`,
  `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.sellerAdmin}/login`,
  `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.driver}/login`,
]);

const LOCAL_CORS_ORIGINS = [
  `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.consumer}`,
  `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.sellerAdmin}`,
  `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.driver}`,
].join(',');

const PRODUCTION_MARKERS = Object.freeze({
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  RAILWAY_ENVIRONMENT_NAME: 'production',
});

const LOCAL_ENVIRONMENT_KEYS_TO_REMOVE = new Set([
  'AUTH_SECRET',
  'AUTH_URL',
  'CORS_ORIGIN',
  'CLOUDSDK_CORE_PROJECT',
  'E2E_TEST_SECRET',
  'E2E_TEST',
  'FIREBASE_CONFIG',
  'FIREBASE_SERVICE_ACCOUNT',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'FIREBASE_SERVICE_ACCOUNT_PATH',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_API_KEY',
  'GOOGLE_CLOUD_PROJECT',
  'GREENHUB_JAVA_HOME',
  'JWT_REFRESH_SECRET',
  'JWT_SECRET',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'NEXTAUTH_URL_INTERNAL',
  'RAILWAY_ENVIRONMENT_NAME',
  'ROUND_DIRECT_E2E_DRIVER_EMAILS',
  'ROUND_DIRECT_E2E_ENABLED',
  'ROUND_DIRECT_E2E_PORTONE_FIXTURES_JSON',
  'ROUND_DIRECT_E2E_SHARED_SECRET',
  'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
]);

const LOCAL_RUNTIME_SAFE_OVERRIDE_KEYS = new Set([
  'AUTH_URL',
  'CORS_ORIGIN',
  'HOSTNAME',
  'NEXTAUTH_URL',
  'NEXT_PUBLIC_API_URL',
  'PORT',
]);

const LOCAL_ENVIRONMENT_KEY_PREFIXES_TO_REMOVE = [
  'ALIGO_',
  'FIREBASE_SERVICE_ACCOUNT_',
  'GEMINI_',
  'KAKAO_',
  'NEXT_PUBLIC_GEMINI_',
  'NEXT_PUBLIC_KAKAO_',
  'NEXT_PUBLIC_PORTONE_',
  'PORTONE_',
];

const LOCAL_RUNTIME_DENY_VALUE_KEYS = Object.freeze([
  'ALIGO_API_KEY',
  'ALIGO_SENDER_KEY',
  'ALIGO_SENDER_PHONE',
  'ALIGO_TEMPLATE_CODES_JSON',
  'ALIGO_USER_ID',
  'E2E_TEST',
  'E2E_TEST_SECRET',
  'FIREBASE_CONFIG',
  'FIREBASE_SERVICE_ACCOUNT',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'FIREBASE_SERVICE_ACCOUNT_PATH',
  'GEMINI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_API_KEY',
  'KAKAO_CLIENT_ID',
  'KAKAO_CLIENT_SECRET',
  'NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY',
  'NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY',
  'NEXT_PUBLIC_PORTONE_STORE_ID',
  'NEXT_PUBLIC_KAKAO_MAP_KEY',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL_INTERNAL',
  'PORTONE_V2_SECRET',
  'PORTONE_WEBHOOK_SECRET',
  'ROUND_DIRECT_E2E_DRIVER_EMAILS',
  'ROUND_DIRECT_E2E_ENABLED',
  'ROUND_DIRECT_E2E_PORTONE_FIXTURES_JSON',
  'ROUND_DIRECT_E2E_SHARED_SECRET',
]);

export class LocalRuntimeError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'LocalRuntimeError';
  }
}

export class LocalRuntimeConfigurationError extends LocalRuntimeError {
  constructor(message) {
    super(message);
    this.name = 'LocalRuntimeConfigurationError';
  }
}

export class JavaRuntimeConfigurationError extends LocalRuntimeConfigurationError {
  constructor(message) {
    super(message);
    this.name = 'JavaRuntimeConfigurationError';
  }
}

export class PortCollisionError extends LocalRuntimeError {
  constructor(ports) {
    super(`로컬 runtime 포트가 이미 사용 중입니다: ${ports.join(', ')}`);
    this.name = 'PortCollisionError';
    this.ports = [...ports];
  }
}

export class ChildProcessExitError extends LocalRuntimeError {
  constructor(name, code, signal) {
    const exitDescription = signal ? `signal=${signal}` : `code=${code ?? 'unknown'}`;
    super(`소유 child process가 예기치 않게 종료되었습니다: ${name} (${exitDescription})`);
    this.name = 'ChildProcessExitError';
    this.childName = name;
    this.code = code;
    this.signal = signal;
  }
}

export class ReadinessTimeoutError extends LocalRuntimeError {
  constructor(result, timeoutMs) {
    const failed = result?.failures?.join(', ') || '미확인';
    super(`local runtime readiness timeout (${timeoutMs}ms): ${failed}`);
    this.name = 'ReadinessTimeoutError';
    this.result = result;
    this.timeoutMs = timeoutMs;
  }
}

export class ShutdownRequestedError extends LocalRuntimeError {
  constructor(exitCode, signal) {
    super(`local runtime 종료 요청: ${signal}`);
    this.name = 'ShutdownRequestedError';
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

function readEnvironmentValue(environment, key) {
  const value = environment?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function hasEnvironmentKey(environment, key) {
  return Object.keys(environment ?? {}).some(
    (candidate) => candidate.toLowerCase() === key.toLowerCase(),
  );
}

function pathApiForPlatform(platform) {
  return platform === 'win32' ? windowsPath : posixPath;
}

function javaExecutableName(platform) {
  return platform === 'win32' ? 'java.exe' : 'java';
}

function javaHomeFromEnvironment(environment, key) {
  return readEnvironmentValue(environment, key).replace(/^"|"$/g, '');
}

function javaExecutableFromHome(javaHome, platform) {
  return pathApiForPlatform(platform).join(javaHome, 'bin', javaExecutableName(platform));
}

function parseJavaMajorVersion(output) {
  const text = String(output ?? '');
  const propertyMatch = text.match(/(?:^|\r?\n)\s*java\.version\s*=\s*([0-9]+)(?:\.([0-9]+))?/m);
  const versionMatch = text.match(/\bversion\s+"([0-9]+)(?:\.([0-9]+))?/i);
  const openJdkMatch = text.match(/\b(?:openjdk|java)\s+([0-9]+)(?:\.([0-9]+))?/i);
  const match = propertyMatch ?? versionMatch ?? openJdkMatch;
  if (!match) return undefined;

  const first = Number(match[1]);
  const second = match[2] === undefined ? undefined : Number(match[2]);
  if (!Number.isInteger(first)) return undefined;
  return first === 1 && Number.isInteger(second) ? second : first;
}

function parseJavaHome(output) {
  const match = String(output ?? '').match(/^\s*java\.home\s*=\s*(.+?)\s*$/m);
  return match?.[1]?.trim() || undefined;
}

function javaRuntimeErrorMessage() {
  return `Firebase Emulator를 실행하려면 Java ${JAVA_RUNTIME_CONTRACT.minimumMajorVersion}+가 필요합니다. ${JAVA_RUNTIME_CONTRACT.explicitOverrideKey}, ${JAVA_RUNTIME_CONTRACT.currentJavaHomeKey} 또는 PATH에 Java ${JAVA_RUNTIME_CONTRACT.minimumMajorVersion}+를 설정하세요.`;
}

function explicitJavaRuntimeError(javaHome, reason) {
  return `${javaRuntimeErrorMessage()} ${JAVA_RUNTIME_CONTRACT.explicitOverrideKey}=${javaHome} ${reason}`;
}

export function discoverWindowsJavaFallbackHomes(environment = process.env) {
  const pathApi = pathApiForPlatform('win32');
  const roots = [
    readEnvironmentValue(environment, 'ProgramW6432'),
    readEnvironmentValue(environment, 'ProgramFiles'),
    readEnvironmentValue(environment, 'ProgramFiles(x86)'),
  ].filter(Boolean);
  const candidates = roots.flatMap((root) => [
    pathApi.join(root, 'Android', 'Android Studio', 'jbr'),
    pathApi.join(root, 'Android Studio', 'jbr'),
  ]);
  const localAppData = readEnvironmentValue(environment, 'LOCALAPPDATA');
  if (localAppData) {
    candidates.push(pathApi.join(localAppData, 'Programs', 'Android Studio', 'jbr'));
  }
  return [...new Set(candidates)];
}

export function probeJavaExecutable({
  executable,
  environment,
  javaHome,
  source,
  platform = process.platform,
  spawnSyncImpl = nativeSpawnSync,
} = {}) {
  let result;
  try {
    result = spawnSyncImpl(executable, ['-XshowSettings:properties', '-version'], {
      env: environment,
      encoding: 'utf8',
      shell: false,
      windowsHide: platform === 'win32',
    });
  } catch {
    return undefined;
  }

  if (result?.error || result?.status !== 0) return undefined;
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const majorVersion = parseJavaMajorVersion(output);
  if (!Number.isInteger(majorVersion)) return undefined;

  return {
    executable,
    javaHome: javaHome || parseJavaHome(output),
    majorVersion,
    source,
  };
}

function probeJavaCandidate(candidate, options) {
  try {
    return options.probeJavaRuntime({
      ...candidate,
      environment: options.baseEnvironment,
      platform: options.platform,
    });
  } catch {
    return undefined;
  }
}

export function resolveJavaRuntime({
  baseEnvironment = process.env,
  platform = process.platform,
  probeJavaRuntime = probeJavaExecutable,
  windowsFallbackHomes,
} = {}) {
  const explicitJavaHome = javaHomeFromEnvironment(
    baseEnvironment,
    JAVA_RUNTIME_CONTRACT.explicitOverrideKey,
  );
  const hasExplicitOverride = hasEnvironmentKey(
    baseEnvironment,
    JAVA_RUNTIME_CONTRACT.explicitOverrideKey,
  );
  if (hasExplicitOverride) {
    if (!explicitJavaHome) {
      throw new JavaRuntimeConfigurationError(
        `${javaRuntimeErrorMessage()} ${JAVA_RUNTIME_CONTRACT.explicitOverrideKey}가 비어 있습니다.`,
      );
    }
    const candidate = {
      executable: javaExecutableFromHome(explicitJavaHome, platform),
      javaHome: explicitJavaHome,
      source: 'explicit-override',
    };
    const result = probeJavaCandidate(candidate, {
      baseEnvironment,
      platform,
      probeJavaRuntime,
    });
    if (!result) {
      throw new JavaRuntimeConfigurationError(
        explicitJavaRuntimeError(explicitJavaHome, '경로가 없거나 실행할 수 없습니다.'),
      );
    }
    if (
      !Number.isInteger(result.majorVersion) ||
      result.majorVersion < JAVA_RUNTIME_CONTRACT.minimumMajorVersion
    ) {
      throw new JavaRuntimeConfigurationError(
        explicitJavaRuntimeError(
          explicitJavaHome,
          `Java ${JAVA_RUNTIME_CONTRACT.minimumMajorVersion}+가 아닌 ${result.majorVersion}입니다.`,
        ),
      );
    }
    return { ...candidate, ...result, source: candidate.source };
  }

  const candidates = [];
  const currentJavaHome = javaHomeFromEnvironment(
    baseEnvironment,
    JAVA_RUNTIME_CONTRACT.currentJavaHomeKey,
  );
  if (currentJavaHome) {
    candidates.push({
      executable: javaExecutableFromHome(currentJavaHome, platform),
      javaHome: currentJavaHome,
      source: 'java-home',
    });
  }
  candidates.push({
    executable: javaExecutableName(platform),
    source: 'path',
  });

  if (platform === 'win32') {
    const fallbackHomes = windowsFallbackHomes ?? discoverWindowsJavaFallbackHomes(baseEnvironment);
    candidates.push(
      ...fallbackHomes.map((javaHome) => ({
        executable: javaExecutableFromHome(javaHome, platform),
        javaHome,
        source: 'windows-jbr-fallback',
      })),
    );
  }

  for (const candidate of candidates) {
    const result = probeJavaCandidate(candidate, {
      baseEnvironment,
      platform,
      probeJavaRuntime,
    });
    if (result?.majorVersion >= JAVA_RUNTIME_CONTRACT.minimumMajorVersion) {
      return { ...candidate, ...result, source: candidate.source };
    }
  }

  throw new JavaRuntimeConfigurationError(javaRuntimeErrorMessage());
}

export function projectJavaRuntime(environment, javaRuntime, platform = process.platform) {
  if (
    !javaRuntime ||
    !Number.isInteger(javaRuntime.majorVersion) ||
    javaRuntime.majorVersion < JAVA_RUNTIME_CONTRACT.minimumMajorVersion
  ) {
    throw new JavaRuntimeConfigurationError(javaRuntimeErrorMessage());
  }

  const projected = {
    ...environment,
    JAVA_HOME: javaRuntime.javaHome || '',
  };
  const javaBin = javaRuntime.javaHome
    ? pathApiForPlatform(platform).join(javaRuntime.javaHome, 'bin')
    : '';
  if (javaBin) {
    const pathKey = Object.hasOwn(projected, 'PATH')
      ? 'PATH'
      : Object.hasOwn(projected, 'Path')
        ? 'Path'
        : 'PATH';
    const inheritedPath = readEnvironmentValue(projected, pathKey);
    projected[pathKey] = [javaBin, inheritedPath]
      .filter(Boolean)
      .join(platform === 'win32' ? ';' : ':');
  }
  return projected;
}

function isProductionMarker(key, environment) {
  return readEnvironmentValue(environment, key).toLowerCase() === PRODUCTION_MARKERS[key];
}

export function assertSafeLocalParentEnvironment(environment = process.env) {
  const productionKeys = Object.keys(PRODUCTION_MARKERS).filter((key) =>
    isProductionMarker(key, environment),
  );

  if (productionKeys.length > 0) {
    throw new LocalRuntimeConfigurationError(
      `production marker가 있는 환경에서는 local runtime을 시작할 수 없습니다: ${productionKeys.join(', ')}`,
    );
  }
}

export function isBlockedLocalEnvironmentKey(key) {
  if (LOCAL_ENVIRONMENT_KEYS_TO_REMOVE.has(key)) return true;
  return LOCAL_ENVIRONMENT_KEY_PREFIXES_TO_REMOVE.some((prefix) => key.startsWith(prefix));
}

function fixedLocalEnvironment(overrides = {}) {
  const safeOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([key]) => LOCAL_RUNTIME_SAFE_OVERRIDE_KEYS.has(key)),
  );

  return {
    ...safeOverrides,
    ...LOCAL_RUNTIME_CONTRACT.requiredMarkers,
    AUTH_SECRET: 'greenhub-local-auth-secret',
    CORS_ORIGIN: LOCAL_CORS_ORIGINS,
    FIREBASE_PROJECT_ID: LOCAL_RUNTIME_CONTRACT.projectId,
    FIREBASE_STORAGE_BUCKET: LOCAL_RUNTIME_CONTRACT.storageBucket,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${LOCAL_RUNTIME_CONTRACT.ports.auth}`,
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${LOCAL_RUNTIME_CONTRACT.ports.firestore}`,
    STORAGE_EMULATOR_HOST: `127.0.0.1:${LOCAL_RUNTIME_CONTRACT.ports.storage}`,
    FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${LOCAL_RUNTIME_CONTRACT.ports.storage}`,
    NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME: 'true',
    NEXT_PUBLIC_FIREBASE_API_KEY: 'greenhub-local-emulator-key',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'greenhub-local.firebaseapp.com',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: LOCAL_RUNTIME_CONTRACT.projectId,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: LOCAL_RUNTIME_CONTRACT.storageBucket,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'greenhub-local-sender',
    NEXT_PUBLIC_FIREBASE_APP_ID: 'greenhub-local-app',
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${LOCAL_RUNTIME_CONTRACT.ports.auth}`,
    NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: `127.0.0.1:${LOCAL_RUNTIME_CONTRACT.ports.firestore}`,
    NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${LOCAL_RUNTIME_CONTRACT.ports.storage}`,
    GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY: 'DENY_ALL_EXTERNAL_PROVIDER_DISPATCH',
    JWT_SECRET: 'greenhub-local-jwt-secret',
    JWT_REFRESH_SECRET: 'greenhub-local-jwt-refresh-secret',
  };
}

export function buildRuntimeEnvironment(baseEnvironment = process.env, overrides = {}) {
  assertSafeLocalParentEnvironment(baseEnvironment);

  const sanitized = {};
  for (const [key, value] of Object.entries(baseEnvironment ?? {})) {
    if (!isBlockedLocalEnvironmentKey(key)) sanitized[key] = value;
  }

  const environment = {
    ...sanitized,
    ...fixedLocalEnvironment(overrides),
  };

  for (const key of LOCAL_RUNTIME_DENY_VALUE_KEYS) environment[key] = '';

  return environment;
}

function executableName(binary, platform) {
  if (platform !== 'win32') return binary;
  if (/\.(?:cmd|exe|com)$/i.test(binary)) return binary;
  return `${binary}.cmd`;
}

export function buildChildSpecs({
  baseEnvironment = process.env,
  platform = process.platform,
  repositoryRoot = REPOSITORY_ROOT,
  pnpmCommand,
  firebaseCommand,
  javaRuntime,
  javaRuntimeResolver = resolveJavaRuntime,
} = {}) {
  const resolvedPnpmCommand = pnpmCommand ?? executableName('pnpm', platform);
  const configuredFirebaseCommand = readEnvironmentValue(
    baseEnvironment,
    'GREENHUB_FIREBASE_COMMAND',
  );
  const resolvedFirebaseCommand =
    firebaseCommand ?? (configuredFirebaseCommand || executableName('firebase', platform));
  const selectedJavaRuntime = javaRuntime ?? javaRuntimeResolver({ baseEnvironment, platform });

  const appEnvironment = (port, nextAuthUrl) =>
    buildRuntimeEnvironment(baseEnvironment, {
      PORT: String(port),
      NEXT_PUBLIC_API_URL: `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.api}`,
      NEXTAUTH_URL: nextAuthUrl,
      AUTH_URL: nextAuthUrl,
      HOSTNAME: '127.0.0.1',
    });

  const apiEnvironment = buildRuntimeEnvironment(baseEnvironment, {
    PORT: String(LOCAL_RUNTIME_CONTRACT.ports.api),
    HOSTNAME: '127.0.0.1',
  });

  const firebaseEnvironment = projectJavaRuntime(
    buildRuntimeEnvironment(baseEnvironment, {
      HOSTNAME: '127.0.0.1',
    }),
    selectedJavaRuntime,
    platform,
  );

  return [
    {
      name: 'firebase-emulator-suite',
      command: resolvedFirebaseCommand,
      args: [
        'emulators:start',
        '--only',
        'auth,firestore,storage',
        '--project',
        LOCAL_RUNTIME_CONTRACT.projectId,
      ],
      cwd: repositoryRoot,
      env: firebaseEnvironment,
    },
    {
      name: 'api',
      command: resolvedPnpmCommand,
      args: ['--filter', 'api', 'start:dev'],
      cwd: repositoryRoot,
      env: apiEnvironment,
    },
    {
      name: 'consumer',
      command: resolvedPnpmCommand,
      args: [
        '--filter',
        'consumer',
        'dev',
        '--port',
        String(LOCAL_RUNTIME_CONTRACT.ports.consumer),
      ],
      cwd: repositoryRoot,
      env: appEnvironment(
        LOCAL_RUNTIME_CONTRACT.ports.consumer,
        `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.consumer}`,
      ),
    },
    {
      name: 'seller-admin',
      command: resolvedPnpmCommand,
      args: [
        '--filter',
        'seller',
        'dev',
        '--port',
        String(LOCAL_RUNTIME_CONTRACT.ports.sellerAdmin),
      ],
      cwd: repositoryRoot,
      env: appEnvironment(
        LOCAL_RUNTIME_CONTRACT.ports.sellerAdmin,
        `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.sellerAdmin}`,
      ),
    },
    {
      name: 'driver',
      command: resolvedPnpmCommand,
      args: ['--filter', 'driver', 'dev'],
      cwd: repositoryRoot,
      env: appEnvironment(
        LOCAL_RUNTIME_CONTRACT.ports.driver,
        `http://localhost:${LOCAL_RUNTIME_CONTRACT.ports.driver}`,
      ),
    },
  ];
}

export function isPortAvailable(
  port,
  { host = '127.0.0.1', createServerImpl = createServer } = {},
) {
  return new Promise((resolveResult, rejectResult) => {
    const server = createServerImpl();
    let settled = false;

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') settle(resolveResult, false);
      else settle(rejectResult, error);
    });

    server.listen({ port, host, exclusive: true }, () => {
      server.close((error) => {
        if (error) settle(rejectResult, error);
        else settle(resolveResult, true);
      });
    });
  });
}

export function probePortListening(port, { host = '127.0.0.1', timeoutMs = 1000 } = {}) {
  return new Promise((resolveResult) => {
    const socket = createConnection({ port, host });
    let settled = false;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveResult(value);
    };

    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

export async function preflightPorts(ports = FIXED_PORTS, { probe = isPortAvailable } = {}) {
  const results = await Promise.all(
    ports.map(async (port) => ({ port, available: await probe(port) })),
  );
  const collisions = results.filter((result) => !result.available).map((result) => result.port);
  if (collisions.length > 0) throw new PortCollisionError(collisions);
  return results;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromOutside = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromOutside, { once: true });
  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromOutside);
  }
}

async function readJsonResponse(response) {
  if (typeof response?.json === 'function') return response.json();
  if (typeof response?.text === 'function') return JSON.parse(await response.text());
  return undefined;
}

async function checkHttpReadiness(
  target,
  { fetchImpl = fetch, requestTimeoutMs = 2000, signal } = {},
) {
  try {
    const response = await fetchWithTimeout(fetchImpl, target.url, requestTimeoutMs, signal);
    if (response.status !== 200) {
      return { name: target.name, ok: false, reason: `HTTP ${response.status}` };
    }

    if (target.requiresOkStatus) {
      const body = await readJsonResponse(response);
      if (body?.status !== 'ok') {
        return { name: target.name, ok: false, reason: 'status=ok 아님' };
      }
    }

    return { name: target.name, ok: true };
  } catch (error) {
    return {
      name: target.name,
      ok: false,
      reason: error?.name === 'AbortError' ? 'timeout' : error?.message || '연결 실패',
    };
  }
}

export async function checkReadinessOnce({
  listenerPorts = READINESS_LISTENER_PORTS,
  httpTargets = READINESS_HTTP_TARGETS,
  portProbe = probePortListening,
  fetchImpl = fetch,
  requestTimeoutMs = 2000,
  signal,
} = {}) {
  const listenerResults = await Promise.all(
    listenerPorts.map(async (port) => {
      try {
        return { port, ok: await portProbe(port) };
      } catch (error) {
        return { port, ok: false, reason: error?.message || '연결 실패' };
      }
    }),
  );
  const httpResults = await Promise.all(
    httpTargets.map((target) =>
      checkHttpReadiness(target, { fetchImpl, requestTimeoutMs, signal }),
    ),
  );
  const failures = [
    ...listenerResults.filter((result) => !result.ok).map((result) => `port:${result.port}`),
    ...httpResults
      .filter((result) => !result.ok)
      .map((result) => `${result.name}:${result.reason}`),
  ];

  return {
    ready: failures.length === 0,
    listeners: listenerResults,
    http: httpResults,
    failures,
  };
}

export async function waitForReadiness({
  timeoutMs = 120_000,
  pollIntervalMs = 250,
  signal,
  ...options
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastResult;

  while (Date.now() <= deadline) {
    if (signal?.aborted) throw new LocalRuntimeError('readiness probe가 중단되었습니다.');
    lastResult = await checkReadinessOnce({ ...options, signal });
    if (lastResult.ready) return lastResult;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolveResult) => {
      const timer = setTimeout(resolveResult, Math.min(pollIntervalMs, remainingMs));
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolveResult();
        },
        { once: true },
      );
    });
  }

  throw new ReadinessTimeoutError(lastResult, timeoutMs);
}

function executeFile(execFileImpl, command, args) {
  return new Promise((resolveResult, rejectResult) => {
    execFileImpl(command, args, { windowsHide: true }, (error) => {
      if (error) rejectResult(error);
      else resolveResult();
    });
  });
}

function childHasExited(child) {
  return child?.exitCode !== null && child?.exitCode !== undefined;
}

function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return Promise.resolve(true);
  if (typeof child?.once !== 'function') return Promise.resolve(false);

  return new Promise((resolveResult) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolveResult(value);
    };
    child.once('exit', () => settle(true));
    setTimeout(() => settle(childHasExited(child)), timeoutMs);
  });
}

export async function terminateOwnedProcessTree(
  child,
  {
    platform = process.platform,
    execFileImpl = nativeExecFile,
    signalProcess = process.kill,
    gracePeriodMs = 3000,
  } = {},
) {
  if (!child?.pid) return;

  if (platform === 'win32') {
    try {
      await executeFile(execFileImpl, 'taskkill.exe', ['/PID', String(child.pid), '/T', '/F']);
    } catch {
      // 이미 종료된 owned process에 대한 idempotent cleanup은 성공으로 취급한다.
    }
    return;
  }

  try {
    signalProcess(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      try {
        child.kill?.('SIGTERM');
      } catch {
        // 아래의 강제 종료 단계에서 최종 정리를 시도한다.
      }
    }
  }

  if (await waitForChildExit(child, gracePeriodMs)) return;

  try {
    signalProcess(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      try {
        child.kill?.('SIGKILL');
      } catch {
        // cleanup은 호출자 finally에서 계속된다.
      }
    }
  }
}

export function openLocalBrowserUrls(
  urls = LOCAL_BROWSER_URLS,
  { platform = process.platform, spawnImpl = nativeSpawn } = {},
) {
  for (const url of urls) {
    let command;
    let args;
    if (platform === 'win32') {
      command = 'cmd.exe';
      args = ['/c', 'start', '', url];
    } else if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    try {
      const browserProcess = spawnImpl(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      browserProcess?.once?.('error', () => {});
      browserProcess?.unref?.();
    } catch {
      // 브라우저 열기는 선택 기능이며 runtime readiness를 거짓으로 만들지 않는다.
    }
  }
}

export function createLocalRuntime({
  baseEnvironment = process.env,
  platform = process.platform,
  repositoryRoot = REPOSITORY_ROOT,
  spawnImpl = nativeSpawn,
  terminateProcessTree = terminateOwnedProcessTree,
  childSpecsFactory = buildChildSpecs,
  readinessOptions = {},
  logger = console,
  pnpmCommand,
  firebaseCommand,
  javaRuntime,
  javaRuntimeResolver = resolveJavaRuntime,
} = {}) {
  const children = new Map();
  let cleanupPromise;
  let lifecycleResult;
  let resolveLifecycle;
  let ready = false;
  let stopping = false;
  const abortController = new AbortController();

  const lifecyclePromise = new Promise((resolveResult) => {
    resolveLifecycle = resolveResult;
  });

  const fail = (error) => {
    if (lifecycleResult || stopping) return;
    lifecycleResult = { kind: 'failure', error };
    resolveLifecycle(lifecycleResult);
    abortController.abort();
  };

  const requestStop = (exitCode, signal) => {
    if (lifecycleResult) return;
    stopping = true;
    lifecycleResult = { kind: 'stop', exitCode, signal };
    resolveLifecycle(lifecycleResult);
    abortController.abort();
  };

  const start = () => {
    if (children.size > 0)
      throw new LocalRuntimeError('local runtime은 한 번만 시작할 수 있습니다.');
    if (stopping) throw new ShutdownRequestedError(130, '시작 전 종료 요청');

    const specs = childSpecsFactory({
      baseEnvironment,
      platform,
      repositoryRoot,
      pnpmCommand,
      firebaseCommand,
      javaRuntime,
      javaRuntimeResolver,
    });

    for (const spec of specs) {
      let child;
      try {
        child = spawnImpl(spec.command, spec.args, {
          cwd: spec.cwd,
          env: spec.env,
          stdio: 'inherit',
          windowsHide: true,
          detached: platform !== 'win32',
          shell: platform === 'win32' && /\.cmd$/i.test(spec.command),
        });
      } catch (error) {
        throw new LocalRuntimeError(`owned child process 시작 실패: ${spec.name}`, {
          cause: error,
        });
      }
      children.set(spec.name, { spec, child });
      child?.once?.('error', (error) => {
        fail(
          new LocalRuntimeError(`owned child process 시작 실패: ${spec.name}`, { cause: error }),
        );
      });
      child?.once?.('exit', (code, signal) => {
        if (!stopping) fail(new ChildProcessExitError(spec.name, code, signal));
      });
    }

    return children;
  };

  const waitUntilReady = async () => {
    const readinessPromise = waitForReadiness({
      ...readinessOptions,
      signal: abortController.signal,
    });
    readinessPromise.catch(() => {});
    const lifecycleFailurePromise = lifecyclePromise.then((result) => {
      if (result.kind === 'failure') throw result.error;
      throw new ShutdownRequestedError(result.exitCode, result.signal);
    });
    return Promise.race([readinessPromise, lifecycleFailurePromise]).then(
      (result) => {
        ready = true;
        return result;
      },
      (error) => {
        if (lifecycleResult?.kind === 'failure') throw lifecycleResult.error;
        throw error;
      },
    );
  };

  const waitForTermination = () => lifecyclePromise;

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    stopping = true;
    abortController.abort();
    cleanupPromise = Promise.allSettled(
      [...children.values()].map(({ child }) =>
        Promise.resolve().then(() => terminateProcessTree(child, { platform })),
      ),
    ).then((results) => {
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        logger.error?.(`owned process cleanup 중 ${failures.length}건의 오류가 발생했습니다.`);
      }
      return results;
    });
    return cleanupPromise;
  };

  return {
    start,
    waitUntilReady,
    waitForTermination,
    requestStop,
    cleanup,
    isReady: () => ready,
    isStopping: () => stopping,
    children,
  };
}

export function parseLauncherOptions(argv = [], environment = process.env) {
  const explicitlyOpen = argv.includes('--open-browser');
  const explicitlyClosed = argv.includes('--no-browser');
  return {
    openBrowser: explicitlyClosed
      ? false
      : explicitlyOpen || readEnvironmentValue(environment, 'GREENHUB_OPEN_BROWSER') === 'true',
  };
}

export async function runLocalRuntime({
  baseEnvironment = process.env,
  openBrowser = false,
  openBrowserImpl = openLocalBrowserUrls,
  signalSource = process,
  logger = console,
  portAvailabilityProbe = isPortAvailable,
  ...runtimeOptions
} = {}) {
  const runtime = createLocalRuntime({ ...runtimeOptions, baseEnvironment, logger });
  const signalHandlers = {
    SIGINT: () => runtime.requestStop(130, 'SIGINT'),
    SIGTERM: () => runtime.requestStop(143, 'SIGTERM'),
  };

  for (const [signal, handler] of Object.entries(signalHandlers)) {
    signalSource.on(signal, handler);
  }

  try {
    assertSafeLocalParentEnvironment(baseEnvironment);
    await preflightPorts(runtimeOptions.ports ?? FIXED_PORTS, {
      probe: portAvailabilityProbe,
    });

    if (runtime.isStopping()) throw new ShutdownRequestedError(130, 'preflight 중 종료 요청');

    runtime.start();
    await runtime.waitUntilReady();
    logger.log?.('[local-runtime] READY: emulator, API, Consumer, Seller/Admin, Driver');

    if (openBrowser) {
      await openBrowserImpl(LOCAL_BROWSER_URLS);
    }

    const termination = await runtime.waitForTermination();
    if (termination.kind === 'failure') throw termination.error;
    return termination.exitCode ?? 0;
  } catch (error) {
    await runtime.cleanup();
    if (error instanceof ShutdownRequestedError) {
      logger.log?.(`[local-runtime] ${error.signal}에 따라 종료했습니다.`);
      return error.exitCode;
    }
    throw error;
  } finally {
    for (const [signal, handler] of Object.entries(signalHandlers)) {
      signalSource.removeListener(signal, handler);
    }
    await runtime.cleanup();
  }
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const launcherOptions = parseLauncherOptions(argv, environment);
  try {
    return await runLocalRuntime({
      baseEnvironment: environment,
      openBrowser: launcherOptions.openBrowser,
    });
  } catch (error) {
    console.error(`[local-runtime] 실행 실패: ${error?.message || error}`);
    return 1;
  }
}

const invokedFile = process.argv[1] ? resolve(process.argv[1]) : '';
const moduleFile = resolve(fileURLToPath(import.meta.url));
if (invokedFile === moduleFile) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
