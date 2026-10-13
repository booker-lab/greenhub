import { getSession } from 'next-auth/react';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { fetchWithTimeout, resolveApiTimeoutMs } from '@/lib/api-timeout';
import { retryReadOnceOnUnauthorized } from '@/lib/session-refresh';

export type ApiFetchOptions = RequestInit & {
  /** 이 요청만의 시간 제한(ms). 생략하면 조회·명령·업로드 기본값(api-timeout.ts)을 쓴다. */
  timeoutMs?: number;
};

/**
 * 기사 앱 API 호출. 모든 요청에 시간 제한이 걸린다(조회 15초·명령 45초·사진 업로드 90초).
 * 시간 초과는 ApiTimeoutError로 던지며, 명령 호출자는 이를 "응답 불확실"로 보고
 * 같은 명령을 자동 재전송하지 않고 상태를 다시 조회해 수렴해야 한다.
 */
export async function apiFetch(
  path: string,
  token: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const { timeoutMs, ...init } = options;
  const isFormData = init.body instanceof FormData;
  return fetchWithTimeout(
    (input, requestInit) => fetch(input, requestInit),
    `${getApiBaseUrl()}${path}`,
    {
      ...init,
      headers: {
        ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    },
    resolveApiTimeoutMs({ method: init.method, isFormData, timeoutMs }),
  );
}

export type ApiReadOptions = Pick<ApiFetchOptions, 'signal' | 'timeoutMs'>;

/**
 * 조회(GET) 전용 호출. 화면이 기억한 API 토큰이 만료돼 401이 오면 세션을 한 번 다시 받아
 * (Auth.js jwt callback이 만료 토큰을 갱신한다) 새 토큰으로 같은 조회를 한 번만 다시 보낸다.
 * 메서드를 GET으로 고정해 명령(PATCH·POST)은 이 경로로 다시 보내지지 않는다. 명령은 apiFetch를
 * 쓰고, 응답이 불확실하면 자동 재전송 없이 상태를 다시 조회해 수렴한다(#379).
 */
export function apiRead(
  path: string,
  token: string,
  options: ApiReadOptions = {},
): Promise<Response> {
  return retryReadOnceOnUnauthorized({
    read: (readToken) => apiFetch(path, readToken, { ...options, method: 'GET' }),
    token,
    refreshAccessToken: async () => (await getSession())?.user?.accessToken,
  });
}
