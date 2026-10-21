/**
 * 주문 상태 변경 명령(PATCH .../status) 뒤 화면이 결과를 보일 때까지의 대기 시간.
 *
 * 서버는 상태를 바꾼 뒤 고객 알림톡을 멱등 기록(발송 선점·시도 기록·완료 기록)과 함께 보내고 나서
 * 응답한다. 원격 스테이징에서는 이 왕복이 건당 수 초 걸려, Playwright 기본 대기(5초) 안에 끝나지
 * 않을 수 있다(2026-10-21 회차 E2E에서 일괄 준비 시작·배송 재개가 이 이유로 실패).
 * 화면이 명령 응답을 기다리는 단언에만 쓰고, 화면 그리기만 기다리는 단언은 기본 대기를 그대로 쓴다.
 */
export const ORDER_COMMAND_SETTLE_TIMEOUT_MS = 10_000;

/** Playwright 시험 하나의 제한 시간. playwright.config.ts가 이 값을 쓴다. */
export const E2E_TEST_TIMEOUT_MS = 30_000;

/** 로컬 대상 모드의 화면 확인 기본 대기. playwright.config.ts가 이 값을 쓴다. */
export const LOCAL_TARGET_EXPECT_TIMEOUT_MS = 15_000;

/**
 * 명령 commandCount건을 차례로 보내는 화면(예: 결제 완료 주문 일괄 준비 시작)이 끝났다고 보일 때까지의
 * 대기 시간. 명령은 한 건씩 차례로 나가므로 건수만큼 늘리고, 로컬 대상 모드 기본 대기보다 짧게 줄이지 않는다.
 * 시험 제한 시간 안에 앞뒤 단계가 들어갈 자리가 없으면 시험을 고치라고 바로 실패한다.
 */
export function orderCommandsSettleTimeout(commandCount = 1): number {
  if (!Number.isInteger(commandCount) || commandCount < 1) {
    throw new Error('명령 건수는 1 이상의 정수여야 합니다.');
  }
  const timeout = Math.max(
    ORDER_COMMAND_SETTLE_TIMEOUT_MS * commandCount,
    LOCAL_TARGET_EXPECT_TIMEOUT_MS,
  );
  if (timeout >= E2E_TEST_TIMEOUT_MS) {
    throw new Error(`명령 ${commandCount}건의 대기(${timeout}ms)가 시험 제한 시간을 넘습니다.`);
  }
  return timeout;
}
