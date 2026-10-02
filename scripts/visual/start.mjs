// 화면 확인용 dev 실행기 — 가짜 API + next dev(외부 차단)를 한 번에 띄운다.
// 배포·Vercel·카카오 로그인 없이 작업 직후 화면을 PC 브라우저나 휴대폰(Tailscale)으로 본다.
//
//   node scripts/visual/start.mjs [app] [--phone]
//     app      셀러(어드민 포함)만 지원: seller (기본)
//     --phone  Tailscale 주소에 바인딩해 휴대폰에서 접속한다(같은 tailnet 기기만 접근 가능)
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
import { API_PORT, APPS } from './apps.mjs';
import { startMockApi } from './mock-api.mjs';

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
const appName = args.find((a) => !a.startsWith('--')) ?? 'seller';
const phone = args.includes('--phone');
const app = APPS[appName];
if (!app) fail(`지원하지 않는 앱: ${appName} (가능: ${Object.keys(APPS).join(', ')})`);

const host = phone ? tailscaleAddress() : '127.0.0.1';
if (!host) fail('Tailscale 주소(100.x)를 찾지 못했습니다. Tailscale이 켜져 있는지 확인하세요.');

const appDir = path.join(ROOT, app.dir);
const appUrl = `http://${host}:${app.port}`;
const apiUrl = `http://${host}:${API_PORT}`;

const runDir = path.join(os.tmpdir(), 'greenhub-visual', appName);
fs.mkdirSync(runDir, { recursive: true });
const logs = {
  api: path.join(runDir, 'mock-api.log'),
  guard: path.join(runDir, 'node-guard.log'),
  next: path.join(runDir, 'next-dev.log'),
};
for (const f of Object.values(logs)) fs.writeFileSync(f, '');

const { user, routes } = await import(`./fixtures/${appName}.mjs`);
const mock = startMockApi({
  port: API_PORT,
  hosts: [...new Set(['127.0.0.1', host])],
  allowedOrigins: [appUrl, `http://localhost:${app.port}`],
  fixtures: { user, routes },
  logFile: logs.api,
});

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
  AUTH_SECRET: randomBytes(32).toString('hex'),
  AUTH_TRUST_HOST: 'true',
  // 로그인 화면의 이메일·비밀번호 입력을 켜고 E2E 헤더 게이트를 생략한다(auth.ts isLocalCredentialRuntime).
  GREENHUB_LOCAL_RUNTIME: 'true',
  E2E_TEST: '',
  NEXT_TELEMETRY_DISABLED: '1',
  NODE_OPTIONS: `--require "${path.join(HERE, 'node-guard.cjs').replaceAll('\\', '/')}"`,
  VISUAL_GUARD_ALLOW: host,
  VISUAL_GUARD_LOG: logs.guard,
});

const nextBin = createRequire(path.join(appDir, 'package.json')).resolve('next/dist/bin/next');
const child = spawn(
  process.execPath,
  [nextBin, 'dev', '--webpack', '-p', String(app.port), '-H', host],
  {
    cwd: appDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const nextLog = fs.createWriteStream(logs.next, { flags: 'a' });
let announced = false;
const onOutput = (chunk) => {
  nextLog.write(chunk);
  if (!announced && /Ready in/.test(String(chunk))) {
    announced = true;
    console.log(
      [
        '',
        `✅ 화면 확인 서버 준비됨 (${appName})`,
        `   주소: ${appUrl}/login`,
        '   로그인: 아무 이메일·비밀번호나 입력 → 겸직(어드민+셀러) 가짜 계정으로 들어갑니다',
        `   요청 기록: ${logs.api}`,
        `   next 로그: ${logs.next}`,
        '   종료: Ctrl+C',
        '',
      ].join('\n'),
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
  mock.close();
  nextLog.end();
  process.exit(code);
}
child.on('exit', (code) => {
  if (!stopping) {
    console.error(`❌ next dev 종료(code=${code}). 로그: ${logs.next}`);
    stop(code ?? 1);
  }
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
console.log(`⏳ ${appName} next dev 기동 중… (${appUrl})`);
