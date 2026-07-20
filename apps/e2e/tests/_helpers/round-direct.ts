import type { Page, TestInfo } from '@playwright/test'
import { ROUND_DIRECT_STATE_PATHS } from './auth'

export type RoundDirectProject = keyof typeof ROUND_DIRECT_STATE_PATHS

const PROVIDER_HOSTS = new Set([
  'cdn.portone.io',
  'api.portone.io',
  'kakaoapi.aligo.in',
  'apis.aligo.in',
])

export type RoundDirectFixture = {
  runId: string
  project: RoundDirectProject
  namespace: string
  storeId: string
  productId: string
  openRoundId: string
  openRoundItemId: string
  statePath: string
  sellerRoundId: (suffix: string) => string
  orderId: (suffix: string) => string
  cartItems: Array<{
    productId: string
    name: string
    price: number
    image: string
    quantity: number
    saleType: 'normal'
    deliveryMethod: 'direct'
    storeId: string
    roundId: string
    roundItemId: string
    roundPrice: number
  }>
}

export function roundDirectProject(testInfo: TestInfo): RoundDirectProject {
  if (testInfo.project.name !== 'chromium' && testInfo.project.name !== 'mobile') {
    throw new Error('회차 E2E는 chromium 또는 mobile project에서만 실행할 수 있습니다.')
  }
  return testInfo.project.name
}

export function roundDirectFixture(testInfo: TestInfo): RoundDirectFixture {
  const runId = process.env['ROUND_DIRECT_E2E_RUN_ID']?.trim()
  if (!runId) throw new Error('ROUND_DIRECT_E2E_RUN_ID가 필요합니다.')
  const project = roundDirectProject(testInfo)
  const namespace = `round-direct-e2e-${runId}-${project}`
  const storeId = `${namespace}-store`
  const productId = `${namespace}-product-1`
  const openRoundId = `${namespace}-round-open`
  const openRoundItemId = `${openRoundId}-item-1`
  return {
    runId,
    project,
    namespace,
    storeId,
    productId,
    openRoundId,
    openRoundItemId,
    statePath: ROUND_DIRECT_STATE_PATHS[project],
    sellerRoundId: (suffix) => `${namespace}-${suffix}`,
    orderId: (suffix) => `${namespace}-${suffix}`,
    cartItems: [
      {
        productId,
        name: 'E2E 호접란',
        price: 12000,
        image: 'https://placehold.co/600x600.jpg',
        quantity: 1,
        saleType: 'normal',
        deliveryMethod: 'direct',
        storeId,
        roundId: openRoundId,
        roundItemId: openRoundItemId,
        roundPrice: 12000,
      },
    ],
  }
}

export async function installRoundDirectCart(
  page: Page,
  fixture: RoundDirectFixture,
): Promise<void> {
  await page.addInitScript((cartItems) => {
    localStorage.setItem('greenhub_cart', JSON.stringify(cartItems))
    sessionStorage.setItem('checkout_cart', JSON.stringify(cartItems))
  }, fixture.cartItems)
}

export async function installPortOneBrowserStub(
  page: Page,
): Promise<{ assertNoProviderEgress: () => void }> {
  const egress: string[] = []
  await page.route(
    (url) => PROVIDER_HOSTS.has(url.hostname),
    async (route) => {
      egress.push(route.request().url())
      await route.abort('blockedbyclient')
    },
  )
  await page.addInitScript(() => {
    const calls: Array<Record<string, unknown>> = []
    const portone = {
      async requestPayment(request: Record<string, unknown>) {
        calls.push({ ...request })
        return {
          paymentId: request['paymentId'],
          transactionType: 'PAYMENT',
          txId: `e2e-${String(request['paymentId'])}`,
        }
      },
    }
    Object.defineProperty(window, 'PortOne', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: portone,
    })
    Object.defineProperty(window, '__ROUND_DIRECT_E2E_PORTONE_CALLS__', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: calls,
    })
  })
  return {
    assertNoProviderEgress() {
      if (egress.length > 0) {
        throw new Error(`금지된 외부 provider egress가 감지됐습니다: ${egress.length}건`)
      }
    },
  }
}
