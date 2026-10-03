/**
 * 기사 앱 API 호출 시간 제한의 순수 판단 (DOM·네트워크 없음, node:test로 검증).
 *
 * 시간 제한이 없으면 서버가 응답을 늦게 주거나 전파가 약할 때 fetch가 끝나지 않아
 * 버튼이 계속 로딩 상태로 남고, in-flight 가드 때문에 다시 누를 수도 없다.
 * 시간 초과는 "실패"가 아니라 "응답 불확실"이다: 서버는 이미 처리했을 수 있으므로
 * 호출자는 같은 명령을 자동 재전송하지 않고 상태를 다시 조회해 수렴해야 한다.
 */

/** 조회(GET). 단건·목록 조회는 서버 쪽 대기 작업이 없어 보통 1초 안에 끝난다. */
export const API_READ_TIMEOUT_MS = 15_000;

/**
 * 명령(PATCH·POST 등). 상태 변경 PATCH(배송 시작·완료·보류·사진 완료)는 서버가 상태를
 * 저장한 뒤 알림(알림톡·문자) 발송이 끝날 때까지 기다렸다가 응답한다
 * (apps/api orders-lifecycle.service.ts updateStatus → sendTransitionNotification).
 * 서버(PR #378)는 ALIGO 호출당 8초 제한을 두며, 최악 대기는 약 35초
 * (알림톡 3회×8초 + SMS 1회×8초 + 재시도 대기 최대 3초), ALIGO 무응답의 흔한 경우는 약 8초다.
 * 최악 대기 35초보다 넉넉하게 45초로 둔다. 서버 쪽 제한이 바뀌면 이 값도 다시 본다.
 */
export const API_COMMAND_TIMEOUT_MS = 45_000;

/**
 * 사진 업로드(multipart). 앱이 사진을 4MB 이하로 줄여 올리지만(photo-upload-policy.ts),
 * 약한 모바일 회선(약 1Mbps)에서는 4MB 전송에만 약 32초가 걸릴 수 있고, 배송 완료 사진은
 * 서버가 완료 처리 뒤 알림 발송(최악 약 35초)까지 기다릴 수 있어 둘을 더한 약 67초보다
 * 넉넉하게 90초로 둔다. 시간 초과는 업로드 흐름의 NETWORK(불확실) 실패로 분류되어
 * 상태 재조회로 수렴하고, 재시도는 같은 멱등 키·같은 사진으로만 한다.
 */
export const API_UPLOAD_TIMEOUT_MS = 90_000;

/**
 * 이 요청에 적용할 시간 제한(ms).
 * - 호출자가 양의 유한수로 명시하면 그 값을 쓴다.
 * - 본문이 FormData(사진 업로드)면 업로드 제한.
 * - GET·HEAD(메서드 생략 포함)는 조회 제한.
 * - 그 밖의 메서드는 명령 제한.
 */
export function resolveApiTimeoutMs(args: {
  method?: string | null;
  isFormData?: boolean;
  timeoutMs?: number | null;
}): number {
  const { timeoutMs } = args;
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  if (args.isFormData) return API_UPLOAD_TIMEOUT_MS;
  const method = (args.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return API_READ_TIMEOUT_MS;
  return API_COMMAND_TIMEOUT_MS;
}

/**
 * 시간 제한 초과. 호출자 취소(AbortError DOMException)와 구분되도록 DOMException이 아닌
 * 별도 Error로 둔다: 기존 화면들은 AbortError를 "내가 취소한 요청"으로 보고 조용히 무시한다.
 */
export class ApiTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`API 응답이 ${timeoutMs}ms 안에 오지 않았습니다.`);
    this.name = 'ApiTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function isApiTimeoutError(cause: unknown): boolean {
  if (cause instanceof ApiTimeoutError) return true;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { name?: unknown }).name === 'ApiTimeoutError'
  );
}

/**
 * fetch에 시간 제한을 씌운다. fetch 구현을 주입받아 node:test에서 가짜 fetch로 검증한다.
 *
 * - 호출자 취소 신호와 시간 제한을 하나의 신호로 합친다
 *   (AbortSignal.any는 구형 모바일 브라우저에 없어 직접 합친다).
 * - 호출자 취소는 원래 사유(AbortError 등) 그대로 던진다: 기존 화면의 "취소 무시" 계약 유지.
 * - 시간 초과는 브라우저와 무관하게 항상 ApiTimeoutError로 던진다.
 * - 응답 헤더 이후 본문 읽기(response.json())까지 같은 기한으로 묶기 위해 성공해도 타이머를
 *   지우지 않는다. 본문을 다 읽은 뒤의 abort는 아무 일도 하지 않는다.
 */
export async function fetchWithTimeout(
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const { signal: callerSignal, ...rest } = init;
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    controller.abort(callerSignal.reason);
  } else {
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    callerSignal?.removeEventListener('abort', onCallerAbort);
    controller.abort(new ApiTimeoutError(timeoutMs));
  }, timeoutMs);

  try {
    return await fetchImpl(url, { ...rest, signal: controller.signal });
  } catch (cause) {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
    // 브라우저에 따라 abort 사유 대신 일반 AbortError로 거절되므로 직접 판정해 바꿔 던진다.
    if (timedOut) throw new ApiTimeoutError(timeoutMs);
    throw cause;
  }
}
