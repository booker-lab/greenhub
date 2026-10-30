/**
 * UI 교체(Mantine → shadcn/ui) 동결 검사 — PR CI와 운영 배포 workflow가 쓴다.
 *
 *   node scripts/release/freeze-guard.mjs pr --base <sha> [--head HEAD] [--labels a,b]
 *   node scripts/release/freeze-guard.mjs deploy --sha <sha>
 *
 * 기준: docs/specs/frontend/ui-stack-migration-plan.md §8(M2, 2026-10-30 사용자 확정).
 * 동결 상태는 docs/release/ui-migration-freeze.json 하나가 소유한다. 구간 전환은 이 파일을 바꾸는 커밋으로 한다
 * (날짜로 자동 전환하지 않는다). PR 검사는 상태를 PR 쪽이 아니라 base SHA에서 읽어, PR이 파일을 같이 고쳐
 * 동결을 풀 수 없게 한다. 배포 검사는 main checkout(HEAD)의 상태를 읽는다.
 *
 * 구간(stage):
 *   open             동결 없음.
 *   consumer-freeze  소비자 앱 화면만 묶는다(카카오페이 심사·LIVE 결제 확인 전, 2026-10-30 사용자 결정).
 *                    apps/consumer의 교체 흔적과, 소비자 화면 값을 바꾸는 공용 파일(theme.ts·style.css) 수정을 막는다.
 *   pre-candidate    교체 코드(shadcn·Tailwind·Base UI 흔적)를 main에 넣지 않는다.
 *   candidate      위 + 프런트 앱을 다시 빌드하게 하는 변경은 수정·revert(라벨 freeze-fix)만.
 *                  배포는 상태 파일의 후보 SHA이거나 그 뒤의 SHA이고, 그 사이에 교체 코드가 없어야 한다.
 * 프런트 재빌드 여부는 scripts/vercel/ignore-build.mjs의 판정을 그대로 쓴다(분류를 따로 만들지 않는다).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS, decideForChangedFiles, resolveAppSourceDirs } from '../vercel/ignore-build.mjs';

export const STATE_FILE = 'docs/release/ui-migration-freeze.json';
export const STAGES = Object.freeze(['open', 'consumer-freeze', 'pre-candidate', 'candidate']);

// consumer-freeze에서 막는 공용 파일: 소비자 화면의 색·글자·보정 값을 바꾼다.
export const CONSUMER_SHARED_FILES = Object.freeze([
  'packages/ui/src/theme.ts',
  'packages/ui/src/style.css',
]);
export const FIX_LABEL = 'freeze-fix';

// 교체 작업만 만드는 경로. 동결 중에는 이 경로를 바꾸는 PR을 막는다.
export const MIGRATION_PATHS = Object.freeze([
  /^packages\/ui\/src\/(components|styles|lib)\//,
  /(^|\/)components\.json$/,
  /^apps\/(consumer|seller|driver)\/postcss\.config\.[cm]?js$/,
  /^\.claude\/skills\//,
]);

// 프런트 소스·패키지 매니페스트에 새로 들어온 줄에서 찾는 교체 흔적.
const SIGNATURE_SCOPE = /^(apps\/(consumer|seller|driver)\/|packages\/|package\.json$)/;
export const MIGRATION_SIGNATURES = Object.freeze([
  /@greenhub\/ui\/(components|styles|lib)\b/,
  /["']tailwindcss["'/]|@tailwindcss\//,
  /@base-ui\/react/,
  /tw-animate-css/,
  /["']shadcn["'/]/,
]);

/** 상태 파일 내용을 검증한다. 틀리면 예외(검사를 통과시키지 않는다). */
export function parseState(text) {
  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    throw new Error(`${STATE_FILE}을 JSON으로 읽지 못했습니다: ${error.message}`);
  }
  if (!state || !STAGES.includes(state.stage)) {
    throw new Error(`${STATE_FILE}의 stage는 ${STAGES.join('·')} 중 하나여야 합니다`);
  }
  const sha = state.candidateSha ?? null;
  if (state.stage === 'candidate' && !/^[0-9a-f]{40}$/.test(String(sha))) {
    throw new Error(`${STATE_FILE}: candidate 구간에는 40자리 candidateSha가 있어야 합니다`);
  }
  return { stage: state.stage, candidateSha: sha };
}

/** `git diff -U0` 출력에서 파일별로 새로 들어온 줄을 모은다. */
export function parseAddedLines(diffText) {
  const added = new Map();
  let file = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      file = target === '/dev/null' ? null : target.replace(/^b\//, '');
      if (file && !added.has(file)) added.set(file, []);
    } else if (file && line.startsWith('+') && !line.startsWith('+++')) {
      added.get(file).push(line.slice(1));
    }
  }
  return added;
}

/** 교체 흔적(경로·새 줄) 목록. */
export function migrationFootprint({ changedFiles, addedLines }) {
  const found = [];
  for (const file of changedFiles) {
    if (MIGRATION_PATHS.some((re) => re.test(file))) found.push(`${file}: 교체 전용 경로`);
  }
  for (const [file, lines] of addedLines) {
    if (!SIGNATURE_SCOPE.test(file)) continue;
    for (const line of lines) {
      const hit = MIGRATION_SIGNATURES.find((re) => re.test(line));
      if (hit) {
        found.push(`${file}: 교체 흔적 "${line.trim().slice(0, 80)}"`);
        break;
      }
    }
  }
  return found;
}

/**
 * PR 하나를 판정한다.
 * @param {{ stage: string }} state
 * @param {{ changedFiles: string[], addedLines: Map<string,string[]>, labels: string[], rebuildsFrontend: string[] }} change
 *   rebuildsFrontend: 다시 빌드되는 프런트 앱 이름(ignore-build 판정)
 */
export function evaluatePullRequest(state, change) {
  if (state.stage === 'open') return { ok: true, violations: [] };
  if (state.stage === 'consumer-freeze') {
    const violations = migrationFootprint(change).filter((item) =>
      item.startsWith('apps/consumer/'),
    );
    for (const file of change.changedFiles) {
      if (CONSUMER_SHARED_FILES.includes(file)) {
        violations.push(`${file}: 소비자 화면 값을 바꾸는 공용 파일(소비자 동결 중)`);
      }
    }
    return { ok: violations.length === 0, violations };
  }
  const violations = migrationFootprint(change);
  if (
    state.stage === 'candidate' &&
    change.rebuildsFrontend.length > 0 &&
    !change.labels.includes(FIX_LABEL)
  ) {
    violations.push(
      `후보 확정 뒤에는 프런트(${change.rebuildsFrontend.join('·')})를 다시 빌드하게 하는 변경은 수정·revert만 병합한다. 수정·revert면 라벨 ${FIX_LABEL}를 붙인다`,
    );
  }
  return { ok: violations.length === 0, violations };
}

/**
 * 운영 배포 SHA 하나를 판정한다.
 * @param {{ stage: string, candidateSha: string | null }} state
 * @param {{ sha: string, descendsFromCandidate: boolean, footprintSinceCandidate: string[] }} deploy
 */
export function evaluateDeploy(state, deploy) {
  if (state.stage !== 'candidate') return { ok: true, violations: [] };
  const violations = [];
  if (deploy.sha !== state.candidateSha && !deploy.descendsFromCandidate) {
    violations.push(
      `동결(candidate) 중에는 후보 ${state.candidateSha} 또는 그 뒤의 SHA만 배포한다: ${deploy.sha}`,
    );
  }
  for (const item of deploy.footprintSinceCandidate)
    violations.push(`후보 뒤에 교체 코드: ${item}`);
  return { ok: violations.length === 0, violations };
}

// ── 명령 ──

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function option(argv, name) {
  const prefix = `--${name}=`;
  const inline = argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
}

function readStateAt(root, rev) {
  let text;
  try {
    text = git(root, ['show', `${rev}:${STATE_FILE}`]);
  } catch {
    // 상태 파일이 아직 없는 base(이 검사를 들인 PR 자체)는 동결 없음으로 본다.
    return { stage: 'open', candidateSha: null, missing: true };
  }
  return parseState(text);
}

function changeBetween(root, base, head) {
  const changedFiles = git(root, ['diff', '--name-only', base, head]).split('\n').filter(Boolean);
  const addedLines = parseAddedLines(git(root, ['diff', '-U0', '--no-color', base, head]));
  return { changedFiles, addedLines };
}

function rebuiltApps(root, changedFiles) {
  return APPS.filter((app) => {
    const { relevant } = resolveAppSourceDirs({ repositoryRoot: root, app });
    return decideForChangedFiles({ app, changedFiles, appSourceDirs: relevant }).build;
  });
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const [command] = argv;
  if (command === 'pr') {
    const base = option(argv, 'base');
    const head = option(argv, 'head') ?? 'HEAD';
    if (!base) throw new Error('--base <sha>가 필요합니다');
    const labels = (option(argv, 'labels') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const state = readStateAt(root, base);
    const change = changeBetween(root, base, head);
    const result = evaluatePullRequest(state, {
      ...change,
      labels,
      rebuildsFrontend: state.stage === 'candidate' ? rebuiltApps(root, change.changedFiles) : [],
    });
    report(`UI 교체 동결(${state.stage}${state.missing ? ', 상태 파일 없음' : ''})`, result);
    return result.ok ? 0 : 1;
  }
  if (command === 'deploy') {
    const sha = option(argv, 'sha');
    if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error('--sha는 40자리 SHA여야 합니다');
    const state = readStateAt(root, 'HEAD');
    let descendsFromCandidate = false;
    let footprintSinceCandidate = [];
    if (state.stage === 'candidate') {
      try {
        git(root, ['merge-base', '--is-ancestor', state.candidateSha, sha]);
        descendsFromCandidate = true;
      } catch {
        descendsFromCandidate = false;
      }
      if (descendsFromCandidate) {
        footprintSinceCandidate = migrationFootprint(changeBetween(root, state.candidateSha, sha));
      }
    }
    const result = evaluateDeploy(state, { sha, descendsFromCandidate, footprintSinceCandidate });
    report(`UI 교체 동결 배포 확인(${state.stage})`, result);
    return result.ok ? 0 : 1;
  }
  throw new Error(
    '사용법: freeze-guard.mjs pr --base <sha> [--head HEAD] [--labels a,b] | deploy --sha <sha>',
  );
}

function report(title, result) {
  if (result.ok) {
    console.log(`✅ ${title}: 통과`);
    return;
  }
  console.error(`❌ ${title}: 막힘`);
  for (const v of result.violations) console.error(`  - ${v}`);
  console.error(`  기준: docs/specs/frontend/ui-stack-migration-plan.md §8, 상태: ${STATE_FILE}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}
