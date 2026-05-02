import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AligoClient {
  private readonly apiKey: string;
  private readonly userId: string;
  private readonly senderKey: string;
  private readonly senderPhone: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('ALIGO_API_KEY', '');
    this.userId = config.get<string>('ALIGO_USER_ID', '');
    this.senderKey = config.get<string>('ALIGO_SENDER_KEY', '');
    this.senderPhone = config.get<string>('ALIGO_SENDER_PHONE', '');
  }

  async sendAlimtalk(
    phone: string,
    templateCode: string,
    variables: Record<string, string>,
  ): Promise<{ success: boolean; errorMessage?: string }> {
    if (!this.apiKey || !this.userId) {
      console.warn(`[AligoClient] API 키 미설정 — 알림톡 스킵 [${templateCode}] → ${phone}`);
      return { success: true };
    }

    try {
      const params = new URLSearchParams({
        apikey: this.apiKey,
        userid: this.userId,
        senderkey: this.senderKey,
        tpl_code: templateCode,
        sender: this.senderPhone,
        receiver_1: phone,
        subject_1: '알림',
        message_1: this.buildMessage(templateCode, variables),
      });

      const res = await fetch('https://kakaoapi.aligo.in/akv10/alimtalk/send/', {
        method: 'POST',
        body: params,
      });
      const json = (await res.json()) as { code: number; message: string };
      if (json.code !== 0) {
        return { success: false, errorMessage: json.message };
      }
      return { success: true };
    } catch (e) {
      return { success: false, errorMessage: String(e) };
    }
  }

  private buildMessage(templateCode: string, variables: Record<string, string>): string {
    // 실제 배포 시 알리고 등록 템플릿 본문 사용
    return `[${templateCode}] ${JSON.stringify(variables)}`;
  }
}
