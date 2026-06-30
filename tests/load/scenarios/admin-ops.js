import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { login } from '../lib/auth.js';
import { API_BASE_URL, PROFILE, authHeaders } from '../lib/env.js';
import { scenarioOptions } from '../lib/options.js';

export const options = scenarioOptions(PROFILE);

export function setup() {
  return {
    adminToken: login('admin'),
  };
}

export default function (data) {
  if (!data.adminToken) {
    return;
  }

  const headers = authHeaders(data.adminToken);

  group('관리자 운영 조회', () => {
    check(http.get(`${API_BASE_URL}/admin/orders`, headers), {
      '관리자 주문 목록 성공': (r) => r.status === 200 || r.status === 403,
    });
    check(http.get(`${API_BASE_URL}/admin/settlements`, headers), {
      '관리자 정산 목록 성공': (r) => r.status === 200 || r.status === 403,
    });
    check(http.get(`${API_BASE_URL}/admin/stores`, headers), {
      '관리자 스토어 목록 성공': (r) => r.status === 200 || r.status === 403,
    });
    check(http.get(`${API_BASE_URL}/admin/users`, headers), {
      '관리자 사용자 목록 성공': (r) => r.status === 200 || r.status === 403,
    });
  });

  sleep(1);
}
