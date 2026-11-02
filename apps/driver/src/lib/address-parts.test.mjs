import assert from 'node:assert/strict';
import test from 'node:test';
import { splitDeliveryAddress } from './address-parts.ts';

test('기본 주소 뒤에 붙은 동·호수를 상세 주소로 나눈다', () => {
  assert.deepEqual(
    splitDeliveryAddress(
      '경기도 이천시 증포동 새봄마을아파트 103동 1204호',
      '경기도 이천시 증포동 새봄마을아파트',
    ),
    { base: '경기도 이천시 증포동 새봄마을아파트', detail: '103동 1204호' },
  );
});

test('기본 주소가 없거나 같거나 앞부분이 아니면 나누지 않는다', () => {
  assert.deepEqual(splitDeliveryAddress('이천시 중리천로 115', undefined), {
    base: '이천시 중리천로 115',
    detail: null,
  });
  assert.deepEqual(splitDeliveryAddress('이천시 중리천로 115', '이천시 중리천로 115'), {
    base: '이천시 중리천로 115',
    detail: null,
  });
  assert.deepEqual(splitDeliveryAddress('이천시 중리천로 115', '서울시 중구'), {
    base: '이천시 중리천로 115',
    detail: null,
  });
});

test('전체 주소가 비어 있으면 null', () => {
  assert.equal(splitDeliveryAddress('  ', '이천시'), null);
  assert.equal(splitDeliveryAddress(null, null), null);
});
