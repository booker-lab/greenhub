import type { NotificationChannel } from '@greenhub/shared';
import { Injectable } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { resolveAligoTemplateCode } from './aligo-template-codes';
import {
  type ApiNotificationTemplateCode,
  NOTIFICATION_TEMPLATES,
  renderNotificationMessage,
} from './notification-templates';

export type ProviderOutcome = 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';

export type NotificationDeliveryResult = {
  success: boolean;
  outcome: ProviderOutcome;
  channel: Extract<NotificationChannel, 'alimtalk' | 'sms'> | null;
  message: string;
  alimtalkAttempts: number;
  smsAttempts: number;
  providerReceipt: string | null;
  attemptId: string | null;
  needsVerify: boolean;
  errorMessage?: string;
};

type ProviderAttemptResult = {
  outcome: ProviderOutcome;
  providerReceipt: string | null;
  errorMessage?: string;
};

export function normalizeProviderReceipt(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseAlimtalkReceipt(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const record = json as Record<string, unknown>;
  const info = record['info'];
  if (info && typeof info === 'object') {
    const mid = (info as Record<string, unknown>)['mid'];
    const normalized = normalizeProviderReceipt(mid);
    if (normalized) return normalized;
  }
  return normalizeProviderReceipt(record['mid']);
}

export function parseSmsReceipt(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const record = json as Record<string, unknown>;
  return normalizeProviderReceipt(record['msg_id']);
}

function localRejection(
  message: string,
  alimtalkAttempts: number,
  smsAttempts: number,
  errorMessage: string,
): NotificationDeliveryResult {
  return {
    success: false,
    outcome: 'REJECTED',
    channel: null,
    message,
    alimtalkAttempts,
    smsAttempts,
    providerReceipt: null,
    attemptId: null,
    needsVerify: false,
    errorMessage,
  };
}

@Injectable()
export class AligoClient {
  private readonly apiKey: string;
  private readonly userId: string;
  private readonly senderKey: string;
  private readonly senderPhone: string;
  private readonly templateCodesJson: string;
  private readonly outboundDenied: boolean;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('ALIGO_API_KEY', '');
    this.userId = config.get<string>('ALIGO_USER_ID', '');
    this.senderKey = config.get<string>('ALIGO_SENDER_KEY', '');
    this.senderPhone = config.get<string>('ALIGO_SENDER_PHONE', '');
    this.templateCodesJson = config.get<string>('ALIGO_TEMPLATE_CODES_JSON', '');
    // Local pilot runtime에서는 외부 provider dispatch를 차단한다 (fail-closed).
    // launcher가 local child에 DENY 정책을 고정하므로 운영 동작은 바뀌지 않는다.
    this.outboundDenied =
      config.get<string>('GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY', '') ===
      'DENY_ALL_EXTERNAL_PROVIDER_DISPATCH';
  }

  async sendAlimtalk(
    phone: string,
    templateCode: ApiNotificationTemplateCode,
    variables: Record<string, string>,
  ): Promise<NotificationDeliveryResult> {
    const rendered = this.renderMessage(templateCode, variables);
    if ('errorMessage' in rendered) {
      return {
        ...rendered,
        outcome: 'REJECTED',
        providerReceipt: null,
        attemptId: null,
        needsVerify: false,
      };
    }
    const message = rendered.message;
    if (this.outboundDenied) {
      return localRejection(
        message,
        0,
        0,
        'local runtime에서는 외부 발송을 거부합니다.',
      );
    }
    if (!this.apiKey || !this.userId || !this.senderKey || !this.senderPhone) {
      return localRejection(message, 0, 0, '알림 발송 필수 설정이 누락되었습니다.');
    }

    let providerTemplateCode: string;
    try {
      providerTemplateCode = resolveAligoTemplateCode(this.templateCodesJson, templateCode);
    } catch (error) {
      return localRejection(
        message,
        0,
        0,
        error instanceof Error ? error.message : 'ALIGO 템플릿 코드 설정 오류입니다.',
      );
    }

    const attemptId = uuidv4();
    let errorMessage = '알림톡 발송에 실패했습니다.';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await this.sendAlimtalkOnce(phone, providerTemplateCode, message);
      if (result.outcome === 'ACCEPTED') {
        return {
          success: true,
          outcome: 'ACCEPTED',
          channel: 'alimtalk',
          message,
          alimtalkAttempts: attempt + 1,
          smsAttempts: 0,
          providerReceipt: result.providerReceipt,
          attemptId,
          needsVerify: false,
        };
      }
      if (result.outcome === 'UNKNOWN') {
        return {
          success: false,
          outcome: 'UNKNOWN',
          channel: null,
          message,
          alimtalkAttempts: attempt + 1,
          smsAttempts: 0,
          providerReceipt: null,
          attemptId,
          needsVerify: true,
          errorMessage:
            result.errorMessage ??
            'provider 접수 여부를 확인할 수 없습니다. blind retry 없이 수동 확인이 필요합니다.',
        };
      }
      errorMessage = result.errorMessage ?? errorMessage;
    }

    const smsResult = await this.sendSmsMessage(phone, message);
    if (smsResult.outcome === 'ACCEPTED') {
      return {
        success: true,
        outcome: 'ACCEPTED',
        channel: 'sms',
        message,
        alimtalkAttempts: 3,
        smsAttempts: 1,
        providerReceipt: smsResult.providerReceipt,
        attemptId,
        needsVerify: false,
      };
    }
    if (smsResult.outcome === 'UNKNOWN') {
      return {
        success: false,
        outcome: 'UNKNOWN',
        channel: null,
        message,
        alimtalkAttempts: 3,
        smsAttempts: 1,
        providerReceipt: null,
        attemptId,
        needsVerify: true,
        errorMessage:
          smsResult.errorMessage ??
          'provider 접수 여부를 확인할 수 없습니다. blind retry 없이 수동 확인이 필요합니다.',
      };
    }

    return {
      success: false,
      outcome: 'REJECTED',
      channel: null,
      message,
      alimtalkAttempts: 3,
      smsAttempts: 1,
      providerReceipt: null,
      attemptId,
      needsVerify: false,
      errorMessage: smsResult.errorMessage ?? errorMessage,
    };
  }

  async sendSms(
    phone: string,
    templateCode: ApiNotificationTemplateCode,
    variables: Record<string, string>,
  ): Promise<NotificationDeliveryResult> {
    const rendered = this.renderMessage(templateCode, variables);
    if ('errorMessage' in rendered) {
      return {
        ...rendered,
        outcome: 'REJECTED',
        providerReceipt: null,
        attemptId: null,
        needsVerify: false,
      };
    }
    const message = rendered.message;
    if (this.outboundDenied) {
      return localRejection(
        message,
        0,
        0,
        'local runtime에서는 외부 발송을 거부합니다.',
      );
    }
    if (!this.apiKey || !this.userId || !this.senderPhone) {
      return localRejection(message, 0, 0, '문자 발송 필수 설정이 누락되었습니다.');
    }
    const attemptId = uuidv4();
    const result = await this.sendSmsMessage(phone, message);
    if (result.outcome === 'ACCEPTED') {
      return {
        success: true,
        outcome: 'ACCEPTED',
        channel: 'sms',
        message,
        alimtalkAttempts: 0,
        smsAttempts: 1,
        providerReceipt: result.providerReceipt,
        attemptId,
        needsVerify: false,
      };
    }
    if (result.outcome === 'UNKNOWN') {
      return {
        success: false,
        outcome: 'UNKNOWN',
        channel: null,
        message,
        alimtalkAttempts: 0,
        smsAttempts: 1,
        providerReceipt: null,
        attemptId,
        needsVerify: true,
        errorMessage:
          result.errorMessage ??
          'provider 접수 여부를 확인할 수 없습니다. blind retry 없이 수동 확인이 필요합니다.',
      };
    }
    return {
      success: false,
      outcome: 'REJECTED',
      channel: null,
      message,
      alimtalkAttempts: 0,
      smsAttempts: 1,
      providerReceipt: null,
      attemptId,
      needsVerify: false,
      errorMessage: result.errorMessage,
    };
  }

  private renderMessage(
    templateCode: ApiNotificationTemplateCode,
    variables: Record<string, string>,
  ):
    | { message: string }
    | {
        success: false;
        channel: null;
        message: string;
        alimtalkAttempts: number;
        smsAttempts: number;
        errorMessage: string;
      } {
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
  ): Promise<ProviderAttemptResult> {
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
      let json: unknown;
      try {
        json = (await res.json()) as unknown;
      } catch (e) {
        return {
          outcome: 'UNKNOWN',
          providerReceipt: null,
          errorMessage: `알림톡 응답 파싱 실패: ${String(e)}`,
        };
      }
      const record = (json ?? {}) as Record<string, unknown>;
      if (typeof record['code'] !== 'number' || !Number.isFinite(record['code'])) {
        return {
          outcome: 'UNKNOWN',
          providerReceipt: null,
          errorMessage: '알림톡 응답 코드 파싱 실패로 접수 여부를 확인할 수 없습니다.',
        };
      }
      if (record['code'] !== 0) {
        const messageText =
          typeof record['message'] === 'string' && record['message'].trim().length > 0
            ? (record['message'] as string)
            : '알림톡 발송에 실패했습니다.';
        return { outcome: 'REJECTED', providerReceipt: null, errorMessage: messageText };
      }
      return { outcome: 'ACCEPTED', providerReceipt: parseAlimtalkReceipt(json) };
    } catch (e) {
      return {
        outcome: 'UNKNOWN',
        providerReceipt: null,
        errorMessage: `알림톡 transport 불확실: ${String(e)}`,
      };
    }
  }

  private async sendSmsMessage(
    phone: string,
    message: string,
  ): Promise<ProviderAttemptResult> {
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
      let json: unknown;
      try {
        json = (await res.json()) as unknown;
      } catch (e) {
        return {
          outcome: 'UNKNOWN',
          providerReceipt: null,
          errorMessage: `문자 응답 파싱 실패: ${String(e)}`,
        };
      }
      const record = (json ?? {}) as Record<string, unknown>;
      const resultCode = Number(record['result_code'] ?? record['code']);
      if (!Number.isFinite(resultCode)) {
        return {
          outcome: 'UNKNOWN',
          providerReceipt: null,
          errorMessage: '문자 응답 코드 파싱 실패로 접수 여부를 확인할 수 없습니다.',
        };
      }
      if (resultCode !== 0 && resultCode !== 1) {
        const messageText =
          typeof record['message'] === 'string' && record['message'].trim().length > 0
            ? (record['message'] as string)
            : '문자 대체 발송에 실패했습니다.';
        return { outcome: 'REJECTED', providerReceipt: null, errorMessage: messageText };
      }
      return { outcome: 'ACCEPTED', providerReceipt: parseSmsReceipt(json) };
    } catch (e) {
      return {
        outcome: 'UNKNOWN',
        providerReceipt: null,
        errorMessage: `문자 transport 불확실: ${String(e)}`,
      };
    }
  }
}
