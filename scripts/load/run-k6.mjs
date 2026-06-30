import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const scenarios = {
  smoke: 'tests/load/scenarios/smoke.js',
  consumer: 'tests/load/scenarios/consumer-read.js',
  checkout: 'tests/load/scenarios/checkout.js',
  seller: 'tests/load/scenarios/seller-ops.js',
  admin: 'tests/load/scenarios/admin-ops.js',
  driver: 'tests/load/scenarios/driver-ops.js',
  throttle: 'tests/load/scenarios/throttle-auth.js',
  readiness: 'tests/load/scenarios/release-readiness.js',
};

const scenario = process.argv[2] || 'readiness';
const script = scenarios[scenario];

if (!script) {
  console.error(`알 수 없는 k6 시나리오입니다: ${scenario}`);
  console.error(`사용 가능: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}

function findK6() {
  const candidates = [
    process.env.K6_BIN,
    'k6',
    'C:\\Program Files\\k6\\k6.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['version'], { shell: false, stdio: 'ignore' });
    if (result.status === 0) {
      return candidate;
    }
  }

  return null;
}

const k6 = findK6();
if (!k6) {
  console.error('k6 실행 파일을 찾지 못했습니다. K6_BIN을 지정하거나 k6를 PATH에 추가하세요.');
  process.exit(1);
}

mkdirSync('docs/performance/load', { recursive: true });

const now = new Date().toISOString().replace(/[:.]/g, '-');
const profile = process.env.K6_PROFILE || 'smoke';
const summaryPath =
  process.env.K6_SUMMARY_EXPORT || join('docs/performance/load', `${scenario}-${profile}-${now}.json`);

const args = ['run', '--summary-export', summaryPath, script];
const result = spawnSync(k6, args, { stdio: 'inherit', shell: false });

if (result.status === 0) {
  console.log(`k6 요약 저장: ${summaryPath}`);
}

process.exit(result.status ?? 1);
