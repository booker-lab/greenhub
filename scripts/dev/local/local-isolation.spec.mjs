import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_RUNTIME_CONTRACT,
  READINESS_HTTP_TARGETS,
  buildChildSpecs,
  buildRuntimeEnvironment,
} from './launcher.mjs';
import { assertLocalSeedEnvironment } from './seed-seller-orders.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '../../..');
const TEST_JAVA = Object.freeze({
  executable: 'java',
  javaHome: 'test-java-home',
  majorVersion: 21,
  source: 'test',
});

function readRepo(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

test('local contract: Seller Slice 고정 포트/프로젝트를 만족한다', () => {
  assert.equal(LOCAL_RUNTIME_CONTRACT.ports.api, 3000);
  assert.equal(LOCAL_RUNTIME_CONTRACT.ports.sellerAdmin, 3002);
  assert.equal(LOCAL_RUNTIME_CONTRACT.projectId, 'greenhub-local');
  assert.equal(LOCAL_RUNTIME_CONTRACT.ports.auth, 9099);
  assert.equal(LOCAL_RUNTIME_CONTRACT.ports.firestore, 8080);
  assert.equal(LOCAL_RUNTIME_CONTRACT.ports.storage, 9199);
  const urls = Object.fromEntries(READINESS_HTTP_TARGETS.map((t) => [t.name, t.url]));
  assert.equal(urls['api-health'], 'http://localhost:3000/health');
  assert.equal(urls['seller-login'], 'http://localhost:3002/login');
});

test('launcher child spec: Seller/Admin는 localhost:3002 + localhost API만 사용한다', () => {
  const specs = buildChildSpecs({
    baseEnvironment: { PATH: 'test' },
    javaRuntime: TEST_JAVA,
  });
  const byName = Object.fromEntries(specs.map((s) => [s.name, s]));
  assert.ok(byName['api']);
  assert.ok(byName['seller-admin']);
  assert.ok(byName['firebase-emulator-suite']);
  assert.deepEqual(byName['seller-admin'].args, ['--filter', 'seller', 'dev', '--port', '3002']);
  assert.equal(byName['seller-admin'].env.NEXT_PUBLIC_API_URL, 'http://localhost:3000');
  assert.equal(byName['seller-admin'].env.NEXTAUTH_URL, 'http://localhost:3002');
  assert.equal(byName['seller-admin'].env.GREENHUB_LOCAL_RUNTIME, 'true');
  assert.equal(byName['seller-admin'].env.NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME, 'true');
  assert.equal(byName['seller-admin'].env.GREENHUB_SCHEDULES_ENABLED, 'false');
  assert.equal(byName['api'].env.PORT, '3000');
  assert.ok(byName['firebase-emulator-suite'].args.includes('greenhub-local'));
});

test('launcher env: production secret/identity를 제거하고 외부 provider 실행값을 거부한다', () => {
  const env = buildRuntimeEnvironment(
    {
      PATH: 'test',
      NODE_ENV: 'development',
      JWT_SECRET: 'real-secret-value',
      PORTONE_V2_SECRET: 'real-portone',
      ALIGO_API_KEY: 'real-aligo',
      KAKAO_CLIENT_SECRET: 'real-kakao',
      E2E_TEST_SECRET: 'real-e2e',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"green-e4fe3"}',
      NEXT_PUBLIC_API_URL: 'http://localhost:3000',
    },
    {},
  );
  assert.equal(env.GREENHUB_LOCAL_RUNTIME, 'true');
  assert.equal(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'greenhub-local');
  assert.equal(env.FIREBASE_PROJECT_ID, 'greenhub-local');
  assert.equal(env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  assert.equal(env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
  for (const key of [
    'PORTONE_V2_SECRET',
    'ALIGO_API_KEY',
    'KAKAO_CLIENT_SECRET',
    'E2E_TEST_SECRET',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
  ]) {
    assert.ok(!(key in env) || env[key] === '', `${key}는 local child에 전달되지 않아야 한다`);
  }
  // JWT_SECRET은 parent 실값이 local 고정 dev 값으로 교체된다 (실값 유출 없음).
  assert.notEqual(env.JWT_SECRET, 'real-secret-value');
  assert.equal(env.JWT_SECRET, 'greenhub-local-jwt-secret');
  assert.ok(!('RAILWAY_ENVIRONMENT_NAME' in env));
  // child spec은 parent URL과 무관하게 localhost API로 고정한다 (위 child spec 테스트).
  assert.equal(env.NEXT_PUBLIC_API_URL, 'http://localhost:3000');
});

test('launcher env: production parent에서는 실행을 거부한다', () => {
  assert.throws(() => buildRuntimeEnvironment({ NODE_ENV: 'production' }), /production|local runtime/i);
});

test('seed env: local harness가 production Firebase/remote API를 거부한다', () => {
  const localEnv = {
    GREENHUB_LOCAL_RUNTIME: 'true',
    NODE_ENV: 'development',
    GREENHUB_SCHEDULES_ENABLED: 'false',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIREBASE_PROJECT_ID: 'greenhub-local',
    FIREBASE_STORAGE_BUCKET: 'greenhub-local.appspot.com',
    NEXT_PUBLIC_API_URL: 'http://localhost:3000',
  };
  assert.doesNotThrow(() => assertLocalSeedEnvironment({ ...localEnv }));
  assert.throws(
    () => assertLocalSeedEnvironment({ ...localEnv, FIREBASE_PROJECT_ID: 'green-e4fe3' }),
    /greenhub-local/,
  );
  assert.throws(
    () =>
      assertLocalSeedEnvironment({
        ...localEnv,
        NEXT_PUBLIC_API_URL: 'https://api-production-13e7.up.railway.app',
      }),
    /localhost/,
  );
});

test('Seller local auth는 fail-closed다 (E2E secret 없이 거부 + 실 Kakao 의존 없음)', () => {
  const sellerAuth = readRepo('apps/seller/src/auth.ts');
  assert.match(sellerAuth, /E2E_TEST_SECRET/);
  assert.match(sellerAuth, /authorize-rejected/);
  assert.match(sellerAuth, /seller.*admin|admin.*seller/);
  // local-only Seller 진입은 development + explicit local mode + localhost authority를 요구한다.
  // 기존 Credentials 경로는 E2E header 게이트이며, secret 미설정 시 전체 거부(안전 기본값)다.
  assert.match(sellerAuth, /if \(!expected\) throw/);
  const loginPage = readRepo('apps/seller/src/app/login/page.tsx');
  assert.match(loginPage, /E2E_TEST/);
});

test('Seller /orders는 보호된 store 경유 + Bearer 호출이다 (UX 수정 없이 계약 확인)', () => {
  const hook = readRepo('apps/seller/src/hooks/useOrders.ts');
  assert.match(hook, /\/stores\/.*\/orders/);
  assert.match(hook, /accessToken/);
  assert.match(hook, /if \(!storeId \|\| !token\)/);
  const controller = readRepo('apps/api/src/orders/orders.controller.ts');
  assert.match(controller, /stores\/:storeId\/orders/);
  assert.match(controller, /Roles\('seller', 'admin'\)/);
  const apiBase = readRepo('apps/seller/src/lib/api-base-url.ts');
  assert.match(apiBase, /http:\/\/localhost:3000/);
  assert.match(apiBase, /Production API URL은 localhost를 사용할 수 없습니다/);
});
