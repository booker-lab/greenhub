import * as crypto from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface PortonePaymentData {
  id: string;
  transactionId: string;
  amount: { total: number };
  status: string;
  method?: { type: string };
}

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/**
 * PortOne V2 idempotency contract (PILOT-REFUND-PROVIDER-IDEMPOTENCY-BINDING-28B).
 *
 * - POST /payments/{paymentId}/cancel accepts an `Idempotency-Key` header.
 * - The same business refund operation must reuse one stable key across its
 *   initial POST and every UNKNOWN-recovery retry POST, so PortOne treats
 *   them as a single provider operation (no duplicate processing).
 * - A key must never be reused across different refund operations.
 * - Official shape: 16-256 ASCII string. No secret/PII, no raw user input
 *   (reason/payment payloads) inside the key.
 */
export type PortoneRefundIdempotencyNamespace = 'payment-refund' | 'order-charge-refund';

const REFUND_IDEMPOTENCY_KEY_MIN_LENGTH = 16;
const REFUND_IDEMPOTENCY_KEY_MAX_LENGTH = 256;
const REFUND_IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]+$/;

export function createPortoneRefundIdempotencyKey(
  namespace: PortoneRefundIdempotencyNamespace,
): string {
  return `ghr-${namespace}-${crypto.randomUUID()}`;
}

export function isPortoneIdempotencyKeyShape(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= REFUND_IDEMPOTENCY_KEY_MIN_LENGTH &&
    value.length <= REFUND_IDEMPOTENCY_KEY_MAX_LENGTH &&
    REFUND_IDEMPOTENCY_KEY_PATTERN.test(value)
  );
}

export class PortoneError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: string,
    message: string,
  ) {
    super(message);
    this.name = 'PortoneError';
  }
}

@Injectable()
export class PortoneClient {
  private readonly secret: string;
  private readonly baseUrl = 'https://api.portone.io';
  private readonly logger = new Logger(PortoneClient.name);

  constructor(private readonly config: ConfigService) {
    this.secret = config.get<string>('PORTONE_V2_SECRET', '');
  }

  // Local pilot runtime에서는 외부 provider dispatch를 차단한다 (fail-closed).
  // launcher가 local child에 DENY 정책을 고정하므로 운영 동작은 바뀌지 않는다.
  private assertOutboundAllowed(action: string): void {
    if (
      this.config.get<string>('GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY', '') ===
      'DENY_ALL_EXTERNAL_PROVIDER_DISPATCH'
    ) {
      throw new PortoneError(
        503,
        'LOCAL_OUTBOUND_DENIED',
        `local runtime에서는 외부 provider dispatch를 거부합니다: ${action}`,
      );
    }
  }

  private sanitizeDiagnosticField(value: unknown): string {
    if (typeof value !== 'string') return 'unknown';
    return value.replace(/[\r\n\t]/g, ' ').slice(0, 500);
  }

  private async createResponseError(res: Response, action: string): Promise<PortoneError> {
    let type = 'unknown';
    let message = 'unknown';
    try {
      const body = (await res.json()) as { type?: unknown; message?: unknown };
      type = this.sanitizeDiagnosticField(body.type);
      message = this.sanitizeDiagnosticField(body.message);
    } catch {
      type = 'unparseable';
      message = 'PortOne 응답 본문을 JSON으로 해석하지 못함';
    }

    if (res.status !== 404 || type !== 'PAYMENT_NOT_FOUND') {
      const label = res.status === 401 ? 'PortOne V2 인증 실패' : 'PortOne API 오류';
      this.logger.error(
        `${label} action=${action} status=${res.status} type=${type} message=${message}`,
      );
    }
    return new PortoneError(res.status, type, message);
  }

  /** Portone V2 Webhook 서명 검증 (Svix 기반) */
  verifyWebhookSignature(
    webhookId: string,
    webhookTimestamp: string,
    rawBody: Buffer,
    signatureHeader: string,
  ): void {
    const webhookSecret = this.config.get<string>('PORTONE_WEBHOOK_SECRET', '');
    if (
      !webhookId?.trim() ||
      !webhookTimestamp?.trim() ||
      !signatureHeader?.trim() ||
      !Buffer.isBuffer(rawBody) ||
      !webhookSecret
    ) {
      throw new UnauthorizedException('웹훅 인증 정보가 올바르지 않습니다.');
    }

    const timestamp = Number(webhookTimestamp);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
      throw new UnauthorizedException('웹훅 timestamp가 올바르지 않습니다.');
    }

    const secretBytes = Buffer.from(
      webhookSecret.startsWith('whsec_') ? webhookSecret.slice(6) : webhookSecret,
      'base64',
    );
    if (secretBytes.length === 0) {
      throw new UnauthorizedException('웹훅 인증 정보가 올바르지 않습니다.');
    }

    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody.toString()}`;

    const expectedSig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest();

    const signatures = signatureHeader
      .trim()
      .split(/\s+/)
      .filter((signature) => /^v[0-9]+,/.test(signature))
      .map((signature) => Buffer.from(signature.replace(/^v[0-9]+,/, ''), 'base64'));

    const isValid = signatures.some(
      (signature) =>
        signature.length === expectedSig.length && crypto.timingSafeEqual(signature, expectedSig),
    );
    if (!isValid) {
      throw new UnauthorizedException('웹훅 서명이 올바르지 않습니다.');
    }
  }

  async getPayment(paymentId: string): Promise<PortonePaymentData> {
    this.assertOutboundAllowed('getPayment');
    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${this.secret}` },
    });
    if (!res.ok) {
      throw await this.createResponseError(res, 'getPayment');
    }
    return res.json() as Promise<PortonePaymentData>;
  }

  async refund(
    paymentId: string,
    amount: number,
    reason: string,
    idempotencyKey?: string,
  ): Promise<void> {
    this.assertOutboundAllowed('refund');
    // Fail closed on malformed keys: never send a key PortOne would reject
    // with a confusing error, and never silently downgrade to an unkeyed
    // POST (which would lose duplicate protection for this operation).
    if (idempotencyKey !== undefined && !isPortoneIdempotencyKeyShape(idempotencyKey)) {
      throw new PortoneError(
        400,
        'INVALID_IDEMPOTENCY_KEY',
        'PortOne idempotency key 형식이 올바르지 않습니다.',
      );
    }
    const headers: Record<string, string> = {
      Authorization: `PortOne ${this.secret}`,
      'Content-Type': 'application/json',
    };
    if (idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(paymentId)}/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason, amount }),
    });
    if (!res.ok) {
      throw await this.createResponseError(res, 'refund');
    }
  }
}
