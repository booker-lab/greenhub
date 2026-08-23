import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { login } from '../lib/auth.js';
import {
  API_BASE_URL,
  ENABLE_WRITES,
  PROFILE,
  authHeaders,
  targetIds,
} from '../lib/env.js';
import { scenarioOptions } from '../lib/options.js';

export const options = scenarioOptions(PROFILE, {
  http_req_duration: ['p(95)<1500', 'p(99)<3000'],
});

export function setup() {
  return {
    consumerToken: login('consumer'),
  };
}

export default function (data) {
  const ids = targetIds();

  group('주문 전 조회', () => {
    check(http.get(`${API_BASE_URL}/products/${ids.productId}`), {
      '상품 상세 성공': (r) => r.status === 200 || r.status === 404,
    });
    check(http.get(`${API_BASE_URL}/stores/${ids.storeId}/delivery-config`), {
      '배송 설정 성공': (r) => r.status === 200 || r.status === 404,
    });
  });

  if (ENABLE_WRITES && data.consumerToken) {
    const payload = {
      productId: ids.productId,
      quantity: 1,
      saleType: 'normal',
      deliveryMethod: 'direct',
      deliveryAddress: {
        address: '서울시 테스트구 테스트로 1',
        addressDetail: '101호',
        zipCode: '00000',
      },
      requestedDeliveryDate: '2026-07-10',
    };

    const response = http.post(
      `${API_BASE_URL}/stores/${ids.storeId}/orders`,
      JSON.stringify(payload),
      authHeaders(data.consumerToken),
    );
    check(response, {
      '주문 생성 성공': (r) => r.status === 201 || r.status === 200,
    });
  }

  sleep(1);
}
