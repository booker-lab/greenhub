// 화면 확인용 next dev의 외부 요청 차단 가드 — start.mjs가 NODE_OPTIONS=--require로 주입한다.
// 허용 호스트(루프백 + VISUAL_GUARD_ALLOW) 밖으로 가는 fetch·http(s)·net·tls 연결을 막고 기록한다.
// Google Fonts는 next/font가 개발 중 글꼴을 받아 오는 읽기 전용 경로라 허용한다.
const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');

const LOG = process.env.VISUAL_GUARD_LOG;
const ALLOW = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  ...(process.env.VISUAL_GUARD_ALLOW ?? '').split(',').filter(Boolean),
]);

function isAllowed(host) {
  if (host === undefined || host === null || host === '') return true; // IPC 경로 등
  return ALLOW.has(String(host).toLowerCase());
}

function record(kind, target) {
  if (!LOG) return;
  try {
    fs.appendFileSync(
      LOG,
      `${new Date().toISOString()} pid=${process.pid} BLOCK ${kind} ${target}\n`,
    );
  } catch {
    /* 기록 실패는 무시 */
  }
}

// 1) 전역 fetch
if (typeof globalThis.fetch === 'function') {
  const orig = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, init) {
    let url;
    try {
      url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
    } catch {
      return orig.call(this, input, init);
    }
    if (!isAllowed(url.hostname)) {
      record('fetch', `${url.protocol}//${url.host}${url.pathname}`);
      return Promise.reject(new TypeError(`화면 확인 가드: 외부 요청 차단 (${url.host})`));
    }
    return orig.call(this, input, init);
  };
}

// 2) net/tls 연결(http·https·undici 하위 경로 포함)
function hostFromArgs(args) {
  const a = args[0];
  if (a && typeof a === 'object') return a.host ?? a.hostname ?? (a.path ? undefined : 'localhost');
  if (typeof a === 'number') return typeof args[1] === 'string' ? args[1] : 'localhost';
  return undefined; // 문자열 = IPC 경로
}

for (const [mod, name] of [
  [net, 'connect'],
  [net, 'createConnection'],
  [tls, 'connect'],
]) {
  const orig = mod[name];
  mod[name] = function guardedConnect(...args) {
    const host = hostFromArgs(args);
    if (!isAllowed(host)) {
      record(`${mod === tls ? 'tls' : 'net'}.${name}`, String(host));
      const sock = new net.Socket();
      process.nextTick(() => sock.destroy(new Error(`화면 확인 가드: 외부 연결 차단 (${host})`)));
      return sock;
    }
    return orig.apply(this, args);
  };
}

// 3) http/https.request — 차단 기록을 읽기 쉽게 남기려고 따로 막는다.
for (const [mod, label] of [
  [http, 'http'],
  [https, 'https'],
]) {
  for (const fn of ['request', 'get']) {
    const orig = mod[fn];
    mod[fn] = function guardedRequest(...args) {
      let host;
      const a = args[0];
      try {
        if (typeof a === 'string') host = new URL(a).hostname;
        else if (a instanceof URL) host = a.hostname;
        else if (a && typeof a === 'object') host = a.hostname ?? a.host;
      } catch {
        /* 무시 */
      }
      if (host && !isAllowed(String(host).replace(/:\d+$/, ''))) {
        record(`${label}.${fn}`, String(host));
        const req = orig.call(this, { host: '127.0.0.1', port: 9, path: '/blocked' });
        process.nextTick(() => req.destroy(new Error(`화면 확인 가드: 외부 요청 차단 (${host})`)));
        return req;
      }
      return orig.apply(this, args);
    };
  }
}
