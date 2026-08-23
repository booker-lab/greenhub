import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { API_BASE_URL, PROFILE, targetIds } from '../lib/env.js';
import { scenarioOptions } from '../lib/options.js';

export const options = scenarioOptions(PROFILE, {
  http_req_duration: ['p(95)<800', 'p(99)<2000'],
});

export default function () {
  const ids = targetIds();

  group('공개 탐색', () => {
    check(http.get(`${API_BASE_URL}/banner`), {
      '배너 조회 성공': (r) => r.status === 200,
    });
    check(http.get(`${API_BASE_URL}/products`), {
      '상품 목록 성공': (r) => r.status === 200,
    });
  });

  group('상품 상세', () => {
    check(http.get(`${API_BASE_URL}/products/${ids.productId}`), {
      '상품 상세 성공': (r) => r.status === 200,
    });
    check(http.get(`${API_BASE_URL}/stores/${ids.storeId}/products`), {
      '스토어 상품 성공': (r) => r.status === 200,
    });
    check(http.get(`${API_BASE_URL}/stores/${ids.storeId}/delivery-config`), {
      '배송 설정 성공': (r) => r.status === 200,
    });
  });

  sleep(1);
}
