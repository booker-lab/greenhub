// appAriaSnapshot이 Next.js 경로 안내만 빼고 앱이 그린 alert는 남기는지 실제 Chromium으로 확인한다(로컬 전용).
// 실행: GREENHUB_VISUAL_CHROMIUM=<chrome 경로> node --test scripts/visual/aria-snapshot.browser-check.mjs
// CI script specs(scripts/**/*.spec.mjs·*.test.mjs)는 Playwright 브라우저를 설치하지 않으므로 이 파일은 일부러
// .spec이 아닌 이름으로 둔다. 감추고 되돌리는 DOM 로직은 aria-snapshot.spec.mjs가 가짜 document로 CI에서 검증한다.
// 이 파일은 그 로직이 실제 Chromium의 ariaSnapshot에서도 경로 안내만 빼는지(aria-hidden이 shadow root까지 빠지는지) 본다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ARIA_EXCLUDED_TAGS, appAriaSnapshot } from './aria-snapshot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(ROOT, 'apps/e2e/package.json'))('@playwright/test');

// Next.js가 붙이는 경로 안내와 같은 모양: body 끝의 <next-route-announcer> + shadow root 안 role=alert·aria-live 요소.
const PAGE = (announcerAttrs = '') => `<!doctype html><html><head><title>t</title></head><body>
  <main>
    <h1>주문 결제</h1>
    <div role="alert">결제 수단을 골라 주세요</div>
    <button>결제하기</button>
  </main>
  <next-route-announcer ${announcerAttrs}></next-route-announcer>
  <script>
    // setContent는 같은 창에 문서를 다시 쓰므로 최상위 const를 두면 두 번째부터 재선언 오류가 난다. 블록으로 감싼다.
    {
      const host = document.querySelector('next-route-announcer');
      const root = host.attachShadow({ mode: 'open' });
      const live = document.createElement('div');
      live.setAttribute('aria-live', 'assertive');
      live.setAttribute('role', 'alert');
      live.textContent = '결제 확인 중...';
      root.appendChild(live);
    }
  </script>
</body></html>`;

describe('aria-snapshot(Chromium): Next.js 경로 안내만 빼고 찍는다', () => {
  let browser;
  let page;
  before(async () => {
    browser = await chromium.launch(
      process.env.GREENHUB_VISUAL_CHROMIUM
        ? { executablePath: process.env.GREENHUB_VISUAL_CHROMIUM }
        : {},
    );
    page = await browser.newPage();
  });
  after(async () => {
    await browser?.close();
  });

  it('빼지 않으면 경로 안내가 alert로 접근성 트리에 나온다(시험 페이지가 Next와 같은 모양인지 확인)', async () => {
    await page.setContent(PAGE());
    const raw = await page.locator('body').ariaSnapshot();
    assert.match(raw, /alert: 결제 확인 중\.\.\./);
  });

  it('경로 안내는 빠지고 앱이 그린 alert·제목·버튼은 남는다', async () => {
    await page.setContent(PAGE());
    // 시험 페이지가 이번에도 경로 안내를 실제로 만들었는지 먼저 확인한다.
    assert.match(await page.locator('body').ariaSnapshot(), /alert: 결제 확인 중\.\.\./);
    const { aria, routeAnnouncer } = await appAriaSnapshot(page);
    assert.doesNotMatch(aria, /결제 확인 중/);
    assert.match(aria, /- alert: 결제 수단을 골라 주세요/);
    assert.match(aria, /- heading "주문 결제"/);
    assert.match(aria, /- button "결제하기"/);
    assert.deepEqual(routeAnnouncer, ['결제 확인 중...']);
  });

  it('찍은 뒤 경로 안내의 aria-hidden을 원래대로 되돌린다(없던 것은 지우고, 있던 값은 남긴다)', async () => {
    await page.setContent(PAGE());
    await appAriaSnapshot(page);
    const state = await page.evaluate(() => {
      const host = document.querySelector('next-route-announcer');
      return { hidden: host.getAttribute('aria-hidden'), marks: host.getAttributeNames() };
    });
    assert.deepEqual(state, { hidden: null, marks: [] });

    await page.setContent(PAGE('aria-hidden="false"'));
    await appAriaSnapshot(page);
    const kept = await page.evaluate(() =>
      document
        .querySelector('next-route-announcer')
        .getAttributeNames()
        .map((n) => [n, document.querySelector('next-route-announcer').getAttribute(n)]),
    );
    assert.deepEqual(kept, [['aria-hidden', 'false']]);
  });

  it('경로 안내가 없는 화면은 그대로 찍고 빈 목록을 남긴다', async () => {
    await page.setContent('<!doctype html><body><div role="alert">앱 알림</div></body>');
    const { aria, routeAnnouncer } = await appAriaSnapshot(page);
    assert.match(aria, /- alert: 앱 알림/);
    assert.deepEqual(routeAnnouncer, []);
  });

  it('빼는 요소는 경로 안내 하나뿐이다', () => {
    assert.deepEqual(ARIA_EXCLUDED_TAGS, ['next-route-announcer']);
  });
});
