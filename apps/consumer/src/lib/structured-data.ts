// 검색엔진·AI 검색이 읽는 구조화 데이터(JSON-LD). 화면에 보이는 사실과 같은 값만 싣는다.
// 이 모듈은 다른 모듈을 import하지 않는다(테스트가 단독으로 변환해 실행한다).

const SCHEMA_CONTEXT = 'https://schema.org';

export interface StructuredBusinessInfo {
  brand: string;
  businessName: string;
  registrationNumber: string;
  address: string;
  phone: string;
  email: string;
  kakaoChannel: { url: string };
}

export interface StructuredProduct {
  id?: unknown;
  storeId?: unknown;
  name?: unknown;
  description?: unknown;
  images?: unknown;
}

export interface StructuredRound {
  id: string;
  storeId: string;
  status: string;
  schedule: { orderOpenAt: string; orderCloseAt: string };
  items: StructuredRoundItem[];
}

export interface StructuredRoundItem {
  roundId: string;
  storeId: string;
  productId: string;
  roundPrice: number;
  status: string;
}

/** `<script>` 안에 넣어도 태그가 닫히지 않도록 `<`를 유니코드로 바꿔 직렬화한다. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** 국내 번호(010-1234-5678)를 국제 표기(+82-10-1234-5678)로 바꾼다. */
function internationalPhone(phone: string): string {
  return phone.startsWith('0') ? `+82-${phone.slice(1)}` : phone;
}

/** "경기도 이천시 백사면 …" 주소를 시·도/시·군·구/나머지로 나눈다. 형식이 다르면 통째로 둔다. */
function postalAddress(address: string) {
  const [region, locality, ...rest] = address.trim().split(/\s+/);
  if (!region || !locality || rest.length === 0) {
    return { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'KR' };
  }
  return {
    '@type': 'PostalAddress',
    streetAddress: rest.join(' '),
    addressLocality: locality,
    addressRegion: region,
    addressCountry: 'KR',
  };
}

/** 홈에 싣는 사업자(온라인 상점)·사이트 정보. */
export function buildSiteJsonLd(info: StructuredBusinessInfo, siteUrl: string, logoUrl: string) {
  const storeNodeId = `${siteUrl}/#store`;
  return {
    '@context': SCHEMA_CONTEXT,
    '@graph': [
      {
        '@type': 'OnlineStore',
        '@id': storeNodeId,
        name: info.brand,
        alternateName: 'Green Love',
        legalName: info.businessName,
        url: siteUrl,
        logo: logoUrl,
        email: info.email,
        telephone: internationalPhone(info.phone),
        taxID: info.registrationNumber,
        address: postalAddress(info.address),
        sameAs: [info.kakaoChannel.url],
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        name: info.brand,
        url: siteUrl,
        inLanguage: 'ko-KR',
        publisher: { '@id': storeNodeId },
      },
    ],
  };
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text : null;
}

function httpsImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images.filter(
    (value): value is string => typeof value === 'string' && /^https:\/\//.test(value),
  );
}

type RoundTiming = Pick<StructuredRound, 'status' | 'schedule'>;

function orderMillis(round: RoundTiming): number {
  const value = new Date(round.schedule.orderOpenAt).getTime();
  return Number.isNaN(value) ? 0 : value;
}

/**
 * 화면의 "이번 주 회차"와 같은 규칙으로 현재 회차를 고른다(useSaleRounds의 selectCurrentRound).
 * 판매 중 회차가 우선이고, 없으면 아직 주문 시작 전인 가장 가까운 판매 예정 회차다.
 * 마감 회차는 지금 살 수 없으므로 가격 정보 대상이 아니다.
 */
export function selectOrderableRound<T extends RoundTiming>(
  rounds: ReadonlyArray<T>,
  now: Date,
): T | null {
  const open = rounds.find((round) => round.status === 'OPEN');
  if (open) return open;
  const nowMillis = now.getTime();
  return (
    rounds
      .filter((round) => round.status === 'SCHEDULED' && orderMillis(round) > nowMillis)
      .sort((a, b) => orderMillis(a) - orderMillis(b))[0] ?? null
  );
}

/**
 * 상품 상세 화면과 같은 판정(ProductDetailClient의 resolveRoundProduct)으로 가격·판매 상태를 만든다.
 * - 판매 중 + 판매 가능 → 재고 있음
 * - 판매 중·판매 예정 + 품절 → 품절
 * - 판매 예정 + 판매 가능 → 아직 주문 불가(주문 시작 시각 표시)
 * 회차에 없거나 숨긴 상품은 가격을 말할 수 없으므로 null.
 */
function buildRoundOffer(
  productId: string,
  storeId: string,
  productUrl: string,
  round: StructuredRound | null,
) {
  if (!round || round.storeId !== storeId) return null;
  if (round.status !== 'OPEN' && round.status !== 'SCHEDULED') return null;
  const matches = round.items.filter(
    (item) =>
      item.roundId === round.id &&
      item.storeId === storeId &&
      item.productId === productId &&
      item.status !== 'HIDDEN',
  );
  if (matches.length !== 1) return null;
  const item = matches[0];
  if (!Number.isFinite(item.roundPrice) || item.roundPrice <= 0) return null;

  let availability: string;
  if (item.status === 'SOLD_OUT') availability = 'https://schema.org/SoldOut';
  else if (item.status !== 'ACTIVE') return null;
  else if (round.status === 'OPEN') availability = 'https://schema.org/InStock';
  else availability = 'https://schema.org/OutOfStock';

  return {
    '@type': 'Offer',
    url: productUrl,
    price: item.roundPrice,
    priceCurrency: 'KRW',
    availability,
    ...(round.status === 'SCHEDULED' ? { availabilityStarts: round.schedule.orderOpenAt } : {}),
    availabilityEnds: round.schedule.orderCloseAt,
  };
}

/** 상품 JSON-LD. 이름이나 현재 회차 가격이 없으면 null(잘못된 가격을 알리지 않는다). */
export function buildProductJsonLd({
  product,
  round,
  siteUrl,
  sellerName,
}: {
  product: StructuredProduct;
  round: StructuredRound | null;
  siteUrl: string;
  sellerName: string;
}) {
  const id = nonEmptyString(product.id);
  const storeId = nonEmptyString(product.storeId);
  const name = nonEmptyString(product.name);
  if (!id || !storeId || !name) return null;
  const url = `${siteUrl}/products/${encodeURIComponent(id)}`;
  const offer = buildRoundOffer(id, storeId, url, round);
  if (!offer) return null;

  const description = nonEmptyString(product.description);
  const images = httpsImages(product.images);
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Product',
    name,
    url,
    ...(description ? { description } : {}),
    ...(images.length > 0 ? { image: images } : {}),
    offers: { ...offer, seller: { '@type': 'Organization', name: sellerName } },
  };
}
