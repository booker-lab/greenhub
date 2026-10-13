import { type ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Firestore가 "잠시 뒤 다시 하면 될 수 있다"는 뜻으로 돌려주는 gRPC 상태 코드.
 * 4 DEADLINE_EXCEEDED, 10 ABORTED(트랜잭션 경합 — 같은 회차 문서를 여러 결제가 동시에 고칠 때),
 * 14 UNAVAILABLE.
 */
const RETRYABLE_FIRESTORE_CODES = new Map<number, string>([
  [4, 'DEADLINE_EXCEEDED'],
  [10, 'ABORTED'],
  [14, 'UNAVAILABLE'],
]);

export const RETRYABLE_FIRESTORE_MESSAGE =
  '요청이 몰려 잠시 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';

/**
 * gRPC 오류만 골라낸다. gRPC 오류 메시지는 `${code} ${STATUS}: ...` 형식이라
 * 숫자 code가 우연히 같은 다른 오류(HTTP 상태 등)와 구분된다.
 */
export function retryableFirestoreCode(error: unknown): number | null {
  if (!error || typeof error !== 'object' || error instanceof HttpException) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== 'number') return null;
  const status = RETRYABLE_FIRESTORE_CODES.get(code);
  if (!status) return null;
  if (typeof message !== 'string' || !message.startsWith(`${code} ${status}`)) return null;
  return code;
}

/**
 * 오픈 직후처럼 결제가 몰려 Firestore 트랜잭션이 재시도 끝에 실패하면 지금까지는
 * 손님 화면에 영어 "Internal server error"(500)가 떴다. 이런 일시 실패만 503과
 * 다시 시도하라는 안내로 바꾼다. 소비자 결제는 5xx면 같은 결제 시도 ID로 다시 보내므로
 * 재시도해도 주문이 두 번 생기지 않는다. 그 밖의 오류는 기본 처리 그대로 둔다.
 */
@Catch()
export class FirestoreRetryableErrorFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(FirestoreRetryableErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const code = host.getType() === 'http' ? retryableFirestoreCode(exception) : null;
    if (code === null) {
      super.catch(exception, host);
      return;
    }
    const http = host.switchToHttp();
    const request = http.getRequest<{ method?: string; route?: { path?: string } }>();
    // 경로 패턴만 남긴다(주소의 주문·회차 ID나 본문은 남기지 않는다).
    this.logger.warn(
      `firestore.retryable code=${code} route=${request.method ?? '-'} ${request.route?.path ?? '-'}`,
    );
    http
      .getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>()
      .status(HttpStatus.SERVICE_UNAVAILABLE)
      .json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        message: RETRYABLE_FIRESTORE_MESSAGE,
        retryable: true,
      });
  }
}
