import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  type RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PortoneClient } from './portone.client';

// 서명 검증 실패는 요청마다 저장하지 않고, 구간마다 경고 한 줄과 직전 구간의 건수만 남긴다.
export const WEBHOOK_REJECTION_LOG_WINDOW_MS = 60 * 1000;

type WebhookRejectionReason =
  | 'missing_credentials'
  | 'timestamp_out_of_range'
  | 'signature_mismatch';

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

// 가드는 파이프보다 먼저 실행된다. 서명을 본문 검증(ValidationPipe)보다 앞에서 확인해,
// 서명이 없거나 틀린 요청은 본문 형식과 무관하게 401만 받는다.
@Injectable()
export class PortoneWebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(PortoneWebhookSignatureGuard.name);
  private rejectionWindowStartedAt: number | null = null;
  private suppressedRejections = 0;

  constructor(private readonly portone: PortoneClient) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const rawBody = req.rawBody;
    const webhookId = headerValue(req, 'webhook-id');
    const webhookTimestamp = headerValue(req, 'webhook-timestamp');
    const webhookSignature = headerValue(req, 'webhook-signature');
    let reason: WebhookRejectionReason = 'missing_credentials';
    try {
      if (
        !Buffer.isBuffer(rawBody) ||
        !webhookId?.trim() ||
        !webhookTimestamp?.trim() ||
        !webhookSignature?.trim()
      ) {
        throw new UnauthorizedException('웹훅 인증 정보가 누락되었습니다.');
      }
      reason = 'signature_mismatch';
      this.portone.verifyWebhookSignature(webhookId, webhookTimestamp, rawBody, webhookSignature);
    } catch (e) {
      if (reason === 'signature_mismatch' && /timestamp/.test((e as Error).message ?? '')) {
        reason = 'timestamp_out_of_range';
      }
      this.recordWebhookRejection(reason);
      throw e;
    }
    return true;
  }

  // 요청 값(헤더·본문)은 남기지 않는다. 구간의 첫 실패만 경고하고, 나머지는 다음 구간 첫 경고에 건수로 합친다.
  private recordWebhookRejection(reason: WebhookRejectionReason) {
    const now = Date.now();
    if (
      this.rejectionWindowStartedAt !== null &&
      now - this.rejectionWindowStartedAt < WEBHOOK_REJECTION_LOG_WINDOW_MS
    ) {
      this.suppressedRejections += 1;
      return;
    }
    const suppressed = this.suppressedRejections;
    this.rejectionWindowStartedAt = now;
    this.suppressedRejections = 0;
    this.logger.warn(
      `webhook rejected: reason=${reason}${suppressed > 0 ? ` suppressedSinceLastWarning=${suppressed}` : ''}`,
    );
  }
}
