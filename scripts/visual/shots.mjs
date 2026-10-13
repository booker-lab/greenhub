// 화면 자동 캡처 — start.mjs로 띄운 화면 확인 서버에서 fixtures/<app>.mjs의 screens를 모바일·데스크톱으로 찍는다.
//
//   node scripts/visual/shots.mjs [app] [--label after] [--only id,id] [--base http://127.0.0.1:3202]
//
// 결과: %TEMP%/greenhub-visual/<app>/shots/<label>/ 아래 PNG와 manifest.json.
// manifest에는 화면별 최종 주소·콘솔 오류·fixture 없는 API 경로가 남는다(report.mjs가 읽는다).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS, RUNTIME_FILE } from './apps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const VIEWPORTS = {
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
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
const runtime = fs.existsSync(runtimeFile) ? JSON.parse(fs.readFileSync(runtimeFile, 'utf8')) : {};
const apiBase = `http://${new URL(base).hostname}:${app.apiPort}`;
const label = option('label', 'current');
const only = option('only', '')?.split(',').filter(Boolean) ?? [];
const outDir = option('out', path.join(os.tmpdir(), 'greenhub-visual', appName, 'shots', label));

const { screens: allScreens, browserStorage } = await import(`./fixtures/${appName}.mjs`);
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
const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]', new URL(base).hostname]);

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

/** Credentials 로그인(가짜 API /auth/login 경유). 세션 쿠키는 컨텍스트에 저장된다. */
async function login(context) {
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

async function capture(page, file) {
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
  await page.screenshot({ path: file });
  await page.setViewportSize(size);
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
  shots: [],
};
// Playwright 버전과 설치된 브라우저가 다른 환경(예: 클라우드 세션의 /opt/pw-browsers/chromium)에서는
// GREENHUB_VISUAL_CHROMIUM으로 실행 파일을 지정한다.
const browser = await chromium.launch(
  process.env.GREENHUB_VISUAL_CHROMIUM
    ? { executablePath: process.env.GREENHUB_VISUAL_CHROMIUM }
    : undefined,
);
try {
  for (const viewportName of Object.keys(VIEWPORTS)) {
    const authed = await newContext(browser, viewportName);
    await login(authed);
    const guest = await newContext(browser, viewportName);
    for (const screen of screens) {
      const context = screen.auth === false ? guest : authed;
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
        errors.push(m.text().slice(0, 300));
      });
      page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));
      // storage: true인 화면은 열기 전에 fixture의 브라우저 저장소 값(장바구니 등)을 넣는다.
      if (screen.storage && browserStorage) {
        await page.addInitScript((stored) => {
          for (const [k, v] of Object.entries(stored.localStorage ?? {}))
            localStorage.setItem(k, v);
          for (const [k, v] of Object.entries(stored.sessionStorage ?? {}))
            sessionStorage.setItem(k, v);
        }, browserStorage);
      }
      await fetch(`${apiBase}/__log/reset`, { method: 'POST' });
      const t0 = Date.now();
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
      const file = `${screen.id}-${viewportName}.png`;
      await capture(page, path.join(outDir, file));
      const log = await (await fetch(`${apiBase}/__log`)).json();
      const missing = [...new Set(log.filter((e) => e.kind === 'missing').map((e) => e.path))];
      manifest.shots.push({
        id: screen.id,
        group: screen.group,
        title: screen.title,
        path: screen.path,
        viewport: viewportName,
        file,
        finalPath: new URL(page.url()).pathname,
        missing,
        errors: [...new Set(errors)],
        ms: Date.now() - t0,
      });
      const mark = missing.length || errors.length ? '⚠️' : '✅';
      console.log(
        `${mark} ${viewportName} ${screen.id} (${Date.now() - t0}ms)${missing.length ? ` fixture 없음: ${missing.join(', ')}` : ''}`,
      );
      await page.close();
    }
    await authed.close();
    await guest.close();
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n📁 ${outDir} (${manifest.shots.length}장)`);
