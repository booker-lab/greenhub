import { expect, type Page, test } from '@playwright/test';
import {
  expectNoElementHorizontalOverflow,
  expectNoHorizontalOverflow,
  setMobileViewport,
} from './_helpers/responsive';

const BASE = process.env.SELLER_FIXTURE_BASE ?? 'http://localhost:3011';

async function openFixture(page: Page) {
  await page.goto(`${BASE}/e2e/order-bulk-parcel-ship`);
  await expect(page.getByRole('region', { name: '일괄 택배 발송 모바일 상태' })).toBeVisible();
}

test.describe('판매자 주문 일괄 택배 발송 fixture', () => {
  test('모바일에서 액션 바, 카드, 송장 모달 행, 버튼이 가로 넘침 없이 수납된다', async ({
    page,
  }) => {
    await setMobileViewport(page);
    await openFixture(page);

    const state = page.getByRole('region', { name: '일괄 택배 발송 모바일 상태' });
    await expect(state.getByLabel('택배 발송 가능 2건')).toBeVisible();
    await expect(state.getByLabel('20260603-000174 일괄 택배 발송 선택')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await state.getByLabel('20260603-000174 일괄 택배 발송 선택').check();
    await state.getByRole('button', { name: '택배 발송', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('택배 일괄 발송')).toBeVisible();
    await expect(dialog.getByLabel('택배사 20260603-000174')).toBeVisible();
    await expect(dialog.getByLabel('운송장번호 20260603-000174')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '취소' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '1건 발송 완료' })).toBeDisabled();
    await expectNoElementHorizontalOverflow(dialog);
    await expectNoHorizontalOverflow(page);
  });

  test('부분 실패 시 성공 주문만 배송 완료로 바꾸고 실패 주문 선택을 유지한다', async ({
    page,
  }) => {
    await openFixture(page);

    const state = page.getByRole('region', { name: '일괄 택배 발송 모바일 상태' });
    await state.getByLabel('택배 발송 가능 2건').check();
    await expect(state.getByText('2건 선택')).toBeVisible();
    await state.getByRole('button', { name: '택배 발송', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('운송장번호 20260603-000174').fill('1234567890');
    await dialog.getByLabel('운송장번호 20260603-000173').fill('9876543210');
    await dialog.getByRole('button', { name: '2건 발송 완료' }).click();

    await expect(page.getByText('일부 주문만 처리됐습니다')).toBeVisible();
    await expect(page.getByText('성공 1건, 실패 1건')).toBeVisible();
    await expect(state.getByText('배송 완료')).toBeVisible();
    await expect(state.getByLabel('20260603-000174 일괄 택배 발송 선택')).toHaveCount(0);
    await expect(state.getByLabel('20260603-000173 일괄 택배 발송 선택')).toBeChecked();
    await expect(state.getByText('1건 선택')).toBeVisible();
  });
});
