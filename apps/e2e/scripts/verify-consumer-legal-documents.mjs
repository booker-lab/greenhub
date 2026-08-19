import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

async function openPublicPage(page, path, expectedHeading) {
  const response = await page.goto(`${baseUrl}${path}`, {
    waitUntil: 'domcontentloaded',
  });

  assert.ok(response, `${path} 응답이 없습니다.`);
  assert.equal(response.status(), 200, `${path}가 HTTP 200이 아닙니다.`);
  assert.equal(
    new URL(page.url()).pathname,
    path,
    `${path}가 비로그인 상태에서 다른 경로로 이동했습니다.`,
  );
  await page.getByRole('heading', { level: 1, name: expectedHeading }).waitFor();
  await page.getByText('디어 오키드', { exact: true }).first().waitFor();
  await page.getByText('2026년 8월 19일', { exact: true }).first().waitFor();
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${label}에 가로 스크롤이 있습니다: ${JSON.stringify(dimensions)}`,
  );
}

async function assertLinkIsReachable(page, name) {
  const link = page.getByRole('link', { name, exact: true }).last();
  await link.scrollIntoViewIfNeeded();
  await link.waitFor({ state: 'visible' });

  const isTopmostAtCenter = await link.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    return document.elementsFromPoint(x, y).includes(element);
  });

  assert.equal(isTopmostAtCenter, true, `${name} 링크가 고정 UI에 가려졌습니다.`);
  return link;
}

async function verifyViewport(browser, viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const browserErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });

  try {
    const homeResponse = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    assert.ok(homeResponse, '홈 응답이 없습니다.');
    assert.equal(homeResponse.status(), 200, '홈이 HTTP 200이 아닙니다.');
    const privacyFooterLink = await assertLinkIsReachable(
      page,
      '개인정보처리방침',
    );
    await privacyFooterLink.click();
    await openPublicPage(page, '/privacy', '개인정보처리방침');
    await assertNoHorizontalOverflow(page, `${label} 개인정보처리방침`);

    const termsLink = await assertLinkIsReachable(page, '이용약관');
    await termsLink.click();
    await openPublicPage(page, '/terms', '이용약관');
    await assertNoHorizontalOverflow(page, `${label} 이용약관`);

    const privacyLink = await assertLinkIsReachable(page, '개인정보처리방침');
    await privacyLink.click();
    await openPublicPage(page, '/privacy', '개인정보처리방침');

    assert.deepEqual(browserErrors, [], `${label} 브라우저 오류가 발생했습니다.`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();

try {
  await verifyViewport(browser, { width: 1280, height: 900 }, '데스크톱');
  await verifyViewport(browser, { width: 375, height: 812 }, '모바일 375×812');
  console.log(`consumer 법적 문서 브라우저 검증 통과: ${baseUrl}`);
} finally {
  await browser.close();
}
