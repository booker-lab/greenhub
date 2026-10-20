import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { OpsAlertService } from '../../ops-alerts/ops-alert.service';

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
 * 기본 처리가 돌려줄 HTTP 상태. HttpException이 아니어도 body-parser 오류처럼
 * statusCode를 가진 오류는 그 상태(400·413 등)로 응답되므로 그대로 따른다.
 */
function responseStatus(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  if (exception && typeof exception === 'object') {
    const { statusCode, message } = exception as { statusCode?: unknown; message?: unknown };
    if (typeof statusCode === 'number' && typeof message === 'string') return statusCode;
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

/** 알림에 싣는 오류 이름. 클래스 이름 형태만 쓰고 그 밖은 버린다(메시지·ID가 섞이지 않게). */
function errorName(exception: unknown): string {
  const name =
    exception && typeof exception === 'object'
      ? ((exception as { name?: unknown }).name ?? exception.constructor?.name)
      : typeof exception;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)
    ? name
    : 'UnknownError';
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

  constructor(@Optional() @Inject(OpsAlertService) private readonly opsAlert?: OpsAlertService) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const code = host.getType() === 'http' ? retryableFirestoreCode(exception) : null;
    if (code === null) {
      if (host.getType() === 'http') this.alertServerError(exception, host);
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

  /**
   * 5xx로 끝나는 예외를 운영 텔레그램으로 알린다. 503은 뜻을 담아 일부러 돌려주는 응답
   * (Firestore 일시 오류, 재배송비 환불 미완료로 웹훅 재전송 유도 등)이라 알리지 않는다.
   * 메서드와 경로 패턴, 오류 이름만 싣는다. 실제 주소(주문 ID)·오류 메시지는 싣지 않는다.
   * 전송을 기다리지 않는다(응답을 늦추지 않음, 실패해도 throw하지 않는 서비스).
   */
  private alertServerError(exception: unknown, host: ArgumentsHost) {
    if (!this.opsAlert?.enabled) return;
    const status = responseStatus(exception);
    if (status < 500 || status === (HttpStatus.SERVICE_UNAVAILABLE as number)) return;
    const request = host
      .switchToHttp()
      .getRequest<{ method?: string; route?: { path?: string } }>();
    const route = `${request.method ?? '-'} ${request.route?.path ?? '-'}`;
    const name = errorName(exception);
    void this.opsAlert.send({
      level: 'critical',
      title: `서버 오류 ${status}`,
      lines: [`요청: ${route}`, `오류: ${name}`],
      dedupeKey: `server-error:${route}:${name}`,
    });
  }
}
