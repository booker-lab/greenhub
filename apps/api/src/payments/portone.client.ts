import * as crypto from 'node:crypto';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface PortonePaymentData {
  id: string;
  transactionId: string;
  amount: { total: number };
  status: string;
  method?: { type: string };
  // PortOne V2 PaidPayment 필수 필드. 확정 전 상점·통화·채널 확인에 쓴다
  // (portone-payment-context.ts). 다른 상태나 E2E stub 응답에는 없을 수 있다.
  storeId?: string;
  currency?: string;
  channel?: { type?: string };
}

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/**
 * PortOne 호출 시간 상한. undici 기본값(헤더·본문 각 300초)에 기대지 않는다.
 * 신호 하나가 연결부터 본문 읽기까지 덮으므로, 시간 초과는 요청이 PortOne에 닿았는지
 * 구분할 수 없다. 호출부는 기존처럼 모든 throw를 결과 불확실(UNKNOWN)로 다룬다.
 */
export const PORTONE_GET_PAYMENT_TIMEOUT_MS = 10_000;
export const PORTONE_REFUND_TIMEOUT_MS = 15_000;
export const PORTONE_TIMEOUT_ERROR_STATUS = 504;
export const PORTONE_TIMEOUT_ERROR_TYPE = 'PORTONE_TIMEOUT';

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

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
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

  /**
   * 시간 상한을 걸고 PortOne을 호출한다. AbortSignal.timeout() 대신 전역 setTimeout을 써서
   * 호출이 끝나면 바로 정리하고, 테스트의 가짜 타이머로도 같은 경로를 검증할 수 있게 한다.
   * 시간 초과는 PortoneError(504, PORTONE_TIMEOUT)로 바꿔 기존 PortoneError 경로로 흐르게 한다.
   */
  private async send<T>(
    action: string,
    url: string,
    init: RequestInit,
    timeoutMs: number,
    readBody: (res: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        throw await this.createResponseError(res, action);
      }
      return await readBody(res);
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof PortoneError)) {
        this.logger.error(`PortOne 요청 시간 초과 action=${action} timeoutMs=${timeoutMs}`);
        throw new PortoneError(
          PORTONE_TIMEOUT_ERROR_STATUS,
          PORTONE_TIMEOUT_ERROR_TYPE,
          `PortOne ${action} 요청이 ${timeoutMs}ms 안에 끝나지 않아 결과를 확인할 수 없습니다.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
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
    return this.send(
      'getPayment',
      `${this.baseUrl}/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `PortOne ${this.secret}` } },
      PORTONE_GET_PAYMENT_TIMEOUT_MS,
      (res) => res.json() as Promise<PortonePaymentData>,
    );
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
    await this.send(
      'refund',
      `${this.baseUrl}/payments/${encodeURIComponent(paymentId)}/cancel`,
      { method: 'POST', headers, body: JSON.stringify({ reason, amount }) },
      PORTONE_REFUND_TIMEOUT_MS,
      async () => undefined,
    );
  }
}
