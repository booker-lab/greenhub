import { randomUUID } from 'node:crypto';
import { test as base, expect, type Response, type TestInfo } from '@playwright/test';
import { AUTH_STATE_PATH, ROUND_DIRECT_STATE_PATHS } from './_helpers/auth';
import { genericPreviewFixture } from './_helpers/generic-preview';
import { roundDirectProject } from './_helpers/round-direct';
import {
  E2E_PRODUCTION_APP_TARGET_REASON,
  isProductionApiUrl,
  isProductionAppTarget,
  resolveE2ETargetUrl,
} from './_helpers/target-url';

// 셀러 상품 실제 저장 동선. 폼 렌더·단계 이동 검증은 seller-product-create.spec.ts가 맡는다.

const BASE = resolveE2ETargetUrl('seller');

// 원격 회차 E2E(e2e-round-direct.yml)는 globalSetup이 project별 회차 계정 state만 만들고
// 공용 AUTH_STATE는 만들지 않는다. 회차 실행에서는 그 project의 회차 셀러 계정(가게)으로 돈다.
const roundDirectEnabled = process.env['ROUND_DIRECT_E2E_ENABLED'] === 'true';

function sellerCredentialEnvNames(testInfo: TestInfo): [string, string] {
  if (!roundDirectEnabled) return ['TEST_SELLER_EMAIL', 'TEST_SELLER_PASSWORD'];
  const suffix = roundDirectProject(testInfo).toUpperCase();
  return [`TEST_SELLER_EMAIL_${suffix}`, `TEST_SELLER_PASSWORD_${suffix}`];
}

const test = base.extend({
  // 계정 환경변수가 없으면 globalSetup이 이 state를 만들지 않았으므로, 컨텍스트를 열기 전에 건너뛴다.
  storageState: async ({}, use, testInfo) => {
    const [emailName, passwordName] = sellerCredentialEnvNames(testInfo);
    testInfo.skip(
      !process.env[emailName] || !process.env[passwordName],
      `환경변수 ${emailName} / ${passwordName} 필요`,
    );
    await use(
      roundDirectEnabled ? ROUND_DIRECT_STATE_PATHS[roundDirectProject(testInfo)] : AUTH_STATE_PATH,
    );
  },
});

// ── 실제 저장: 등록 → 목록 → 수정 → 삭제 ────────────────────────────
//
// 감사 S-01(상품 등록 500)은 '등록하기'를 실제로 눌러야 드러난다. seller-product-create.spec.ts는
// 폼 렌더·단계 이동만 봐서 원격 E2E가 놓쳤다. 여기서는 사진 없이(현재 화면이 허용) 등록해
// S-01·S-02 경로를 그대로 지난다.
//
// 픽스처 수명(AGENTS.md §0-8): 이 테스트가 만든 상품은 이 테스트가 소유한다.
//  - 이름에 실행 ID(ROUND_DIRECT_E2E_RUN_ID)와 시도마다 다른 접미어를 붙여 다른 데이터와 구분한다.
//  - 상품 ID는 이 화면의 등록 응답(POST)에서만 기록한다. 기록하지 않은 상품은 지우지 않는다.
//  - 화면 삭제가 확인되지 않은 상품은 afterEach가 화면과 같은 API로 지운다(성공·단언 실패·예외·시간 초과 모두).
//  - 정리에 실패하면 숨기지 않고 테스트를 실패시킨다.
//  - 새로 만든 상품만 다뤄 주문·회차 참조로 삭제가 막히는 경우(409)가 생기지 않는다.
// 대상 가드: 앱 대상이 운영 도메인이면 건너뛰고, 화면이 부르는 API가 운영 API면 만들기 전에 멈춘다.

const fixture = genericPreviewFixture();
const CREATE_PRICE = 23_000;
const EDIT_PRICE = 27_000;

type OwnedProducts = {
  apiBase: string;
  storeId: string;
  accessToken: string;
  /** 등록 응답으로 확인했고 아직 지운 것이 확인되지 않은 상품 ID */
  ids: Set<string>;
  /** 등록 응답 본문을 읽는 중인 작업 — 정리 전에 모두 기다린다 */
  pending: Promise<void>[];
  /** 등록은 성공했는데 ID를 읽지 못한 응답 — 지울 수 없으므로 실패로 드러낸다 */
  unreadable: string[];
};

function formatWon(value: number): string {
  return `₩${value.toLocaleString('en-US')}`;
}

test.describe('셀러 상품 등록·수정·삭제 — 실제 저장', () => {
  test.skip(isProductionAppTarget(BASE), E2E_PRODUCTION_APP_TARGET_REASON);

  let owned: OwnedProducts | null = null;

  test.afterEach(async ({ request }) => {
    const current = owned;
    owned = null;
    if (!current) return;
    await Promise.all(current.pending);
    const failures = [...current.unreadable];
    for (const id of current.ids) {
      const res = await request.delete(
        `${current.apiBase}/stores/${encodeURIComponent(current.storeId)}/products/${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${current.accessToken}` } },
      );
      if (!res.ok()) failures.push(`상품 ${id} 삭제 응답 HTTP ${res.status()}`);
    }
    if (failures.length > 0) {
      throw new Error(`이 테스트가 만든 상품을 정리하지 못했습니다: ${failures.join(' / ')}`);
    }
  });

  test('사진 없이 등록 → 목록에 보임 → 가격 수정 저장 → 삭제', async ({ page }, testInfo) => {
    // AI 미리보기 생성과 저장 두 번, Firestore 목록 반영을 실제로 기다린다.
    test.setTimeout(120_000);

    const attempt = `${testInfo.project.name === 'mobile' ? 'm' : 'c'}${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const productName = `E2E ${fixture.runId} ${attempt} 장미`;

    // 1. 셀러 세션의 가게·토큰 — 정리 요청에 쓴다.
    const sessionRes = await page.request.get(`${BASE}/api/auth/session`);
    expect(sessionRes.ok(), `세션 응답 HTTP ${sessionRes.status()}`).toBe(true);
    const session = (await sessionRes.json()) as {
      user?: { storeId?: string; accessToken?: string };
    };
    const storeId = session.user?.storeId;
    const accessToken = session.user?.accessToken;
    if (!storeId || !accessToken) {
      throw new Error('셀러 세션에 storeId·accessToken이 없어 상품을 만들지 않습니다.');
    }
    const storeSegment = `/stores/${encodeURIComponent(storeId)}`;

    // 2. 등록 화면이 부르는 API 주소를 확인한다. 운영 API면 아무것도 만들기 전에 멈춘다.
    const profileResponse = page.waitForResponse(
      (res) =>
        res.request().method() === 'GET' &&
        new URL(res.url()).pathname.endsWith(`${storeSegment}/public-profile`),
    );
    await page.goto(`${BASE}/products/new`);
    await expect(page.getByPlaceholder('상품명')).toBeVisible({ timeout: 10_000 });
    const profileUrl = new URL((await profileResponse).url());
    if (isProductionApiUrl(profileUrl.origin)) {
      throw new Error('셀러 화면이 운영 API를 부르고 있어 상품을 만들지 않고 멈춥니다.');
    }
    const apiBase =
      profileUrl.origin +
      profileUrl.pathname.slice(0, profileUrl.pathname.lastIndexOf(storeSegment));
    const productsUrl = `${apiBase}${storeSegment}/products`;
    const isProductsRequest = (res: Response, method: string, productId?: string) => {
      const url = new URL(res.url());
      const target = productId ? `${productsUrl}/${encodeURIComponent(productId)}` : productsUrl;
      return res.request().method() === method && `${url.origin}${url.pathname}` === target;
    };

    // 3. 정리 장부를 먼저 연다. 이후 이 화면의 등록 응답은 모두 이 테스트 소유로 기록된다.
    const current: OwnedProducts = {
      apiBase,
      storeId,
      accessToken,
      ids: new Set(),
      pending: [],
      unreadable: [],
    };
    owned = current;
    page.on('response', (res) => {
      if (!isProductsRequest(res, 'POST') || !res.ok()) return;
      current.pending.push(
        res.json().then(
          (body: { id?: unknown }) => {
            if (typeof body?.id === 'string' && body.id) current.ids.add(body.id);
            else current.unreadable.push(`등록 응답(HTTP ${res.status()})에 상품 ID가 없음`);
          },
          () => {
            current.unreadable.push(`등록 응답(HTTP ${res.status()}) 본문을 읽지 못함`);
          },
        ),
      );
    });

    // 4. 등록 — 사진 없이 1→5단계를 지나 '등록하기'를 누른다.
    const next = page.getByRole('button', { name: '다음', exact: true });
    await page.getByPlaceholder('상품명').fill(productName);
    await next.click();

    await page.getByRole('button', { name: '레드', exact: true }).click();
    await next.click();

    // 3단계 판매자 메모는 비워 둔다.
    await expect(page.getByPlaceholder(/직접 키운 호접란/)).toBeVisible();
    await next.click();

    // 4단계는 AI 생성이 끝나야(성공·실패 모두) 입력칸이 나온다. 결과와 상관없이 문구를 직접 넣는다.
    const headline = page.getByPlaceholder('AI가 생성한 마케팅 문구');
    await expect(headline).toBeVisible({ timeout: 60_000 });
    await headline.fill('E2E 확인용 장미');
    await page
      .getByPlaceholder('AI가 생성한 상세 설명')
      .fill('E2E가 등록·수정·삭제를 확인하는 상품입니다.');
    await next.click();

    await page.getByPlaceholder('가격').fill(String(CREATE_PRICE));
    const createResponse = page.waitForResponse((res) => isProductsRequest(res, 'POST'));
    await page.getByRole('button', { name: '등록하기', exact: true }).click();
    const created = await createResponse;
    expect(created.ok(), `상품 등록 응답 HTTP ${created.status()} (감사 S-01)`).toBe(true);
    const createdBody = (await created.json()) as { id?: unknown };
    const productId = typeof createdBody.id === 'string' ? createdBody.id : '';
    expect(productId, '등록 응답에 상품 ID가 있어야 합니다').not.toBe('');
    current.ids.add(productId);

    // 5. 목록에 보임 — 이름·가격으로 이 테스트의 상품 카드만 집는다.
    await expect(page).toHaveURL(/\/products\/?$/, { timeout: 15_000 });
    const card = page
      .locator('div')
      .filter({ has: page.getByText(productName, { exact: true }) })
      .filter({ has: page.getByRole('button', { name: '삭제', exact: true }) })
      .last();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText(formatWon(CREATE_PRICE));

    // 6. 수정 저장 — 가격만 바꾼다.
    await card.getByRole('link', { name: '수정', exact: true }).click();
    await expect(page.getByPlaceholder('상품명')).toHaveValue(productName, { timeout: 15_000 });
    await next.click();
    await expect(page.getByRole('button', { name: '레드', exact: true })).toBeVisible();
    await next.click();
    await expect(page.getByPlaceholder(/직접 키운 호접란/)).toBeVisible();
    await next.click();
    await expect(page.getByPlaceholder('AI가 생성한 마케팅 문구')).toHaveValue('E2E 확인용 장미', {
      timeout: 60_000,
    });
    await next.click();

    const priceInput = page.getByPlaceholder('가격');
    await expect(priceInput).toHaveValue(CREATE_PRICE.toLocaleString('en-US'));
    await priceInput.fill(String(EDIT_PRICE));
    const updateResponse = page.waitForResponse((res) =>
      isProductsRequest(res, 'PATCH', productId),
    );
    await page.getByRole('button', { name: '저장하기', exact: true }).click();
    const updated = await updateResponse;
    expect(updated.ok(), `상품 수정 응답 HTTP ${updated.status()}`).toBe(true);

    await expect(page).toHaveURL(/\/products\/?$/, { timeout: 15_000 });
    await expect(card).toContainText(formatWon(EDIT_PRICE), { timeout: 15_000 });

    // 7. 삭제 — 확인창에서 지우고, 서버 응답과 목록에서 사라진 것을 함께 확인한다.
    await card.getByRole('button', { name: '삭제', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: productName });
    await expect(dialog).toBeVisible();
    const deleteResponse = page.waitForResponse((res) =>
      isProductsRequest(res, 'DELETE', productId),
    );
    await dialog.getByRole('button', { name: '삭제', exact: true }).click();
    const deleted = await deleteResponse;
    expect(deleted.ok(), `상품 삭제 응답 HTTP ${deleted.status()}`).toBe(true);
    current.ids.delete(productId);
    await expect(page.getByText(productName, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  });
});
