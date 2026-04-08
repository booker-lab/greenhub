import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

interface PortonePaymentData {
  id: string;
  transactionId: string;
  amount: { total: number };
  status: string;
  method?: { type: string };
}

@Injectable()
export class PortoneClient {
  private readonly secret: string;
  private readonly baseUrl = 'https://api.portone.io';

  constructor(private readonly config: ConfigService) {
    this.secret = config.get<string>('PORTONE_V2_SECRET', '');
  }

  /**
   * Portone V2 Webhook 서명 검증 (Svix 기반)
   * 서명 키: Portone 콘솔 > 웹훅 > 서명 키 (PORTONE_WEBHOOK_SECRET)
   */
  verifyWebhookSignature(
    webhookId: string,
    webhookTimestamp: string,
    rawBody: Buffer,
    signatureHeader: string,
  ): void {
    const webhookSecret = this.config.get<string>('PORTONE_WEBHOOK_SECRET', '');
    if (!webhookSecret) {
      throw new UnauthorizedException('Webhook secret not configured');
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
    if (!signatureHeader) {
      throw new UnauthorizedException('Missing webhook-signature header');
    }
    const signatures = signatureHeader
      .split(' ')
      .map((s) => s.replace(/^v[0-9]+,/, ''));

    const isValid = signatures.some((sig) => sig === expectedSig);
    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  async getPayment(paymentId: string): Promise<PortonePaymentData> {
    const res = await fetch(
      `${this.baseUrl}/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `PortOne ${this.secret}` } },
    );
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Portone 결제 조회 실패: ${res.status}`,
      );
    }
    return res.json() as Promise<PortonePaymentData>;
  }

  async refund(paymentId: string, amount: number, reason: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/payments/${encodeURIComponent(paymentId)}/cancel`,
      {
        method: 'POST',
        headers: {
          Authorization: `PortOne ${this.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason, amount }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string };
      throw new InternalServerErrorException(
        `Portone 환불 실패: ${body.message ?? res.status}`,
      );
    }
  }
}
