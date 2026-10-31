// 창(Dialog) 초점 순회 검사 — start.mjs로 띄운 화면 확인 서버에서 fixture 화면의 steps로 창을 연 뒤,
// Tab·Shift+Tab을 눌러 초점이 창 안에서만 도는지, Esc로 닫으면 초점이 여는 버튼으로 돌아오는지 본다.
//
//   node scripts/visual/focus-trap.mjs [app] [--only id,id] [--viewports mobile,tablet,desktop] [--label <이름>] [--set compare]
//
// 대상: steps가 있는 화면 중 steps 뒤에 모달 창(role=dialog·alertdialog, aria-modal="false" 제외)이 열려 있는 화면. id가 modal-로 시작하는데
// 창이 열리지 않으면 실패다. 판정(하나라도 어기면 종료 코드 1):
//   - 창이 열린 뒤 초점을 받은 요소(focusin)가 모두 창 안이다. 다음 프레임에 창 안으로 되돌아가는 초점 가드도 실패로 본다.
//   - Tab만 눌러 출발 요소로 돌아오고(한 바퀴), Shift+Tab만 눌러도 돌아온다. 누를 때마다 두 프레임 뒤 초점이 창 안이다.
//   - 창이 열린 직후 첫 초점은 창 안 data-autofocus 요소, 없으면 창 안 첫 Tab 대상이다(Mantine Modal과 같은 약속).
//   - 창에 aria-modal="true"가 있고, 본문(data-slot=dialog-body·sheet-body)이 있으면 aria-describedby가 창 안 요소를 가리킨다.
//   - Esc로 창이 닫히고 초점이 창을 연 요소로 돌아온다(--set compare처럼 주소로 연 창은 여는 요소가 없어 빼고 기록한다).
// 결과: %TEMP%/greenhub-visual/<app>/focus/<label>.json
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS, RUNTIME_FILE } from './apps.mjs';
import { VISUAL_NOW_ENV } from './clock.mjs';
import { runSteps } from './steps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// shots.mjs와 같은 폭(키보드 동작은 폭과 무관해 보이지만 좁은 화면에서만 보이는 버튼이 있다).
const VIEWPORTS = {
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  tablet: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
// 한 방향으로 한 바퀴를 도는 데 허용하는 최대 입력 수 = 창 안 Tab 대상 수 × 4 + 10.
// 날짜·시각 입력칸은 칸 안의 연·월·일 등에서도 Tab이 멈추므로 대상 수보다 많이 눌러야 한 바퀴가 된다.
const MAX_PRESS = (count) => count * 4 + 10;
// 스스로 비모달이라고 밝힌 창(aria-modal="false", 예: Base UI 알림 toast)은 초점을 가두지 않는 것이 맞아 뺀다.
// aria-modal이 없는 창은 모달로 보고 검사한다(그래서 aria-modal 누락은 실패로 잡힌다).
const DIALOG = ':is([role="dialog"],[role="alertdialog"]):not([aria-modal="false"])';

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
if (!runtime.visualNow) {
  console.error(
    `❌ ${runtimeFile}에 기준 시각이 없습니다. node scripts/visual/start.mjs ${appName} 를 먼저 실행하세요.`,
  );
  process.exit(1);
}
if (runtime.prod) {
  console.error(
    '❌ 운영 빌드(--prod) 서버는 지원하지 않습니다(로컬 로그인 사용). next dev로 띄워 주세요.',
  );
  process.exit(1);
}
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
const only = option('only', '')?.split(',').filter(Boolean) ?? [];
const label = option('label', 'current');
const fixture = await import(`./fixtures/${appName}.mjs`);
// --set compare: UI 교체 대조 화면(fixture compareScreens). 주소(?open=…)로 창을 여는 화면도 검사한다.
const screenSet = option('set', '');
if (screenSet && screenSet !== 'compare') {
  console.error(`❌ 지원하지 않는 화면 묶음: ${screenSet} (가능: compare)`);
  process.exit(1);
}
const screens = (screenSet ? (fixture.compareScreens ?? []) : fixture.screens).filter(
  (s) => (screenSet || s.steps) && (!only.length || only.includes(s.id)),
);
const missingIds = only.filter((id) => !screens.some((s) => s.id === id));
if (missingIds.length) {
  console.error(`❌ 검사 대상 화면이 아닙니다: ${missingIds.join(', ')}`);
  process.exit(1);
}

const { chromium } = createRequire(path.join(ROOT, 'apps/e2e/package.json'))('@playwright/test');
const apiBase = `http://${new URL(base).hostname}:${app.apiPort}`;
const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]', new URL(base).hostname]);

async function newContext(browser, viewportName) {
  const context = await browser.newContext({
    ...VIEWPORTS[viewportName],
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) && !allowedHosts.has(u.hostname)) {
      return route.abort();
    }
    return route.continue();
  });
  // 창이 열린 뒤 초점을 받은 모든 요소를 기록한다(다음 프레임에 되돌아가는 초점도 남도록 focusin으로 센다).
  await context.addInitScript((dialogSelector) => {
    const log = [];
    Object.defineProperty(window, '__FOCUS_LOG__', { value: log });
    document.addEventListener(
      'focusin',
      (event) => {
        const dialog = [...document.querySelectorAll(dialogSelector)].find((d) =>
          d.checkVisibility(),
        );
        if (!dialog) return;
        const el = event.target;
        log.push({
          inside: dialog.contains(el),
          what: window.__describeFocus__?.(el) ?? String(el?.nodeName),
        });
      },
      true,
    );
  }, DIALOG);
  return context;
}

async function login(context) {
  const csrf = await (await context.request.get(`${base}/api/auth/csrf`)).json();
  await context.request.post(`${base}/api/auth/callback/credentials`, {
    maxRedirects: 0,
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

/** 페이지 안에서 쓰는 도우미(창 찾기·Tab 대상 목록·요소 설명)를 심는다. */
async function installHelpers(page) {
  await page.evaluate((dialogSelector) => {
    window.__openDialog__ = () =>
      [...document.querySelectorAll(dialogSelector)].find((d) => d.checkVisibility());
    window.__describeFocus__ = (el) => {
      if (!el || el === document.body) return 'BODY';
      if (el.hasAttribute?.('data-base-ui-focus-guard')) return 'span[data-base-ui-focus-guard]';
      const name =
        el.getAttribute('aria-label') ||
        el.labels?.[0]?.textContent ||
        el.textContent ||
        el.getAttribute('placeholder') ||
        '';
      return `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''} "${name.trim().replace(/\s+/g, ' ').slice(0, 30)}"`;
    };
    // 브라우저 Tab 순서의 근사: 보이고 켜져 있으며 tabindex가 0 이상인 요소. 같은 이름 라디오는 선택된 것(없으면 첫째)만.
    window.__tabbables__ = (root) => {
      const candidates = root.querySelectorAll(
        'a[href],button,input:not([type="hidden"]),select,textarea,[tabindex],[contenteditable]:not([contenteditable="false"])',
      );
      const seenRadio = new Set();
      return [...candidates].filter((el) => {
        if (
          el.matches(':disabled') ||
          el.tabIndex < 0 ||
          el.closest('[inert]') ||
          !el.checkVisibility({ visibilityProperty: true })
        )
          return false;
        if (el.type === 'radio' && el.name) {
          const group = [
            ...root.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`),
          ];
          const pick = group.find((r) => r.checked) ?? group[0];
          if (pick !== el || seenRadio.has(el.name)) return false;
          seenRadio.add(el.name);
        }
        return true;
      });
    };
  }, DIALOG);
}

const twoFrames = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** 지금 초점이 창 안인지와 설명. */
const activeState = (page) =>
  page.evaluate(() => {
    const dialog = window.__openDialog__();
    const el = document.activeElement;
    return { inside: !!dialog && dialog.contains(el), what: window.__describeFocus__(el) };
  });

/** 한 방향으로 출발 요소에 돌아올 때까지 누른다. */
async function cycle(page, key, count) {
  const start = await page.evaluateHandle(() => document.activeElement);
  const visited = [];
  for (let i = 0; i < MAX_PRESS(count); i++) {
    await page.keyboard.press(key);
    await twoFrames(page);
    const state = await activeState(page);
    visited.push(state);
    if (!state.inside)
      return { ok: false, visited, problem: `${key} ${i + 1}번째에 창 밖(${state.what})` };
    if (await start.evaluate((el) => el === document.activeElement)) return { ok: true, visited };
  }
  return {
    ok: false,
    visited,
    problem: `${key} ${MAX_PRESS(count)}번 안에 출발 요소로 돌아오지 않음`,
  };
}

/** step이 가리키는 요소(창을 여는 요소)의 locator. */
function stepLocator(page, step) {
  if (step.click) return page.getByText(step.click, { exact: true }).first();
  if (step.clickSelector) return page.locator(step.clickSelector).first();
  if (step.press)
    return page.getByRole('button', { name: step.press, exact: true }).nth(step.nth ?? 0);
  return null;
}

async function checkScreen(context, screen) {
  const page = await context.newPage();
  const problems = [];
  const result = { id: screen.id, problems };
  try {
    await fetch(`${apiBase}/__scenario?name=${encodeURIComponent(screen.scenario ?? '')}`, {
      method: 'POST',
    });
    await page.clock.setFixedTime(new Date(runtime.visualNow));
    await page.goto(`${base}${screen.path}`, { waitUntil: 'load', timeout: 180_000 });
    await page
      .waitForLoadState('networkidle', { timeout: runtime.emulator ? 2_000 : 15_000 })
      .catch(() => {});
    await page.waitForTimeout(runtime.emulator ? 2_000 : 800);
    await installHelpers(page);
    if (screen.click) {
      await page.getByText(screen.click, { exact: true }).first().click();
      await page.waitForTimeout(800);
    }
    // 창이 열린 직후 첫 초점(data-autofocus가 있으면 그 요소, 없으면 첫 Tab 대상).
    const checkInitialFocus = async () => {
      const first = await page.evaluate(() => {
        const dialog = window.__openDialog__();
        const expected =
          dialog.querySelector('[data-autofocus]') ?? window.__tabbables__(dialog)[0];
        return {
          ok: document.activeElement === expected,
          expected: window.__describeFocus__(expected),
          actual: window.__describeFocus__(document.activeElement),
          autofocus: !!dialog.querySelector('[data-autofocus]'),
        };
      });
      result.initialFocus = first;
      if (!first.ok) problems.push(`첫 초점이 ${first.expected}가 아니라 ${first.actual}`);
    };
    let opener = null;
    // 주소(?open=…)로 이미 열린 창. 여는 요소가 없으므로 닫기·초점 복귀는 검사하지 않는다(아래).
    const openedByUrl = await page.evaluate(() => !!window.__openDialog__());
    if (openedByUrl) await checkInitialFocus();
    for (const step of screen.steps ?? []) {
      const wasOpen = await page.evaluate(() => !!window.__openDialog__());
      const locator = wasOpen ? null : stepLocator(page, step);
      const openerHandle = locator
        ? await locator.elementHandle({ timeout: 2_000 }).catch(() => null)
        : null;
      const note = await runSteps(page, [step]);
      if (note) {
        problems.push(`steps 실패: ${note}`);
        return result;
      }
      if (!wasOpen && (await page.evaluate(() => !!window.__openDialog__()))) {
        opener = openerHandle;
        await checkInitialFocus();
      }
    }
    const open = await page.evaluate(() => !!window.__openDialog__());
    if (!open) {
      if (screen.id.startsWith('modal-')) problems.push('창이 열리지 않음');
      else result.skipped = '창 없음';
      return result;
    }
    const aria = await page.evaluate(() => {
      const dialog = window.__openDialog__();
      const describedby = dialog.getAttribute('aria-describedby');
      const target = describedby ? document.getElementById(describedby) : null;
      return {
        modal: dialog.getAttribute('aria-modal'),
        describedby,
        describedInside: !!target && dialog.contains(target),
        hasBody: !!dialog.querySelector('[data-slot="dialog-body"],[data-slot="sheet-body"]'),
        count: window.__tabbables__(dialog).length,
      };
    });
    result.aria = aria;
    if (aria.modal !== 'true') problems.push(`aria-modal=${aria.modal}`);
    if ((aria.hasBody || aria.describedby) && !aria.describedInside) {
      problems.push(`aria-describedby가 창 안 본문을 가리키지 않음(${aria.describedby})`);
    }
    // steps가 입력칸에 적은 뒤라면 초점이 그 칸에 있다. 창 안이 아니면 순회 전에 실패로 본다.
    const before = await activeState(page);
    if (!before.inside) problems.push(`순회 전 초점이 창 밖(${before.what})`);
    else {
      await page.evaluate(() => {
        window.__FOCUS_LOG__.length = 0;
      });
      const forward = await cycle(page, 'Tab', aria.count);
      const backward = await cycle(page, 'Shift+Tab', aria.count);
      result.tab = forward.visited.map((v) => v.what);
      result.shiftTab = backward.visited.map((v) => v.what);
      if (!forward.ok) problems.push(forward.problem);
      if (!backward.ok) problems.push(backward.problem);
      const escaped = await page.evaluate(() =>
        window.__FOCUS_LOG__.filter((e) => !e.inside).map((e) => e.what),
      );
      if (escaped.length)
        problems.push(`창 밖으로 간 초점 ${escaped.length}번: ${[...new Set(escaped)].join(', ')}`);
    }
    // 주소로 연 창(대조 화면)은 여는 요소가 없고 닫기 처리기도 없어(open 고정) 닫기·복귀를 검사하지 않는다.
    if (openedByUrl) {
      result.closeCheck = '주소로 연 창: 닫기·초점 복귀 검사 안 함';
      return result;
    }
    // Esc로 닫고 초점이 창을 연 요소로 돌아오는지.
    await page.keyboard.press('Escape');
    await page
      .waitForFunction(() => !window.__openDialog__(), null, { timeout: 3_000 })
      .catch(() => {});
    if (await page.evaluate(() => !!window.__openDialog__()))
      problems.push('Esc로 창이 닫히지 않음');
    else if (!opener) problems.push('창을 연 요소를 찾지 못함');
    else {
      await page.waitForTimeout(300);
      const returned = await opener.evaluate((el) => {
        const target = el.closest('button,a,[tabindex],input') ?? el;
        return {
          ok: target === document.activeElement || target.contains(document.activeElement),
          what: window.__describeFocus__(document.activeElement),
        };
      });
      result.returnFocus = returned.what;
      if (!returned.ok) problems.push(`닫은 뒤 초점이 여는 요소가 아니라 ${returned.what}`);
    }
    return result;
  } catch (error) {
    problems.push(`검사 오류: ${String(error.message).slice(0, 200)}`);
    return result;
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({
  ...(process.env.GREENHUB_VISUAL_CHROMIUM
    ? { executablePath: process.env.GREENHUB_VISUAL_CHROMIUM }
    : {}),
});
const report = {
  app: appName,
  label,
  visualNow: runtime.visualNow,
  createdAt: new Date().toISOString(),
  results: [],
};
try {
  for (const viewportName of viewportNames) {
    const context = await newContext(browser, viewportName);
    await login(context);
    for (const screen of screens) {
      const r = { viewport: viewportName, ...(await checkScreen(context, screen)) };
      report.results.push(r);
      if (r.skipped) continue;
      console.log(
        `${r.problems.length ? '❌' : '✅'} ${viewportName} ${screen.id}${r.problems.length ? ` · ${r.problems.join(' · ')}` : ''}`,
      );
    }
    await context.close();
  }
} finally {
  await fetch(`${apiBase}/__scenario?name=`, { method: 'POST' }).catch(() => {});
  await browser.close();
}

const outFile = path.join(os.tmpdir(), 'greenhub-visual', appName, 'focus', `${label}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
const checked = report.results.filter((r) => !r.skipped);
const failed = checked.filter((r) => r.problems.length);
console.log(`\n📁 ${outFile} (창 ${checked.length}개 검사, 실패 ${failed.length}개)`);
if (!checked.length) {
  console.error('❌ 검사한 창이 없습니다.');
  process.exitCode = 1;
} else if (failed.length) process.exitCode = 1;
