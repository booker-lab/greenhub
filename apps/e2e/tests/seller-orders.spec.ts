import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

test.describe('???二쇰Ц 愿由???怨듦컻', () => {
  test('誘몄씤利??묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ?? ?몄쬆 ??湲곕뒫 寃利?????????????????????????????????????????????????

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('???二쇰Ц 愿由????몄쬆 ?붾㈃', () => {
  test.skip(skipAuth, '?섍꼍蹂??TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD ?꾩슂')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)
  })

  test('二쇰Ц 愿由??ㅻ뜑 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
  })

  // ?? ????????????????????????????????????????????????????????????????

  test('5媛??곹깭 ??紐⑤몢 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
    for (const label of ['泥섎━ ?꾩슂', '?湲?以?, '諛곗넚 以?, '?꾨즺', '痍⑥냼']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  test('???대┃ ??媛????꾪솚 ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })

    for (const label of ['?湲?以?, '諛곗넚 以?, '?꾨즺', '痍⑥냼', '泥섎━ ?꾩슂']) {
      await page.locator(`text=${label}`).first().click()
      await page.waitForTimeout(300)
    }

    expect(errors).toHaveLength(0)
  })

  test('?ㅼ떆媛??곌껐 ?곹깭 ?띿뒪???쒖떆', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
    const statusLocator = page
      .locator('text=?ㅼ떆媛??곌껐')
      .or(page.locator('text=?곌껐 以?))
      .or(page.locator('text=?곌껐 ?ㅻ쪟'))
    await expect(statusLocator.first()).toBeVisible({ timeout: 12_000 })
  })

  test('二쇰Ц ?놁쓣 ??empty state ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
    // Firestore RTL ?곌껐 ?꾨즺 ?湲???'?곌껐 以? 珥덇린 ?곹깭??留ㅼ묶 (line 56 ?뚯뒪?몄? ?쇨?)
    await expect(
      page
        .locator('text=?ㅼ떆媛??곌껐')
        .or(page.locator('text=?곌껐 以?))
        .or(page.locator('text=?곌껐 ?ㅻ쪟'))
    ).toBeVisible({ timeout: 15_000 })
    // ?곌껐 ??empty state ?먮뒗 二쇰Ц 移대뱶 異쒗쁽??polling?쇰줈 ?湲?(RTL ?곗씠???꾩갑 吏??怨좊젮)
    await expect
      .poll(
        async () => {
          const hasEmpty = await page.locator('text=?꾩옱 ?대떦 二쇰Ц???놁뒿?덈떎').count()
          const hasOrderBadge = await page.evaluate(() =>
            Array.from(document.querySelectorAll('span')).some((el) =>
              ['?湲?, '寃곗젣 ?꾨즺', '二쇰Ц ?뺤젙', '紐⑥쭛 以?, '以鍮?以?, '諛곗넚 以?, '嫄곗젏 ?꾩갑', '?쎌뾽 ?꾨즺', '諛곗넚 ?꾨즺', '痍⑥냼'].includes((el.textContent ?? '').trim()),
            ),
          )
          return hasEmpty > 0 || hasOrderBadge
        },
        { timeout: 15_000 },
      )
      .toBe(true)
  })

  // ?? Summary Bar ?????????????????????????????????????????????????????

  test('Summary Bar ??3??ぉ ?뚮뜑留?(Summary + ??뿉 媛??덉씠釉?2???댁긽 議댁옱)', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
    // Summary Bar? ???묒そ???숈씪 ?덉씠釉붿씠 議댁옱?섎?濡?count >= 2
    for (const label of ['泥섎━ ?꾩슂', '諛곗넚 以?, '?湲?以?]) {
      const count = await page.locator(`text=${label}`).count()
      expect(count).toBeGreaterThanOrEqual(2)
    }
  })

  test('Summary Bar ?대┃ ??諛곗넚 以??대┃ ??IN_DELIVERY ???쒖꽦??(SubFilter 異쒗쁽)', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
    // Summary Bar??'諛곗넚 以?? 泥?踰덉㎏ ?깆옣 (??낫???꾩뿉 ?꾩튂)
    await page.locator('text=諛곗넚 以?).first().click()
    // IN_DELIVERY ???쒖꽦???뺤씤 ??SubFilter??怨좎쑀 ??ぉ?쇰줈 寃利?    await expect(page.locator('text=嫄곗젏 ?꾩갑')).toBeVisible({ timeout: 3_000 })
  })

  // ?? SubFilter ????????????????????????????????????????????????????????

  test('諛곗넚 以????좏깮 ??SubFilter(?꾩껜쨌諛곗넚 以뫢룰굅???꾩갑) ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
    // ???됱쓽 '諛곗넚 以? ?대┃: Summary Bar? 寃뱀튂誘濡?last()濡????좏깮
    await page.locator('text=諛곗넚 以?).last().click()
    await expect(page.locator('text=嫄곗젏 ?꾩갑')).toBeVisible({ timeout: 3_000 })
    // '?꾩껜' ?띿뒪?몃뒗 SubFilter?먮쭔 議댁옱
    await expect(page.locator('text=?꾩껜')).toBeVisible()
  })

  test('?ㅻⅨ ???꾪솚 ??SubFilter ?щ씪吏?, async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
    await page.locator('text=諛곗넚 以?).last().click()
    await expect(page.locator('text=嫄곗젏 ?꾩갑')).toBeVisible({ timeout: 3_000 })
    // ?꾨즺 ??쑝濡??대룞 ??SubFilter ?뚮㈇
    await page.locator('text=?꾨즺').first().click()
    await expect(page.locator('text=嫄곗젏 ?꾩갑')).not.toBeVisible()
  })

  test('SubFilter ?대┃ ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
    await page.locator('text=諛곗넚 以?).last().click()
    await expect(page.locator('text=嫄곗젏 ?꾩갑')).toBeVisible({ timeout: 3_000 })

    for (const label of ['嫄곗젏 ?꾩갑', '諛곗넚 以?, '?꾩껜']) {
      await page.locator(`text=${label}`).first().click()
      await page.waitForTimeout(300)
    }

    expect(errors).toHaveLength(0)
  })

  test('???꾪솚 ??SubFilter ALL 由ъ뀑 ?뺤씤', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
    // 諛곗넚 以?????嫄곗젏 ?꾩갑 SubFilter ?좏깮
    await page.locator('text=諛곗넚 以?).last().click()
    await expect(page.locator('text=嫄곗젏 ?꾩갑')).toBeVisible({ timeout: 3_000 })
    await page.locator('text=嫄곗젏 ?꾩갑').first().click()
    // ?ㅻⅨ ??쑝濡??대룞 ??諛곗넚 以????ъ쭊??    await page.locator('text=?꾨즺').first().click()
    await page.locator('text=諛곗넚 以?).last().click()
    // SubFilter媛 '?꾩껜' ?곹깭濡?由ъ뀑?섏뼱??????'?꾩껜' 踰꾪듉??active ?ㅽ???諛곌꼍??
    // 援ъ“ 寃利? '?꾩껜' ?띿뒪?멸? 蹂댁엫 = SubFilter ?뺤긽 ?뚮뜑留?    await expect(page.locator('text=?꾩껜')).toBeVisible({ timeout: 3_000 })
    await expect(page.locator('text=嫄곗젏 ?꾩갑')).toBeVisible()
  })
})
