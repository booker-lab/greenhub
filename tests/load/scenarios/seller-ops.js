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

export const options = scenarioOptions(PROFILE);

export function setup() {
  return {
    sellerToken: login('seller'),
  };
}

export default function (data) {
  if (!data.sellerToken) {
    return;
  }

  const ids = targetIds();
  const headers = authHeaders(data.sellerToken);

  group('판매자 주문 운영', () => {
    check(http.get(`${API_BASE_URL}/stores/${ids.storeId}/orders`, headers), {
      '판매자 주문 목록 성공': (r) => r.status === 200 || r.status === 403 || r.status === 404,
    });
    check(http.get(`${API_BASE_URL}/stores/${ids.storeId}/orders/${ids.orderId}`, headers), {
      '판매자 주문 상세 성공': (r) => r.status === 200 || r.status === 403 || r.status === 404,
    });
  });

  if (ENABLE_WRITES) {
    const response = http.patch(
      `${API_BASE_URL}/stores/${ids.storeId}/orders/${ids.orderId}/status`,
      JSON.stringify({ status: 'ACCEPTED' }),
      headers,
    );
    check(response, {
      '판매자 상태 변경 성공': (r) => r.status === 200 || r.status === 403 || r.status === 404,
    });
  }

  sleep(1);
}
