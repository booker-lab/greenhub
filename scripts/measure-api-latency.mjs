/**
 * Railway API latency 계측 스크립트 — P2-A 관측 (BACKLOG §12).
 *
 * Railway API에는 요청 로깅 인터셉터가 없어 배포 로그에서 latency를 추출할 수
 * 없다. 본 스크립트는 능동(synthetic) 측정으로 p50/p95/p99 + 실패율을 산출한다.
 *
 * 사용법:
 *   node scripts/measure-api-latency.mjs [--api <url>] [--health-count N]
 *        [--login-count N] [--email <e>] [--password <p>] [--json <path>]
 *
 * 측정 대상:
 *   - GET  /health       네트워크 왕복 + 자명한 핸들러 (서버 작업 ~0)
 *   - POST /auth/login   Firestore 사용자 조회 + bcrypt(factor 12) + 토큰 발급
 *
 * ⚠️ Throttle 주의: app.module.ts의 ThrottlerModule은 'default'(100/분)·'auth'
 * (10/분) 두 throttler를 등록하는데, NestJS는 등록된 모든 throttler를 모든
 * 라우트에 전역 적용한다. 따라서 /health 포함 *전 엔드포인트*가 IP당 사실상
 * 10/분으로 제한된다(binding = auth). → 모든 측정을 60초 윈도우당 8회로 페이싱
 * (한도 10, 마진 2). refreshTokens/{uid}는 단일 doc 덮어쓰기라 잔여물 없음.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- 인자 파싱 ---
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// apps/e2e/.env 에서 키 읽기 (인자 미지정 시 fallback)
function envFromE2e(key) {
  try {
    const txt = readFileSync(join(__dirname, '../apps/e2e/.env'), 'utf-8');
    const m = txt.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

const API = arg('api', 'https://api-production-13e7.up.railway.app').replace(/\/$/, '');
const HEALTH_COUNT = Number(arg('health-count', '24'));
const LOGIN_COUNT = Number(arg('login-count', '24'));
const EMAIL = arg('email', envFromE2e('TEST_SELLER_EMAIL'));
const PASSWORD = arg('password', envFromE2e('TEST_SELLER_PASSWORD'));
const JSON_OUT = arg('json', undefined);

const WINDOW_SIZE = 8; // throttle 10/분 → 윈도우당 8 (마진 2)
const WINDOW_GAP_MS = 62_000; // throttle ttl 60s + 여유 2s

// --- 통계 ---
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarize(label, samples) {
  const ok = samples.filter((s) => s.ok);
  const lat = ok.map((s) => s.ms).sort((a, b) => a - b);
  const failed = samples.length - ok.length;
  const throttled = samples.filter((s) => s.status === 429).length;
  const mean = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null;
  return {
    label,
    total: samples.length,
    ok: ok.length,
    failed,
    throttled,
    failureRate: samples.length ? (failed / samples.length) * 100 : 0,
    min: lat[0] ?? null,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    p99: percentile(lat, 99),
    max: lat[lat.length - 1] ?? null,
    mean: mean !== null ? Math.round(mean) : null,
  };
}

// --- 단일 요청 측정 ---
async function timed(fn) {
  const t0 = performance.now();
  try {
    const res = await fn();
    const ms = Math.round(performance.now() - t0);
    return { ms, status: res.status, ok: res.ok };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return { ms, status: 0, ok: false, error: String(e?.message ?? e) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 60초 윈도우당 WINDOW_SIZE회로 페이싱하며 count회 측정.
 * @param requestFn () => Promise<Response>
 */
async function measureWindowed(label, count, requestFn) {
  const samples = [];
  const windows = Math.ceil(count / WINDOW_SIZE);
  let done = 0;
  for (let w = 0; w < windows; w++) {
    const n = Math.min(WINDOW_SIZE, count - done);
    for (let i = 0; i < n; i++) {
      const s = await timed(requestFn);
      samples.push(s);
      done++;
      process.stdout.write(`\r[${label}] ${done}/${count} win=${w + 1}/${windows} last=${s.ms}ms status=${s.status}   `);
    }
    if (w < windows - 1) {
      process.stdout.write(`\n[${label}] throttle 윈도우 대기 ${WINDOW_GAP_MS / 1000}s...\n`);
      await sleep(WINDOW_GAP_MS);
    }
  }
  process.stdout.write('\n');
  return samples;
}

function printReport(rows) {
  const col = (v, w) => String(v ?? '-').padStart(w);
  console.log('\n=== Railway API latency 계측 결과 ===');
  console.log(`API: ${API}`);
  console.log(`측정 시각: ${new Date().toISOString()}\n`);
  console.log('endpoint          total   ok  fail  429   min   p50   p95   p99   max  mean(ms)');
  console.log('-'.repeat(80));
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(16)} ${col(r.total, 5)} ${col(r.ok, 4)} ${col(r.failed, 5)} ${col(r.throttled, 4)} ` +
        `${col(r.min, 5)} ${col(r.p50, 5)} ${col(r.p95, 5)} ${col(r.p99, 5)} ${col(r.max, 5)} ${col(r.mean, 6)}`,
    );
    console.log(`${''.padEnd(16)} 실패율 ${r.failureRate.toFixed(1)}%`);
  }
}

async function main() {
  console.log(`[measure-api-latency] API=${API} health=${HEALTH_COUNT} login=${LOGIN_COUNT}\n`);

  // 콜드 연결 워밍업 1회 (집계 제외) — 첫 요청은 TLS handshake 비용 포함
  await timed(() => fetch(`${API}/health`));

  const health = await measureWindowed('health', HEALTH_COUNT, () => fetch(`${API}/health`));

  let login = [];
  if (EMAIL && PASSWORD) {
    login = await measureWindowed('login', LOGIN_COUNT, () =>
      fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      }),
    );
  } else {
    console.warn('[login] 자격증명 없음 — /auth/login 측정 건너뜀 (--email/--password 또는 apps/e2e/.env 필요)');
  }

  const rows = [summarize('GET /health', health)];
  if (login.length) rows.push(summarize('POST /auth/login', login));
  printReport(rows);

  if (JSON_OUT) {
    const { writeFileSync } = await import('fs');
    writeFileSync(JSON_OUT, JSON.stringify({ api: API, at: new Date().toISOString(), rows }, null, 2));
    console.log(`\nJSON 저장: ${JSON_OUT}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
