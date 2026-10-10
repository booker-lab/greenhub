import type { Product, SaleRound, SaleRoundStatus } from '@greenhub/shared';
import type { SellerSaleRound } from '@/hooks/useSaleRounds';
import type { RoundFormCarrotLinks } from './RoundForm';

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CONSUMER_ORIGIN = 'https://greenlove.co.kr';

export interface RoundPageData {
  products: Product[];
  carrotLinks: RoundFormCarrotLinks;
}

export type RoundAction = 'schedule' | 'close' | 'complete';

export function readSafeRoundId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_IDENTIFIER_PATTERN.test(value) ? value : null;
}

export function getRoundAction(status: SaleRoundStatus): RoundAction | null {
  if (status === 'DRAFT') return 'schedule';
  if (status === 'OPEN') return 'close';
  if (status === 'CLOSED') return 'complete';
  return null;
}

/** 서버는 작성 중·판매 예정이고 취소가 걸리지 않은 회차만 수정을 받는다. 그 밖에는 읽기 전용. */
export function isRoundEditable(round: Pick<SaleRound, 'status' | 'cancellation'>): boolean {
  return (round.status === 'DRAFT' || round.status === 'SCHEDULED') && round.cancellation == null;
}

/** 서버가 취소를 받는 회차 상태(sale-round-state.contract assertStatusTransition). */
const ROUND_CANCELLABLE_STATUSES: readonly SaleRoundStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'OPEN',
  'CLOSED',
];

export type RoundCancellationProgress = 'NONE' | 'RUNNING' | 'STUCK';

/**
 * 회차 취소 진행 상태. 서버는 취소 작업자에게 5분 lease를 주고 주문마다 갱신한다.
 * - RUNNING: lease가 살아 있는 CANCELLING — 다른 요청은 서버가 거부한다.
 * - STUCK: LOCAL_FAILED 또는 lease가 끝난 CANCELLING — 같은 취소 요청으로 이어서 진행한다
 *   (서버가 남은 주문만 처리하고, 이미 환불된 주문은 다시 환불하지 않는다).
 */
export function resolveRoundCancellationProgress(
  round: Pick<SaleRound, 'status' | 'cancellation'>,
  nowMs: number,
): RoundCancellationProgress {
  const cancellation = round.cancellation;
  if (round.status === 'CANCELLED' || !cancellation || cancellation.status === 'COMPLETED') {
    return 'NONE';
  }
  if (cancellation.status === 'LOCAL_FAILED') return 'STUCK';
  const leaseExpiresAt = Date.parse(cancellation.leaseExpiresAt ?? '');
  return Number.isFinite(leaseExpiresAt) && leaseExpiresAt > nowMs ? 'RUNNING' : 'STUCK';
}

/** 회차 취소 버튼 — 관리자 계정만 본다(사용자 결정). 멈춘 취소는 "다시 진행"으로 보인다. */
export function resolveRoundCancelAction(
  round: Pick<SaleRound, 'status' | 'cancellation'>,
  role: string | null | undefined,
  nowMs: number,
): 'cancel' | 'resume' | null {
  if (role !== 'admin' || !ROUND_CANCELLABLE_STATUSES.includes(round.status)) return null;
  const progress = resolveRoundCancellationProgress(round, nowMs);
  if (progress === 'RUNNING') return null;
  return progress === 'STUCK' ? 'resume' : 'cancel';
}

/** 회차 이름을 그대로 입력해야 취소를 보낸다(앞뒤 공백만 무시). */
export function isRoundCancelConfirmationValid(input: string, roundName: string): boolean {
  const expected = roundName.trim();
  return expected.length > 0 && input.trim() === expected;
}

function isSafeProductId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_IDENTIFIER_PATTERN.test(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function assertAllowedLandingUrl(value: string | null, roundId: string) {
  if (value === null) return;
  if (value.length > 2_048 || hasControlCharacter(value)) {
    throw new Error('당근 대표 링크 응답이 올바르지 않습니다.');
  }

  try {
    const url = new URL(value);
    const linkedRoundId = url.searchParams.get('round');
    if (
      url.origin !== CONSUMER_ORIGIN ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      (linkedRoundId !== null && linkedRoundId !== roundId)
    ) {
      throw new Error('허용되지 않은 당근 대표 링크입니다.');
    }
  } catch {
    throw new Error('당근 대표 링크 응답이 올바르지 않습니다.');
  }
}

function isUsableProduct(product: Product, storeId: string): boolean {
  return (
    product.storeId === storeId &&
    isSafeProductId(product.id) &&
    typeof product.name === 'string' &&
    product.name.trim().length > 0 &&
    !hasControlCharacter(product.name) &&
    Number.isSafeInteger(product.price) &&
    product.price > 0 &&
    typeof product.isActive === 'boolean'
  );
}

function buildConsumerUrl(pathname: string, roundId: string): string {
  const url = new URL(pathname, CONSUMER_ORIGIN);
  url.searchParams.set('round', roundId);
  url.searchParams.set('utm_source', 'carrot');
  return url.toString();
}

export function buildRoundPageData(
  round: SellerSaleRound,
  providedProducts: readonly Product[],
): RoundPageData {
  const roundId = readSafeRoundId(round.id);
  if (!roundId) throw new Error('회차 식별자 응답이 올바르지 않습니다.');
  assertAllowedLandingUrl(round.carrotLandingUrl, roundId);

  const roundProductIds = new Set<string>();
  for (const item of round.items) {
    if (!isSafeProductId(item.productId) || roundProductIds.has(item.productId)) {
      throw new Error('회차 상품 식별자 응답이 올바르지 않습니다.');
    }
    roundProductIds.add(item.productId);
  }

  const products = providedProducts.filter((product) => product.storeId === round.storeId);
  const productIds = new Set<string>();
  for (const product of products) {
    if (!isUsableProduct(product, round.storeId) || productIds.has(product.id)) {
      throw new Error('스토어 상품 응답이 올바르지 않습니다.');
    }
    productIds.add(product.id);
  }

  const productLinks = products.map((product) => ({
    productId: product.id,
    url: buildConsumerUrl(`/products/${encodeURIComponent(product.id)}`, roundId),
  }));

  return {
    products,
    carrotLinks: {
      representativeUrl: buildConsumerUrl('/', roundId),
      productLinks,
    },
  };
}
