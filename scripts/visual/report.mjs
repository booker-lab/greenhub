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
// 여러 앱을 한 확인판에 넣을 수 있다: consumer,seller (앞에 쓴 앱이 위에 온다).
// 앱마다 다른 캡처를 쓰려면 앱@label로 쓴다: consumer@after,seller@baseline
// --before는 그 label 캡처가 있고 after와 다를 때만 비교로 붙는다.
const appSpecs = (
  args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'seller'
)
  .split(',')
  .map((spec) => {
    const [app, label] = spec.split('@');
    return { app, label };
  });
// 확인판에서 앱을 구분하는 묶음 이름 앞머리. 셀러 fixture의 묶음(판매자·어드민)은 그대로 둔다.
const APP_GROUP_PREFIX = { consumer: '소비자 · ' };
const afterLabel = option('after', 'current');
const beforeLabel = option('before', null);
const outDir = option('out', null);
if (!outDir) {
  console.error('❌ --out <폴더>를 지정하세요.');
  process.exit(1);
}

const shotsRoot = (app) => path.join(os.tmpdir(), 'greenhub-visual', app, 'shots');

function readRun(app, label) {
  const file = path.join(shotsRoot(app), label, 'manifest.json');
  if (!fs.existsSync(file)) {
    console.error(`❌ 캡처 기록이 없습니다: ${file} (먼저 shots.mjs ${app} --label ${label})`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function copyShots(app, label) {
  const dest = path.join(outDir, 'shots', app, label);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join(shotsRoot(app), label))) {
    if (f.endsWith('.png'))
      fs.copyFileSync(path.join(shotsRoot(app), label, f), path.join(dest, f));
  }
}

fs.rmSync(outDir, { recursive: true, force: true });

// 화면 단위로 묶는다: 각 화면에 모바일·데스크톱 캡처와(있으면) 이전 캡처를 붙인다.
// 화면 id는 앱 이름을 붙여 앱 사이에서 겹치지 않게 한다(판정 문서 id에도 쓰인다).
const screens = [];
const runs = [];
for (const { app, label } of appSpecs) {
  const afterOfApp = label ?? afterLabel;
  const beforeOfApp =
    beforeLabel &&
    beforeLabel !== afterOfApp &&
    fs.existsSync(path.join(shotsRoot(app), beforeLabel, 'manifest.json'))
      ? beforeLabel
      : null;
  const after = readRun(app, afterOfApp);
  const before = beforeOfApp ? readRun(app, beforeOfApp) : null;
  copyShots(app, afterOfApp);
  if (before) copyShots(app, beforeOfApp);
  runs.push({
    app,
    label: afterOfApp,
    before: beforeOfApp,
    gitSha: after.gitSha,
    beforeSha: before?.gitSha ?? null,
    createdAt: after.createdAt,
  });
  for (const shot of after.shots) {
    const id = `${app}-${shot.id}`;
    let screen = screens.find((s) => s.id === id);
    if (!screen) {
      const group = `${APP_GROUP_PREFIX[app] ?? ''}${shot.group}`;
      screen = { id, app, group, title: shot.title, path: shot.path, views: {} };
      screens.push(screen);
    }
    const prev = before?.shots.find((b) => b.id === shot.id && b.viewport === shot.viewport);
    screen.views[shot.viewport] = {
      src: `shots/${app}/${afterOfApp}/${shot.file}`,
      beforeSrc: prev ? `shots/${app}/${beforeOfApp}/${prev.file}` : null,
      finalPath: shot.finalPath,
      missing: shot.missing,
      errors: shot.errors,
    };
  }
}

const data = {
  app: appSpecs.map((s) => s.app).join(','),
  runs,
  run: afterLabel,
  before: beforeLabel,
  gitSha: runs[0].gitSha,
  beforeSha: runs[0].beforeSha,
  createdAt: runs
    .map((r) => r.createdAt)
    .sort()
    .at(-1),
  screens,
};

const html = fs
  .readFileSync(new URL('./report-template.html', import.meta.url), 'utf8')
  .replace('/*__DATA__*/null', JSON.stringify(data).replaceAll('<', '\\u003c'));
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`✅ 보고서: ${path.join(outDir, 'index.html')} (화면 ${screens.length}개)`);
