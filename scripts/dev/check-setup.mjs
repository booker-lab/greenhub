#!/usr/bin/env node
// 노트북·데스크탑·CI·운영 API 이미지가 같은 Node·pnpm·의존성으로 도는지 확인한다.
// 기본 실행은 이 컴퓨터를 점검하고, --repo는 저장소 안의 버전 고정이 한 값을 가리키는지만 본다(CI용).
// env 파일은 키 이름만 비교하고 값은 읽어 출력하지 않는다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JAVA_RUNTIME_CONTRACT, resolveJavaRuntime } from './local/launcher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW_DIR = '.github/workflows';

// 앞쪽 파일이 있으면 그 파일과 비교한다(Next.js는 .env.local을 .env보다 먼저 읽는다).
export const ENV_FILES = [
  { example: 'apps/api/.env.example', candidates: ['apps/api/.env'] },
  {
    example: 'apps/consumer/.env.example',
    candidates: ['apps/consumer/.env.local', 'apps/consumer/.env'],
  },
];

// 버전을 저장소가 고정하지 않는 선택 도구. 두 컴퓨터의 출력을 비교할 수 있게 버전만 보여 준다.
export const OPTIONAL_TOOLS = [
  { name: 'just', args: ['--version'], use: 'Justfile 명령' },
  { name: 'k6', args: ['version'], use: '부하 테스트(pnpm load:*)' },
  { name: 'trufflehog', args: ['--version'], use: '비밀값 검사(just secret-scan)' },
];

export function parseExactVersion(text) {
  const value = String(text ?? '').trim();
  return /^\d+\.\d+\.\d+$/.test(value) ? value : undefined;
}

export function parsePackageManagerVersion(field) {
  return String(field ?? '').match(/^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$/)?.[1];
}

export function parseUserAgentPnpmVersion(userAgent) {
  return String(userAgent ?? '').match(/(?:^|\s)pnpm\/(\d+\.\d+\.\d+)/)?.[1];
}

export function parseDockerNodeVersion(dockerfile) {
  return String(dockerfile ?? '').match(/^ARG NODE_IMAGE=node:(\d+\.\d+\.\d+)-/m)?.[1];
}

export function findRepoPinProblems({ nvmrc, dockerfile, workflows }) {
  const problems = [];
  const pinned = parseExactVersion(nvmrc);
  if (!pinned) {
    problems.push(
      `.nvmrc에는 22.23.3처럼 정확한 버전 하나만 적는다. 현재 값: ${JSON.stringify(String(nvmrc ?? '').trim())}`,
    );
  }
  const dockerVersion = parseDockerNodeVersion(dockerfile);
  if (pinned && dockerVersion !== pinned) {
    problems.push(
      `Dockerfile의 Node 이미지(${dockerVersion ?? '찾지 못함'})가 .nvmrc(${pinned})와 다르다. 둘을 같은 버전으로 맞춘다.`,
    );
  }
  for (const { file, text } of workflows) {
    let setupNodeSteps = 0;
    let nvmrcSteps = 0;
    String(text)
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (/^\s*(?:-\s*)?uses:\s*actions\/setup-node@/.test(line)) setupNodeSteps += 1;
        if (/^\s*node-version-file:\s*(['"]?)\.nvmrc\1\s*(?:#.*)?$/.test(line)) nvmrcSteps += 1;
        if (/^\s*node-version:/.test(line)) {
          problems.push(
            `${file}:${index + 1} node-version을 직접 적지 않고 node-version-file: .nvmrc를 쓴다.`,
          );
        }
      });
    if (setupNodeSteps !== nvmrcSteps) {
      problems.push(
        `${file}: setup-node ${setupNodeSteps}곳 중 ${nvmrcSteps}곳만 node-version-file: .nvmrc를 쓴다.`,
      );
    }
  }
  return problems;
}

function envKeys(text) {
  const keys = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key) keys.add(key);
  }
  return keys;
}

// 예시 파일에서 주석이 아닌 키 중 실제 env 파일에 없는 이름을 돌려준다.
export function findMissingEnvKeys(exampleText, envText) {
  const present = envKeys(envText);
  return [...envKeys(exampleText)].filter((key) => !present.has(key));
}

// pnpm은 전체 설치 뒤 node_modules/.pnpm/lock.yaml에 설치한 lockfile을 그대로 남긴다.
// Windows checkout은 줄바꿈이 CRLF일 수 있어 줄바꿈만 맞춰 비교한다.
export function isInstallCurrent(lockText, installedLockText) {
  if (typeof installedLockText !== 'string') return false;
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  return normalize(lockText) === normalize(installedLockText);
}

export function parsePlaywrightInstallLocations(output) {
  const locations = [...String(output ?? '').matchAll(/^\s*Install location:\s*(.+?)\s*$/gm)];
  return [...new Set(locations.map((match) => match[1]))];
}

function readText(relativePath) {
  try {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  } catch {
    return undefined;
  }
}

function readWorkflows() {
  return fs
    .readdirSync(path.join(ROOT, WORKFLOW_DIR))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => {
      const file = `${WORKFLOW_DIR}/${name}`;
      return { file, text: readText(file) };
    });
}

function repoPinProblems() {
  return findRepoPinProblems({
    nvmrc: readText('.nvmrc'),
    dockerfile: readText('Dockerfile'),
    workflows: readWorkflows(),
  });
}

function firstOutputLine(result) {
  return [result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function runTool(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return undefined;
  return firstOutputLine(result);
}

function pnpmVersion() {
  const fromUserAgent = parseUserAgentPnpmVersion(process.env.npm_config_user_agent);
  if (fromUserAgent) return fromUserAgent;
  // pnpm은 Windows에서 .cmd shim이라 shell 없이 직접 실행할 수 없다.
  const output =
    process.platform === 'win32'
      ? runTool(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm --version'])
      : runTool('pnpm', ['--version']);
  return parseExactVersion(output);
}

function checkMachine(report) {
  const pinnedNode = parseExactVersion(readText('.nvmrc'));
  const currentNode = process.versions.node;
  if (pinnedNode && currentNode === pinnedNode) {
    report.pass(`Node ${currentNode} — .nvmrc와 같다`);
  } else {
    report.fail(
      `Node ${currentNode} — .nvmrc는 ${pinnedNode ?? '정확한 버전이 아님'}. Windows는 저장소 루트의 setup.bat을 실행한다(fnm이 있으면 \`fnm install\` 후 터미널을 다시 연다)`,
    );
  }

  const packageJson = JSON.parse(readText('package.json'));
  const pinnedPnpm = parsePackageManagerVersion(packageJson.packageManager);
  const currentPnpm = pnpmVersion();
  if (pinnedPnpm && currentPnpm === pinnedPnpm) {
    report.pass(`pnpm ${currentPnpm} — package.json packageManager와 같다`);
  } else {
    report.fail(
      `pnpm ${currentPnpm ?? '확인 못 함'} — packageManager는 ${pinnedPnpm ?? '찾지 못함'}. \`corepack enable\` 후 다시 실행한다`,
    );
  }

  const installedLock = readText('node_modules/.pnpm/lock.yaml');
  if (isInstallCurrent(readText('pnpm-lock.yaml') ?? '', installedLock)) {
    report.pass('설치된 의존성이 pnpm-lock.yaml과 같다');
  } else {
    report.fail(
      `${installedLock === undefined ? '의존성이 설치되지 않았다' : '설치된 의존성이 pnpm-lock.yaml과 다르다'}. 루트에서 \`pnpm install --frozen-lockfile\`을 실행한다`,
    );
  }

  const minimumJava = JAVA_RUNTIME_CONTRACT.minimumMajorVersion;
  try {
    const java = resolveJavaRuntime();
    report.pass(`Java ${java.majorVersion} (${java.source}) — Firebase 에뮬레이터 실행 가능`);
  } catch {
    report.warn(
      `Java ${minimumJava} 이상을 찾지 못했다 — Firebase 에뮬레이터(pnpm dev:local, rules 테스트)에 필요하다`,
    );
  }

  const playwrightCli = path.join(ROOT, 'apps/e2e/node_modules/@playwright/test/cli.js');
  if (fs.existsSync(playwrightCli)) {
    const result = spawnSync(
      process.execPath,
      [playwrightCli, 'install', '--dry-run', 'chromium'],
      {
        cwd: path.join(ROOT, 'apps/e2e'),
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      },
    );
    const locations = parsePlaywrightInstallLocations(result.stdout);
    const missing = locations.filter((location) => !fs.existsSync(location));
    if (result.status !== 0 || locations.length === 0) {
      report.warn('Playwright 브라우저 위치를 확인하지 못했다');
    } else if (missing.length === 0) {
      report.pass('Playwright chromium이 lockfile 버전에 맞게 설치돼 있다');
    } else {
      report.warn(
        'Playwright chromium이 lockfile 버전에 맞게 설치되지 않았다 — `pnpm --filter e2e exec playwright install chromium`',
      );
    }
  }

  for (const { example, candidates } of ENV_FILES) {
    const exampleText = readText(example);
    if (exampleText === undefined) continue;
    const envFile = candidates.find((candidate) => fs.existsSync(path.join(ROOT, candidate)));
    if (!envFile) {
      report.warn(
        `${candidates.join(' 또는 ')} 없음 — 다른 컴퓨터에서 옮겨 온다(GitHub에 올리지 않는다)`,
      );
      continue;
    }
    const missing = findMissingEnvKeys(exampleText, readText(envFile));
    if (missing.length === 0) {
      report.pass(`${envFile} — ${example}의 키가 모두 있다`);
    } else {
      report.warn(
        `${envFile} — ${example}에 있는 키 ${missing.length}개 없음: ${missing.join(', ')}`,
      );
    }
  }

  for (const { name, args, use } of OPTIONAL_TOOLS) {
    const version = runTool(name, args);
    report.info(version ? `${name}: ${version}` : `${name} 없음 — ${use}에만 필요`);
  }
}

function createReport() {
  const counts = { fail: 0, warn: 0 };
  const line = (label, message) => console.log(`[${label}] ${message}`);
  return {
    counts,
    pass: (message) => line('통과', message),
    fail: (message) => {
      counts.fail += 1;
      line('실패', message);
    },
    warn: (message) => {
      counts.warn += 1;
      line('주의', message);
    },
    info: (message) => line('선택', message),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const problems = repoPinProblems();

  if (process.argv.includes('--repo')) {
    if (problems.length === 0) {
      console.log('Node 버전 고정 검사 통과 (.nvmrc·Dockerfile·workflow)');
    } else {
      for (const problem of problems) console.error(`Node 버전 고정 검사 실패: ${problem}`);
      process.exit(1);
    }
  } else {
    console.log('Greenhub 개발 환경 점검\n');
    const report = createReport();
    if (problems.length === 0) {
      report.pass('저장소의 Node 버전 고정(.nvmrc·Dockerfile·workflow)이 한 값을 가리킨다');
    } else {
      for (const problem of problems) report.fail(problem);
    }
    checkMachine(report);
    console.log(
      `\n실패 ${report.counts.fail}건, 주의 ${report.counts.warn}건. 두 컴퓨터에서 이 출력을 비교하면 차이를 찾을 수 있다.`,
    );
    if (report.counts.fail > 0) process.exit(1);
  }
}
