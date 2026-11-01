// 작업 전·후 동작·접근성 의미 비교 — shots.mjs가 화면마다 남긴 기록을 비교한다.
//
//   node scripts/visual/parity.mjs [app] --before <label> --after <label> [--allow <허용 목록.json>]
//
// 비교하는 것(화면·폭마다):
// - writes: 앱이 가짜 API에 보낸 쓰기 요청(메서드·경로·쿼리·본문). 주문 생성·장바구니 검증 요청이 같아야 한다.
// - portoneCalls: 결제창(PortOne stub)에 넘긴 인자(screen.portone이 있는 화면).
// - storage: 찍기 직전 브라우저 저장소(장바구니 담기 등 서버에 보내지 않는 동작의 결과).
// - aria: 접근성 트리(역할·이름·상태). 링크가 버튼이 되는 회귀는 픽셀이 같아도 여기서 드러난다.
// 결제마다 새로 만드는 값(UUID)과 실제 시각(ISO 시각)은 자리표시로 바꿔 비교한다. 판매자 저장소의 Firebase 에뮬레이터
// 로그인 기록(firebase:authUser:… 키)은 로그인 시각(createdAt·lastLoginAt)과 토큰 시각(iat·exp·auth_time)만 바꾼다.
// 통과 조건: 모든 항목이 같거나, 다른 항목이 허용 목록에 사유와 함께 있다. 한쪽에만 있는 화면·기록이 없는 화면은
// 실패다(기록이 없으면 아무것도 증명하지 못한다). 실패하면 종료 코드 1이다.
//
// 허용 목록(JSON 배열): { "screen": "order-accepted", "viewport": "mobile", "kind": "aria", "reason": "..." }
// viewport를 빼면 모든 폭. kind는 writes·portoneCalls·storage·aria 중 하나. 사유가 없는 항목은 받지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { incompleteReason } from './manifest-store.mjs';

export const PARITY_KINDS = ['writes', 'portoneCalls', 'storage', 'aria'];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;

/** 실행마다 달라지는 값(UUID·실제 시각)을 자리표시로 바꾼다. */
export function normalizeVolatile(text) {
  return String(text).replace(UUID, '<uuid>').replace(ISO_TIME, '<time>');
}

const FIREBASE_AUTH_USER_KEY = /^firebase:authUser:/;
const FIREBASE_USER_TIME_FIELDS = ['createdAt', 'lastLoginAt'];
const JWT_TIME_CLAIMS = ['iat', 'exp', 'auth_time'];

/** 서명 없는 에뮬레이터 토큰(헤더.본문.서명)의 시각 클레임만 자리표시로 바꾼다. 다른 클레임(역할·가게)은 그대로 비교한다. */
function normalizeJwtTimes(token) {
  if (typeof token !== 'string') return token;
  const [header, payload, ...rest] = token.split('.');
  if (!payload || rest.length !== 1) return token;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return token;
  }
  if (!claims || typeof claims !== 'object') return token;
  for (const claim of JWT_TIME_CLAIMS) if (claim in claims) claims[claim] = '<time>';
  return `${header}.${JSON.stringify(claims)}.${rest[0]}`;
}

/**
 * 저장소 기록에서 Firebase 에뮬레이터 로그인 기록의 실행마다 바뀌는 시각만 자리표시로 바꾼다.
 * 그 밖의 키(장바구니·상품 임시 저장 등)와 로그인 기록의 다른 값(uid·클레임·갱신 토큰)은 그대로 둔다.
 */
export function normalizeStorage(storage) {
  if (!storage || typeof storage !== 'object') return storage;
  const out = {};
  for (const [area, entries] of Object.entries(storage)) {
    if (!entries || typeof entries !== 'object') {
      out[area] = entries;
      continue;
    }
    out[area] = {};
    for (const [key, value] of Object.entries(entries)) {
      out[area][key] = FIREBASE_AUTH_USER_KEY.test(key) ? normalizeFirebaseUser(value) : value;
    }
  }
  return out;
}

function normalizeFirebaseUser(value) {
  let user;
  try {
    user = JSON.parse(value);
  } catch {
    return value;
  }
  if (!user || typeof user !== 'object') return value;
  for (const field of FIREBASE_USER_TIME_FIELDS) if (field in user) user[field] = '<time>';
  if (user.stsTokenManager && typeof user.stsTokenManager === 'object') {
    user.stsTokenManager.accessToken = normalizeJwtTimes(user.stsTokenManager.accessToken);
  }
  return JSON.stringify(user);
}

export function parseParityAllowances(entries) {
  if (!Array.isArray(entries)) throw new Error('허용 목록은 배열이어야 합니다.');
  return entries.map((entry, index) => {
    if (!entry || typeof entry.screen !== 'string')
      throw new Error(`${index}번 항목에 screen이 없습니다.`);
    if (!PARITY_KINDS.includes(entry.kind))
      throw new Error(`${index}번 항목의 kind는 ${PARITY_KINDS.join('·')} 중 하나여야 합니다.`);
    if (typeof entry.reason !== 'string' || !entry.reason.trim())
      throw new Error(`${index}번 항목에 사유(reason)가 없습니다.`);
    return { ...entry, used: false };
  });
}

/**
 * 두 묶음의 화면 기록을 비교한다. records: { [`${id}@${viewport}`]: { writes, portoneCalls, storage, aria } }
 * aria는 글자, 나머지는 JSON 값이다. 기록이 없는 항목(undefined)은 화면이 그 기록을 남기지 않았다는 뜻이다.
 */
export function compareParity(beforeRecords, afterRecords, allowances = []) {
  const results = [];
  const keys = [...new Set([...Object.keys(beforeRecords), ...Object.keys(afterRecords)])].sort();
  for (const key of keys) {
    const [screen, viewport] = key.split('@');
    const before = beforeRecords[key];
    const after = afterRecords[key];
    if (!before || !after) {
      results.push({ screen, viewport, status: 'missing', side: before ? 'after' : 'before' });
      continue;
    }
    // 접근성 트리를 다른 방식으로 찍은 두 기록(경로 안내를 뺀 쪽과 안 뺀 쪽)은 aria를 비교할 수 없다.
    const excludesBefore = JSON.stringify(before.ariaExcludes ?? []);
    const excludesAfter = JSON.stringify(after.ariaExcludes ?? []);
    if (excludesBefore !== excludesAfter) {
      results.push({
        screen,
        viewport,
        status: 'different',
        differences: [
          {
            kind: 'aria',
            reason: `접근성 트리를 다른 방식으로 찍음(before 제외 ${excludesBefore}, after 제외 ${excludesAfter}). 두 묶음을 같은 shots.mjs로 다시 찍으세요.`,
          },
        ],
      });
      continue;
    }
    const differences = [];
    for (const kind of PARITY_KINDS) {
      const prepare = (value) =>
        value === undefined
          ? undefined
          : normalizeVolatile(serialize(kind === 'storage' ? normalizeStorage(value) : value));
      const a = prepare(before[kind]);
      const b = prepare(after[kind]);
      if (a === undefined && b === undefined) continue;
      if (a === undefined || b === undefined) {
        differences.push({
          kind,
          reason: `한쪽에만 기록이 있음(${a === undefined ? 'before' : 'after'} 없음)`,
        });
        continue;
      }
      if (a === b) continue;
      const allowance = allowances.find(
        (entry) =>
          entry.screen === screen &&
          entry.kind === kind &&
          (entry.viewport === undefined || entry.viewport === viewport),
      );
      if (allowance) {
        allowance.used = true;
        differences.push({ kind, allowed: allowance.reason });
      } else {
        differences.push({ kind, before: a, after: b });
      }
    }
    const unexplained = differences.filter((d) => !d.allowed);
    results.push({
      screen,
      viewport,
      status:
        differences.length === 0 ? 'same' : unexplained.length === 0 ? 'allowed' : 'different',
      differences,
    });
  }
  return results;
}

function serialize(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** 바뀐 줄만 보여 준다(앞뒤 같은 줄은 건너뛴다). */
export function changedLines(a, b, context = 2) {
  const left = a.split('\n');
  const right = b.split('\n');
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let endL = left.length - 1;
  let endR = right.length - 1;
  while (endL >= start && endR >= start && left[endL] === right[endR]) {
    endL--;
    endR--;
  }
  const from = Math.max(0, start - context);
  return [
    ...left.slice(from, endL + 1).map((line, i) => `${from + i < start ? ' ' : '-'} ${line}`),
    ...right.slice(start, endR + 1).map((line) => `+ ${line}`),
  ].join('\n');
}

function readRecords(shotsRoot, label) {
  const dir = path.join(shotsRoot, label);
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error(`캡처 기록이 없습니다: ${file}`);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  // 끊긴 촬영(complete: false)은 비교하지 않는다(예전에는 manifest가 없어 실패했다).
  const incomplete = incompleteReason(manifest, label);
  if (incomplete) throw new Error(incomplete);
  const records = {};
  for (const shot of manifest.shots) {
    if (!shot.aria || !Array.isArray(shot.writes)) {
      throw new Error(
        `${label}의 ${shot.id}(${shot.viewport})에 동작 기록이 없습니다(예전 shots.mjs로 찍음).`,
      );
    }
    records[`${shot.id}@${shot.viewport}`] = {
      writes: shot.writes,
      portoneCalls: shot.portoneCalls,
      storage: shot.storage,
      aria: fs.readFileSync(path.join(dir, shot.aria), 'utf8'),
      // 접근성 트리에서 뺀 요소(aria-snapshot.mjs). 예전 shots.mjs로 찍은 기록은 빼지 않았다(빈 목록).
      ariaExcludes: shot.ariaExcludes ?? [],
      sound: shot.sound,
    };
  }
  return { manifest, records };
}

async function main() {
  const option = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : fallback;
  };
  const args = process.argv.slice(2);
  const appName =
    args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'seller';
  const beforeLabel = option('before', null);
  const afterLabel = option('after', null);
  if (!beforeLabel || !afterLabel) {
    console.error('❌ --before <label> --after <label>을 지정하세요.');
    process.exit(1);
  }
  const shotsRoot = path.join(os.tmpdir(), 'greenhub-visual', appName, 'shots');
  let allowances = [];
  const allowFile = option('allow', null);
  try {
    if (allowFile)
      allowances = parseParityAllowances(JSON.parse(fs.readFileSync(allowFile, 'utf8')));
    const before = readRecords(shotsRoot, beforeLabel);
    const after = readRecords(shotsRoot, afterLabel);
    if (before.manifest.visualNow !== after.manifest.visualNow) {
      throw new Error(
        `기준 시각이 다릅니다: ${before.manifest.visualNow} / ${after.manifest.visualNow}`,
      );
    }
    const results = compareParity(before.records, after.records, allowances);
    let failed = 0;
    for (const result of results) {
      const key = `${result.screen}(${result.viewport})`;
      const unsound = [before.records, after.records].some(
        (records) => records[`${result.screen}@${result.viewport}`]?.sound === false,
      );
      if (result.status === 'missing') {
        failed++;
        console.log(`❌ ${key}: ${result.side} 쪽에 없음`);
      } else if (unsound) {
        failed++;
        console.log(`❌ ${key}: 정상 촬영 판정 실패(비교하지 않음)`);
      } else if (result.status === 'different') {
        failed++;
        console.log(`❌ ${key}`);
        for (const d of result.differences.filter((x) => !x.allowed)) {
          console.log(`  [${d.kind}] ${d.reason ?? ''}`);
          if (d.before !== undefined)
            console.log(changedLines(d.before, d.after).replace(/^/gm, '    '));
        }
      } else if (result.status === 'allowed') {
        console.log(
          `🟡 ${key}: 허용(${result.differences.map((d) => `${d.kind}: ${d.allowed}`).join(' / ')})`,
        );
      }
    }
    for (const entry of allowances.filter((x) => !x.used)) {
      console.warn(`⚠️ 쓰이지 않은 허용 항목: ${entry.screen} ${entry.kind} (${entry.reason})`);
    }
    const same = results.filter((r) => r.status === 'same').length;
    console.log(
      `\n${failed ? '❌' : '✅'} 동작·접근성 비교 ${results.length}건: 같음 ${same} · 실패 ${failed}`,
    );
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
