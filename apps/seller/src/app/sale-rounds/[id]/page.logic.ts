import type { Product, SaleRoundStatus } from '@greenhub/shared';
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
