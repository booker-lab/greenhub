import type { NotificationChannel } from '@greenhub/shared';
import { Injectable } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { resolveAligoTemplateCode } from './aligo-template-codes';
import {
  type NotificationRetryMetricsChannel,
  type NotificationRetryMetricsRecorder,
  notificationRetryMetrics,
} from './notification-retry-metrics';
import {
  type ApiNotificationTemplateCode,
  NOTIFICATION_TEMPLATES,
  renderNotificationMessage,
} from './notification-templates';

export type ProviderOutcome = 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';

// provider 오류를 재시도 가능/rate-limit/영구/불확실로 분류한다. 분류 결과가
// 재시도 backoff와 SMS fallback 여부를 결정한다.
export type ProviderErrorClass = 'RETRYABLE' | 'RATE_LIMITED' | 'PERMANENT' | 'UNKNOWN';

export const NOTIFICATION_RETRY_BACKOFF_POLICY = {
  maxAlimtalkAttempts: 3,
  maxSmsFallbackAttempts: 1,
  baseBackoffMs: 200,
  rateLimitBackoffMs: 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 2000,
} as const;

const RATE_LIMIT_MESSAGE_PATTERNS: readonly RegExp[] = [
  /rate.?limit/i,
  /too many/i,
  /(발송|요청|호출|전송)[^\n]{0,20}(한도|제한|초과)/,
  /(한도|제한|초과)[^\n]{0,20}(발송|요청|호출|전송)/,
];

const RETRYABLE_MESSAGE_PATTERNS: readonly RegExp[] = [
  /일시/,
  /잠시/,
  /timeout/i,
  /temporar/i,
  /try again/i,
  /server error/i,
];

const RETRYABLE_ALIMTALK_CODES: ReadonlySet<number> = new Set([-1, -2, -3, -99, -100]);
const RETRYABLE_SMS_CODES: ReadonlySet<number> = new Set([-1, -2, -3, -99, -100]);

export function classifyProviderError(input: {
  code?: number | null;
  message?: string | null;
  httpStatus?: number | null;
  retryableCodes: ReadonlySet<number>;
}): ProviderErrorClass {
  if (input.httpStatus === 429) return 'RATE_LIMITED';
  const message = typeof input.message === 'string' ? input.message : '';
  if (RATE_LIMIT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'RATE_LIMITED';
  }
  if (
    typeof input.httpStatus === 'number' &&
    Number.isFinite(input.httpStatus) &&
    input.httpStatus >= 500
  ) {
    return 'RETRYABLE';
  }
  const hasRetryableCode =
    typeof input.code === 'number' &&
    Number.isFinite(input.code) &&
    input.retryableCodes.has(input.code);
  if (hasRetryableCode || RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'RETRYABLE';
  }
  return 'PERMANENT';
}

export function classifyAlimtalkProviderError(input: {
  code?: number | null;
  message?: string | null;
  httpStatus?: number | null;
}): ProviderErrorClass {
  return classifyProviderError({ ...input, retryableCodes: RETRYABLE_ALIMTALK_CODES });
}

export function classifySmsProviderError(input: {
  code?: number | null;
  message?: string | null;
  httpStatus?: number | null;
}): ProviderErrorClass {
  return classifyProviderError({ ...input, retryableCodes: RETRYABLE_SMS_CODES });
}

// 재시도 사이 지연을 지수적으로 늘리되 maxBackoffMs로 상한한다. rate-limit은
// 같은 채널을 더 오래 쉬게 하는 별도 base를 사용한다.
export function computeNotificationRetryDelayMs(
  errorClass: ProviderErrorClass,
  retryIndex: number,
): number {
  const base =
    errorClass === 'RATE_LIMITED'
      ? NOTIFICATION_RETRY_BACKOFF_POLICY.rateLimitBackoffMs
      : NOTIFICATION_RETRY_BACKOFF_POLICY.baseBackoffMs;
  const exponent = Number.isFinite(retryIndex) ? Math.max(0, Math.trunc(retryIndex)) : 0;
  const raw = base * NOTIFICATION_RETRY_BACKOFF_POLICY.backoffMultiplier ** exponent;
  return Math.min(raw, NOTIFICATION_RETRY_BACKOFF_POLICY.maxBackoffMs);
}

export type NotificationDeliveryResult = {
  success: boolean;
  outcome: ProviderOutcome;
  errorClass: ProviderErrorClass | null;
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
  errorClass?: ProviderErrorClass;
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
    errorClass: null,
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
  private readonly retryMetrics: NotificationRetryMetricsRecorder;

  constructor(
    config: ConfigService,
    metrics: NotificationRetryMetricsRecorder = notificationRetryMetrics,
  ) {
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
    this.retryMetrics = metrics;
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
        errorClass: null,
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
    let alimtalkAttemptsUsed = 0;
    let lastErrorClass: ProviderErrorClass = 'RETRYABLE';

    for (
      let attempt = 0;
      attempt < NOTIFICATION_RETRY_BACKOFF_POLICY.maxAlimtalkAttempts;
      attempt += 1
    ) {
      const result = await this.sendAlimtalkOnce(phone, providerTemplateCode, message);
      alimtalkAttemptsUsed = attempt + 1;
      if (result.outcome === 'ACCEPTED') {
        return {
          success: true,
          outcome: 'ACCEPTED',
          errorClass: null,
          channel: 'alimtalk',
          message,
          alimtalkAttempts: alimtalkAttemptsUsed,
          smsAttempts: 0,
          providerReceipt: result.providerReceipt,
          attemptId,
          needsVerify: false,
        };
      }
      if (result.outcome === 'UNKNOWN') {
        // 접수 여부가 불확실하면 blind 재시도나 SMS 대체를 하지 않는다.
        this.recordProviderAttemptError('alimtalk', result);
        return {
          success: false,
          outcome: 'UNKNOWN',
          errorClass: 'UNKNOWN',
          channel: null,
          message,
          alimtalkAttempts: alimtalkAttemptsUsed,
          smsAttempts: 0,
          providerReceipt: null,
          attemptId,
          needsVerify: true,
          errorMessage:
            result.errorMessage ??
            'provider 접수 여부를 확인할 수 없습니다. blind retry 없이 수동 확인이 필요합니다.',
        };
      }
      lastErrorClass = result.errorClass ?? 'RETRYABLE';
      this.recordProviderAttemptError('alimtalk', result);
      errorMessage = result.errorMessage ?? errorMessage;
      const hasNextAttempt =
        attempt + 1 < NOTIFICATION_RETRY_BACKOFF_POLICY.maxAlimtalkAttempts;
      // 명시적 영구 오류는 같은 채널 blind 재시도 대신 1회 SMS fallback으로 넘긴다.
      if (!hasNextAttempt || lastErrorClass === 'PERMANENT') break;
      const retryDelayMs = computeNotificationRetryDelayMs(lastErrorClass, attempt);
      this.retryMetrics.recordAppliedRetryDelay('alimtalk', retryDelayMs);
      await this.delay(retryDelayMs);
    }

    const smsResult = await this.sendSmsMessage(phone, message);
    if (smsResult.outcome === 'ACCEPTED') {
      return {
        success: true,
        outcome: 'ACCEPTED',
        errorClass: null,
        channel: 'sms',
        message,
        alimtalkAttempts: alimtalkAttemptsUsed,
        smsAttempts: 1,
        providerReceipt: smsResult.providerReceipt,
        attemptId,
        needsVerify: false,
      };
    }
    if (smsResult.outcome === 'UNKNOWN') {
      this.recordProviderAttemptError('sms', smsResult);
      return {
        success: false,
        outcome: 'UNKNOWN',
        errorClass: 'UNKNOWN',
        channel: null,
        message,
        alimtalkAttempts: alimtalkAttemptsUsed,
        smsAttempts: 1,
        providerReceipt: null,
        attemptId,
        needsVerify: true,
        errorMessage:
          smsResult.errorMessage ??
          'provider 접수 여부를 확인할 수 없습니다. blind retry 없이 수동 확인이 필요합니다.',
      };
    }

    this.recordProviderAttemptError('sms', smsResult);
    return {
      success: false,
      outcome: 'REJECTED',
      errorClass: smsResult.errorClass ?? lastErrorClass,
      channel: null,
      message,
      alimtalkAttempts: alimtalkAttemptsUsed,
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
        errorClass: null,
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
        errorClass: null,
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
      this.recordProviderAttemptError('sms', result);
      return {
        success: false,
        outcome: 'UNKNOWN',
        errorClass: 'UNKNOWN',
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
    this.recordProviderAttemptError('sms', result);
    return {
      success: false,
      outcome: 'REJECTED',
      errorClass: result.errorClass ?? 'PERMANENT',
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

  private async delay(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  // 관측 기록은 채널·오류 분류만 담고 PII는 기록하지 않는다. 관측이 전달 경로를
  // 깨지 않으므로 provider 호출 동작과 결과 계약은 그대로 유지한다.
  private recordProviderAttemptError(
    channel: NotificationRetryMetricsChannel,
    result: ProviderAttemptResult,
  ): void {
    this.retryMetrics.recordProviderErrorClassification(
      channel,
      result.outcome === 'UNKNOWN' ? 'UNKNOWN' : (result.errorClass ?? 'UNKNOWN'),
    );
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
          errorClass: 'UNKNOWN',
          errorMessage: `알림톡 응답 파싱 실패: ${String(e)}`,
        };
      }
      const record = (json ?? {}) as Record<string, unknown>;
      if (typeof record['code'] !== 'number' || !Number.isFinite(record['code'])) {
        return {
          outcome: 'UNKNOWN',
          providerReceipt: null,
          errorClass: 'UNKNOWN',
          errorMessage: '알림톡 응답 코드 파싱 실패로 접수 여부를 확인할 수 없습니다.',
        };
      }
      if (record['code'] !== 0) {
        const messageText =
          typeof record['message'] === 'string' && record['message'].trim().length > 0
            ? (record['message'] as string)
            : '알림톡 발송에 실패했습니다.';
        return {
          outcome: 'REJECTED',
          providerReceipt: null,
          errorClass: classifyAlimtalkProviderError({
            code: record['code'],
            message: messageText,
            httpStatus: res.status,
          }),
          errorMessage: messageText,
        };
      }
      return { outcome: 'ACCEPTED', providerReceipt: parseAlimtalkReceipt(json) };
    } catch (e) {
      return {
        outcome: 'UNKNOWN',
        providerReceipt: null,
        errorClass: 'UNKNOWN',
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
          errorClass: 'UNKNOWN',
          errorMessage: `문자 응답 파싱 실패: ${String(e)}`,
        };
      }
      const record = (json ?? {}) as Record<string, unknown>;
      const resultCode = Number(record['result_code'] ?? record['code']);
      if (!Number.isFinite(resultCode)) {
        return {
          outcome: 'UNKNOWN',
          providerReceipt: null,
          errorClass: 'UNKNOWN',
          errorMessage: '문자 응답 코드 파싱 실패로 접수 여부를 확인할 수 없습니다.',
        };
      }
      if (resultCode !== 0 && resultCode !== 1) {
        const messageText =
          typeof record['message'] === 'string' && record['message'].trim().length > 0
            ? (record['message'] as string)
            : '문자 대체 발송에 실패했습니다.';
        return {
          outcome: 'REJECTED',
          providerReceipt: null,
          errorClass: classifySmsProviderError({
            code: resultCode,
            message: messageText,
            httpStatus: res.status,
          }),
          errorMessage: messageText,
        };
      }
      return { outcome: 'ACCEPTED', providerReceipt: parseSmsReceipt(json) };
    } catch (e) {
      return {
        outcome: 'UNKNOWN',
        providerReceipt: null,
        errorClass: 'UNKNOWN',
        errorMessage: `문자 transport 불확실: ${String(e)}`,
      };
    }
  }
}
