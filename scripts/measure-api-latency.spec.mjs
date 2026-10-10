import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { API_URL_ENV, resolveApiBaseUrl } from './measure-api-latency.mjs';

const script = fileURLToPath(new URL('./measure-api-latency.mjs', import.meta.url));

test('API base URL이 없으면 기본 호스트로 가지 않고 오류를 낸다', () => {
  assert.throws(() => resolveApiBaseUrl({ argv: ['node', script], env: {} }), /--api <url>/);
  assert.throws(
    () => resolveApiBaseUrl({ argv: ['node', script, '--api'], env: { [API_URL_ENV]: ' ' } }),
    /API base URL이 필요합니다/,
  );
});

test('--api 인자나 환경 변수로 준 URL만 쓰고, 인자가 우선한다', () => {
  assert.equal(
    resolveApiBaseUrl({ argv: ['node', script, '--api', 'http://localhost:3000/'], env: {} }),
    'http://localhost:3000',
  );
  assert.equal(
    resolveApiBaseUrl({
      argv: ['node', script],
      env: { [API_URL_ENV]: 'https://api.example.test' },
    }),
    'https://api.example.test',
  );
  assert.equal(
    resolveApiBaseUrl({
      argv: ['node', script, '--api', 'http://localhost:3000'],
      env: { [API_URL_ENV]: 'https://api.example.test' },
    }),
    'http://localhost:3000',
  );
});

test('http(s)가 아니거나 형식이 틀린 URL은 거부한다', () => {
  assert.throws(
    () => resolveApiBaseUrl({ argv: ['node', script, '--api', 'not-a-url'], env: {} }),
    /형식이 올바르지 않습니다/,
  );
  assert.throws(
    () => resolveApiBaseUrl({ argv: ['node', script, '--api', 'ftp://api.example.test'], env: {} }),
    /http\(s\)/,
  );
  assert.throws(
    () => resolveApiBaseUrl({ argv: ['node', script, '--api', '--health-count', '3'], env: {} }),
    /형식이 올바르지 않습니다/,
  );
});

test('CLI는 URL 없이 실행하면 사용법을 출력하고 exit 2로 끝난다', () => {
  const result = spawnSync(process.execPath, [script, '--health-count', '1'], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /API base URL이 필요합니다/);
  assert.match(result.stderr, /usage: node scripts\/measure-api-latency\.mjs --api <url>/);
  assert.equal(result.stdout, '');
});
