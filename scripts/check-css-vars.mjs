#!/usr/bin/env node
// 앱·UI 소스에서 쓰는 CSS 변수(var(--x))가 어딘가에 정의돼 있는지 확인한다.
// 정의되지 않은 변수는 조용히 무시돼 글꼴 굵기·크기·모서리가 기본값으로 바뀐다.
// 대체값을 준 var(--x, …)와 Mantine 런타임 변수(--mantine-*)는 검사하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_ROOTS = [
  'apps/consumer/src',
  'apps/seller/src',
  'apps/driver/src',
  'packages/ui/src',
];

function listSources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...listSources(full));
    } else if (/\.(tsx?|css)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function findUndefinedCssVars(sources) {
  const defined = new Set();
  const used = new Map();
  for (const { file, text } of sources) {
    for (const m of text.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) defined.add(m[1]);
    for (const m of text.matchAll(/['"](--[A-Za-z0-9-]+)['"]\s*:/g)) defined.add(m[1]);
    for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*(,)?/g)) {
      if (m[2] || m[1].startsWith('--mantine')) continue;
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(file);
    }
  }
  return [...used.entries()]
    .filter(([name]) => !defined.has(name))
    .map(([name, files]) => ({ name, files: [...files].sort() }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sources = SOURCE_ROOTS.flatMap((root) => listSources(path.join(ROOT, root))).map(
    (file) => ({ file: path.relative(ROOT, file), text: fs.readFileSync(file, 'utf8') }),
  );
  const missing = findUndefinedCssVars(sources);
  if (missing.length === 0) {
    console.log(`CSS 변수 검사 통과 (${sources.length}개 파일)`);
  } else {
    for (const { name, files } of missing)
      console.error(`정의되지 않은 CSS 변수 ${name}: ${files.join(', ')}`);
    process.exit(1);
  }
}
