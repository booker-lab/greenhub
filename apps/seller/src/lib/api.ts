import { getApiBaseUrl } from '@/lib/api-base-url';

/** API 응답이 2xx가 아닐 때 던지는 에러. `.message`는 화면에 그대로 보여도 되는 한국어 안내. */
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
  return fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

/** 저장(POST·PATCH 등)이 서버 문제로 실패했을 때 보여줄 안내. */
export const SERVER_SAVE_FAILED_MESSAGE =
  '서버에서 문제가 생겨 저장하지 못했어요. 입력은 그대로 있어요. 잠시 뒤 다시 시도해 주세요.';
/** 조회(GET)가 서버 문제로 실패했을 때 보여줄 안내. */
export const SERVER_LOAD_FAILED_MESSAGE =
  '서버에서 문제가 생겨 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';

const HANGUL = /[\uAC00-\uD7A3]/;

/**
 * 실패 응답을 화면에 보여줄 문구로 바꾼다.
 * - 4xx의 서버 메시지는 그대로 둔다(서버가 판매자에게 하는 한국어 안내).
 * - 본문 메시지가 없거나, 5xx인데 한국어 안내가 아니면(Nest 기본 "Internal server error" 등)
 *   영문 원문 대신 한국어 안내를 쓴다. 5xx라도 서버가 일부러 담은 한국어 안내(503 재시도 안내 등)는 살린다.
 */
export function apiErrorMessage(status: number, bodyMessage: unknown, method = 'GET'): string {
  // 입력 검증 실패(400)는 메시지가 배열로 온다. 예전처럼 문자열로 이어 붙여 보여준다.
  const message =
    typeof bodyMessage === 'string' || Array.isArray(bodyMessage) ? String(bodyMessage).trim() : '';
  if (message && (status < 500 || HANGUL.test(message))) return message;
  return method.toUpperCase() === 'GET' ? SERVER_LOAD_FAILED_MESSAGE : SERVER_SAVE_FAILED_MESSAGE;
}

/**
 * apiFetch + 응답 검사 + JSON 파싱을 묶은 헬퍼.
 * 2xx가 아니면 `apiErrorMessage`로 고른 문구와 상태코드를 담아 `ApiError`를 던진다.
 * 본문이 없으면 빈 객체를 반환(상태 변경 PATCH 등 응답 바디 없는 경우 대응).
 */
export async function apiJson<T = unknown>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await apiFetch(path, token, options);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: unknown } | null;
    throw new ApiError(res.status, apiErrorMessage(res.status, body?.message, options.method));
  }
  return (await res.json().catch(() => ({}))) as T;
}
