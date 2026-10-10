import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildKakaoMapRouteUrl,
  buildKakaoMapSearchUrl,
  buildOrderMapLink,
  destinationAddress,
  pickNextDeliveryStop,
  toValidCoordinate,
} from './map-navigation-link.ts';

const mapSource = await readFile(new URL('../page.tsx', import.meta.url), 'utf8');

test('검색 링크: 한글 주소를 경로 세그먼트로 인코딩한다', () => {
  const href = buildKakaoMapSearchUrl('서울 강남구 테헤란로 123');
  assert.equal(
    href,
    `https://map.kakao.com/link/search/${encodeURIComponent('서울 강남구 테헤란로 123')}`,
  );
  assert.equal(decodeURIComponent(href.split('/link/search/')[1]), '서울 강남구 테헤란로 123');
  assert.doesNotMatch(href.split('/link/search/')[1], /[ 가-힣]/);
});

test('검색 링크: 특수문자(#·?·&·%·+)는 인코딩하고 / 는 경로 구분자로 쓰이지 않게 공백 처리한다', () => {
  const raw = '경기 성남시 분당구 판교로 1 #101 ?&%+ A/B동';
  const href = buildKakaoMapSearchUrl(raw);
  const segment = href.replace('https://map.kakao.com/link/search/', '');
  assert.doesNotMatch(segment, /[#?&/ ]/);
  assert.equal(decodeURIComponent(segment), '경기 성남시 분당구 판교로 1 #101 ?&%+ A B동');
  assert.doesNotThrow(() => new URL(href));
  assert.equal(new URL(href).pathname.split('/').length, 4);
});

test('검색 링크: 빈 주소·공백·비문자열은 링크를 만들지 않는다', () => {
  for (const value of ['', '   ', '\n\t', undefined, null, 0, {}]) {
    assert.equal(buildKakaoMapSearchUrl(value), null, String(value));
  }
});

test('검색 링크: 연속 공백은 하나로 접는다', () => {
  assert.equal(
    buildKakaoMapSearchUrl('  서울   중구\n세종대로  110 '),
    `https://map.kakao.com/link/search/${encodeURIComponent('서울 중구 세종대로 110')}`,
  );
});

test('좌표: 0·누락·비유한·범위 밖·문자열 좌표는 거부한다', () => {
  const rejected = [
    [0, 0],
    [0, 127.1],
    [37.5, 0],
    [undefined, 127.1],
    [37.5, undefined],
    [null, null],
    [Number.NaN, 127.1],
    [37.5, Number.POSITIVE_INFINITY],
    [91, 127.1],
    [37.5, 181],
    ['37.5', '127.1'],
  ];
  for (const [lat, lng] of rejected) {
    assert.equal(toValidCoordinate(lat, lng), null, `${lat},${lng}`);
    assert.equal(buildKakaoMapRouteUrl('목적지', lat, lng), null, `${lat},${lng}`);
  }
  assert.deepEqual(toValidCoordinate(37.5, 127.1), { lat: 37.5, lng: 127.1 });
});

test('길찾기 링크: 유효 좌표만 /link/to/이름,위도,경도 로 만든다', () => {
  assert.equal(
    buildKakaoMapRouteUrl('그린 거점', 37.4, 127.11),
    `https://map.kakao.com/link/to/${encodeURIComponent('그린 거점')},37.4,127.11`,
  );
  // 이름의 쉼표는 이름,위도,경도 구분자와 겹치지 않게 공백으로 바꾼다.
  const href = buildKakaoMapRouteUrl('A,B 거점', 37.4, 127.11);
  assert.equal(href, `https://map.kakao.com/link/to/${encodeURIComponent('A B 거점')},37.4,127.11`);
  // 이름이 비면 기본 라벨을 쓴다.
  assert.equal(
    buildKakaoMapRouteUrl('', 37.4, 127.11),
    `https://map.kakao.com/link/to/${encodeURIComponent('배송지')},37.4,127.11`,
  );
});

test('주문 링크: 좌표 없는 주문은 주소 검색, 0 좌표도 검색으로 떨어진다', () => {
  const noGeo = buildOrderMapLink({ deliveryMethod: 'home', address: '서울 강남구 테헤란로 123' });
  assert.equal(noGeo.kind, 'search');
  assert.match(noGeo.href, /^https:\/\/map\.kakao\.com\/link\/search\//);
  const zeroGeo = buildOrderMapLink({
    deliveryMethod: 'home',
    address: '서울 강남구 테헤란로 123',
    lat: 0,
    lng: 0,
  });
  assert.equal(zeroGeo.kind, 'search');
  assert.doesNotMatch(zeroGeo.href, /0,0|kakaomap:/);
});

test('주문 링크: hub 배송은 거점 주소를 쓰고, 유효 좌표면 거점명으로 길찾기한다', () => {
  const hub = {
    deliveryMethod: 'hub',
    hubName: '판교 거점',
    hubAddress: '성남시 분당구 판교역로 1',
    address: '무시될 주소',
  };
  assert.equal(destinationAddress(hub), '성남시 분당구 판교역로 1');
  assert.equal(
    buildOrderMapLink(hub).href,
    `https://map.kakao.com/link/search/${encodeURIComponent('성남시 분당구 판교역로 1')}`,
  );
  const hubGeo = buildOrderMapLink({ ...hub, lat: 37.39, lng: 127.11 });
  assert.deepEqual(hubGeo, {
    kind: 'route',
    href: `https://map.kakao.com/link/to/${encodeURIComponent('판교 거점')},37.39,127.11`,
  });
});

test('주문 링크: 기본 주소가 있으면 동·호수 붙은 전체 주소 대신 기본 주소로 검색한다', () => {
  const order = {
    deliveryMethod: 'direct',
    address: '경기도 이천시 중리천로 1 101동 1001호',
    deliveryAddress: { address: '경기도 이천시 중리천로 1' },
  };
  assert.equal(destinationAddress(order), '경기도 이천시 중리천로 1');
  assert.equal(
    buildOrderMapLink(order).href,
    `https://map.kakao.com/link/search/${encodeURIComponent('경기도 이천시 중리천로 1')}`,
  );
  // 기본 주소가 없거나 비었으면 전체 주소로 검색한다(이전 API 응답 포함).
  for (const deliveryAddress of [undefined, null, {}, { address: '  ' }, { address: 3 }]) {
    assert.equal(
      destinationAddress({ ...order, deliveryAddress }),
      '경기도 이천시 중리천로 1 101동 1001호',
      JSON.stringify(deliveryAddress),
    );
  }
  // 거점 배송은 그대로 거점 주소를 쓴다.
  assert.equal(
    destinationAddress({ ...order, deliveryMethod: 'hub', hubAddress: '성남시 분당구 판교역로 1' }),
    '성남시 분당구 판교역로 1',
  );
});

test('다음 배송지: 경로에서 처음 나오는 배송 중 주문만 고르고 수거 대기 주문은 고르지 않는다', () => {
  const route = [
    { id: 'unclaimed', status: 'PREPARING' },
    { id: 'mine-1', status: 'DELIVERING' },
    { id: 'mine-2', status: 'DELIVERING' },
  ];
  assert.equal(pickNextDeliveryStop(route)?.id, 'mine-1');
  assert.equal(pickNextDeliveryStop([{ id: 'a', status: 'PREPARING' }]), null);
  assert.equal(pickNextDeliveryStop([]), null);
  // 지도 탭은 이 판단으로 다음 배송지를 고르고, 없으면 안내만 보인다.
  assert.match(mapSource, /const nextStop = pickNextDeliveryStop\(sorted\)/);
  assert.match(mapSource, /아직 배송 중인 주문이 없습니다/);
});

test('주문 링크: 주소와 유효 좌표가 모두 없으면 링크를 만들지 않는다', () => {
  assert.equal(buildOrderMapLink({ deliveryMethod: 'home' }), null);
  assert.equal(buildOrderMapLink({ deliveryMethod: 'home', address: '  ', lat: 0, lng: 0 }), null);
  assert.equal(buildOrderMapLink({ deliveryMethod: 'hub', hubName: '거점', hubAddress: '' }), null);
});

test('주문 링크: 소비자 이름은 외부 지도 URL에 들어가지 않는다', () => {
  const link = buildOrderMapLink({
    deliveryMethod: 'home',
    buyerName: '홍길동',
    address: '서울 강남구 테헤란로 123',
    lat: 37.5,
    lng: 127.03,
  });
  assert.doesNotMatch(decodeURIComponent(link.href), /홍길동/);
});

test('지도 탭: 좌표 (0,0) 카카오맵 스킴과 경유지 조립이 제거되고 순수 함수를 쓴다', () => {
  assert.doesNotMatch(mapSource, /kakaomap:\/\//);
  assert.doesNotMatch(mapSource, /\?\? 0/);
  assert.doesNotMatch(mapSource, /via\$\{i\}/);
  assert.doesNotMatch(mapSource, /카카오내비/);
  assert.match(mapSource, /from '\.\/_lib\/map-navigation-link'/);
  assert.match(mapSource, /다음 배송지 카카오맵에서 열기/);
  // 다음 배송지 링크가 없으면 비활성 버튼과 안내를 보인다.
  assert.match(mapSource, /다음 배송지 주소가 없어 지도를 열 수 없습니다/);
  // 목록 행 지도 링크도 stale(error)에서는 fail-closed로 숨긴다.
  assert.match(mapSource, /const mapLink = error \? null : buildOrderMapLink\(order\)/);
});
