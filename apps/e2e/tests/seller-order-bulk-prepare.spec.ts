import { expect, type Page, test } from '@playwright/test';
import {
  expectNoElementHorizontalOverflow,
  expectNoHorizontalOverflow,
  setMobileViewport,
} from './_helpers/responsive';

const BASE = process.env.SELLER_FIXTURE_BASE ?? 'http://localhost:3011';

async function openFixture(page: Page) {
  await page.goto(`${BASE}/e2e/order-bulk-prepare`);
  await expect(page.getByRole('region', { name: '일괄 준비 모바일 상태' })).toBeVisible();
}

test.describe('판매자 주문 일괄 준비 fixture', () => {
  test('모바일에서 액션 바, 카드, 체크박스, 확인 모달이 가로 넘침 없이 수납된다', async ({
    page,
  }) => {
    await setMobileViewport(page);
    await openFixture(page);

    const state = page.getByRole('region', { name: '일괄 준비 모바일 상태' });
    const actionBar = state.getByLabel('준비 가능 1건').locator('xpath=ancestor::div[2]');
    const card = state.getByText('주문 20260603-000167').locator('xpath=ancestor::div[1]');

    await expect(state.getByLabel('준비 가능 1건')).toBeVisible();
    await expect(state.getByLabel('20260603-000167 일괄 준비 선택')).toBeVisible();
    await expect(state.getByText('모바일 카드 폭 검증용 긴 상품명')).toBeVisible();
    await expectNoElementHorizontalOverflow(actionBar);
    await expectNoElementHorizontalOverflow(card);
    await expectNoHorizontalOverflow(page);

    await state.getByLabel('20260603-000167 일괄 준비 선택').check();
    await state.getByRole('button', { name: '준비 시작' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('선택한 주문을 준비 중으로 바꿀까요?')).toBeVisible();
    await expect(dialog.getByText('1건의 주문을 한 번에 준비 중으로 변경합니다.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '준비 시작' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '취소' })).toBeVisible();
    await expectNoElementHorizontalOverflow(dialog);
    await expectNoHorizontalOverflow(page);
  });
});
