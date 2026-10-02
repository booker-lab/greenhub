import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readRoundDirectTargetUrls } from '../apps/e2e/tests/_helpers/target-url.ts';
import { evaluateReadiness, normalizeReadinessInput } from './check-round-direct-e2e-readiness.mjs';
import { validateFixtureEnvironment } from './round-direct-e2e-fixtures.mjs';
import {
  buildAppEnv,
  buildRunnerEnv,
  buildRunPaths,
  checkCheckoutContract,
  createRunCredentials,
  createRunId,
  EXPECTED_ROUND_TESTS,
  EXPECTED_SESSION_TESTS,
  evaluatePlaywrightStats,
  LOCAL_APPS,
  LOCAL_E2E_API_ORIGIN,
  PLAYWRIGHT_ROUND_ARGS,
  PLAYWRIGHT_SESSION_ARGS,
  parseArgs,
  REQUIRED_ENV_NAMES,
  runLocalRoundDirectE2E,
  sanitizedBaseEnv,
  scanBuildFiles,
  validateLocalEnv,
} from './round-direct-e2e-local.mjs';

const SCRIPT = fileURLToPath(new URL('./round-direct-e2e-local.mjs', import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(SCRIPT), '..');
const SHA = 'c'.repeat(40);
const RUN_ID = 'local-cccccccc-20261002000000';
const SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'greenhub-round-direct-e2e',
  private_key: 'fake-private-key-for-test',
});
const WEB_API_KEY = 'web-api-key-value-for-test';

function validFileEnv(overrides = {}) {
  return {
    NEXT_PUBLIC_FIREBASE_API_KEY: WEB_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'greenhub-round-direct-e2e.firebaseapp.com',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'greenhub-round-direct-e2e',
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'greenhub-round-direct-e2e.firebasestorage.app',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
    FIREBASE_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT_JSON,
    ...overrides,
  };
}

function codes(result) {
  return result.failures.map(({ code }) => code);
}

function fixedSecrets() {
  let counter = 0;
  return () => {
    counter += 1;
    return String(counter).padStart(64, '0');
  };
}

function runContext() {
  const validation = validateLocalEnv(validFileEnv());
  assert.equal(validation.ok, true);
  return {
    sha: SHA,
    runId: RUN_ID,
    values: validation.values,
    serviceAccountJson: validation.serviceAccountJson,
    credentials: createRunCredentials(RUN_ID, { secret: fixedSecrets() }),
    paths: buildRunPaths({
      worktreeDir: path.join('tmp-root', 'repo'),
      outputDir: path.join('tmp-root', 'output'),
      runId: RUN_ID,
    }),
  };
}

describe('로컬 대상 모드 인자와 env 검증', () => {
  it('기본값은 origin/main과 apps/e2e/.env.local-target이고 알 수 없는 인자는 거부한다', () => {
    assert.deepEqual(parseArgs([]), {
      targetRef: 'origin/main',
      envFile: 'apps/e2e/.env.local-target',
      dryRun: false,
      help: false,
    });
    assert.deepEqual(parseArgs(['--sha=HEAD', '--target-env=x.env', '--dry-run']), {
      targetRef: 'HEAD',
      envFile: 'x.env',
      dryRun: true,
      help: false,
    });
    assert.throws(() => parseArgs(['--sha']), /알 수 없는 인자/);
    assert.throws(() => parseArgs(['--force']), /알 수 없는 인자/);
  });

  it('완전한 E2E 웹 설정과 E2E 서비스 계정만 통과한다', () => {
    const result = validateLocalEnv(validFileEnv());
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
    assert.equal(result.serviceAccountJson, SERVICE_ACCOUNT_JSON);
  });

  it('누락 env는 이름만 보고하고 값은 결과에 담지 않는다', () => {
    const result = validateLocalEnv({ NEXT_PUBLIC_FIREBASE_API_KEY: WEB_API_KEY });
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, [
      ...REQUIRED_ENV_NAMES.filter((name) => name !== 'NEXT_PUBLIC_FIREBASE_API_KEY'),
      'FIREBASE_SERVICE_ACCOUNT_FILE',
    ]);
    assert.equal(result.values, null);
    assert.equal(JSON.stringify(result).includes(WEB_API_KEY), false);
  });

  it('알 수 없는 이름·운영 식별자·다른 Firebase 대상은 거부한다', () => {
    assert.ok(
      codes(validateLocalEnv(validFileEnv({ NEXT_PUBLIC_API_URL: 'https://x.test' }))).includes(
        'UNKNOWN_ENV_NAME',
      ),
    );
    const production = validateLocalEnv(
      validFileEnv({
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'green-e4fe3',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'green-e4fe3.firebaseapp.com',
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'green-e4fe3.firebasestorage.app',
      }),
    );
    assert.ok(codes(production).includes('PRODUCTION_VALUE_DETECTED'));
    assert.ok(codes(production).includes('FIREBASE_WEB_PROJECT_MISMATCH'));
    assert.ok(codes(production).includes('FIREBASE_AUTH_DOMAIN_MISMATCH'));
    assert.ok(codes(production).includes('PRODUCTION_STORAGE_BUCKET'));
    assert.equal(JSON.stringify(production).includes(WEB_API_KEY), false);

    const otherBucket = validateLocalEnv(
      validFileEnv({ NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'other-e2e.appspot.com' }),
    );
    assert.ok(codes(otherBucket).includes('STORAGE_BUCKET_NOT_ALLOWED'));
    assert.equal(
      validateLocalEnv(
        validFileEnv({
          NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'greenhub-round-direct-e2e.appspot.com',
        }),
      ).ok,
      true,
    );
  });

  it('운영·다른 프로젝트 서비스 계정과 모호한 서비스 계정 지정은 거부한다', () => {
    const production = validateLocalEnv(
      validFileEnv({
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'green-e4fe3' }),
      }),
    );
    assert.ok(codes(production).includes('PRODUCTION_FIREBASE_SERVICE_ACCOUNT'));
    assert.ok(codes(production).includes('PRODUCTION_VALUE_DETECTED'));

    const other = validateLocalEnv(
      validFileEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'other' }) }),
    );
    assert.ok(codes(other).includes('FIREBASE_SERVICE_ACCOUNT_PROJECT_MISMATCH'));

    const ambiguous = validateLocalEnv(
      validFileEnv({ FIREBASE_SERVICE_ACCOUNT_FILE: 'service-account.json' }),
    );
    assert.ok(codes(ambiguous).includes('SERVICE_ACCOUNT_AMBIGUOUS'));
  });

  it('서비스 계정 파일은 env 파일 위치 기준으로 읽고, 읽지 못하면 거부한다', () => {
    const fileEnv = validFileEnv({ FIREBASE_SERVICE_ACCOUNT_FILE: 'sa.json' });
    delete fileEnv.FIREBASE_SERVICE_ACCOUNT_JSON;
    const reads = [];
    const ok = validateLocalEnv(fileEnv, {
      envFileDir: path.join('env-dir'),
      readFile: (file) => {
        reads.push(file);
        return SERVICE_ACCOUNT_JSON;
      },
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(reads, [path.resolve('env-dir', 'sa.json')]);

    const unreadable = validateLocalEnv(fileEnv, {
      readFile: () => {
        throw new Error('ENOENT');
      },
    });
    assert.ok(codes(unreadable).includes('SERVICE_ACCOUNT_FILE_UNREADABLE'));
  });

  it('실행 ID는 지정 시 형식을 검사하고, 없으면 SHA와 시각으로 만든다', () => {
    assert.ok(
      codes(validateLocalEnv(validFileEnv({ ROUND_DIRECT_E2E_RUN_ID: 'Bad_ID' }))).includes(
        'RUN_ID_INVALID',
      ),
    );
    assert.equal(
      createRunId(SHA, new Date('2026-10-02T01:02:03.456Z')),
      'local-cccccccc-20261002010203',
    );
  });
});

describe('로컬 대상 모드 실행 env', () => {
  it('실행마다 12개 계정과 서로 다른 로컬 secret을 만든다', () => {
    const credentials = createRunCredentials(RUN_ID);
    assert.equal(Object.keys(credentials.accounts).length, 12);
    assert.equal(
      credentials.accounts.TEST_DRIVER_EMAIL_MOBILE,
      `rd-${RUN_ID}-driver-mobile@example.com`,
    );
    assert.ok(credentials.accounts.TEST_SELLER_PASSWORD_CHROMIUM.length >= 12);
    const secrets = new Set([
      credentials.authSecret,
      credentials.e2eTestSecret,
      credentials.sharedSecret,
    ]);
    assert.equal(secrets.size, 3);
  });

  it('앱 env는 스테이징 API와 Preview 흉내만 담고 서비스 계정은 담지 않는다', () => {
    const { values, credentials } = runContext();
    for (const { name } of LOCAL_APPS) {
      const env = buildAppEnv(name, { values, credentials });
      assert.equal(env.NEXT_PUBLIC_API_URL, LOCAL_E2E_API_ORIGIN);
      assert.equal(env.VERCEL_ENV, 'preview');
      assert.equal(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'greenhub-round-direct-e2e');
      assert.equal(env.FIREBASE_SERVICE_ACCOUNT_JSON, undefined);
      assert.equal(env.NODE_ENV, undefined);
    }
    const driver = buildAppEnv('driver', { values, credentials });
    assert.equal(driver.ROUND_DIRECT_E2E_ENABLED, 'true');
    assert.equal(driver.ROUND_DIRECT_E2E_SHARED_SECRET, credentials.sharedSecret);
    assert.equal(
      driver.ROUND_DIRECT_E2E_DRIVER_EMAILS,
      `${credentials.accounts.TEST_DRIVER_EMAIL_CHROMIUM},${credentials.accounts.TEST_DRIVER_EMAIL_MOBILE}`,
    );
    assert.equal(driver.E2E_TEST_SECRET, undefined);
    assert.equal(
      buildAppEnv('consumer', { values, credentials }).E2E_TEST_SECRET,
      credentials.e2eTestSecret,
    );
    assert.equal(
      buildAppEnv('seller', { values, credentials }).E2E_TEST_SECRET,
      credentials.e2eTestSecret,
    );
  });

  it('상위 env에서는 OS 기본값만 넘기고 운영 설정 env는 버린다', () => {
    const sanitized = sanitizedBaseEnv({
      Path: 'C:\\bin',
      SystemRoot: 'C:\\Windows',
      NEXT_PUBLIC_API_URL: 'https://api-production-13e7.up.railway.app',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'green-e4fe3',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
      GOOGLE_APPLICATION_CREDENTIALS: 'prod.json',
      VERCEL_ENV: 'production',
      NODE_ENV: 'production',
      NODE_OPTIONS: '--require x',
    });
    assert.deepEqual(sanitized, { Path: 'C:\\bin', SystemRoot: 'C:\\Windows' });
  });

  it('실행 env는 target-url·readiness·fixture 가드를 모두 그대로 통과한다', () => {
    const context = runContext();
    const { runner, withServiceAccount } = buildRunnerEnv(context);

    assert.deepEqual(readRoundDirectTargetUrls(runner), {
      consumer: 'http://127.0.0.1:3101',
      seller: 'http://127.0.0.2:3102',
      driver: 'http://127.0.0.3:3103',
    });
    const jpeg = {
      exists: true,
      mime: 'image/jpeg',
      size: 128,
      hasStartMagic: true,
      hasEndMagic: true,
    };
    const readiness = evaluateReadiness(normalizeReadinessInput(withServiceAccount, { jpeg }));
    assert.deepEqual(readiness.failures, []);
    assert.equal(readiness.ready, true);
    assert.equal(readiness.targetMode, 'local');
    assert.deepEqual(
      validateFixtureEnvironment(withServiceAccount, { requireServiceAccount: true }),
      {
        runId: RUN_ID,
        projectId: 'greenhub-round-direct-e2e',
        storageBucket: 'greenhub-round-direct-e2e.firebasestorage.app',
        storagePrefix: `e2e/round-direct/${RUN_ID}/`,
      },
    );
    // 워크플로처럼 52건 단계에는 서비스 계정을 넘기지 않는다.
    assert.equal(runner.FIREBASE_SERVICE_ACCOUNT_JSON, undefined);
    assert.equal(withServiceAccount.FIREBASE_SERVICE_ACCOUNT_JSON, SERVICE_ACCOUNT_JSON);
  });

  it('Playwright 인자는 원격 워크플로의 52건·12건 실행 인자와 같다', () => {
    const workflow = fs.readFileSync(
      path.join(REPO_ROOT, '.github/workflows/e2e-round-direct.yml'),
      'utf8',
    );
    const blocks = [...workflow.matchAll(/run: >-\n((?:\s{10}\S.*\n)+)/g)].map((match) =>
      match[1].trim().split(/\s+/),
    );
    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks[0], ['pnpm', ...PLAYWRIGHT_ROUND_ARGS]);
    assert.deepEqual(blocks[1], ['pnpm', ...PLAYWRIGHT_SESSION_ARGS]);
    assert.match(workflow, new RegExp(`\\.stats\\.expected == ${EXPECTED_ROUND_TESTS} and`));
    assert.match(workflow, new RegExp(`\\.stats\\.expected == ${EXPECTED_SESSION_TESTS} and`));
  });

  it('무건너뜀 판정은 expected·skipped·unexpected·flaky를 모두 본다', () => {
    const stats = { expected: 52, skipped: 0, unexpected: 0, flaky: 0 };
    assert.equal(evaluatePlaywrightStats({ stats }, 52).ok, true);
    for (const patch of [{ expected: 51 }, { skipped: 1 }, { unexpected: 1 }, { flaky: 1 }]) {
      assert.equal(evaluatePlaywrightStats({ stats: { ...stats, ...patch } }, 52).ok, false);
    }
    assert.equal(evaluatePlaywrightStats(null, 52).ok, false);
  });
});

describe('대상 SHA checkout 계약', () => {
  it('현재 저장소는 로컬 대상 모드와 앱 start 스크립트 계약을 만족한다', () => {
    assert.deepEqual(checkCheckoutContract(REPO_ROOT), []);
  });

  it('로컬 대상 모드 이전 SHA나 다른 start 스크립트는 빌드 전에 이유와 함께 멈춘다', () => {
    const files = {
      'apps/consumer/package.json': JSON.stringify({
        scripts: { build: 'x', start: 'next start' },
      }),
      'apps/seller/package.json': JSON.stringify({ scripts: { build: 'x', start: 'node server' } }),
      'apps/e2e/tests/_helpers/target-url.ts': 'export function readRoundDirectTargetUrls() {}',
      'scripts/check-round-direct-e2e-readiness.mjs': 'export const PRODUCTION_STORE_ID = 1;',
    };
    const problems = checkCheckoutContract('old-root', {
      readFile: (file) => {
        const key = path.relative('old-root', file).split(path.sep).join('/');
        if (!(key in files)) throw new Error('ENOENT');
        return files[key];
      },
    });
    assert.deepEqual(problems, [
      'seller start가 next start가 아니거나 build가 없음',
      'apps/driver/package.json 없음',
      '대상 SHA가 로컬 대상 모드를 지원하지 않음(target-url·readiness의 local 표식 없음)',
    ]);
  });
});

describe('빌드 산출물 운영 식별자 검사', () => {
  const api = `"${LOCAL_E2E_API_ORIGIN}"`;

  it('seller·driver 차단 가드의 Set 리터럴은 허용하고 스테이징 API 인라인을 요구한다', () => {
    const guard =
      'const a=new Set(["green-e4fe3"]),b=new Set(["green-e4fe3.appspot.com","green-e4fe3.firebasestorage.app"]),c=new Set([\n  \'green-e4fe3.firebaseapp.com\'\n]);';
    assert.equal(scanBuildFiles([{ file: 'chunk.js', content: `${guard}fetch(${api})` }]).ok, true);
    assert.equal(scanBuildFiles([{ file: 'chunk.js', content: guard }]).ok, false);
  });

  it('인라인된 운영 Firebase 설정과 운영 API는 거부한다', () => {
    for (const leak of [
      'const firebaseConfig={projectId:"green-e4fe3"}',
      'x={authDomain:"green-e4fe3.firebaseapp.com"}',
      'fetch("https://api-production-13e7.up.railway.app/auth/login")',
      'new Set(["green-e4fe3-other"])',
      'new Set([foo,"green-e4fe3"])',
    ]) {
      const result = scanBuildFiles([{ file: 'server/app.js', content: `${leak};${api}` }]);
      assert.equal(result.ok, false, leak);
      assert.equal(result.findings.length, 1, leak);
    }
  });
});

function createFakeOps({ failStep, cleanupReady = true, throwIn, scanOk = true } = {}) {
  const files = new Map();
  const calls = [];
  const servers = [];
  const ops = {
    calls,
    files,
    baseEnv: { PATH: 'fake' },
    exists: (file) => files.has(file),
    readJson: (file) => {
      if (!files.has(file)) throw new Error(`없는 파일: ${file}`);
      return files.get(file);
    },
    writeJson: (file, value) => files.set(file, value),
    findEnvFiles: () => [],
    checkCheckoutContract: () => [],
    async createWorktree() {
      calls.push('createWorktree');
      if (throwIn === 'createWorktree') throw new Error('worktree 실패');
    },
    async readHeadSha() {
      return SHA;
    },
    scanAppBuild: () => ({ ok: scanOk, findings: [], requiredFound: scanOk }),
    async assertPortFree() {},
    async startServer({ app }) {
      calls.push(`start:${app.name}`);
      if (throwIn === `start:${app.name}`) throw new Error('시작 실패');
      const server = { app };
      servers.push(server);
      return server;
    },
    async waitForLogin() {},
    async stopServer(server) {
      calls.push(`stop:${server.app.name}`);
    },
    preserveEvidence: () => calls.push('preserveEvidence'),
    async removeWorktree() {
      calls.push('removeWorktree');
    },
    async run({ name, args, env, stdoutFile }) {
      calls.push(name);
      const action = args[1];
      const manifestArg = args.find((arg) => arg.startsWith('--manifest='));
      if (manifestArg && action === 'seed') files.set(manifestArg.slice(11), {});
      if (action === 'cleanup') {
        files.set(stdoutFile, {
          ready: cleanupReady,
          remainingDocuments: cleanupReady ? [] : ['users/x'],
          remainingObjects: [],
        });
      }
      if (name.includes('52건 실행')) {
        assert.equal(env.FIREBASE_SERVICE_ACCOUNT_JSON, undefined);
        files.set(env.PLAYWRIGHT_JSON_OUTPUT_FILE, {
          stats: { expected: 52, skipped: 0, unexpected: failStep === name ? 1 : 0, flaky: 0 },
        });
      }
      if (name.includes('12건 실행')) {
        assert.equal(typeof env.FIREBASE_SERVICE_ACCOUNT_JSON, 'string');
        files.set(env.PLAYWRIGHT_JSON_OUTPUT_FILE, {
          stats: { expected: 12, skipped: 0, unexpected: 0, flaky: 0 },
        });
      }
      return failStep === name ? 1 : 0;
    },
  };
  return ops;
}

const cleanupNames = ['chromium fixture cleanup', 'mobile fixture cleanup'];

describe('로컬 대상 모드 cleanup 수명주기', () => {
  it('성공 경로는 52건 뒤 12건을 실행하고 fixture·서버·worktree를 모두 정리한다', async () => {
    const ops = createFakeOps();
    const result = await runLocalRoundDirectE2E(runContext(), ops);
    assert.deepEqual(result, { ok: true, failures: [], cleanupFailures: [] });
    const roundIndex = ops.calls.indexOf('소비자·셀러·드라이버 52건 실행');
    const sessionIndex = ops.calls.indexOf('세션 수명주기 12건 실행');
    assert.ok(roundIndex > ops.calls.indexOf('mobile fixture verify'));
    assert.ok(sessionIndex > roundIndex);
    assert.deepEqual(ops.calls.slice(sessionIndex + 1), [
      ...cleanupNames,
      'stop:driver',
      'stop:seller',
      'stop:consumer',
      'preserveEvidence',
      'removeWorktree',
    ]);
  });

  it('52건 판정 실패 시 세션 단계는 건너뛰고 cleanup은 모두 수행한다', async () => {
    const ops = createFakeOps({ failStep: '소비자·셀러·드라이버 52건 실행' });
    const result = await runLocalRoundDirectE2E(runContext(), ops);
    assert.equal(result.ok, false);
    assert.match(result.failures[0], /52건 실행 실패/);
    assert.equal(ops.calls.includes('세션 수명주기 12건 실행'), false);
    for (const name of [...cleanupNames, 'stop:consumer', 'removeWorktree']) {
      assert.ok(ops.calls.includes(name), name);
    }
  });

  it('seed 전 빌드 실패는 fixture cleanup 없이 worktree만 정리한다', async () => {
    const ops = createFakeOps({ failStep: 'seller 빌드' });
    const result = await runLocalRoundDirectE2E(runContext(), ops);
    assert.equal(result.ok, false);
    assert.match(result.failures[0], /seller 빌드 실패/);
    assert.equal(
      ops.calls.some((call) => call.startsWith('start:') || cleanupNames.includes(call)),
      false,
    );
    assert.equal(ops.calls.at(-1), 'removeWorktree');
  });

  it('빌드 산출물 검사 실패는 서버를 띄우지 않고 중단한다', async () => {
    const ops = createFakeOps({ scanOk: false });
    const result = await runLocalRoundDirectE2E(runContext(), ops);
    assert.match(result.failures[0], /consumer 빌드 산출물 검사 실패/);
    assert.equal(
      ops.calls.some((call) => call.startsWith('start:')),
      false,
    );
  });

  it('예외 경로에서도 이미 띄운 서버와 worktree를 정리한다', async () => {
    const ops = createFakeOps({ throwIn: 'start:driver' });
    const result = await runLocalRoundDirectE2E(runContext(), ops);
    assert.equal(result.ok, false);
    assert.match(result.failures[0], /예외: 시작 실패/);
    assert.ok(ops.calls.includes('stop:consumer'));
    assert.ok(ops.calls.includes('stop:seller'));
    assert.equal(ops.calls.includes('stop:driver'), false);
    assert.equal(ops.calls.at(-1), 'removeWorktree');

    const worktreeOps = createFakeOps({ throwIn: 'createWorktree' });
    const worktreeResult = await runLocalRoundDirectE2E(runContext(), worktreeOps);
    assert.equal(worktreeResult.ok, false);
    assert.deepEqual(worktreeOps.calls, ['createWorktree', 'preserveEvidence', 'removeWorktree']);
  });

  it('테스트가 통과해도 cleanup 실패는 숨기지 않고 실패로 보고한다', async () => {
    const ops = createFakeOps({ cleanupReady: false });
    ops.removeWorktree = async () => {
      ops.calls.push('removeWorktree');
      throw new Error('파일 잠김');
    };
    const result = await runLocalRoundDirectE2E(runContext(), ops);
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, []);
    assert.equal(result.cleanupFailures.length, 3);
    assert.match(result.cleanupFailures[0], /chromium fixture cleanup 실패.*남은 문서 1/);
    assert.match(result.cleanupFailures[2], /임시 worktree 제거 실패.*파일 잠김/);
  });

  it('중단 요청이 오면 다음 단계를 시작하지 않고 cleanup으로 넘어간다', async () => {
    const ops = createFakeOps();
    let stop = false;
    ops.interrupted = () => stop;
    const originalRun = ops.run;
    ops.run = async (options) => {
      const code = await originalRun(options);
      if (options.name === 'chromium fixture seed') stop = true;
      return code;
    };
    const result = await runLocalRoundDirectE2E(runContext(), ops);
    assert.match(result.failures[0], /중단 요청/);
    assert.equal(ops.calls.includes('chromium fixture verify'), false);
    assert.ok(ops.calls.includes('chromium fixture cleanup'));
    assert.equal(ops.calls.includes('mobile fixture cleanup'), false);
  });
});

describe('--dry-run CLI', () => {
  function withTempDir(callback) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'greenhub-rd-local-spec-'));
    try {
      return callback(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      assert.equal(fs.existsSync(dir), false, `spec 임시 디렉터리가 남았습니다: ${dir}`);
    }
  }

  function runCli(args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? process.env.Path ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
      },
    });
  }

  it('env 검증과 계획만 출력하고 secret 값은 출력하지 않는다', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'sa.json'), SERVICE_ACCOUNT_JSON);
      const envFile = path.join(dir, 'local-target.env');
      const fileEnv = validFileEnv({ FIREBASE_SERVICE_ACCOUNT_FILE: 'sa.json' });
      delete fileEnv.FIREBASE_SERVICE_ACCOUNT_JSON;
      fs.writeFileSync(
        envFile,
        Object.entries(fileEnv)
          .map(([name, value]) => `${name}=${value}`)
          .join('\n'),
      );
      const result = runCli(['--dry-run', '--sha=HEAD', `--target-env=${envFile}`]);
      assert.equal(result.status, 0, result.stderr);
      const plan = JSON.parse(result.stdout);
      assert.equal(plan.dryRun, true);
      assert.match(plan.targetSha, /^[0-9a-f]{40}$/);
      assert.deepEqual(plan.targets, {
        consumer: 'http://127.0.0.1:3101',
        seller: 'http://127.0.0.2:3102',
        driver: 'http://127.0.0.3:3103',
      });
      assert.equal(result.stdout.includes(WEB_API_KEY), false);
      assert.equal(result.stdout.includes('fake-private-key-for-test'), false);
    });
  });

  it('env가 부족하면 이름만 출력하고 종료 코드 2로 멈춘다', () => {
    withTempDir((dir) => {
      const envFile = path.join(dir, 'local-target.env');
      fs.writeFileSync(envFile, `NEXT_PUBLIC_FIREBASE_API_KEY=${WEB_API_KEY}\n`);
      const result = runCli(['--dry-run', `--target-env=${envFile}`]);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /NEXT_PUBLIC_FIREBASE_APP_ID/);
      assert.match(result.stderr, /FIREBASE_SERVICE_ACCOUNT_FILE/);
      assert.equal(`${result.stdout}${result.stderr}`.includes(WEB_API_KEY), false);

      const missingFile = runCli(['--dry-run', `--target-env=${path.join(dir, 'none.env')}`]);
      assert.equal(missingFile.status, 2);
      assert.match(missingFile.stderr, /ENV_FILE_MISSING/);
    });
  });
});
