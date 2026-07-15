import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_RUNTIME_APPS = ['api', 'consumer', 'seller', 'driver'];
const SHARED_PACKAGE = '@greenhub/shared';

function fail(message) {
  console.error(`빌드 선택 회귀 검사 실패: ${message}`);
  process.exit(1);
}

function extractFilters(command) {
  const filters = [];
  const pattern = /--filter(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s&]+))/gu;

  for (const match of command.matchAll(pattern)) {
    filters.push(match[1] ?? match[2] ?? match[3]);
  }

  return filters;
}

function selectPackages(filters) {
  const filterArgs = filters.flatMap((filter) => ['--filter', filter]);
  const pnpmArgs = [...filterArgs, 'list', '--depth', '-1', '--json'];
  const unsafeFilter = filters.find(
    (filter) => !/^[A-Za-z0-9@./_*:-]+$/u.test(filter),
  );

  if (unsafeFilter) {
    fail(`안전하지 않은 pnpm 필터를 실행할 수 없습니다: ${unsafeFilter}`);
  }

  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
  const args =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', `pnpm ${pnpmArgs.join(' ')}`]
      : pnpmArgs;
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    shell: false,
  });

  if (result.error) {
    fail(`pnpm 패키지 선택 확인을 실행하지 못했습니다. ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = result.stderr.trim() || `종료 코드 ${result.status}`;
    fail(`pnpm 패키지 선택 확인이 실패했습니다. ${detail}`);
  }

  try {
    const packages = JSON.parse(result.stdout || '[]');
    return new Set(packages.map((item) => item.name));
  } catch (error) {
    fail(`pnpm 패키지 선택 결과를 해석하지 못했습니다. ${error.message}`);
  }
}

const rootPackage = JSON.parse(
  readFileSync(resolve(ROOT_DIR, 'package.json'), 'utf8'),
);
const buildScript = rootPackage.scripts?.build;

if (typeof buildScript !== 'string' || buildScript.trim() === '') {
  fail('루트 package.json에 build 스크립트가 없습니다.');
}

const buildCommands = buildScript.split(/\s*&&\s*/u);
const commandFilters = buildCommands.map(extractFilters);
const runtimeCommandIndex = commandFilters.findIndex((filters) =>
  REQUIRED_RUNTIME_APPS.every((app) => filters.includes(app)),
);

if (runtimeCommandIndex === -1) {
  fail(
    `필수 런타임 앱을 패키지 이름으로 명시해야 합니다: ${REQUIRED_RUNTIME_APPS.join(', ')}`,
  );
}

const runtimePackages = selectPackages(commandFilters[runtimeCommandIndex]);
const missingApps = REQUIRED_RUNTIME_APPS.filter(
  (app) => !runtimePackages.has(app),
);
const unexpectedPackages = [...runtimePackages].filter(
  (name) => !REQUIRED_RUNTIME_APPS.includes(name),
);

if (missingApps.length > 0) {
  fail(`필수 런타임 앱 선택이 누락됐습니다: ${missingApps.join(', ')}`);
}

if (unexpectedPackages.length > 0) {
  fail(`런타임 앱 build에 불필요한 패키지가 포함됐습니다: ${unexpectedPackages.join(', ')}`);
}

const sharedCommandIndex = commandFilters.findIndex((filters, index) => {
  if (index >= runtimeCommandIndex || filters.length === 0) return false;
  return selectPackages(filters).has(SHARED_PACKAGE);
});

if (sharedCommandIndex === -1) {
  fail(`${SHARED_PACKAGE} build가 런타임 앱 build보다 먼저 실행돼야 합니다.`);
}

console.log(
  `빌드 선택 회귀 검사 통과: ${SHARED_PACKAGE} 이후 ${REQUIRED_RUNTIME_APPS.join(', ')} build를 실행합니다.`,
);
