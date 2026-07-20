import { expect, test } from '@playwright/test';
import { AUTH_STATE_PATH } from './_helpers/auth';

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr';

const ROUND_PRODUCT_ID = 'round-direct-product';
const ROUND_ORDER_ID = 'round-direct-order';

test.describe('Consumer 회차 직배송 공개 화면 계약', () => {
  test.fixme('홈은 현재 회차와 주문 마감, 화요일 배송 약속을 표시한다', async ({ page }) => {
    await page.goto(BASE);

    await expect(page.getByRole('heading', { name: /이번 주 판매/ })).toBeVisible();
    await expect(page.getByText(/주문 마감/)).toBeVisible();
    await expect(page.getByText(/화요일 오전 9시까지 문 앞 배송/)).toBeVisible();
  });

  test.fixme('홈은 현재·지난 회차 상품만 노출하고 공동구매 진입을 숨긴다', async ({ page }) => {
    await page.goto(BASE);

    await expect(page.getByRole('link', { name: /지난 회차/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /공동구매/ })).toHaveCount(0);
    await expect(page.getByText(/거점 픽업|택배/)).toHaveCount(0);
  });

  test.fixme('상품 상세은 회차 가격과 마감, 경기 이천 직접배송 고지를 표시한다', async ({
    page,
  }) => {
    await page.goto(`${BASE}/products/${ROUND_PRODUCT_ID}?round=round-open`);

    await expect(page.getByText(/회차 가격/)).toBeVisible();
    await expect(page.getByText(/주문 마감/)).toBeVisible();
    await expect(page.getByText(/경기 이천 직접배송/)).toBeVisible();
    await expect(page.getByText(/청약철회/)).toBeVisible();
  });

  test.fixme('상품 상세은 배송 방식·날짜·공동구매 선택 없이 회차 구매 동작만 제공한다', async ({
    page,
  }) => {
    await page.goto(`${BASE}/products/${ROUND_PRODUCT_ID}?round=round-open`);

    await expect(page.getByText(/배송 방법/)).toHaveCount(0);
    await expect(page.getByText(/배송 희망일/)).toHaveCount(0);
    await expect(page.getByText(/공동구매/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /장바구니 담기/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /바로 구매/ })).toBeVisible();
  });
});

test.describe('Consumer 회차 직배송 인증 화면 계약', () => {
  test.use({ storageState: AUTH_STATE_PATH });

  test.fixme('장바구니는 같은 회차 식별자의 상품만 한 주문으로 묶고 회차 가격을 표시한다', async ({
    page,
  }) => {
    await page.goto(`${BASE}/cart`);

    await expect(page.getByText(/이번 주 판매/)).toBeVisible();
    await expect(page.getByText(/같은 회차 상품/)).toBeVisible();
    await expect(page.getByText(/회차 가격/)).toBeVisible();
    await expect(page.getByText(/한 번에 결제/)).toBeVisible();
    await expect(page.getByText(/다른 회차 상품/)).toHaveCount(0);
  });

  test.fixme('장바구니는 변경·마감 상품을 남겨 알리고 결제 대상에서 제외한다', async ({ page }) => {
    await page.goto(`${BASE}/cart`);

    await expect(page.getByText(/가격이 변경/)).toBeVisible();
    await expect(page.getByText(/판매가 마감/)).toBeVisible();
    await expect(page.getByText(/결제 대상에서 제외/)).toBeVisible();
  });

  test.fixme('결제는 여러 회차 상품을 한 주문 요약과 한 번의 결제로 표시한다', async ({ page }) => {
    await page.goto(`${BASE}/checkout?from=cart`);

    await expect(page.getByRole('heading', { name: /주문 상품/ })).toBeVisible();
    await expect(page.getByText(/총 .*개 상품/)).toBeVisible();
    await expect(page.getByRole('button', { name: /결제하기/ })).toHaveCount(1);
  });

  test.fixme('결제는 전화번호·이천 주소·필수 고지와 선택 마케팅 동의를 구분한다', async ({
    page,
  }) => {
    await page.goto(`${BASE}/checkout?from=cart`);

    await expect(page.getByLabel(/배송 연락처/)).toBeVisible();
    await expect(page.getByText(/이천시 배송 가능 주소/)).toBeVisible();
    await expect(page.getByText(/필수 고지/)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /마케팅 정보 수신/ })).not.toBeChecked();
  });

  test.fixme('결제 직전 재검증 변경은 사용자 재확인 없이는 결제를 진행하지 않는다', async ({
    page,
  }) => {
    await page.goto(`${BASE}/checkout?from=cart`);

    await expect(page.getByText(/상품 정보가 변경/)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /변경 내용을 확인/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: /결제하기/ })).toBeDisabled();
  });

  test.fixme('배송 보류 주문 상세은 다중 상품과 재배송비 결제를 표시한다', async ({ page }) => {
    await page.goto(`${BASE}/mypage/orders/${ROUND_ORDER_ID}-held`);

    await expect(page.getByRole('heading', { name: /주문 상세/ })).toBeVisible();
    await expect(page.getByText(/외 .*개/)).toBeVisible();
    await expect(page.getByText(/배송 보류/)).toBeVisible();
    await expect(page.getByRole('button', { name: /재배송비 결제/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /배송 완료 사진/ })).toHaveCount(0);
  });

  test.fixme('배송 완료 주문 상세은 완료 상태와 배송 사진을 표시한다', async ({ page }) => {
    await page.goto(`${BASE}/mypage/orders/${ROUND_ORDER_ID}-delivered`);

    await expect(page.getByText(/배송 완료/)).toBeVisible();
    await expect(page.getByRole('img', { name: /배송 완료 사진/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /재배송비 결제/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /주문 취소/ })).toHaveCount(0);
  });

  test.fixme('주문 마감 전 활성 주문 상세만 주문 취소를 제공한다', async ({ page }) => {
    await page.goto(`${BASE}/mypage/orders/${ROUND_ORDER_ID}-accepted`);

    await expect(page.getByText(/주문 접수/)).toBeVisible();
    await expect(page.getByRole('button', { name: /주문 취소/ })).toBeVisible();
    await expect(page.getByText(/배송 보류/)).toHaveCount(0);
    await expect(page.getByRole('img', { name: /배송 완료 사진/ })).toHaveCount(0);
  });
});
