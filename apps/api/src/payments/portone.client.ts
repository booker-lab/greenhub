import { Injectable, InternalServerErrorException } from '@nestjs/common';
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
