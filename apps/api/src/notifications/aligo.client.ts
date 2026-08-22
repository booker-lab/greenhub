import type { NotificationChannel } from '@greenhub/shared';
import { Injectable } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { resolveAligoTemplateCode } from './aligo-template-codes';
import {
  type ApiNotificationTemplateCode,
  NOTIFICATION_TEMPLATES,
  renderNotificationMessage,
} from './notification-templates';

export type NotificationDeliveryResult = {
  success: boolean;
  channel: Extract<NotificationChannel, 'alimtalk' | 'sms'> | null;
  message: string;
  alimtalkAttempts: number;
  smsAttempts: number;
  errorMessage?: string;
};

@Injectable()
export class AligoClient {
  private readonly apiKey: string;
  private readonly userId: string;
  private readonly senderKey: string;
  private readonly senderPhone: string;
  private readonly templateCodesJson: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('ALIGO_API_KEY', '');
    this.userId = config.get<string>('ALIGO_USER_ID', '');
    this.senderKey = config.get<string>('ALIGO_SENDER_KEY', '');
    this.senderPhone = config.get<string>('ALIGO_SENDER_PHONE', '');
    this.templateCodesJson = config.get<string>('ALIGO_TEMPLATE_CODES_JSON', '');
  }

  async sendAlimtalk(
    phone: string,
    templateCode: ApiNotificationTemplateCode,
    variables: Record<string, string>,
  ): Promise<NotificationDeliveryResult> {
    const rendered = this.renderMessage(templateCode, variables);
    if ('errorMessage' in rendered) return rendered;
    const message = rendered.message;
    if (!this.apiKey || !this.userId || !this.senderKey || !this.senderPhone) {
      return {
        success: false,
        channel: null,
        message,
        alimtalkAttempts: 0,
        smsAttempts: 0,
        errorMessage: '알림 발송 필수 설정이 누락되었습니다.',
      };
    }

    let providerTemplateCode: string;
    try {
      providerTemplateCode = resolveAligoTemplateCode(this.templateCodesJson, templateCode);
    } catch (error) {
      return {
        success: false,
        channel: null,
        message,
        alimtalkAttempts: 0,
        smsAttempts: 0,
        errorMessage: error instanceof Error ? error.message : 'ALIGO 템플릿 코드 설정 오류입니다.',
      };
    }

    let errorMessage = '알림톡 발송에 실패했습니다.';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await this.sendAlimtalkOnce(phone, providerTemplateCode, message);
      if (result.success) {
        return {
          success: true,
          channel: 'alimtalk',
          message,
          alimtalkAttempts: attempt + 1,
          smsAttempts: 0,
        };
      }
      errorMessage = result.errorMessage ?? errorMessage;
    }

    const smsResult = await this.sendSmsMessage(phone, message);
    if (smsResult.success) {
      return {
        success: true,
        channel: 'sms',
        message,
        alimtalkAttempts: 3,
        smsAttempts: 1,
      };
    }

    return {
      success: false,
      channel: null,
      message,
      alimtalkAttempts: 3,
      smsAttempts: 1,
      errorMessage: smsResult.errorMessage ?? errorMessage,
    };
  }

  async sendSms(
    phone: string,
    templateCode: ApiNotificationTemplateCode,
    variables: Record<string, string>,
  ): Promise<NotificationDeliveryResult> {
    const rendered = this.renderMessage(templateCode, variables);
    if ('errorMessage' in rendered) return rendered;
    const message = rendered.message;
    if (!this.apiKey || !this.userId || !this.senderPhone) {
      return {
        success: false,
        channel: null,
        message,
        alimtalkAttempts: 0,
        smsAttempts: 0,
        errorMessage: '문자 발송 필수 설정이 누락되었습니다.',
      };
    }
    const result = await this.sendSmsMessage(phone, message);
    return {
      success: result.success,
      channel: result.success ? 'sms' : null,
      message,
      alimtalkAttempts: 0,
      smsAttempts: 1,
      errorMessage: result.errorMessage,
    };
  }

  private renderMessage(
    templateCode: ApiNotificationTemplateCode,
    variables: Record<string, string>,
  ): { message: string } | NotificationDeliveryResult {
    try {
      return { message: renderNotificationMessage(templateCode, variables) };
    } catch (error) {
      return {
        success: false,
        channel: null,
        message: NOTIFICATION_TEMPLATES[templateCode].body,
        alimtalkAttempts: 0,
        smsAttempts: 0,
        errorMessage: error instanceof Error ? error.message : '알림 본문 변수 오류입니다.',
      };
    }
  }

  private async sendAlimtalkOnce(
    phone: string,
    templateCode: string,
    message: string,
  ): Promise<{ success: boolean; errorMessage?: string }> {
    try {
      const params = new URLSearchParams({
        apikey: this.apiKey,
        userid: this.userId,
        senderkey: this.senderKey,
        tpl_code: templateCode,
        sender: this.senderPhone,
        receiver_1: phone,
        subject_1: '알림',
        message_1: message,
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

  private async sendSmsMessage(
    phone: string,
    message: string,
  ): Promise<{ success: boolean; errorMessage?: string }> {
    try {
      const params = new URLSearchParams({
        key: this.apiKey,
        user_id: this.userId,
        sender: this.senderPhone,
        receiver: phone,
        msg: message,
      });

      const res = await fetch('https://apis.aligo.in/send/', {
        method: 'POST',
        body: params,
      });
      const json = (await res.json()) as {
        code?: number;
        result_code?: number | string;
        message?: string;
      };
      const resultCode = Number(json.result_code ?? json.code);
      if (resultCode !== 0 && resultCode !== 1) {
        return { success: false, errorMessage: json.message ?? '문자 대체 발송에 실패했습니다.' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, errorMessage: String(e) };
    }
  }
}
