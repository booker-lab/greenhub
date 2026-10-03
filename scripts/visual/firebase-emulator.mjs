// 화면 확인 하네스용 Firebase 에뮬레이터(Auth·Firestore) — 셀러 상품·준비 화면처럼 브라우저가 Firestore를
// 직접 구독하는 화면을 가짜 데이터로 보기 위해 쓴다.
//
// 앱의 로컬 Firebase 계약(apps/seller/src/lib/firebase.ts)에 맞춰 project greenhub-local,
// 127.0.0.1:8080(Firestore)·9099(Auth)를 쓴다. 이 포트는 dev:local과 같으므로 둘을 동시에 띄울 수 없다.
// 저장소의 firestore.rules가 그대로 적용된다(운영과 같은 읽기 규칙).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { toFirestoreFields } from '../dev/local/seed-seller-orders.mjs';

export const EMULATOR = {
  projectId: 'greenhub-local',
  storageBucket: 'greenhub-local.appspot.com',
  firestore: { host: '127.0.0.1', port: 8080 },
  auth: { host: '127.0.0.1', port: 9099 },
};

const endpoint = ({ host, port }) => `${host}:${port}`;

function portInUse(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Firestore·Auth 에뮬레이터 포트가 비어 있는지 확인한다(dev:local이 떠 있으면 실패). */
export async function assertEmulatorPortsFree() {
  for (const target of [EMULATOR.firestore, EMULATOR.auth]) {
    if (await portInUse(target.port, target.host)) {
      throw new Error(
        `${endpoint(target)}가 이미 쓰이고 있습니다. dev:local이나 다른 에뮬레이터를 끄고 다시 실행하세요.`,
      );
    }
  }
}

/** firebase CLI로 Auth·Firestore 에뮬레이터를 띄운다. 반환값의 stop()으로 프로세스 트리를 끈다. */
export function startEmulators({ root, logFile }) {
  const command = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
  const child = spawn(
    command,
    ['emulators:start', '--only', 'auth,firestore', '--project', EMULATOR.projectId],
    {
      cwd: root,
      // 하네스의 node-guard(NODE_OPTIONS)는 next dev 전용이라 에뮬레이터에는 넘기지 않는다.
      env: { ...process.env, NODE_OPTIONS: '' },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return {
    child,
    stop() {
      if (child.exitCode === null) {
        if (process.platform === 'win32')
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else child.kill('SIGTERM');
      }
      log.end();
    },
  };
}

/** 두 에뮬레이터가 응답할 때까지 기다린다. */
export async function waitForEmulators({ child, timeoutMs = 90_000 }) {
  const started = Date.now();
  const ready = async (url) => {
    try {
      return (await fetch(url)).ok;
    } catch {
      return false;
    }
  };
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null)
      throw new Error(`에뮬레이터가 종료됐습니다(code=${child.exitCode}).`);
    if (
      (await ready(`http://${endpoint(EMULATOR.firestore)}/`)) &&
      (await ready(`http://${endpoint(EMULATOR.auth)}/`))
    )
      return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('에뮬레이터 준비 시간 초과');
}

/**
 * fixture의 firestoreSeed({ 컬렉션: { 문서 id: 데이터 } })를 넣는다.
 * 에뮬레이터 전용 owner 토큰으로 rules를 우회한다. 주소가 127.0.0.1:8080/greenhub-local로 고정이라 운영에 닿지 않는다.
 */
export async function seedFirestore(seed) {
  const base = `http://${endpoint(EMULATOR.firestore)}/v1/projects/${EMULATOR.projectId}/databases/(default)/documents`;
  let count = 0;
  for (const [collection, docs] of Object.entries(seed)) {
    for (const [id, data] of Object.entries(docs)) {
      const res = await fetch(`${base}/${collection}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify(toFirestoreFields(data)),
      });
      if (!res.ok) throw new Error(`시드 실패: ${collection}/${id} → ${res.status}`);
      count += 1;
    }
  }
  return count;
}

/**
 * Auth 에뮬레이터용 커스텀 토큰. 에뮬레이터는 서명을 검사하지 않으므로 서명 없는(alg none) 토큰을 만든다
 * (firebase-admin도 에뮬레이터 모드에서는 같은 형태를 만든다). 실제 Firebase는 이 토큰을 받지 않는다.
 */
export function emulatorCustomToken(uid, claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const issuer = 'firebase-auth-emulator@example.com';
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      iss: issuer,
      sub: issuer,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: now,
      exp: now + 3600,
      uid,
      claims,
    }),
    '',
  ].join('.');
}
