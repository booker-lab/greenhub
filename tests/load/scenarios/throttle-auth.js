import { check, sleep } from 'k6';
import http from 'k6/http';
import { API_BASE_URL, PROFILE, credentials, jsonHeaders } from '../lib/env.js';
import { scenarioOptions } from '../lib/options.js';

export const options = scenarioOptions(PROFILE, {
  http_req_failed: ['rate<0.30'],
});

export default function () {
  const account = credentials('consumer');
  if (!account.email || !account.password) {
    return;
  }

  const response = http.post(
    `${API_BASE_URL}/auth/login`,
    JSON.stringify(account),
    jsonHeaders(),
  );
  check(response, {
    '인증 제한 또는 로그인 성공': (r) => r.status === 200 || r.status === 429,
  });

  sleep(1);
}
