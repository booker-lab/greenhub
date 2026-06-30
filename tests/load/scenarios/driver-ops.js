import { check, sleep } from 'k6';
import http from 'k6/http';
import { login } from '../lib/auth.js';
import { API_BASE_URL, PROFILE, authHeaders } from '../lib/env.js';
import { scenarioOptions } from '../lib/options.js';

export const options = scenarioOptions(PROFILE);

export function setup() {
  return {
    driverToken: login('driver'),
  };
}

export default function (data) {
  if (!data.driverToken) {
    return;
  }

  const response = http.get(
    `${API_BASE_URL}/driver/orders?status=PREPARING,DELIVERING`,
    authHeaders(data.driverToken),
  );
  check(response, {
    '드라이버 주문 목록 성공': (r) => r.status === 200 || r.status === 403,
  });

  sleep(1);
}
