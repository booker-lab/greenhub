// UI 교체 대조 화면(/dev/ui-compare)의 짝을 기계로 비교한다.
// 행마다 왼쪽(Mantine)·오른쪽(@greenhub/ui) 칸에서 같은 순서의 부품(칸의 첫 요소, 입력칸, 글자를 가진 요소)을 짝지어
// 칸 안 위치·크기와 계산된 스타일을 비교하고, 두 칸을 찍어 픽셀 차이 수를 센다.
//
//   node scripts/visual/compare-cells.mjs [--base http://127.0.0.1:3202] [--viewport 768] [--only 행이름] [--out 칸 이미지 폴더]
//
// 화면 확인 하네스(start.mjs seller)를 먼저 띄운다. 차이가 있는 행이 하나라도 있으면 종료 코드 1이다.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparePixels } from './compare.mjs';
import { decodePng, encodePng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const base = option('base', 'http://127.0.0.1:3202');
const width = Number(option('viewport', '768'));
const outDir = option('out', '');
const only = option('only', '');

// 상자(root·button·input·svg)는 면·테두리·모서리를, 글자는 글꼴·색과 글자 자체의 위치(Range 상자)를 비교한다.
// 줄 높이·여백은 위치 비교로 드러나므로 따로 보지 않는다(구조가 달라도 같은 모양이면 같다고 본다).
const BOX_KEYS = [
  'backgroundColor',
  'borderTopWidth',
  'borderTopStyle',
  'borderTopColor',
  'borderTopLeftRadius',
  'opacity',
  'boxShadow',
];
const TEXT_KEYS = [
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'textTransform',
  'textDecorationLine',
  'color',
];
const KEYS_BY_KIND = {
  root: BOX_KEYS,
  button: BOX_KEYS,
  svg: ['color', 'opacity'],
  input: [...BOX_KEYS, ...TEXT_KEYS],
  textarea: [...BOX_KEYS, ...TEXT_KEYS],
  select: [...BOX_KEYS, ...TEXT_KEYS],
};

const { chromium } = createRequire(path.join(ROOT, 'apps/e2e/package.json'))('@playwright/test');
const browser = await chromium.launch(
  process.env.GREENHUB_VISUAL_CHROMIUM
    ? { executablePath: process.env.GREENHUB_VISUAL_CHROMIUM }
    : {},
);
const context = await browser.newContext({ viewport: { width, height: 900 } });
const csrf = await (await context.request.get(`${base}/api/auth/csrf`)).json();
await context.request.post(`${base}/api/auth/callback/credentials`, {
  maxRedirects: 0,
  form: {
    email: 'visual@local.test',
    password: 'visual',
    csrfToken: csrf.csrfToken,
    callbackUrl: base,
    json: 'true',
  },
});
const page = await context.newPage();
const response = await page.goto(`${base}/dev/ui-compare`, { waitUntil: 'networkidle' });
if (response?.status() !== 200) {
  console.error(`❌ /dev/ui-compare 응답 ${response?.status()}`);
  await browser.close();
  process.exit(1);
}
await page.evaluate(() => document.fonts.ready);

const rows = await page.evaluate(
  ({ keysByKind, textKeys }) => {
    const round = (n) => +n.toFixed(2);
    const relBox = (r, base) => ({
      x: round(r.x - base.x),
      y: round(r.y - base.y),
      w: round(r.width),
      h: round(r.height),
    });
    const styleOf = (el, keys, h) => {
      const cs = getComputedStyle(el);
      const out = Object.fromEntries(keys.map((k) => [k, cs[k]]));
      if (out.borderTopWidth === '0px') {
        delete out.borderTopStyle;
        delete out.borderTopColor;
      }
      // 높이 절반 이상의 모서리는 모두 알약 모양으로 같다(32px·1000px·9999px).
      if (out.borderTopLeftRadius && Number.parseFloat(out.borderTopLeftRadius) >= h / 2)
        out.borderTopLeftRadius = 'pill';
      return out;
    };
    const parts = (cell) => {
      const base = cell.getBoundingClientRect();
      const out = [];
      const root = cell.firstElementChild;
      const boxPart = (el, kind) => {
        const r = el.getBoundingClientRect();
        out.push({ kind, box: relBox(r, base), style: styleOf(el, keysByKind[kind], r.height) });
      };
      boxPart(root, 'root');
      out[0].tag = root.tagName;
      for (const el of cell.querySelectorAll('button, input, textarea, select, svg')) {
        const kind = el.tagName.toLowerCase();
        // 보이지 않는 input(Switch·Checkbox의 숨은 체크박스)은 구현마다 다르고 화면에 그려지지 않는다.
        const box = el.getBoundingClientRect();
        if (kind === 'input' && (getComputedStyle(el).opacity === '0' || box.width <= 1)) continue;
        if (el !== root || kind !== 'button') boxPart(el, kind);
      }
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        // textarea·select 안 글자는 입력칸 상자와 픽셀로 비교한다. 글자 노드의 범위 좌표는 화면 위치가 아니다.
        if (['TEXTAREA', 'OPTION'].includes(n.parentElement?.tagName ?? '')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        out.push({
          kind: `text:${n.textContent.trim()}`,
          box: relBox(r, base),
          style: styleOf(n.parentElement, textKeys, r.height),
        });
      }
      return out;
    };
    return [...document.querySelectorAll('[data-compare-row]')].map((row) => ({
      name: row.getAttribute('data-compare-row'),
      hasInput: !!row.querySelector('input'),
      mantine: parts(row.querySelector('[data-compare-cell="mantine"]')),
      ui: parts(row.querySelector('[data-compare-cell="ui"]')),
    }));
  },
  { keysByKind: KEYS_BY_KIND, textKeys: TEXT_KEYS },
);

// 픽셀은 같은 자리에서 비교한다. 같은 Mantine 요소도 가로 위치가 다른 칸에 놓으면 모서리 안티앨리어싱이
// 달라지기 때문이다(실측: Mantine 버튼을 복제해 오른쪽 칸에 놓아도 15픽셀이 다르다).
// 오른쪽 칸을 그대로 찍고, 그 칸의 내용을 왼쪽(Mantine) 내용의 복제로 바꿔 한 번 더 찍은 뒤 되돌린다.
// 칸 하나만 찍으면 스크롤 위치에 따라 고정 머리띠가 칸을 가리므로 전체 화면 기준(fullPage)으로 잘라 찍는다.
const cellBox = (name) =>
  page.evaluate((name) => {
    const cell = document.querySelector(`[data-compare-row="${name}"] > [data-compare-cell="ui"]`);
    const r = cell.getBoundingClientRect();
    return {
      x: Math.round(r.x + window.scrollX),
      y: Math.round(r.y + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }, name);
const swapCell = (name, toMantine) =>
  page.evaluate(
    ([name, toMantine]) => {
      const row = document.querySelector(`[data-compare-row="${name}"]`);
      const ui = row.querySelector('[data-compare-cell="ui"]');
      if (toMantine) {
        ui.__original = [...ui.childNodes];
        const mantine = row.querySelector('[data-compare-cell="mantine"]');
        ui.replaceChildren(...[...mantine.childNodes].map((n) => n.cloneNode(true)));
      } else {
        ui.replaceChildren(...ui.__original);
      }
    },
    [name, toMantine],
  );
const shotCell = async (clip) =>
  decodePng(await page.screenshot({ fullPage: true, clip, animations: 'disabled' }));

let failed = 0;
for (const row of rows) {
  if (only && row.name !== only) continue;
  const problems = [];
  // 같은 종류끼리 순서대로 짝짓는다(root·button·input·svg·글자). 칸의 첫 요소(root)는 태그가 같을 때만 비교한다
  // 칸의 첫 요소는 입력칸이 있는 행에서만 건너뛴다(Mantine TextInput의 감싸는 div ↔ Input은 안쪽 input끼리 비교한다).
  const uiPool = [...row.ui];
  for (const m of row.mantine) {
    const i = uiPool.findIndex((u) => u.kind === m.kind);
    if (i < 0) {
      problems.push(`  ${m.kind}: @greenhub/ui 쪽에 없음`);
      continue;
    }
    const [u] = uiPool.splice(i, 1);
    if (m.kind === 'root' && row.hasInput) continue;
    const diffs = [];
    for (const k of ['x', 'y', 'w', 'h']) {
      if (Math.abs(m.box[k] - u.box[k]) > 0.5) diffs.push(`${k} ${m.box[k]} ↔ ${u.box[k]}`);
    }
    for (const k of new Set([...Object.keys(m.style), ...Object.keys(u.style)])) {
      if (m.style[k] !== u.style[k]) diffs.push(`${k} ${m.style[k]} ↔ ${u.style[k]}`);
    }
    if (diffs.length) problems.push(`  ${m.kind}: ${diffs.join(' · ')}`);
  }
  for (const u of uiPool) problems.push(`  ${u.kind}: Mantine 쪽에 없음`);

  const clip = await cellBox(row.name);
  const b = await shotCell(clip);
  await swapCell(row.name, true);
  const a = await shotCell(clip);
  await swapCell(row.name, false);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const name = row.name.replace(/[^\w가-힣]+/g, '_');
    fs.writeFileSync(path.join(outDir, `${name}.mantine.png`), encodePng(a));
    fs.writeFileSync(path.join(outDir, `${name}.ui.png`), encodePng(b));
  }
  const pixels = comparePixels(a, b, { tolerance: 1 });
  const pixelNote = pixels.sameSize ? `픽셀 차이 ${pixels.diffCount}` : '칸 크기 다름';
  if (problems.length || !pixels.sameSize || pixels.diffCount) failed += 1;
  console.log(
    `${problems.length || !pixels.sameSize || pixels.diffCount ? '✗' : '✓'} ${row.name} (${pixelNote})`,
  );
  for (const p of problems) console.log(p);
}

await browser.close();
console.log(failed ? `\n차이 있는 행 ${failed}개 (폭 ${width})` : `\n모든 행이 같다 (폭 ${width})`);
process.exit(failed ? 1 : 0);
