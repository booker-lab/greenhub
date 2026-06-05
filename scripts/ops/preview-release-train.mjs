import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';

const waves = [
  {
    id: 'docs-policy',
    label: '문서와 정책',
    match: (path) =>
      path === 'package.json' ||
      path === 'scripts/ops/preview-release-train.mjs' ||
      path.startsWith('docs/specs/ops/') ||
      (path.startsWith('docs/') &&
        (path.includes('preview') ||
          path.includes('visual-verify') ||
          path.endsWith('CRITICAL_LOGIC.md') ||
          path.endsWith('memory.md') ||
          path.endsWith('BACKLOG.md') ||
          path.includes('manual-visual-verify'))),
  },
  {
    id: 'shared-contracts',
    label: '공용 계약',
    match: (path) => path.startsWith('packages/shared/') || path === 'firestore.indexes.json',
  },
  {
    id: 'api-backend',
    label: 'API와 서버 로직',
    match: (path) =>
      path.startsWith('apps/api/') ||
      path.startsWith('docs/specs/api/') ||
      path.startsWith('scripts/seed-') ||
      (path.startsWith('scripts/ops/') && path !== 'scripts/ops/preview-release-train.mjs'),
  },
  {
    id: 'consumer-web',
    label: '소비자 웹',
    match: (path) =>
      path.startsWith('apps/consumer/') ||
      path.includes('consumer-') ||
      path.includes('consumer_') ||
      path.includes('delivery-date') ||
      path.includes('parcel-and-order-number'),
  },
  {
    id: 'seller-admin',
    label: '판매자와 관리자 웹',
    match: (path) =>
      path.startsWith('apps/seller/') ||
      path.includes('seller-') ||
      path.includes('admin-') ||
      path.includes('settlement'),
  },
  {
    id: 'driver-web',
    label: '드라이버 웹',
    match: (path) => path.startsWith('apps/driver/') || path.includes('driver-'),
  },
  {
    id: 'e2e-ops',
    label: 'E2E와 검증 운영',
    match: (path) => path.startsWith('apps/e2e/') || path.includes('e2e'),
  },
  {
    id: 'misc-review',
    label: '수동 검토 필요',
    match: () => true,
  },
];

const ignoredPrefixes = ['.codex/', '.vercel/', 'node_modules/', 'scripts/node_modules/'];
const ignoredSuffixes = ['.env', '.env.local', '.log', '.tsbuildinfo'];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function changedFiles() {
  const raw = git(['status', '--porcelain=v1', '-z']);
  const entries = raw.split('\0').filter(Boolean);
  const files = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const first = normalizePath(entry.slice(3));

    if (status.includes('R') || status.includes('C')) {
      const second = entries[index + 1] ? normalizePath(entries[index + 1]) : undefined;
      index += 1;
      if (second) files.push(second);
      continue;
    }

    files.push(...expandPath(first));
  }

  return [...new Set(files)].filter((path) => !isIgnored(path)).sort();
}

function expandPath(path) {
  const normalized = normalizePath(path);
  try {
    if (!statSync(normalized).isDirectory()) return [normalized];
  } catch {
    return [normalized];
  }

  const found = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const child = normalizePath(`${dir}/${name}`);
      if (isIgnored(child)) continue;
      if (statSync(child).isDirectory()) visit(child);
      else found.push(child);
    }
  };

  visit(path);
  return found;
}

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function isIgnored(path) {
  return (
    ignoredPrefixes.some((prefix) => path.startsWith(prefix)) ||
    ignoredSuffixes.some((suffix) => path.endsWith(suffix))
  );
}

function classify(files) {
  const result = new Map(waves.map((wave) => [wave.id, []]));

  for (const file of files) {
    const wave = waves.find((candidate) => candidate.match(file));
    result.get(wave.id).push(file);
  }

  return result;
}

function printPlan(groups) {
  console.log('단계별 Preview 릴리즈 계획');
  console.log('');

  for (const wave of waves) {
    const files = groups.get(wave.id) ?? [];
    console.log(`${wave.id} - ${wave.label}: ${files.length}개`);
    for (const file of files) console.log(`  ${file}`);
    console.log('');
  }

  console.log('사용법');
  console.log('  pnpm release:stage -- <wave>');
  console.log('  예: pnpm release:stage -- consumer-web');
}

function stageWave(groups, waveId) {
  if (!waves.some((wave) => wave.id === waveId)) {
    console.error(`알 수 없는 웨이브입니다: ${waveId}`);
    process.exit(1);
  }

  const files = groups.get(waveId) ?? [];
  if (files.length === 0) {
    console.log(`${waveId}에 stage할 파일이 없습니다.`);
    return;
  }

  git(['add', '--', ...files]);
  console.log(`${waveId} 파일 ${files.length}개를 stage했습니다.`);
  console.log('확인 명령: git diff --cached --name-status');
}

const command = process.argv[2] ?? 'plan';
const waveId = process.argv[3];
const groups = classify(changedFiles());

if (command === 'plan') {
  printPlan(groups);
} else if (command === 'stage') {
  stageWave(groups, waveId);
} else {
  console.error(`알 수 없는 명령입니다: ${command}`);
  process.exit(1);
}
