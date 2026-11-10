import { describe, expect, it } from 'vitest';
import { readPickupPlace } from './pickup-place';

describe('수거 장소 표시', () => {
  it('수거 대기 주문의 가게 이름·주소와 카카오맵 주소 검색 링크를 만든다', () => {
    expect(
      readPickupPlace({
        status: 'PREPARING',
        pickupStoreName: '디어 오키드',
        pickupAddress: '경기도 이천시 가게로 3',
      }),
    ).toEqual({
      storeName: '디어 오키드',
      address: '경기도 이천시 가게로 3',
      label: '수거: 디어 오키드 · 경기도 이천시 가게로 3',
      mapHref: `https://map.kakao.com/link/search/${encodeURIComponent('경기도 이천시 가게로 3')}`,
    });
  });

  it('가게 이름만 있으면 이름만 쓰고 지도 링크는 두지 않는다', () => {
    expect(readPickupPlace({ status: 'PREPARING', pickupStoreName: ' 가게 ' })).toEqual({
      storeName: '가게',
      address: null,
      label: '수거: 가게',
      mapHref: null,
    });
  });

  it('필드가 없거나 비었거나 수거 대기가 아니면 숨긴다', () => {
    expect(readPickupPlace({ status: 'PREPARING' })).toBeNull();
    expect(
      readPickupPlace({ status: 'PREPARING', pickupStoreName: '  ', pickupAddress: '' }),
    ).toBeNull();
    expect(readPickupPlace({ status: 'PREPARING', pickupStoreName: 3 })).toBeNull();
    expect(
      readPickupPlace({ status: 'DELIVERING', pickupStoreName: '가게', pickupAddress: '주소' }),
    ).toBeNull();
  });
});
