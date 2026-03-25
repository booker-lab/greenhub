import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface PortonePaymentData {
  imp_uid: string;
  merchant_uid: string;
  amount: number;
  status: string;
  pay_method: string;
}

@Injectable()
export class PortoneClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.get<string>('PORTONE_API_KEY', '');
    this.apiSecret = config.get<string>('PORTONE_API_SECRET', '');
  }

  async getAccessToken(): Promise<string> {
    const res = await fetch('https://api.iamport.kr/users/getToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imp_key: this.apiKey,
        imp_secret: this.apiSecret,
      }),
    });
    const json = (await res.json()) as { response: { access_token: string } };
    return json.response.access_token;
  }

  async getPayment(impUid: string): Promise<PortonePaymentData> {
    const token = await this.getAccessToken();
    const res = await fetch(`https://api.iamport.kr/payments/${impUid}`, {
      headers: { Authorization: token },
    });
    const json = (await res.json()) as { response: PortonePaymentData };
    return json.response;
  }

  async refund(
    impUid: string,
    amount: number,
    reason: string,
  ): Promise<void> {
    const token = await this.getAccessToken();
    await fetch('https://api.iamport.kr/payments/cancel', {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imp_uid: impUid, amount, reason }),
    });
  }
}
