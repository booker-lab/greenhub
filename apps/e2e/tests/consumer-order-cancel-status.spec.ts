import type { Order, OrderStatus } from '@greenhub/shared';
import { expect, type Page, test } from '@playwright/test';
import { expectNoHorizontalOverflow, setMobileViewport } from './_helpers/responsive';

const CONSUMER_BASE = process.env.CONSUMER_FIXTURE_BASE ?? 'http://localhost:3010';
const SELLER_BASE = process.env.SELLER_FIXTURE_BASE ?? 'http://localhost:3011';
const API_PATTERN = '**/orders/e2e-consumer-cancel-status';
const CANCEL_API_PATTERN = '**/stores/e2e-store/orders/e2e-consumer-cancel-status/cancel';

test('판매자가 저장한 택배사와 운송장번호는 배송 방식 값이 불일치해도 표시한다', async ({
  page,
}) => {
  await setMobileViewport(page);
  await openConsumerFixture(page, {
    ...makeOrder('DELIVERED'),
    deliveryMethod: 'direct',
    courierCompany: 'CJ대한통운',
    trackingNumber: '1234567890',
  });

  await expect(page.getByText('택배사')).toBeVisible();
  await expect(page.getByText('CJ대한통운')).toBeVisible();
  await expect(page.getByText('운송장번호')).toBeVisible();
  await expect(page.getByText('1234567890')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

function makeOrder(status: OrderStatus, cancelReason: string | null = null): Order {
  return {
    id: 'e2e-consumer-cancel-status',
    orderNumber: '20260603-000123',
    storeId: 'e2e-store',
    userId: 'e2e-consumer',
    productId: 'e2e-product',
    quantity: 1,
    saleType: 'group',
    status,
    deliveryMethod: 'direct',
    deliveryFee: 0,
    deliveryAddress: {
      address: '서울특별시 중구 세종대로 110',
      addressDetail: '공동구매 취소 상태 검증',
      zipCode: '04524',
    },
    isMetropolitan: true,
    hubId: null,
    pickupCode: null,
    totalAmount: 35000,
    requestedDeliveryDate: null,
    preparedAt: null,
    cancelReason,
    groupBuyConsent: {
      agreed: true,
      agreedAt: '2026-06-03T00:00:00.000Z',
      userId: 'e2e-consumer',
    },
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
  };
}

async function openConsumerFixture(page: Page, order: Order) {
  await page.route(API_PATTERN, (route) => route.fulfill({ json: order }));
  await page.goto(`${CONSUMER_BASE}/e2e/order-cancel-status`);
  await expect(page.getByRole('heading', { name: '주문 상세' })).toBeVisible();
}

test.describe('소비자 주문 취소 상태 fixture', () => {
  test('모집 중 공동구매는 참여 취소 뒤 취소 안내를 표시한다', async ({ page }) => {
    let cancelRequestCount = 0;
    await page.route(CANCEL_API_PATTERN, (route) => {
      cancelRequestCount += 1;
      return route.fulfill({ json: { ok: true } });
    });
    page.on('dialog', (dialog) => dialog.accept());

    await openConsumerFixture(page, makeOrder('RECRUITING'));
    await expect(page.getByRole('button', { name: '공동구매 참여 취소' })).toBeVisible();
    await page.getByRole('button', { name: '공동구매 참여 취소' }).click();

    await expect(page.getByText('주문이 취소되었습니다')).toBeVisible();
    await expect(page.getByRole('button', { name: '공동구매 참여 취소' })).toHaveCount(0);
    expect(cancelRequestCount).toBe(1);
  });

  test('확정 이후 공동구매는 취소 버튼 없이 기존 타임라인을 유지한다', async ({ page }) => {
    await openConsumerFixture(page, makeOrder('CONFIRMED'));

    await expect(page.getByRole('button', { name: '공동구매 참여 취소' })).toHaveCount(0);
    await expect(page.getByText('배송 현황')).toBeVisible();
    await expect(page.getByText('주문 확정')).toBeVisible();
  });

  for (const [reason, expected] of [
    ['payment_failed', '사유: payment_failed'],
    ['timeout', '사유: timeout'],
    ['목표 수량 미달성으로 취소', '사유: 목표 수량 미달성으로 취소'],
  ]) {
    test(`취소 주문은 ${reason} 사유를 표시한다`, async ({ page }) => {
      await setMobileViewport(page);
      await openConsumerFixture(page, makeOrder('CANCELLED', reason));

      await expect(page.getByText('주문이 취소되었습니다')).toBeVisible();
      await expect(page.getByText(expected)).toBeVisible();
      await expect(page.getByText('배송 현황')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe('판매자 공동구매 취소 상태 fixture', () => {
  test('목표 수량 미달 자동 취소 사유를 상세 정보에 표시한다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${SELLER_BASE}/e2e/order-cancel-status`);

    const state = page.getByRole('region', { name: '판매자 공동구매 취소 상태' });
    await expect(state).toBeVisible();
    await expect(state.getByText('취소 사유')).toBeVisible();
    await expect(state.getByText('목표 수량 미달성으로 취소')).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
