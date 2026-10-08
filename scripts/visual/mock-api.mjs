// 화면 확인용 가짜 API 서버.
// 앱별 fixture 모듈(fixtures/<app>.mjs)의 조회 경로만 응답하고, 외부로 나가는 코드는 없다.
// 쓰기 요청(POST/PATCH/PUT/DELETE, /auth/* 제외)은 기록하고, fixture에 같은 메서드 경로가 있으면 그 응답을,
// 없으면 200 {}을 돌려준다(예: 장바구니 검증처럼 화면이 응답 내용을 읽는 POST).
import fs from 'node:fs';
import http from 'node:http';

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string[]} opts.hosts 바인딩할 주소(루프백·Tailscale 등 명시한 곳만)
 * @param {string[]} opts.allowedOrigins CORS 허용 origin(앱 dev 서버 주소)
 * @param {{ user: object, routes: Array<[string, RegExp, Function]> }} opts.fixtures
 * @param {string} opts.logFile 요청 기록(JSON lines)
 * @param {(() => string) | null} [opts.firebaseToken] 있으면 /auth/firebase-token이 이 값(Auth 에뮬레이터용
 *   커스텀 토큰)을 평문으로 돌려준다. 앱은 응답을 res.text()로 읽어 signInWithCustomToken에 넘긴다.
 */
export function startMockApi({
  port,
  hosts,
  allowedOrigins,
  fixtures,
  logFile,
  firebaseToken = null,
}) {
  const log = [];
  const record = (entry) => {
    const line = { at: new Date().toISOString(), ...entry };
    log.push(line);
    try {
      fs.appendFileSync(logFile, `${JSON.stringify(line)}\n`);
    } catch {
      /* 기록 실패는 무시 */
    }
  };

  const corsHeaders = (req) => {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.includes(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    };
  };

  const send = (req, res, status, body, delayMs = 0) => {
    const go = () => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...corsHeaders(req),
      });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (delayMs) setTimeout(go, delayMs);
    else go();
  };

  const readBody = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
      });
      req.on('end', () => resolve(data));
    });

  const { user, routes } = fixtures;

  async function handler(req, res) {
    const url = new URL(req.url, `http://localhost:${port}`);
    const p = url.pathname;
    const m = req.method;

    if (m === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req),
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }

    // 하네스 내부 조회용 — 요청 기록
    if (p === '/__log' && m === 'GET') return send(req, res, 200, log);
    if (p === '/__log/reset' && m === 'POST') {
      log.length = 0;
      return send(req, res, 200, { ok: true });
    }

    const body = m === 'GET' || m === 'HEAD' ? '' : await readBody(req);

    // ── 인증: 어떤 계정·비밀번호든 fixture 사용자로 로그인된다 ──
    if (p === '/auth/login' && m === 'POST') {
      record({ kind: 'auth', method: m, path: p });
      return send(req, res, 200, {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user,
      });
    }
    if (p === '/auth/session' && m === 'GET') {
      return send(req, res, 200, { id: user.id, role: user.role, storeId: user.storeId });
    }
    if (p === '/auth/refresh' && m === 'POST') {
      record({ kind: 'auth', method: m, path: p });
      return send(req, res, 200, {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      });
    }
    if (p === '/auth/firebase-token' && m === 'GET') {
      if (firebaseToken) {
        record({ kind: 'auth', method: m, path: p });
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders(req) });
        return res.end(firebaseToken());
      }
      // 에뮬레이터 없이 띄운 앱은 Firebase 로그인 자체를 시작하지 않게 실패로 응답한다.
      return send(req, res, 503, { message: '하네스: firebase-token 미지원' });
    }

    // ── fixture 경로 표에서 같은 메서드의 첫 일치 ──
    const isWrite = m !== 'GET' && m !== 'HEAD';
    for (const [method, pattern, handle] of routes) {
      if (method !== m) continue;
      const match = p.match(pattern);
      if (!match) continue;
      const out = handle({ url, params: match.slice(1).map(decodeURIComponent), body });
      const status = out.status ?? 200;
      record({ kind: isWrite ? 'write' : 'read', method: m, path: p, query: url.search, status });
      return send(req, res, status, out.body, out.delay ?? 0);
    }

    // ── fixture에 없는 쓰기 요청: 기록만 하고 200 ──
    if (isWrite) {
      record({ kind: 'write', method: m, path: p, query: url.search, body: body.slice(0, 500) });
      return send(req, res, 200, {});
    }

    record({ kind: 'missing', method: m, path: p, query: url.search, status: 404 });
    return send(req, res, 404, { message: `하네스 fixture 없음: ${p}` });
  }

  const servers = hosts.map((host) =>
    http
      .createServer(handler)
      .on('error', (e) => console.error(`[mock-api] ${host}:${port} 바인딩 실패: ${e.message}`))
      .listen(port, host),
  );
  return {
    log,
    close: () => {
      for (const s of servers) s.close();
    },
  };
}
