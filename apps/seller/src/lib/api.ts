const BASE_URL = process.env.NEXT_PUBLIC_API_URL;

function normalizeApiMessage(status: number, message: unknown) {
  const raw = Array.isArray(message) ? message.join(', ') : String(message || '');
  if (status === 400 && raw.includes('should not exist')) {
    return '입력 항목과 서버 저장 형식이 맞지 않아 저장하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }
  return raw || `서버 오류 (${status})`;
}

/** API 응답이 2xx가 아닐 때 던지는 에러. `.message`는 서버 본문 메시지 또는 상태코드 폴백. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
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
    const apiBody = (await res.json().catch(() => ({}))) as {
      message?: string | string[];
      reason?: string;
    };
    throw new ApiError(
      res.status,
      normalizeApiMessage(res.status, apiBody?.message),
      apiBody?.reason,
    );
  }
  return (await res.json().catch(() => ({}))) as T;
}
