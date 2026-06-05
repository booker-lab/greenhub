import { expect, type Page, test } from '@playwright/test';

const BASE = process.env.CONSUMER_FIXTURE_BASE ?? 'http://localhost:3010';
const AUTO_INTERVAL_BUFFER_MS = 5_500;

async function openCarousel(page: Page) {
  await page.goto(`${BASE}/e2e/hero-banner`);
  const carousel = page.locator('[aria-label="프로모션 배너"]');
  await expect(carousel).toBeVisible();
  await page.mouse.move(800, 600);
  return carousel;
}

async function expectActive(page: Page, index: number) {
  await expect(page.getByRole('tab', { name: `${index}번째 배너 보기` })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

test.describe('소비자 다중 배너 캐러셀 fixture', () => {
  test('기간 배너 최신순 뒤에 기본 배너를 배치한다', async ({ page }) => {
    const carousel = await openCarousel(page);

    await expect(page.getByRole('tab')).toHaveCount(3);
    await expectActive(page, 1);
    await expect
      .poll(() =>
        carousel
          .locator('[data-banner-id]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-banner-id'))),
      )
      .toEqual(['scheduled_new', 'scheduled_old', 'main_hero']);
  });

  test('약 5초 뒤 다음 배너로 자동 전환한다', async ({ page }) => {
    await openCarousel(page);

    await expectActive(page, 1);
    await page.waitForTimeout(AUTO_INTERVAL_BUFFER_MS);
    await expectActive(page, 2);
  });

  test('좌우 버튼과 점 인디케이터 조작 뒤 자동 전환을 멈춘다', async ({ page }) => {
    await openCarousel(page);

    await page.getByRole('button', { name: '다음 배너' }).click();
    await expectActive(page, 2);
    await page.getByRole('tab', { name: '3번째 배너 보기' }).click();
    await expectActive(page, 3);
    await page.waitForTimeout(AUTO_INTERVAL_BUFFER_MS);
    await expectActive(page, 3);
  });

  test('hover와 focus 중에는 자동 전환을 일시 정지한다', async ({ page }) => {
    const carousel = await openCarousel(page);

    await carousel.hover();
    await page.waitForTimeout(AUTO_INTERVAL_BUFFER_MS);
    await expectActive(page, 1);

    await page.mouse.move(0, 0);
    await page.waitForTimeout(AUTO_INTERVAL_BUFFER_MS);
    await expectActive(page, 2);

    await page.getByRole('button', { name: '다음 배너' }).focus();
    await page.waitForTimeout(AUTO_INTERVAL_BUFFER_MS);
    await expectActive(page, 2);
  });
});
