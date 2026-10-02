// 화면 확인 보고서 생성 — shots.mjs 결과(manifest.json + PNG)로 휴대폰에서 볼 HTML 페이지를 만든다.
//
//   node scripts/visual/report.mjs [app] --after <label> [--before <label>] --out <dir>
//
// <dir>/index.html 과 <dir>/shots/<label>/*.png 를 만든다. Claude가 이 폴더를 claude.ai 아티팩트로 올리면
// 화면마다 ✅/❌·메모를 남길 수 있고(아티팩트 db의 verdicts 컬렉션), Claude가 그 판정을 읽어 다음 작업을 정한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const args = process.argv.slice(2);
const appName =
  args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'seller';
const shotsRoot = path.join(os.tmpdir(), 'greenhub-visual', appName, 'shots');
const afterLabel = option('after', 'current');
const beforeLabel = option('before', null);
const outDir = option('out', null);
if (!outDir) {
  console.error('❌ --out <폴더>를 지정하세요.');
  process.exit(1);
}

function readRun(label) {
  const file = path.join(shotsRoot, label, 'manifest.json');
  if (!fs.existsSync(file)) {
    console.error(`❌ 캡처 기록이 없습니다: ${file} (먼저 shots.mjs --label ${label})`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function copyShots(label) {
  const dest = path.join(outDir, 'shots', label);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join(shotsRoot, label))) {
    if (f.endsWith('.png')) fs.copyFileSync(path.join(shotsRoot, label, f), path.join(dest, f));
  }
}

const after = readRun(afterLabel);
const before = beforeLabel ? readRun(beforeLabel) : null;
fs.rmSync(outDir, { recursive: true, force: true });
copyShots(afterLabel);
if (before) copyShots(beforeLabel);

// 화면(id) 단위로 묶는다: 각 화면에 모바일·데스크톱 캡처와(있으면) 이전 캡처를 붙인다.
const screens = [];
for (const shot of after.shots) {
  let screen = screens.find((s) => s.id === shot.id);
  if (!screen) {
    screen = { id: shot.id, group: shot.group, title: shot.title, path: shot.path, views: {} };
    screens.push(screen);
  }
  const prev = before?.shots.find((b) => b.id === shot.id && b.viewport === shot.viewport);
  screen.views[shot.viewport] = {
    src: `shots/${afterLabel}/${shot.file}`,
    beforeSrc: prev ? `shots/${beforeLabel}/${prev.file}` : null,
    finalPath: shot.finalPath,
    missing: shot.missing,
    errors: shot.errors,
  };
}

const data = {
  app: appName,
  run: afterLabel,
  before: beforeLabel,
  gitSha: after.gitSha,
  beforeSha: before?.gitSha ?? null,
  createdAt: after.createdAt,
  screens,
};

const html = fs
  .readFileSync(new URL('./report-template.html', import.meta.url), 'utf8')
  .replace('/*__DATA__*/null', JSON.stringify(data).replaceAll('<', '\\u003c'));
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`✅ 보고서: ${path.join(outDir, 'index.html')} (화면 ${screens.length}개)`);
