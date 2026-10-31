// 화면 자동 캡처 — start.mjs로 띄운 화면 확인 서버에서 fixtures/<app>.mjs의 screens를 모바일·태블릿·데스크톱으로 찍는다.
//
//   node scripts/visual/shots.mjs [app] [--label after] [--only id,id] [--base http://127.0.0.1:3202] [--set benchmark]
//                                 [--viewports mobile,tablet,desktop]
//     --set benchmark  fixtures의 benchmarkScreens(팔도감 벤치마킹 비교 화면)를 찍는다
//     --set compare    fixtures의 compareScreens(UI 교체 대조 화면: Mantine ↔ @greenhub/ui)를 찍는다
//
// 결과: %TEMP%/greenhub-visual/<app>/shots/<label>/ 아래 PNG와 manifest.json.
// manifest에는 화면별 최종 주소·콘솔 오류·fixture 없는 API 경로와 정상 판정(soundness.mjs)이 남는다(report.mjs·diff.mjs가 읽는다).
// 브라우저 시계는 start.mjs가 정한 기준 시각(clock.mjs)에 고정하고, CSS 애니메이션은 멈춘 채 찍는다.
// 정상 판정을 통과하지 못한 화면이 하나라도 있으면 종료 코드 1이다.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APPS, DEV_RESTARTS_FILE, RUNTIME_FILE } from './apps.mjs';
import { VISUAL_NOW_ENV } from './clock.mjs';
import { expectedPathOf, shotProblems } from './soundness.mjs';
import { runSteps } from './steps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const VIEWPORTS = {
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  // 판매자 1100px 이하 배치(상단바·메뉴 시트)를 보는 폭.
  tablet: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const args = process.argv.slice(2);
const appName =
  args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'seller';
const app = APPS[appName];
if (!app) {
  console.error(`❌ 지원하지 않는 앱: ${appName}`);
  process.exit(1);
}
const base = option('base', `http://127.0.0.1:${app.port}`);
const runtimeFile = path.join(os.tmpdir(), 'greenhub-visual', appName, RUNTIME_FILE);
const devRestartsFile = path.join(os.tmpdir(), 'greenhub-visual', appName, DEV_RESTARTS_FILE);
/** start.mjs가 센 next dev 메모리 재시작 횟수(파일이 없으면 0). */
function devRestartCount() {
  try {
    return Number(fs.readFileSync(devRestartsFile, 'utf8')) || 0;
  } catch {
    return 0;
  }
}
// 바로 앞 화면을 찍기 시작할 때의 재시작 횟수. 재시작 직후 다음 화면은 다시 컴파일하는 동안 덜 그려진(로딩)
// 채로 찍힐 수 있어서(판매자 회차 상세 데스크톱에서 확인) 이 화면과 바로 앞 화면 사이의 재시작을 모두 본다.
let restartsAtPreviousStart = devRestartCount();
const runtime = fs.existsSync(runtimeFile) ? JSON.parse(fs.readFileSync(runtimeFile, 'utf8')) : {};
const apiBase = `http://${new URL(base).hostname}:${app.apiPort}`;
if (!runtime.visualNow) {
  console.error(
    `❌ ${runtimeFile}에 기준 시각이 없습니다. node scripts/visual/start.mjs ${appName} 를 다시 실행하세요.`,
  );
  process.exit(1);
}
// fixture가 import될 때 서버(start.mjs)와 같은 기준 시각으로 회차 일정을 만든다.
process.env[VISUAL_NOW_ENV] = runtime.visualNow;
const viewportNames = option('viewports', Object.keys(VIEWPORTS).join(','))
  .split(',')
  .filter(Boolean);
for (const name of viewportNames) {
  if (!VIEWPORTS[name]) {
    console.error(`❌ 지원하지 않는 화면 폭: ${name} (가능: ${Object.keys(VIEWPORTS).join(', ')})`);
    process.exit(1);
  }
}
const label = option('label', 'current');
const only = option('only', '')?.split(',').filter(Boolean) ?? [];
const outDir = option('out', path.join(os.tmpdir(), 'greenhub-visual', appName, 'shots', label));

const fixture = await import(`./fixtures/${appName}.mjs`);
const { browserStorage, wishStorage } = fixture;
const screenSet = option('set', '');
const SCREEN_SETS = { benchmark: 'benchmarkScreens', compare: 'compareScreens' };
if (screenSet && !SCREEN_SETS[screenSet]) {
  console.error(
    `❌ 지원하지 않는 화면 묶음: ${screenSet} (가능: ${Object.keys(SCREEN_SETS).join(', ')})`,
  );
  process.exit(1);
}
const allScreens = screenSet ? (fixture[SCREEN_SETS[screenSet]] ?? []) : fixture.screens;
const screens = only.length ? allScreens.filter((s) => only.includes(s.id)) : allScreens;

const { chromium } = createRequire(path.join(ROOT, 'apps/e2e/package.json'))('@playwright/test');

// 서버가 떠 있는지 먼저 확인한다.
try {
  await fetch(`${apiBase}/__log`);
  await fetch(`${base}/login`, { redirect: 'manual' });
} catch {
  console.error(
    `❌ 화면 확인 서버가 꺼져 있습니다. 먼저 node scripts/visual/start.mjs ${appName} 를 실행하세요.`,
  );
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const HARNESS_NOISE = /firebase-token|@firebase\/|net::ERR_FAILED/;
// 앱이 부르는 가짜 API 주소(운영 빌드는 https://127.0.0.2). 예전 runtime.json에는 apiUrl이 없을 수 있다.
const apiOrigin = new URL(runtime.apiUrl ?? apiBase).origin;
const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]', new URL(base).hostname]);
// 운영 빌드(start.mjs --prod)의 가짜 API는 https://127.0.0.2다.
if (runtime.prod) allowedHosts.add(new URL(runtime.apiUrl).hostname);

async function newContext(browser, viewportName) {
  const context = await browser.newContext({
    ...VIEWPORTS[viewportName],
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  // 브라우저에서도 로컬 밖으로 나가는 요청은 막는다.
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) && !allowedHosts.has(u.hostname)) {
      return route.abort();
    }
    return route.continue();
  });
  return context;
}

// 운영 빌드는 로컬 로그인(Credentials)이 꺼져 있다. 앱의 jwt 콜백이 로그인 직후 만드는 토큰과 같은 모양을
// start.mjs의 AUTH_SECRET으로 암호화해 세션 쿠키로 넣는다. 앱은 이후 요청마다 가짜 API /auth/session으로
// 다시 검증한다(revalidateSessionToken). 필드는 세 앱 jwt 콜백의 합집합이다(쓰지 않는 필드는 앱이 무시한다).
// http 주소라 쿠키 이름에 __Secure- 접두사가 붙지 않는다. Auth.js는 쿠키 이름을 암호화 salt로 쓴다.
const SESSION_COOKIE = 'authjs.session-token';
async function forgeSessionCookie(context) {
  // 앱이 쓰는 next-auth와 같은 설치본을 쓴다(새 의존성 없음).
  const jwtModule = createRequire(path.join(ROOT, app.dir, 'package.json')).resolve(
    'next-auth/jwt',
  );
  const { encode } = await import(pathToFileURL(jwtModule).href);
  const { user } = fixture;
  const token = {
    name: user.name,
    email: user.email,
    sub: user.id,
    id: user.id,
    role: user.role,
    storeId: user.storeId,
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    accessTokenExpires: Date.now() + 55 * 60 * 1000,
  };
  const value = await encode({
    token,
    secret: runtime.authSecret,
    salt: SESSION_COOKIE,
    maxAge: 60 * 60,
  });
  const { hostname } = new URL(base);
  await context.addCookies([
    { name: SESSION_COOKIE, value, domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
}

/** Credentials 로그인(가짜 API /auth/login 경유). 세션 쿠키는 컨텍스트에 저장된다. 운영 빌드는 쿠키를 직접 넣는다. */
async function login(context) {
  if (runtime.prod) {
    await forgeSessionCookie(context);
    const session = await (await context.request.get(`${base}/api/auth/session`))
      .json()
      .catch(() => ({}));
    if (!session?.user?.accessToken) throw new Error('세션 쿠키 로그인 실패(운영 빌드)');
    return;
  }
  const csrf = await (await context.request.get(`${base}/api/auth/csrf`)).json();
  await context.request.post(`${base}/api/auth/callback/credentials`, {
    maxRedirects: 0,
    // 소비자 앱은 E2E 헤더 게이트를 통과해야 한다(start.mjs가 만든 1회용 값).
    headers: runtime.e2eSecret ? { 'x-e2e-test-token': runtime.e2eSecret } : {},
    form: {
      email: 'visual@local.test',
      password: 'visual',
      csrfToken: csrf.csrfToken,
      callbackUrl: base,
      json: 'true',
    },
  });
  const session = await (await context.request.get(`${base}/api/auth/session`))
    .json()
    .catch(() => ({}));
  if (!session?.user?.accessToken) throw new Error('가짜 계정 로그인 실패');
}

/** 찍은 PNG를 돌려준다. */
async function capture(page, { viewportOnly = false } = {}) {
  if (viewportOnly) {
    // 아래에서 올라오는 시트처럼 지금 보이는 화면이 중요한 경우는 화면 크기 그대로 찍는다.
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    await page.waitForTimeout(400);
    return page.screenshot({ animations: 'disabled', caret: 'hide' });
  }
  // 하단 고정 메뉴가 본문 중간에 겹쳐 찍히지 않도록, 화면 높이를 문서 높이로 늘려 한 장으로 찍는다.
  const size = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({
    width: size.width,
    height: Math.min(Math.max(size.height, height), 6000),
  });
  // next dev 개발 표시(N·Issues 배지)가 하단 메뉴를 가리지 않게 숨긴다.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.waitForTimeout(400);
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await page.setViewportSize(size);
  return png;
}

/** 화면 하나를 새 페이지로 열어 찍는다. */
async function shootOnce(context, screen, viewportName) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    // Firebase 토큰(503)·Firestore 접속 차단(ERR_FAILED)은 하네스 한계라 기록하지 않는다.
    const where = m.location()?.url ?? '';
    if (
      m.type() !== 'error' ||
      where.includes('/auth/firebase-token') ||
      HARNESS_NOISE.test(m.text())
    )
      return;
    // 리소스 404처럼 문장만으로 원인을 알 수 없는 오류는 주소를 붙인다.
    errors.push(`${m.text().slice(0, 300)}${where ? ` (${where.slice(0, 200)})` : ''}`);
  });
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));
  // 앱이 가짜 API에 닿지 못한 요청(TLS·연결 실패)은 콘솔 오류 없이 "불러오지 못했습니다" 화면이 될 수 있다.
  // 찍기 전까지 실패한 API 요청을 모은다. 이동·닫기로 취소된 요청(ERR_ABORTED)은 빼고, 찍은 뒤는 보지 않는다.
  const failed = [];
  let captured = false;
  page.on('requestfailed', (request) => {
    const text = request.failure()?.errorText ?? '';
    if (captured || text === 'net::ERR_ABORTED' || !request.url().startsWith(apiOrigin)) return;
    failed.push(`${new URL(request.url()).pathname} ${text}`);
  });
  // storage: true인 화면은 열기 전에 fixture의 브라우저 저장소 값(장바구니 등)을 넣는다.
  if (screen.storage && browserStorage) {
    await page.addInitScript((stored) => {
      for (const [k, v] of Object.entries(stored.localStorage ?? {})) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(stored.sessionStorage ?? {}))
        sessionStorage.setItem(k, v);
    }, browserStorage);
  }
  // wish: true인 화면은 이번 회차 찜(브라우저 저장)을 넣고 연다.
  if (screen.wish && wishStorage) {
    await page.addInitScript((stored) => {
      for (const [k, v] of Object.entries(stored.localStorage ?? {})) localStorage.setItem(k, v);
    }, wishStorage);
  }
  // portone: 결제창(PortOne SDK)을 stub으로 바꾼다. SDK는 window.PortOne이 이미 있으면 CDN 스크립트를
  // 불러오지 않고 그것을 쓴다(@portone/browser-sdk). 호출 인자는 기록해 작업 전·후를 비교한다(parity.mjs).
  // 'success'는 결제 완료 응답, 'cancel'은 결제창에서 취소한 응답(code·message)을 돌려준다.
  // 로컬 E2E의 installPortOneBrowserStub(apps/e2e/tests/_helpers/round-direct.ts)과 같은 방식이다.
  if (screen.portone) {
    await page.addInitScript((mode) => {
      const calls = [];
      Object.defineProperty(window, '__VISUAL_PORTONE_CALLS__', { value: calls });
      Object.defineProperty(window, 'PortOne', {
        value: {
          async requestPayment(request) {
            calls.push(JSON.parse(JSON.stringify(request)));
            if (mode === 'cancel') {
              return {
                code: 'FAILURE_TYPE_PG',
                message: '사용자가 결제를 취소하였습니다.',
                paymentId: request.paymentId,
                transactionType: 'PAYMENT',
              };
            }
            return {
              paymentId: request.paymentId,
              transactionType: 'PAYMENT',
              txId: `visual-${request.paymentId}`,
            };
          },
        },
      });
    }, screen.portone);
  }
  // scenario: 그 화면을 열 때만 가짜 API 경로를 바꾼다.
  await fetch(`${apiBase}/__scenario?name=${encodeURIComponent(screen.scenario ?? '')}`, {
    method: 'POST',
  });
  await fetch(`${apiBase}/__log/reset`, { method: 'POST' });
  // 카운트다운·"오늘" 같은 시각 글자가 캡처마다 달라지지 않게 브라우저 시계를 기준 시각에 고정한다.
  await page.clock.setFixedTime(new Date(runtime.visualNow));
  const t0 = Date.now();
  const restartsAtStart = devRestartCount();
  await page.goto(`${base}${screen.path}`, { waitUntil: 'load', timeout: 180_000 });
  // 데이터 요청이 끝나고 화면이 안정될 때까지 잠시 기다린다.
  // 에뮬레이터 모드는 Firestore 구독이 연결을 계속 열어 두어 networkidle이 오지 않으므로 짧게 기다린다.
  await page
    .waitForLoadState('networkidle', { timeout: runtime.emulator ? 2_000 : 15_000 })
    .catch(() => {});
  await page.waitForTimeout(runtime.emulator ? 2_000 : 800);
  // click: 주소로 열 수 없는 화면 안 상태(탭 등)는 찍기 전에 그 글자를 가진 요소를 누른다.
  if (screen.click) {
    await page.getByText(screen.click, { exact: true }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  const stepNote = screen.steps ? await runSteps(page, screen.steps) : null;
  const png = await capture(page, { viewportOnly: screen.viewport === true });
  captured = true;
  // 접근성 의미(역할·이름·상태)를 남긴다. 링크가 버튼이 되는 것 같은 회귀는 픽셀이 같아도 여기서 드러난다.
  const aria = await page
    .locator('body')
    .ariaSnapshot({ timeout: 10_000 })
    .catch((e) => `ariaSnapshot 실패: ${e.message}`);
  const portoneCalls = screen.portone
    ? await page.evaluate(() => window.__VISUAL_PORTONE_CALLS__ ?? []).catch(() => null)
    : undefined;
  // 브라우저 저장소(장바구니 담기 등 서버에 보내지 않는 동작의 결과).
  const storage = await page
    .evaluate(() => {
      const dump = (store) =>
        Object.fromEntries(
          Object.keys(store)
            .sort()
            .map((key) => [key, store.getItem(key)]),
        );
      return { localStorage: dump(localStorage), sessionStorage: dump(sessionStorage) };
    })
    .catch(() => null);
  const log = await (await fetch(`${apiBase}/__log`)).json();
  // 이 화면에서 앱이 보낸 쓰기 요청(본문 포함). 작업 전·후가 같아야 한다(parity.mjs).
  const writes = log
    .filter((e) => e.kind === 'write')
    .map(({ method, path: p, query, body }) => ({ method, path: p, query, body }));
  const missing = [...new Set(log.filter((e) => e.kind === 'missing').map((e) => e.path))];
  const shot = {
    id: screen.id,
    group: screen.group,
    title: screen.title,
    path: screen.path,
    viewport: viewportName,
    file: `${screen.id}-${viewportName}.png`,
    finalPath: new URL(page.url()).pathname,
    missing,
    writes,
    storage,
    ...(portoneCalls !== undefined ? { portoneCalls } : {}),
    aria: `${screen.id}-${viewportName}.aria.yml`,
    // expectedErrors: 화면이 일부러 만든 오류 응답(주문 거절 409 등)에 브라우저가 남기는 리소스 오류 줄만 뺀다.
    errors: [...new Set(errors)].filter(
      (text) => !(screen.expectedErrors ?? []).some((pattern) => new RegExp(pattern).test(text)),
    ),
    failed: [...new Set(failed)],
    ...(stepNote ? { stepNote } : {}),
    // Firestore를 직접 구독하는 화면은 에뮬레이터 없이는 데이터 없이 찍힌다(셀러 앱은 운영 빌드에서 로컬 Firebase를 거절).
    ...(screen.firestore && !runtime.emulator
      ? { unsupported: 'Firestore 에뮬레이터 없음(운영 빌드·--phone)' }
      : {}),
    // 이 화면이나 바로 앞 화면을 찍는 사이 next dev가 메모리 재시작을 했으면 연결 오류나 덜 그려진 화면일 수 있다.
    ...(devRestartCount() !== restartsAtPreviousStart
      ? { devRestarted: 'next dev 메모리 재시작 중·직후 촬영(이 화면만 다시 찍는다)' }
      : {}),
    ms: Date.now() - t0,
  };
  restartsAtPreviousStart = restartsAtStart;
  await page.close();
  return { shot, png, aria };
}

let gitSha = null;
try {
  gitSha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
} catch {
  /* git 없음 */
}

const manifest = {
  app: appName,
  label,
  base,
  gitSha,
  createdAt: new Date().toISOString(),
  visualNow: runtime.visualNow,
  viewports: viewportNames,
  shots: [],
};
// Playwright 버전과 설치된 브라우저가 다른 환경(예: 클라우드 세션의 /opt/pw-browsers/chromium)에서는
// GREENHUB_VISUAL_CHROMIUM으로 실행 파일을 지정한다.
// --disable-partial-raster: Chromium은 바뀐 영역만 다시 래스터하는데, 그리는 이력에 따라 글자·둥근 모서리의
// 안티앨리어싱이 채널 2~40만큼 달라져 같은 커밋 두 번 촬영이 어긋났다(기사 배송 보류 버튼·알림 화면, 컨텍스트마다
// 약 5~15%). 끄면 20번 중 20번 같고 결과는 기본 렌더의 다수 쪽과 같다(2026-10-30 실측).
// 운영 빌드(start.mjs --prod)의 가짜 API 인증서는 브라우저 전체에서 그 공개키 지문으로만 믿는다.
// Playwright ignoreHTTPSErrors는 서비스워커(PWA)가 대신 보내는 요청에는 걸리지 않아, 서비스워커가 붙은 화면에서
// API 요청이 TLS 오류로 실패한다(주문을 불러오지 못한 화면이 찍힌다). 서비스워커는 운영과 같게 막지 않는다.
const browser = await chromium.launch({
  ...(process.env.GREENHUB_VISUAL_CHROMIUM
    ? { executablePath: process.env.GREENHUB_VISUAL_CHROMIUM }
    : {}),
  args: [
    '--disable-partial-raster',
    ...(runtime.prod ? [`--ignore-certificate-errors-spki-list=${runtime.apiCertSpki}`] : []),
  ],
});
try {
  for (const viewportName of viewportNames) {
    const authed = await newContext(browser, viewportName);
    await login(authed);
    const guest = await newContext(browser, viewportName);
    for (const screen of screens) {
      const context = screen.auth === false ? guest : authed;
      const { shot, png, aria } = await shootOnce(context, screen, viewportName);
      fs.writeFileSync(path.join(outDir, shot.file), png);
      fs.writeFileSync(path.join(outDir, shot.aria), aria);
      shot.problems = shotProblems(shot, expectedPathOf(screen));
      shot.sound = shot.problems.length === 0;
      manifest.shots.push(shot);
      console.log(
        `${shot.sound ? '✅' : '⚠️'} ${viewportName} ${screen.id} (${shot.ms}ms)${shot.sound ? '' : ` · ${shot.problems.join(' · ')}`}`,
      );
    }
    await authed.close();
    await guest.close();
  }
} finally {
  await fetch(`${apiBase}/__scenario?name=`, { method: 'POST' }).catch(() => {});
  await browser.close();
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const unsound = manifest.shots.filter((s) => !s.sound);
console.log(`\n📁 ${outDir} (${manifest.shots.length}장, 기준 시각 ${runtime.visualNow})`);
if (unsound.length) {
  console.error(
    `⚠️ 정상 판정을 통과하지 못한 캡처 ${unsound.length}장: ${unsound.map((s) => `${s.id}(${s.viewport})`).join(', ')}`,
  );
  process.exitCode = 1;
}
