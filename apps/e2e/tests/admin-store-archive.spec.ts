import { expect, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';

// 어드민 화면은 셀러앱 내 /admin/* 경로 → SELLER_BASE 재사용
const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr';

const adminEmail = process.env['TEST_ADMIN_EMAIL'];
const adminPassword = process.env['TEST_ADMIN_PASSWORD'];
const skipAuth = !adminEmail || !adminPassword;

// ── 비인증 가드 ──────────────────────────────────────────────────────
test.describe('Admin — 판매자 목록 (비인증)', () => {
  test('/admin/stores — 비로그인 시 로그인으로 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/admin/stores`);
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 });
  });
});

// ── 인증 후 읽기 전용 스모크 (#CL-53 치우기/아카이브 UI) ──────────────
// 운영 단일 DB 보호 위해 상태변경(치우기/복구) 클릭은 하지 않는다 — 노출·렌더만 확인.
test.describe('Admin — 판매자 치우기 UI (인증)', () => {
  // globalSetup이 발급한 admin 전용 세션 재사용 — seller와 도메인이 같아
  // .auth-state.json이 아닌 .admin-state.json(격리 발급)을 쓴다.
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 — 어드민 인증 spec 건너뜀');

  // 셀러/어드민 화면은 SSE "실시간 연결"이 상시 열려 있어 networkidle에
  // 도달하지 않는다 → domcontentloaded + 명시적 요소 대기로 안정화.
  test('/admin/stores 진입 + JS 에러 없음', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/admin/stores`, { waitUntil: 'domcontentloaded' });

    // admin role이면 로그인으로 튕기지 않아야 한다
    await expect(page).toHaveURL(/\/admin\/stores/, { timeout: 15_000 });
    // "판매자 목록" 제목 렌더 확인
    await expect(page.getByText('판매자 목록')).toBeVisible({ timeout: 15_000 });

    const critical = errors.filter((e) => !e.includes('hydration') && !e.includes('ChunkLoad'));
    expect(critical).toHaveLength(0);
  });

  test('판매자 상태 필터 노출 + 기본값 활성', async ({ page }) => {
    await page.goto(`${BASE}/admin/stores`, { waitUntil: 'domcontentloaded' });

    // PR-B에서 기존 Switch를 상태 Select로 흡수 — 노출과 기본값만 읽기 전용 확인
    const statusFilter = page.getByLabel('상태');
    await expect(statusFilter).toBeVisible({ timeout: 15_000 });
    await expect(statusFilter).toHaveValue('current');
  });

  test('판매자 행이 1개 이상이면 수수료 설정 버튼 노출', async ({ page }) => {
    await page.goto(`${BASE}/admin/stores`, { waitUntil: 'domcontentloaded' });

    // 목록 렌더를 먼저 보장(제목 노출 대기) — 운영 데이터 상태에 의존하지 않도록
    // 수수료 설정 버튼 또는 빈 목록 문구 둘 중 하나만 만족하면 통과.
    await expect(page.getByText('판매자 목록')).toBeVisible({ timeout: 15_000 });
    const hasStore = await page
      .getByRole('button', { name: '수수료 설정' })
      .first()
      .isVisible()
      .catch(() => false);
    const isEmpty = await page
      .getByText('등록된 판매자가 없습니다.')
      .isVisible()
      .catch(() => false);
    const isFilteredEmpty = await page
      .getByText('조건에 맞는 판매자가 없습니다.')
      .isVisible()
      .catch(() => false);
    expect(hasStore || isEmpty || isFilteredEmpty).toBe(true);
  });
});
