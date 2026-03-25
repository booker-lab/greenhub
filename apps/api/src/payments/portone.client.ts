import { Injectable, InternalServerErrorException } from '@nestjs/common';
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

  private async getAccessToken(): Promise<string> {
    const res = await fetch('https://api.iamport.kr/users/getToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imp_key: this.apiKey,
        imp_secret: this.apiSecret,
      }),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Portone 토큰 발급 실패: ${res.status}`,
      );
    }
    const json = (await res.json()) as {
      code: number;
      response: { access_token: string };
    };
    if (json.code !== 0) {
      throw new InternalServerErrorException(
        `Portone 토큰 발급 오류: code=${json.code}`,
      );
    }
    return json.response.access_token;
  }

  async getPayment(impUid: string): Promise<PortonePaymentData> {
    const token = await this.getAccessToken();
    const res = await fetch(`https://api.iamport.kr/payments/${impUid}`, {
      headers: { Authorization: token },
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Portone 결제 조회 실패: ${res.status}`,
      );
    }
    const json = (await res.json()) as {
      code: number;
      response: PortonePaymentData;
    };
    if (json.code !== 0 || !json.response) {
      throw new InternalServerErrorException(
        `Portone 결제 조회 오류: code=${json.code}`,
      );
    }
    return json.response;
  }

  async refund(impUid: string, amount: number, reason: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch('https://api.iamport.kr/payments/cancel', {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imp_uid: impUid, amount, reason }),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Portone 환불 실패: ${res.status}`,
      );
    }
    const json = (await res.json()) as { code: number; message: string };
    if (json.code !== 0) {
      throw new InternalServerErrorException(
        `Portone 환불 오류: ${json.message}`,
      );
    }
  }
}
