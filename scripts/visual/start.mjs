// 화면 확인용 dev 실행기 — 가짜 API + next dev(외부 차단)를 한 번에 띄운다.
// 배포·Vercel·카카오 로그인 없이 작업 직후 화면을 PC 브라우저나 휴대폰(Tailscale)으로 본다.
//
//   node scripts/visual/start.mjs [app] [--phone] [--now <ISO>] [--prod]
//     app      seller(셀러·어드민, 기본), consumer(소비자), driver(기사)
//     --phone  Tailscale 주소에 바인딩해 휴대폰에서 접속한다(같은 tailnet 기기만 접근 가능)
//     --now    fixture 일정과 캡처 시계의 기준 시각(기본: 오늘 한국 시간 0시, clock.mjs)
//     --prod   next dev 대신 운영 빌드(next build && next start)로 띄운다. 운영 빌드는 로컬 로그인이 꺼지므로
//              shots.mjs가 이 실행기의 AUTH_SECRET으로 Auth.js 세션 쿠키를 직접 만들어 로그인한다.
//              가짜 API는 https://127.0.0.2(1회용 자체 서명 인증서)로 연다. README "운영 빌드로 찍기".
//     --allow-concurrent  다른 앱 하네스가 떠 있어도 판매자를 띄운다(기본은 거부, 아래 "동시 실행").
//
// 안전장치: 앱의 .env 파일 값(운영 API·Firebase·비밀값)을 전부 빈 값으로 덮고,
// next dev 프로세스의 외부 연결을 node-guard.cjs로 막는다. 운영 데이터에 닿지 않는다.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS, DEV_RESTARTS_FILE, RUNTIME_FILE } from './apps.mjs';
import { resolveVisualNow, VISUAL_NOW_ENV } from './clock.mjs';
import {
  assertEmulatorPortsFree,
  EMULATOR,
  emulatorCustomToken,
  portInUse,
  seedFirestore,
  startEmulators,
  waitForEmulators,
} from './firebase-emulator.mjs';
import { startMockApi } from './mock-api.mjs';
import { selfSignedCertificate } from './tls-cert.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local'];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function tailscaleAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      // Tailscale 주소 대역 100.64.0.0/10
      if (a.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address))
        return a.address;
    }
  }
  return null;
}

/** 앱 env 파일에 적힌 키 이름만 읽는다(값은 읽지 않는다). */
function envFileKeys(appDir) {
  const keys = new Set();
  for (const name of ENV_FILES) {
    const file = path.join(appDir, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.replace(/^﻿/, '').match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m) keys.add(m[1]);
    }
  }
  return keys;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

const args = process.argv.slice(2);
const nowIndex = args.indexOf('--now');
// --now 값은 앱 이름이 아니다. --now가 없을 때(nowIndex = -1) 첫 인자를 빼지 않도록 nowIndex를 먼저 본다.
const appName =
  args.find((a, i) => !a.startsWith('--') && (nowIndex === -1 || i !== nowIndex + 1)) ?? 'seller';
const phone = args.includes('--phone');
const prod = args.includes('--prod');
if (prod && phone) fail('--prod와 --phone은 함께 쓸 수 없습니다.');
// 운영 빌드는 API 주소로 HTTPS이면서 'localhost'·'127.0.0.1'이 아닌 주소만 받는다
// (packages/shared/src/api-base-url.ts). 루프백 대역의 다른 주소를 쓴다.
const PROD_API_HOST = '127.0.0.2';
let visualNowIso;
try {
  visualNowIso = resolveVisualNow(nowIndex > -1 ? args[nowIndex + 1] : undefined);
} catch (error) {
  fail(error.message);
}
// fixture가 import될 때 이 시각으로 회차 일정을 만든다.
process.env[VISUAL_NOW_ENV] = visualNowIso;
const app = APPS[appName];
if (!app) fail(`지원하지 않는 앱: ${appName} (가능: ${Object.keys(APPS).join(', ')})`);

const host = phone ? tailscaleAddress() : '127.0.0.1';
if (!host) fail('Tailscale 주소(100.x)를 찾지 못했습니다. Tailscale이 켜져 있는지 확인하세요.');

// 동시 실행: 판매자(에뮬레이터 포함)를 다른 앱 하네스와 한 컴퓨터에서 같이 띄우면 next dev가 메모리 상한의 80%에
// 더 빨리 닿아 촬영 도중 스스로 재시작한다(2026-10-30, 세 앱 동시 촬영에서 판매자만 두 번 재시작). 판매자는 혼자 띄운다.
const otherHarnesses = [];
for (const [name, other] of Object.entries(APPS)) {
  if (name !== appName && (await portInUse(other.port, '127.0.0.1'))) {
    otherHarnesses.push(`${name}(${other.port})`);
  }
}
if (otherHarnesses.length) {
  const message = `다른 앱 하네스가 떠 있습니다: ${otherHarnesses.join(', ')}.`;
  if (appName === 'seller' && !args.includes('--allow-concurrent')) {
    fail(
      `${message} 판매자는 혼자 띄웁니다(촬영 도중 next dev 메모리 재시작이 잦아짐). 끄고 다시 실행하거나 --allow-concurrent를 주세요.`,
    );
  }
  if (otherHarnesses.some((h) => h.startsWith('seller'))) {
    console.warn(`⚠️ ${message} 판매자 촬영 중이면 판매자 next dev 메모리 재시작이 잦아집니다.`);
  }
}

const appDir = path.join(ROOT, app.dir);
const appUrl = `http://${host}:${app.port}`;
const apiUrl = prod ? `https://${PROD_API_HOST}:${app.apiPort}` : `http://${host}:${app.apiPort}`;

const runDir = path.join(os.tmpdir(), 'greenhub-visual', appName);
fs.mkdirSync(runDir, { recursive: true });
const logs = {
  api: path.join(runDir, 'mock-api.log'),
  guard: path.join(runDir, 'node-guard.log'),
  next: path.join(runDir, prod ? 'next-start.log' : 'next-dev.log'),
  build: path.join(runDir, 'next-build.log'),
  emulator: path.join(runDir, 'firebase-emulator.log'),
};
for (const f of Object.values(logs)) fs.writeFileSync(f, '');

const { user, routes, scenarioRoutes, firestoreSeed, firebaseClaims } = await import(
  `./fixtures/${appName}.mjs`
);

// fixture에 firestoreSeed가 있으면(셀러 상품·준비처럼 Firestore를 직접 구독하는 화면) Auth·Firestore 에뮬레이터를
// 띄우고 데이터를 넣는다. 앱 계약상 에뮬레이터 주소가 127.0.0.1로 고정이라 --phone에서는 쓰지 않는다.
// 운영 빌드도 쓰지 않는다: 셀러 앱은 NODE_ENV=production에서 로컬 Firebase 런타임을 거절한다
// (apps/seller/src/lib/firebase.ts assertFirebaseRuntimeConfiguration). 그래서 --prod 셀러 상품·준비는 빈 화면이다.
const useEmulator = Boolean(firestoreSeed) && !phone && !prod;
let emulator = null;
if (useEmulator) {
  try {
    await assertEmulatorPortsFree();
    console.log('⏳ Firebase 에뮬레이터(Auth·Firestore) 기동 중…');
    emulator = startEmulators({ root: ROOT, logFile: logs.emulator });
    await waitForEmulators({ child: emulator.child });
    const count = await seedFirestore(firestoreSeed);
    console.log(`✅ 에뮬레이터 준비됨 · 시드 문서 ${count}개`);
  } catch (error) {
    emulator?.stop();
    fail(`에뮬레이터 실패: ${error.message} (로그: ${logs.emulator})`);
  }
}

// 가짜 API의 1회용 인증서. next 서버는 NODE_EXTRA_CA_CERTS로 이 인증서만 더 믿는다.
// 브라우저(shots.mjs)는 SPKI 지문(runtime.json apiCertSpki)으로 이 인증서만 믿는다.
const apiCaFile = path.join(runDir, 'api-ca.pem');
let apiCertSpki = null;
function apiCertificate() {
  const pair = selfSignedCertificate(PROD_API_HOST);
  fs.writeFileSync(apiCaFile, pair.cert);
  apiCertSpki = pair.spki;
  return { cert: pair.cert, key: pair.key };
}

const mock = startMockApi({
  port: app.apiPort,
  hosts: [...new Set(['127.0.0.1', host])],
  allowedOrigins: [appUrl, `http://localhost:${app.port}`],
  fixtures: { user, routes, scenarioRoutes },
  logFile: logs.api,
  tls: prod ? { host: PROD_API_HOST, ...apiCertificate() } : null,
  firebaseToken: useEmulator
    ? () =>
        emulatorCustomToken(user.id, firebaseClaims ?? { role: user.role, storeId: user.storeId })
    : null,
});

// 운영 빌드에서는 shots.mjs가 이 값으로 세션 쿠키를 만든다(runtime.json, 하네스 전용 1회용 값).
const authSecret = randomBytes(32).toString('hex');

// ── next dev 환경: env 파일 값은 전부 빈 값으로 덮고, 하네스 값만 넣는다 ──
// Next는 이미 있는 process.env 값을 .env 파일로 덮어쓰지 않는다.
const env = { ...process.env };
for (const key of envFileKeys(appDir)) env[key] = '';
for (const key of Object.keys(env)) {
  if (/^(VERCEL_|RAILWAY_|KAKAO_|FIREBASE_|GOOGLE_APPLICATION)/.test(key)) env[key] = '';
}
Object.assign(env, {
  NEXT_PUBLIC_API_URL: apiUrl,
  // Firebase Auth는 빈 API 키로 초기화하면 화면 전체가 멈춘다. 운영과 무관한 가짜 값을 넣는다.
  // firebase-token을 가짜 API가 503으로 돌려주므로 실제 Firebase 로그인은 시작되지 않는다.
  NEXT_PUBLIC_FIREBASE_API_KEY: 'visual-harness-fake-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'greenhub-visual.invalid',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'greenhub-visual',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'greenhub-visual.invalid',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '0',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:0:web:0',
  AUTH_SECRET: authSecret,
  AUTH_TRUST_HOST: 'true',
  NEXT_TELEMETRY_DISABLED: '1',
  NODE_OPTIONS: `--require "${path.join(HERE, 'node-guard.cjs').replaceAll('\\', '/')}"`,
  VISUAL_GUARD_ALLOW: prod ? `${host},${PROD_API_HOST}` : host,
  VISUAL_GUARD_LOG: logs.guard,
});
if (prod) env.NODE_EXTRA_CA_CERTS = apiCaFile;
// 소비자 결제 버튼은 PortOne 공개 설정(상점 ID·채널 키)이 없으면 주문 요청 전에 멈춘다(lib/portone-config.ts).
// 운영과 무관한 가짜 값을 넣는다. 결제창은 shots.mjs가 화면마다 stub으로 바꾸고(screen.portone),
// 외부 요청은 브라우저·서버 모두 막혀 있다. 카카오페이 채널만 넣어 결제 수단 목록은 기본(카카오페이)과 같다.
if (appName === 'consumer') {
  Object.assign(env, {
    NEXT_PUBLIC_PORTONE_STORE_ID: 'store-visual-harness',
    NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY: 'channel-key-visual-harness-kakaopay',
  });
}

// 에뮬레이터를 쓰면 앱을 로컬 Firebase 계약(project·bucket·에뮬레이터 주소 고정)으로 띄운다.
if (useEmulator) {
  Object.assign(env, {
    NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME: 'true',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: EMULATOR.projectId,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: EMULATOR.storageBucket,
    NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: `${EMULATOR.firestore.host}:${EMULATOR.firestore.port}`,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: `${EMULATOR.auth.host}:${EMULATOR.auth.port}`,
  });
}

// 로그인 화면의 이메일·비밀번호 입력을 켠다. 방식은 앱마다 다르다(apps.mjs credentials).
// 운영 빌드에서는 어느 방식도 켜지지 않으므로(로컬 로그인은 NODE_ENV=production에서 꺼진다) 둘 다 끈다.
const e2eSecret = randomBytes(24).toString('hex');
if (prod) {
  Object.assign(env, { GREENHUB_LOCAL_RUNTIME: '', E2E_TEST: '' });
} else if (app.credentials === 'local-runtime') {
  Object.assign(env, { GREENHUB_LOCAL_RUNTIME: 'true', E2E_TEST: '' });
} else {
  // 하네스 전용 1회용 비밀값이다. shots.mjs가 runtime.json에서 읽어 x-e2e-test-token 헤더로 보낸다.
  Object.assign(env, { GREENHUB_LOCAL_RUNTIME: '', E2E_TEST: 'true', E2E_TEST_SECRET: e2eSecret });
}
fs.writeFileSync(
  path.join(runDir, RUNTIME_FILE),
  JSON.stringify({
    app: appName,
    appUrl,
    apiUrl,
    e2eSecret: !prod && app.credentials === 'e2e-header' ? e2eSecret : null,
    emulator: useEmulator,
    prod,
    authSecret: prod ? authSecret : null,
    apiCertSpki,
    visualNow: visualNowIso,
  }),
);

const nextBin = createRequire(path.join(appDir, 'package.json')).resolve('next/dist/bin/next');
if (prod) {
  // 앱 package.json의 build와 같은 명령이다. 산출물(.next)·next가 고치는 next-env.d.ts는 커밋하지 않는다.
  console.log(`⏳ ${appName} 운영 빌드 중… (로그: ${logs.build})`);
  const build = spawnSync(process.execPath, [nextBin, 'build', '--webpack'], {
    cwd: appDir,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.writeFileSync(logs.build, `${build.stdout ?? ''}${build.stderr ?? ''}`);
  if (build.status !== 0) {
    mock.close();
    fail(`운영 빌드 실패(code=${build.status}). 로그: ${logs.build}`);
  }
}
const child = spawn(
  process.execPath,
  prod
    ? [nextBin, 'start', '-p', String(app.port), '-H', host]
    : [nextBin, 'dev', '--webpack', '-p', String(app.port), '-H', host],
  {
    cwd: appDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const nextLog = fs.createWriteStream(logs.next, { flags: 'a' });
let announced = false;
// next dev는 힙 사용량이 상한의 80%를 넘으면 스스로 재시작한다. 재시작 중·직후에 찍힌 화면은 연결 오류나
// 덜 그려진 상태(로딩)일 수 있으므로 횟수를 파일로 남겨 shots.mjs가 그 사이 찍은 화면을 정상 판정에서 뺀다.
const devRestartsFile = path.join(runDir, DEV_RESTARTS_FILE);
let devRestarts = 0;
fs.writeFileSync(devRestartsFile, '0');
const onOutput = (chunk) => {
  nextLog.write(chunk);
  const restarts = String(chunk).match(/approaching the used memory threshold/g)?.length ?? 0;
  if (restarts) {
    devRestarts += restarts;
    fs.writeFileSync(devRestartsFile, String(devRestarts));
  }
  if (!announced && /Ready in/.test(String(chunk))) {
    announced = true;
    console.log(
      [
        '',
        `✅ 화면 확인 서버 준비됨 (${appName}${prod ? ', 운영 빌드' : ''})`,
        `   주소: ${appUrl}/login`,
        `   기준 시각: ${visualNowIso} (캡처 시계·fixture 일정)`,
        prod
          ? '   로그인: 운영 빌드라 로그인 화면으로는 들어갈 수 없어요(shots.mjs가 세션 쿠키로 로그인)'
          : app.credentials === 'local-runtime'
            ? '   로그인: 아무 이메일·비밀번호나 입력 → fixture의 가짜 계정으로 들어갑니다'
            : '   로그인: 브라우저에서는 공개 화면만 볼 수 있어요(로그인 화면은 자동 캡처 shots.mjs에서만 통과)',
        useEmulator
          ? `   Firestore: 에뮬레이터 ${EMULATOR.firestore.host}:${EMULATOR.firestore.port} (로그: ${logs.emulator})`
          : null,
        `   요청 기록: ${logs.api}`,
        `   next 로그: ${logs.next}`,
        '   종료: Ctrl+C',
        '',
      ]
        .filter((line) => line !== null)
        .join('\n'),
    );
  }
};
child.stdout.on('data', onOutput);
child.stderr.on('data', onOutput);

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  killTree(child);
  emulator?.stop();
  mock.close();
  nextLog.end();
  process.exit(code);
}
child.on('exit', (code) => {
  if (!stopping) {
    console.error(`❌ next ${prod ? 'start' : 'dev'} 종료(code=${code}). 로그: ${logs.next}`);
    stop(code ?? 1);
  }
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
console.log(`⏳ ${appName} next ${prod ? 'start' : 'dev'} 기동 중… (${appUrl})`);
