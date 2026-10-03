import { getApiBaseUrl } from '@/lib/api-base-url';
import { fetchWithTimeout, resolveApiTimeoutMs } from '@/lib/api-timeout';

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
