import { check, sleep } from 'k6';
import http from 'k6/http';
import { login } from '../lib/auth.js';
import { API_BASE_URL, PROFILE, authHeaders } from '../lib/env.js';
import { scenarioOptions } from '../lib/options.js';

export const options = scenarioOptions(PROFILE);

export function setup() {
  return {
    consumerToken: login('consumer'),
  };
}

export default function (data) {
  const health = http.get(`${API_BASE_URL}/health`);
  check(health, {
    'health 정상': (r) => r.status === 200 && r.json('status') === 'ok',
  });

  const banner = http.get(`${API_BASE_URL}/banner`);
  check(banner, {
    '배너 조회 성공': (r) => r.status === 200,
  });

  const products = http.get(`${API_BASE_URL}/products`);
  check(products, {
    '공개 상품 조회 성공': (r) => r.status === 200,
  });

  if (data.consumerToken) {
    const me = http.get(`${API_BASE_URL}/auth/me`, authHeaders(data.consumerToken));
    check(me, {
      '내 정보 조회 성공': (r) => r.status === 200,
    });
  }

  sleep(1);
}
