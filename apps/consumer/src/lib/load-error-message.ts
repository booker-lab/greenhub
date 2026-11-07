// 조회 실패를 손님에게 보일 문구로 바꾼다. 브라우저 원문("Failed to fetch")이나 HTTP 상태 코드는 화면에 내지 않는다.

export const CONNECTION_UNSTABLE_MESSAGE = '연결이 불안정해요. 잠시 후 다시 시도해 주세요.';

// fetch가 연결 실패 때 던지는 브라우저별 원문: Chrome "Failed to fetch", Safari "Load failed",
// Firefox "NetworkError when attempting to fetch resource.", Node "fetch failed".
const NETWORK_FAILURE = /failed to fetch|load failed|networkerror|network ?error|network request failed|fetch failed/i;

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/** 연결 자체가 안 된 실패인지(응답을 받은 HTTP 오류와 구분한다). */
export function isConnectionFailure(error: unknown): boolean {
  return NETWORK_FAILURE.test(readMessage(error));
}

/**
 * 조회 실패 안내. 연결 실패면 연결 안내, 그 밖(HTTP 오류·응답 형식 오류)은 "○○ 불러오지 못했어요" 안내.
 * subject는 목적격 조사까지 넣는다(예: "상품을").
 */
export function customerLoadErrorMessage(error: unknown, subject = '정보를'): string {
  if (isConnectionFailure(error)) return CONNECTION_UNSTABLE_MESSAGE;
  return `${subject} 불러오지 못했어요. 잠시 후 다시 시도해 주세요.`;
}
