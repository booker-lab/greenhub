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
   * Portone V2 Webhook 서명 검증 (Svix 기반)
   * - webhook-signature 헤더가 없으면 서명 미설정 환경으로 간주하고 통과 (경고 로그)
   * - 헤더가 있으면 반드시 유효해야 함
   */
  verifyWebhookSignature(
    webhookId: string,
    webhookTimestamp: string,
    rawBody: Buffer,
    signatureHeader: string,
  ): void {
    // 서명 헤더가 없으면 포트원 콘솔에서 서명 미설정 — 검증 스킵
    if (!signatureHeader) {
      this.logger.warn(
        'webhook-signature header absent — skipping verification (configure signing key in Portone console)',
      );
      return;
    }

    const webhookSecret = this.config.get<string>('PORTONE_WEBHOOK_SECRET', '');
    if (!webhookSecret) {
      this.logger.warn('PORTONE_WEBHOOK_SECRET not set — skipping verification');
      return;
    }

    // Svix: secret은 "whsec_" 접두사 제거 후 base64 디코딩
    const secretBytes = Buffer.from(
      webhookSecret.startsWith('whsec_') ? webhookSecret.slice(6) : webhookSecret,
      'base64',
    );

    // 서명 대상: "{webhookId}.{webhookTimestamp}.{rawBody}"
    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody.toString()}`;

    const expectedSig = crypto
      .createHmac('sha256', secretBytes)
      .update(signedContent)
      .digest('base64');

    // 헤더 형식: "v1,<sig1> v1,<sig2>" (복수 서명 지원)
    const signatures = signatureHeader.split(' ').map((s) => s.replace(/^v[0-9]+,/, ''));

    const isValid = signatures.some((sig) => sig === expectedSig);
    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  async getPayment(paymentId: string): Promise<PortonePaymentData> {
    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${this.secret}` },
    });
    if (!res.ok) {
      throw await this.createResponseError(res, 'getPayment');
    }
    return res.json() as Promise<PortonePaymentData>;
  }

  async refund(paymentId: string, amount: number, reason: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(paymentId)}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `PortOne ${this.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason, amount }),
    });
    if (!res.ok) {
      throw await this.createResponseError(res, 'refund');
    }
  }
}
