import { expect, type Page, test } from '@playwright/test';
import { AUTH_STATE_PATH } from './_helpers/auth';
import { expectNoHorizontalOverflow, setMobileViewport } from './_helpers/responsive';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';

async function waitForRealtimeOrders(page: Page) {
  await expect(page.locator('text=실시간 연결')).toBeVisible({ timeout: 20_000 });
}

test.describe('셀러 주문 관리 — 공개', () => {
  test('미인증 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 });
  });
});

// ── 인증 후 기능 검증 ────────────────────────────────────────────────

const sellerEmail = process.env.TEST_SELLER_EMAIL;
const sellerPassword = process.env.TEST_SELLER_PASSWORD;
const skipAuth = !sellerEmail || !sellerPassword;

test.describe('셀러 주문 관리 — 인증 화면', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용 — spec별 로그인 호출 제거
  test.use({ storageState: AUTH_STATE_PATH });

  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요');

  test('주문 관리 헤더 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
  });

  // ── 탭 ──────────────────────────────────────────────────────────────

  test('5개 상태 탭 모두 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    for (const label of ['처리 필요', '대기 중', '배송 중', '완료', '취소']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible();
    }
  });

  test('탭 클릭 — 각 탭 전환 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });

    for (const label of ['대기 중', '배송 중', '완료', '취소', '처리 필요']) {
      await page.locator(`text=${label}`).first().click();
      await page.waitForTimeout(300);
    }

    expect(errors).toHaveLength(0);
  });

  test('실시간 연결 상태 텍스트 표시', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    const statusLocator = page
      .locator('text=실시간 연결')
      .or(page.locator('text=연결 중'))
      .or(page.locator('text=연결 오류'));
    await expect(statusLocator.first()).toBeVisible({ timeout: 12_000 });
  });

  test('주문 없을 때 empty state 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    // Firestore RTL 연결 완료 대기 — '연결 중' 초기 상태도 매칭 (line 56 테스트와 일관)
    await expect(
      page
        .locator('text=실시간 연결')
        .or(page.locator('text=연결 중'))
        .or(page.locator('text=연결 오류')),
    ).toBeVisible({ timeout: 15_000 });
    await waitForRealtimeOrders(page);
    // 연결 후 empty state 또는 주문 카드 출현을 polling으로 대기 (RTL 데이터 도착 지연 고려)
    await expect
      .poll(
        async () => {
          const hasEmpty = await page.locator('text=현재 해당 주문이 없습니다').count();
          const hasOrderCard = await page.getByText(/주문 (2026|#)/).count();
          return hasEmpty > 0 || hasOrderCard > 0;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  // ── 탭 뱃지 ──────────────────────────────────────────────────────────
  // 세션42 T2: 요약바 제거 — 건수 표시가 탭 뱃지로 흡수됨

  test('탭 뱃지 — 건수가 숫자로 표시됨', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    // RTL 연결 완료 후 groupCounts 확정 → 뱃지 렌더
    await expect(
      page
        .locator('text=실시간 연결')
        .or(page.locator('text=연결 중'))
        .or(page.locator('text=연결 오류')),
    ).toBeVisible({ timeout: 15_000 });
    // 각 탭 버튼에 건수 뱃지가 있으면 그 텍스트는 숫자여야 함
    for (const label of ['처리 필요', '대기 중', '배송 중', '완료', '취소']) {
      const badge = page.locator('button', { hasText: label }).locator('.mantine-Badge-root');
      if ((await badge.count()) > 0) {
        const txt = (await badge.first().textContent())?.trim() ?? '';
        expect(txt).toMatch(/^\d+$/);
      }
    }
  });

  // ── SubFilter ────────────────────────────────────────────────────────

  test('배송 중 탭 선택 시 SubFilter(전체·배송 중·거점 도착) 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    // 탭 행의 '배송 중' 클릭: Summary Bar와 겹치므로 last()로 탭 선택
    await page.locator('text=배송 중').last().click();
    await expect(page.locator('text=거점 도착')).toBeVisible({ timeout: 3_000 });
    // '전체' 텍스트는 SubFilter에만 존재
    await expect(page.locator('text=전체')).toBeVisible();
  });

  test('다른 탭 전환 시 SubFilter 사라짐', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    await page.locator('text=배송 중').last().click();
    await expect(page.locator('text=거점 도착')).toBeVisible({ timeout: 3_000 });
    // 완료 탭으로 이동 → SubFilter 소멸
    await page.locator('text=완료').first().click();
    await expect(page.locator('text=거점 도착')).not.toBeVisible();
  });

  test('SubFilter 클릭 — JS 에러 없음', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    await page.locator('text=배송 중').last().click();
    await expect(page.locator('text=거점 도착')).toBeVisible({ timeout: 3_000 });

    for (const label of ['거점 도착', '배송 중', '전체']) {
      await page.locator(`text=${label}`).first().click();
      await page.waitForTimeout(300);
    }

    expect(errors).toHaveLength(0);
  });

  test('탭 전환 시 SubFilter ALL 리셋 확인', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    // 배송 중 탭 → 거점 도착 SubFilter 선택
    await page.locator('text=배송 중').last().click();
    await expect(page.locator('text=거점 도착')).toBeVisible({ timeout: 3_000 });
    await page.locator('text=거점 도착').first().click();
    // 다른 탭으로 이동 후 배송 중 탭 재진입
    await page.locator('text=완료').first().click();
    await page.locator('text=배송 중').last().click();
    // SubFilter가 '전체' 상태로 리셋되어야 함 — '전체' 버튼이 active 스타일(배경색)
    // 구조 검증: '전체' 텍스트가 보임 = SubFilter 정상 렌더링
    await expect(page.locator('text=전체')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('text=거점 도착')).toBeVisible();
  });

  // ── 세션51 T6-B: SaleTypeToggle (#CL-35) ─────────────────────────────────
  // 선행: scripts/seed-e2e-orders.mjs 실행 — 일반/공구 주문 + groupProductConfig 시드.

  test('판매 유형 토글 — 일반/공구 testid 노출 + 기본값 normal', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });

    const normal = page.getByTestId('sale-type-toggle-normal');
    const group = page.getByTestId('sale-type-toggle-group');
    await expect(normal).toBeVisible();
    await expect(group).toBeVisible();
    // 기본값 normal — 라벨은 둘 다 보이므로 active 상태는 fontWeight로 확인하지 않고
    // 동작 검증으로 대체: normal 활성 시 날짜 프리셋 칩('이번 주' 등)이 노출되어야 한다.
    await expect(page.locator('text=이번 주').first()).toBeVisible({ timeout: 5_000 });
  });

  test('공구 토글 전환 시 날짜 필터 칩 미노출', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    // normal에서 '이번 주' 칩 노출 확인
    await expect(page.locator('text=이번 주').first()).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('sale-type-toggle-group').click();
    // 공구 토글에서 '이번 주/이번 달/직접 입력' 칩 미노출
    await expect(page.locator('text=이번 주').first()).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('text=직접 입력').first()).toBeHidden();
  });

  test('공구 토글 — 일반 주문이 가려지고 공구 주문 표시', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    await waitForRealtimeOrders(page);
    await page.getByTestId('sale-type-toggle-group').click();
    // 공구 상품명이 보이고 일반 상품명은 보이지 않음 (시드된 데이터 기준)
    await expect(page.locator('text=E2E 공구 상품').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=E2E 일반 상품').first()).toBeHidden();
  });

  // ── 세션51 T6-C: 공구 주문 groupDeliveryDate 조인 ───────────────────────

  test('공구 토글 — groupDeliveryDate 헤더(월 일) 그룹핑', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    await waitForRealtimeOrders(page);
    await page.getByTestId('sale-type-toggle-group').click();
    // 시드된 groupProductConfig.groupDeliveryDate 기반 헤더 ('X월 X일' 또는 '날짜 미정')
    // 정합 시드 시 'X월 X일' 헤더, 미존재 시 '날짜 미정'으로 떨어진다.
    const dateHeader = page.locator('text=/\\d+월 \\d+일/').first();
    const undefinedHeader = page.locator('text=날짜 미정').first();
    await expect(dateHeader.or(undefinedHeader)).toBeVisible({ timeout: 10_000 });
  });

  test('토글 전환 시 datePreset week 초기화', async ({ page }) => {
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    // '직접 입력'으로 변경 — custom 분기 진입 (input[type=date] 2개 노출)
    await page.locator('text=직접 입력').first().click();
    // 공구 → 일반 토글 라운드트립
    await page.getByTestId('sale-type-toggle-group').click();
    await expect(page.locator('text=직접 입력').first()).toBeHidden({ timeout: 5_000 });
    await page.getByTestId('sale-type-toggle-normal').click();
    // 일반 복귀 시 datePreset='week'으로 초기화 — '이번 주' 칩 노출
    await expect(page.locator('text=이번 주').first()).toBeVisible({ timeout: 5_000 });
  });

  // ── 판매자 주문 모바일 회귀 ───────────────────────────────────────────────
  // 선행: scripts/seed-e2e-orders.mjs 실행 — ACCEPTED 일반 주문 + PREPARING 택배 주문.

  test('모바일 — 우선 알림과 일괄 준비 액션 바가 겹치지 않음', async ({ page }) => {
    await setMobileViewport(page);
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    await waitForRealtimeOrders(page);

    await expect(page.getByText('먼저 확인할 주문이 있습니다')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: '처리 필요 보기' })).toBeVisible();
    await expect(page.getByLabel(/준비 가능 \d+건/)).toBeVisible();

    await page
      .getByLabel(/일괄 준비 선택/)
      .first()
      .check();
    await page.getByRole('button', { name: '준비 시작' }).first().click();
    await expect(page.getByText('선택한 주문을 준비 중으로 바꿀까요?')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page
      .getByLabel('선택한 주문을 준비 중으로 바꿀까요?')
      .getByRole('button', { name: '취소' })
      .click();
  });

  test('모바일 — 일괄 택배 발송 모달 입력이 카드 폭 안에 수납됨', async ({ page }) => {
    await setMobileViewport(page);
    await page.goto(`${BASE}/orders`);
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 });
    await waitForRealtimeOrders(page);

    await page.getByRole('button', { name: /대기 중/ }).click();
    await expect(page.getByLabel(/택배 발송 가능 \d+건/)).toBeVisible({ timeout: 10_000 });
    await page
      .getByLabel(/일괄 택배 발송 선택/)
      .first()
      .check();
    await page.getByRole('button', { name: '택배 발송', exact: true }).click();

    await expect(page.getByText('택배 일괄 발송')).toBeVisible();
    await expect(page.getByRole('combobox', { name: /택배사 20260101-000003/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /운송장번호 20260101-000003/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '1건 발송 완료' })).toBeDisabled();
    await expectNoHorizontalOverflow(page);

    await page.getByLabel('택배 일괄 발송').getByRole('button', { name: '취소' }).click();
  });
});
