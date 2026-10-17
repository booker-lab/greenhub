import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./structured-data.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { buildProductJsonLd, buildSiteJsonLd, selectOrderableRound, serializeJsonLd } =
  module.exports;

const SITE = 'https://greenlove.co.kr';
const NOW = new Date('2026-10-18T00:00:00Z');

function round(overrides = {}, items = [item()]) {
  return {
    id: 'r1',
    storeId: 's1',
    status: 'OPEN',
    schedule: { orderOpenAt: '2026-11-01T01:00:00Z', orderCloseAt: '2026-11-08T15:00:00Z' },
    items,
    ...overrides,
  };
}

function item(overrides = {}) {
  return { roundId: 'r1', storeId: 's1', productId: 'p1', roundPrice: 30000, status: 'ACTIVE', ...overrides };
}

const product = {
  id: 'p1',
  storeId: 's1',
  name: ' 빅립 ',
  description: '분홍색 꽃이\n크게 핍니다.',
  images: ['https://storage.example/a.png', 'http://insecure/b.png'],
};

function build(r) {
  return buildProductJsonLd({ product, round: r, siteUrl: SITE, sellerName: '디어 오키드' });
}

test('판매 중 회차 상품은 회차 가격·재고 있음으로 알린다', () => {
  const jsonLd = build(round());
  assert.equal(jsonLd['@type'], 'Product');
  assert.equal(jsonLd.name, '빅립');
  assert.equal(jsonLd.description, '분홍색 꽃이 크게 핍니다.');
  assert.deepEqual(jsonLd.image, ['https://storage.example/a.png']);
  assert.equal(jsonLd.url, `${SITE}/products/p1`);
  assert.equal(jsonLd.offers.price, 30000);
  assert.equal(jsonLd.offers.priceCurrency, 'KRW');
  assert.equal(jsonLd.offers.availability, 'https://schema.org/InStock');
  assert.equal(jsonLd.offers.availabilityStarts, undefined);
  assert.equal(jsonLd.offers.seller.name, '디어 오키드');
});

test('판매 예정 회차는 주문 불가와 주문 시작 시각으로 알린다', () => {
  const jsonLd = build(round({ status: 'SCHEDULED' }));
  assert.equal(jsonLd.offers.availability, 'https://schema.org/OutOfStock');
  assert.equal(jsonLd.offers.availabilityStarts, '2026-11-01T01:00:00Z');
  assert.equal(jsonLd.offers.availabilityEnds, '2026-11-08T15:00:00Z');
});

test('품절 품목은 품절로 알린다', () => {
  const jsonLd = build(round({}, [item({ status: 'SOLD_OUT' })]));
  assert.equal(jsonLd.offers.availability, 'https://schema.org/SoldOut');
});

test('가격을 확정할 수 없으면 상품 JSON-LD를 만들지 않는다', () => {
  assert.equal(build(null), null);
  assert.equal(build(round({ status: 'CLOSED' })), null);
  assert.equal(build(round({ storeId: 's2' })), null);
  assert.equal(build(round({}, [item({ status: 'HIDDEN' })])), null);
  assert.equal(build(round({}, [item({ status: 'CLOSED' })])), null);
  assert.equal(build(round({}, [item({ productId: 'p2' })])), null);
  assert.equal(build(round({}, [item(), item()])), null);
  assert.equal(build(round({}, [item({ roundPrice: 0 })])), null);
  assert.equal(
    buildProductJsonLd({ product: { ...product, name: ' ' }, round: round(), siteUrl: SITE, sellerName: 'x' }),
    null,
  );
});

test('현재 회차는 판매 중 우선, 없으면 가장 가까운 미래 판매 예정 회차다', () => {
  const later = round({ id: 'later', status: 'SCHEDULED', schedule: { orderOpenAt: '2026-11-08T01:00:00Z', orderCloseAt: 'x' } });
  const sooner = round({ id: 'sooner', status: 'SCHEDULED' });
  const past = round({ id: 'past', status: 'SCHEDULED', schedule: { orderOpenAt: '2026-10-01T00:00:00Z', orderCloseAt: 'x' } });
  const closed = round({ id: 'closed', status: 'CLOSED' });
  assert.equal(selectOrderableRound([later, sooner, past, closed], NOW).id, 'sooner');
  assert.equal(selectOrderableRound([later, round({ id: 'open' })], NOW).id, 'open');
  assert.equal(selectOrderableRound([closed, past], NOW), null);
});

test('사업자 정보는 화면 footer와 같은 값으로 싣고 주소를 나눈다', () => {
  const jsonLd = buildSiteJsonLd(
    {
      brand: '그린러브',
      businessName: '디어 오키드',
      registrationNumber: '505-28-01702',
      address: '경기도 이천시 백사면 도지리 543-2',
      phone: '010-4452-2104',
      email: 'support@greenlove.co.kr',
      kakaoChannel: { url: 'https://pf.kakao.com/_vGfjX' },
    },
    SITE,
    `${SITE}/icons/icon-512x512.png`,
  );
  const [store, website] = jsonLd['@graph'];
  assert.equal(store['@type'], 'OnlineStore');
  assert.equal(store.legalName, '디어 오키드');
  assert.equal(store.telephone, '+82-10-4452-2104');
  assert.equal(store.taxID, '505-28-01702');
  assert.deepEqual(store.address, {
    '@type': 'PostalAddress',
    streetAddress: '백사면 도지리 543-2',
    addressLocality: '이천시',
    addressRegion: '경기도',
    addressCountry: 'KR',
  });
  assert.deepEqual(website.publisher, { '@id': store['@id'] });
});

test('직렬화 결과는 script 태그를 닫을 수 없다', () => {
  const text = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
  assert.ok(!text.includes('<'));
  assert.equal(JSON.parse(text).name, '</script><script>alert(1)</script>');
});
