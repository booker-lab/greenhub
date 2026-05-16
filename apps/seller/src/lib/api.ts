const BASE_URL = process.env.NEXT_PUBLIC_API_URL;

/** API 응답이 2xx가 아닐 때 던지는 에러. `.message`는 서버 본문 메시지 또는 상태코드 폴백. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Railway API에 인증 헤더를 붙여 fetch. 응답 검사 없이 raw Response 반환. */
export async function apiFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

/**
 * apiFetch + 응답 검사 + JSON 파싱을 묶은 헬퍼.
 * 2xx가 아니면 서버 본문 `message`를 담아 `ApiError`를 던진다.
 * 본문이 없으면 빈 객체를 반환(상태 변경 PATCH 등 응답 바디 없는 경우 대응).
 */
export async function apiJson<T = unknown>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await apiFetch(path, token, options);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body?.message ?? `서버 오류 (${res.status})`);
  }
  return (await res.json().catch(() => ({}))) as T;
}
