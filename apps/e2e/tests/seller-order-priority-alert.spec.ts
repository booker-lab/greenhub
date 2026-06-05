import { expect, type Page, test } from '@playwright/test';
import { expectNoHorizontalOverflow, setMobileViewport } from './_helpers/responsive';

const BASE = process.env.SELLER_FIXTURE_BASE ?? 'http://localhost:3011';

async function openFixture(page: Page) {
  await page.goto(`${BASE}/e2e/order-priority-alert`);
  await expect(page.getByRole('region', { name: '빈 알림 상태' })).toBeVisible();
}

test.describe('판매자 주문 우선 알림 fixture', () => {
  test('빈 메타에서는 알림 없이 탭과 빈 상태를 유지한다', async ({ page }) => {
    await openFixture(page);

    const emptyState = page.getByRole('region', { name: '빈 알림 상태' });
    await expect(emptyState.getByText('먼저 확인할 주문이 있습니다')).not.toBeVisible();
    await expect(emptyState.getByText('현재 해당 주문이 없습니다')).toBeVisible();
    for (const label of ['처리 필요', '대기 중', '배송 중', '완료', '취소']) {
      await expect(emptyState.getByRole('button', { name: label })).toBeVisible();
    }
  });

  test('모바일에서 알림 텍스트와 두 버튼이 가로 넘침 없이 수납된다', async ({ page }) => {
    await setMobileViewport(page);
    await openFixture(page);

    const alertState = page.getByRole('region', { name: '알림 노출 상태' });
    await expect(alertState.getByText('먼저 확인할 주문이 있습니다')).toBeVisible();
    await expect(alertState.getByText('처리 필요 2건 · 지연 3건')).toBeVisible();
    await expect(alertState.getByRole('button', { name: '처리 필요 보기' })).toBeVisible();
    await expect(alertState.getByRole('button', { name: '지연 주문 보기' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
