import { check } from 'k6';
import http from 'k6/http';
import { API_BASE_URL, credentials, jsonHeaders } from './env.js';

export function login(role) {
  const account = credentials(role);
  if (!account.email || !account.password) {
    return null;
  }

  const response = http.post(
    `${API_BASE_URL}/auth/login`,
    JSON.stringify(account),
    jsonHeaders(),
  );

  check(response, {
    [`${role} 로그인 성공`]: (r) => r.status === 200 && Boolean(r.json('accessToken')),
  });

  return response.status === 200 ? response.json('accessToken') : null;
}
