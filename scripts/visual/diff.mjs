// 작업 전·후 캡처 픽셀 비교 — shots.mjs가 찍은 두 label을 비교해 "차이 난 화면 목록"을 낸다.
//
//   node scripts/visual/diff.mjs [app] --before <label> --after <label> [--allow <허용 목록.json>] [--out <폴더>]
//                                [--tolerance 0]
//
// 판정 규칙은 compare.mjs. 통과 조건: 모든 화면이 같음(same)이거나, 차이가 허용 목록의 영역 안에만 있음(allowed).
// 정상 판정을 통과하지 못한 캡처·한쪽에만 있는 화면·기준 시각이나 화면 폭이 다른 묶음은 실패다.
// 결과: <폴더>/report.json과 차이 난 화면의 표시 이미지(<id>-<viewport>.diff.png, 빨강 = 설명 안 된 차이, 노랑 = 허용한 차이).
// 실패하면 종료 코드 1이다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareRuns, parseAllowances } from './compare.mjs';
import { decodePng, encodePng } from './png.mjs';

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const args = process.argv.slice(2);
const appName =
  args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'seller';
const beforeLabel = option('before', null);
const afterLabel = option('after', null);
if (!beforeLabel || !afterLabel) {
  console.error('❌ --before <label> --after <label>을 지정하세요.');
  process.exit(1);
}
const tolerance = Number(option('tolerance', '0'));
if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
  console.error('❌ --tolerance는 0~255 정수입니다.');
  process.exit(1);
}
const shotsRoot = path.join(os.tmpdir(), 'greenhub-visual', appName, 'shots');
const outDir = option(
  'out',
  path.join(os.tmpdir(), 'greenhub-visual', appName, 'diff', `${beforeLabel}..${afterLabel}`),
);

function readRun(label) {
  const file = path.join(shotsRoot, label, 'manifest.json');
  if (!fs.existsSync(file)) {
    console.error(`❌ 캡처 기록이 없습니다: ${file} (먼저 shots.mjs ${appName} --label ${label})`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

let allowances = [];
const allowFile = option('allow', null);
if (allowFile) {
  try {
    allowances = parseAllowances(JSON.parse(fs.readFileSync(allowFile, 'utf8')));
  } catch (error) {
    console.error(`❌ 허용 목록을 읽지 못했습니다(${allowFile}): ${error.message}`);
    process.exit(1);
  }
}

const runs = { before: readRun(beforeLabel), after: readRun(afterLabel) };
const labels = { before: beforeLabel, after: afterLabel };
const images = new Map();
function loadImage(run, shot) {
  const file = path.join(shotsRoot, labels[run], shot.file);
  if (!images.has(file)) images.set(file, decodePng(fs.readFileSync(file)));
  return images.get(file);
}

const result = compareRuns(runs.before, runs.after, loadImage, allowances, { tolerance });

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const screen of result.screens) {
  if (!screen.mask || screen.diffCount === 0) continue;
  // 표시 이미지: after 캡처를 흐리게 깔고 차이 픽셀을 칠한다.
  const after = loadImage('after', screen);
  const data = new Uint8Array(after.data.length);
  for (let p = 0; p < screen.mask.length; p++) {
    const i = p * 4;
    const kind = screen.mask[p];
    if (kind === 2) data.set([230, 30, 30, 255], i);
    else if (kind === 1) data.set([240, 190, 0, 255], i);
    else {
      for (let c = 0; c < 3; c++) data[i + c] = 255 - Math.round((255 - after.data[i + c]) * 0.25);
      data[i + 3] = 255;
    }
  }
  fs.writeFileSync(
    path.join(outDir, `${screen.id}-${screen.viewport}.diff.png`),
    encodePng({ width: after.width, height: after.height, data }),
  );
}

const report = {
  app: appName,
  before: { label: beforeLabel, gitSha: runs.before.gitSha, visualNow: runs.before.visualNow },
  after: { label: afterLabel, gitSha: runs.after.gitSha, visualNow: runs.after.visualNow },
  tolerance,
  ok: result.ok,
  problems: result.problems,
  unusedAllowances: result.unusedAllowances,
  screens: result.screens.map(({ mask, ...rest }) => rest),
};
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

const counts = {};
for (const s of result.screens) counts[s.status] = (counts[s.status] ?? 0) + 1;
console.log(
  `${result.ok ? '✅' : '❌'} ${appName} ${beforeLabel} → ${afterLabel}: ${Object.entries(counts)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')}${tolerance ? ` (tolerance ${tolerance})` : ''}`,
);
for (const p of result.problems) console.log(`   - ${p}`);
for (const a of result.unusedAllowances) {
  console.log(
    `   ⚠️ 쓰이지 않은 허용 항목: ${a.screen}${a.viewport ? `(${a.viewport})` : ''} — ${a.reason}`,
  );
}
console.log(`📁 ${outDir}`);
if (!result.ok) process.exitCode = 1;
