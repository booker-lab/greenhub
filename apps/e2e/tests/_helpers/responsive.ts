import { expect, type Locator, type Page } from '@playwright/test';

export async function setMobileViewport(page: Page) {
  await page.setViewportSize({ width: 375, height: 900 });
}

export async function expectAdminTableSwitchAtSm(page: Page) {
  await page.setViewportSize({ width: 767, height: 900 });
  await expect(page.locator('table')).not.toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.locator('table')).toBeVisible();
}

export async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

export async function expectNoElementHorizontalOverflow(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
}

export async function expectMobileRiskRefundModalFits(page: Page) {
  const deliveringCard = page
    .getByText('ORD-DEL-002')
    .locator('xpath=ancestor::*[contains(@class,"mantine-Paper-root")][1]');
  await deliveringCard.getByRole('button', { name: '강제환불' }).click();

  const dialog = page.getByRole('dialog', { name: '강제환불' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('배달 진행 후 환불입니다. 정산·고객 영향이 큽니다.');
  await expect(page.getByLabel('환불 사유')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '취소' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '환불 처리' })).toBeVisible();
  await expectNoElementHorizontalOverflow(dialog);
  await expectNoHorizontalOverflow(page);
}

export async function expectMobileTrackingRowsFit(page: Page) {
  const mobileCards = page.locator('.mantine-Paper-root:not(.mantine-visible-from-sm)');
  const deliveringCard = mobileCards.filter({ hasText: 'ORD-DEL-002' });
  const preparingCard = mobileCards.filter({ hasText: 'ORD-PRE-001' });

  await expect(deliveringCard).toContainText('스토어 store-ac…');
  await expect(deliveringCard).toContainText('송장');
  await expect(deliveringCard).toContainText('CJ대한통운');
  await expect(deliveringCard).toContainText('1234567890123456789012345678901234567890');
  await expect(preparingCard).toContainText('송장');
  await expect(preparingCard).toContainText('-');
  await expectNoElementHorizontalOverflow(deliveringCard);
  await expectNoHorizontalOverflow(page);
}
