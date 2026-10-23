#!/usr/bin/env node
// 앱의 node:test 파일(*.test.mjs)을 셸 차이 없이 같은 집합으로 실행한다.
//
// `node --test 'src/**/*.test.mjs'`는 Windows의 pnpm/npm 스크립트(cmd 셸)에서
// 작은따옴표가 벗겨지지 않아 0건 실행 후 통과한다. 또 `node --test`의 위치 인자는
// glob으로 해석돼 `[id]`·`[orderId]` 같은 경로를 직접 넘기면 빠진다.
// 그래서 파일 목록을 직접 모아 node:test run()에 경로 그대로 넘기고,
// 모은 파일이나 실행한 테스트가 0건이면 실패로 끝낸다.
//
// 사용: node <이 파일> <디렉터리> [접미사=.test.mjs]

import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { fileURLToPath } from 'node:url';

export function collectTestFiles(rootDir, suffix = '.test.mjs') {
  return readdirSync(rootDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.split(sep).includes('node_modules'))
    .sort();
}

async function main([rootDir, suffix = '.test.mjs']) {
  if (!rootDir) {
    console.error('사용: node scripts/run-node-tests.mjs <디렉터리> [접미사=.test.mjs]');
    process.exitCode = 2;
    return;
  }
  const files = collectTestFiles(resolve(rootDir), suffix);
  if (files.length === 0) {
    console.error(`${rootDir}에서 ${suffix} 파일을 찾지 못했다. 0건 실행은 실패로 본다.`);
    process.exitCode = 1;
    return;
  }

  let executed = 0;
  // 테스트가 없는 파일은 파일 경로 이름의 결과 1건으로 보고되므로 실행 건수에서 뺀다.
  const countTest = (event) => {
    if (event.details.type !== 'suite' && event.name !== event.file) executed += 1;
  };
  // `node --test` 기본값과 같은 동시 실행 수를 쓴다.
  const stream = run({ files, concurrency: Math.max(availableParallelism() - 1, 1) });
  stream.on('test:pass', countTest);
  stream.on('test:fail', (event) => {
    countTest(event);
    if (!event.todo) process.exitCode = 1;
  });
  stream.compose(spec).pipe(process.stdout);
  await new Promise((done) => stream.once('close', done));

  if (executed === 0) {
    console.error(
      `${files.length}개 파일에서 테스트를 1건도 실행하지 못했다. 0건 실행은 실패로 본다.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
