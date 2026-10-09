import type { NotificationChannel } from '@greenhub/shared';
import { Injectable } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
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

type AligoFetch = (
  url: string,
  init: { method: string; body: URLSearchParams; signal: AbortSignal },
) => Promise<Response>;

/**
 * ALIGO HTTP 호출 1회(연결·요청 전송·응답 헤더·본문 읽기 전체)의 시간 상한.
 * 주문 상태 변경 요청(기사 배송 시작·완료 등)이 알림 발송을 기다리므로 상한이 없으면
 * ALIGO나 고정 IP 프록시가 멈출 때 그 요청도 끝없이 멈춘다. 정상 ALIGO 응답은 1초 안팎이고
 * 프록시 한 홉을 더해도 8초면 충분한 여유가 있다. 최악 지연(알림톡 3회+SMS 1회가 모두
 * 상한 직전에 오류 응답) = 4 × 8초 + backoff 최대 3초 ≈ 35초.
 */
export const ALIGO_REQUEST_TIMEOUT_MS = 8_000;

/**
 * 시간 상한 신호. AbortSignal.timeout() 대신 전역 setTimeout을 써서 호출이 끝나면 바로
 * 정리하고, 테스트의 가짜 타이머로도 같은 경로를 검증할 수 있게 한다. 신호는 전역 fetch와
 * 프록시(undici fetch + ProxyAgent dispatcher) 양쪽에 그대로 전달되고 본문 읽기까지 덮는다.
 */
function startAligoRequestTimeout(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALIGO_REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

// 시간 초과는 연결 단계인지 요청 전송 뒤인지 구분할 수 없다(신호 하나가 전 구간을 덮는다).
// 요청이 이미 ALIGO에 닿았을 수 있으므로 접수 여부 불확실(UNKNOWN)로 보고 blind 재발송하지 않는다.
function aligoTimeoutMessage(channelLabel: string): string {
  return `${channelLabel} 요청이 ${ALIGO_REQUEST_TIMEOUT_MS}ms 안에 끝나지 않아 접수 여부를 확인할 수 없습니다. blind retry 없이 수동 확인이 필요합니다.`;
}

/**
 * 수신번호를 ALIGO에 보낼 단일 국내 휴대폰 번호(숫자만)로 정규화한다. 공백·하이픈·괄호는
 * 제거하고 +82 국가번호는 0으로 바꾼다. 쉼표 등으로 여러 번호를 이은 값이나 휴대폰 형식이
 * 아닌 값은 null을 돌려 발송하지 않게 한다.
 */
export function normalizeAligoRecipientPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+82')) digits = `0${digits.slice(3).replace(/^0/, '')}`;
  return /^(?:010\d{8}|01[16789]\d{7,8})$/.test(digits) ? digits : null;
}

const LOOPBACK_PROXY_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * ALIGO는 등록된 송신 IP만 허용한다. 호스팅의 송신 IP가 고정되지 않을 때는
 * ALIGO_OUTBOUND_PROXY_URL(고정 IP 프록시)을 설정해 ALIGO 호출만 그 프록시로 보낸다.
 * 값이 없으면 직접 호출하고, 형식이 잘못되면 직접 호출로 우회하지 않고 발송을 거부한다.
 * 프록시 URL의 인증 정보가 평문 구간을 지나지 않도록 `https:`만 허용하고, `http:`는
 * 같은 호스트 안의 루프백 프록시(localhost·127.0.0.1·::1)에만 허용한다.
 * 프록시 URL에는 인증 정보가 들어 있으므로 오류·로그에 원문을 남기지 않는다.
 */
export function resolveAligoOutboundFetch(
  rawProxyUrl: string | undefined,
): { fetch: AligoFetch } | { configError: string } {
  const raw = (rawProxyUrl ?? '').trim();
  if (!raw) {
    return { fetch: (url, init) => fetch(url, init) };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { configError: 'ALIGO 송신 프록시 설정이 올바르지 않습니다.' };
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    return { configError: 'ALIGO 송신 프록시 설정이 올바르지 않습니다.' };
  }
  if (parsed.protocol === 'http:' && !LOOPBACK_PROXY_HOSTS.has(parsed.hostname.toLowerCase())) {
    return {
      configError: 'ALIGO 송신 프록시는 https URL이어야 합니다(http는 루프백 주소만 허용).',
    };
  }
  const dispatcher = new ProxyAgent(raw);
  return {
    fetch: (url, init) =>
      undiciFetch(url, { ...init, dispatcher }) as unknown as Promise<Response>,
  };
}

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

// ALIGO는 -99 하나에 잔액 부족·인증 실패·파라미터 누락 등 성격이 다른 실패를 함께 싣는다
// (smartsms.aligo.in/alimapi.html 응답 예시). 그래서 code만으로는 영구 여부를 알 수 없어
// 공식 문서·운영 실측으로 확인된 문구만 영구 사유로 본다. 확인되지 않은 응답은 null을
// 돌려 기존 분류(재시도 가능 코드 등)를 그대로 따른다.
export type AligoPermanentErrorReason =
  | 'INSUFFICIENT_BALANCE'
  | 'UNAUTHORIZED_IP'
  | 'AUTH_FAILED'
  | 'SENDER_NOT_REGISTERED'
  | 'TEMPLATE_INVALID'
  | 'SENDER_PROFILE_INVALID';

/**
 * 영구 사유별로 SMS 대체가 의미 있는지 고정한다. 잔액·송신 IP·계정 인증·발신번호는
 * 같은 ALIGO 계정과 발신번호를 쓰는 SMS도 같은 원인으로 거절되므로 대체하지 않는다.
 * 템플릿·발신 프로필(senderkey)은 알림톡에만 쓰이므로 SMS 대체 1회를 유지한다.
 */
export const ALIGO_PERMANENT_ERROR_SMS_FALLBACK: Readonly<
  Record<AligoPermanentErrorReason, boolean>
> = {
  INSUFFICIENT_BALANCE: false,
  UNAUTHORIZED_IP: false,
  AUTH_FAILED: false,
  SENDER_NOT_REGISTERED: false,
  TEMPLATE_INVALID: true,
  SENDER_PROFILE_INVALID: true,
};

const ALIGO_PERMANENT_MESSAGE_PATTERNS: ReadonlyArray<
  readonly [AligoPermanentErrorReason, RegExp]
> = [
  // 공식: "포인트가 부족합니다." / 2026-09-28 운영 실측: "보유건수가 부족합니다"
  [
    'INSUFFICIENT_BALANCE',
    /(포인트|보유\s*건수|잔액|잔여\s*건수|발송\s*가능\s*건수)[^\n]{0,10}부족/,
  ],
  // 운영 실측·명세: "-99 인증되지 않는 서버 IP"
  ['UNAUTHORIZED_IP', /인증되지\s*않[는은]\s*(서버\s*)?ip/i],
  // 공식: "등록되지 않은 인증키 입니다." / "인증오류입니다."
  ['AUTH_FAILED', /등록되지\s*않은\s*인증\s*키|인증\s*오류/],
  // 사전 등록된 발신번호만 발송할 수 있다(발신번호 미등록 문구가 명시될 때만)
  [
    'SENDER_NOT_REGISTERED',
    /(등록되지\s*않은|미등록)[^\n]{0,10}발신\s*번호|발신\s*번호[^\n]{0,15}(등록되지\s*않|미등록)/,
  ],
  // 공식: "발신 프로파일 키(=senderkey)파라메더 정보가 전달되지 않았습니다."
  ['SENDER_PROFILE_INVALID', /발신\s*프로[파필]|senderkey/i],
  // 알림톡 전용 자원인 템플릿을 지목한 거절
  ['TEMPLATE_INVALID', /템플릿|tpl_code/i],
];

// 공식: -101 "인증오류입니다."(알림톡·문자 API 공통)
const ALIGO_AUTH_FAILED_CODES: ReadonlySet<number> = new Set([-101]);

export function classifyAligoPermanentError(input: {
  code?: number | null;
  message?: string | null;
}): AligoPermanentErrorReason | null {
  const message = typeof input.message === 'string' ? input.message : '';
  for (const [reason, pattern] of ALIGO_PERMANENT_MESSAGE_PATTERNS) {
    if (pattern.test(message)) return reason;
  }
  if (
    typeof input.code === 'number' &&
    Number.isFinite(input.code) &&
    ALIGO_AUTH_FAILED_CODES.has(input.code)
  ) {
    return 'AUTH_FAILED';
  }
  return null;
}

export function classifyProviderError(input: {
  code?: number | null;
  message?: string | null;
  httpStatus?: number | null;
  retryableCodes: ReadonlySet<number>;
}): ProviderErrorClass {
  if (input.httpStatus === 429) return 'RATE_LIMITED';
  // 재시도해도 결과가 같은 영구 사유는 재시도 가능 코드(-99 등)보다 우선한다.
  if (classifyAligoPermanentError(input) !== null) return 'PERMANENT';
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
  // 최종 실패를 만든 ALIGO 영구 사유. 영구 사유가 아니거나 성공이면 없음/null.
  permanentErrorReason?: AligoPermanentErrorReason | null;
};

type ProviderAttemptResult = {
  outcome: ProviderOutcome;
  providerReceipt: string | null;
  errorMessage?: string;
  errorClass?: ProviderErrorClass;
  permanentReason?: AligoPermanentErrorReason | null;
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

const ALIGO_INVALID_RECIPIENT_MESSAGE = '수신번호가 단일 휴대폰 번호 형식이 아닙니다.';

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
  private readonly aligoFetch: AligoFetch | null;
  private readonly outboundProxyError: string | null;
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
    const outbound = resolveAligoOutboundFetch(config.get<string>('ALIGO_OUTBOUND_PROXY_URL', ''));
    this.aligoFetch = 'fetch' in outbound ? outbound.fetch : null;
    this.outboundProxyError = 'configError' in outbound ? outbound.configError : null;
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
    if (this.outboundProxyError || !this.aligoFetch) {
      return localRejection(
        message,
        0,
        0,
        this.outboundProxyError ?? 'ALIGO 송신 프록시 설정이 올바르지 않습니다.',
      );
    }

    const receiver = normalizeAligoRecipientPhone(phone);
    if (!receiver) {
      return localRejection(message, 0, 0, ALIGO_INVALID_RECIPIENT_MESSAGE);
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
    let alimtalkPermanentReason: AligoPermanentErrorReason | null = null;

    for (
      let attempt = 0;
      attempt < NOTIFICATION_RETRY_BACKOFF_POLICY.maxAlimtalkAttempts;
      attempt += 1
    ) {
      const result = await this.sendAlimtalkOnce(receiver, providerTemplateCode, message);
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
      alimtalkPermanentReason = result.permanentReason ?? null;
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

    // 잔액·송신 IP·계정 인증처럼 SMS도 같은 원인으로 거절될 것이 확실하면 대체를 건너뛴다.
    if (
      alimtalkPermanentReason !== null &&
      !ALIGO_PERMANENT_ERROR_SMS_FALLBACK[alimtalkPermanentReason]
    ) {
      return {
        success: false,
        outcome: 'REJECTED',
        errorClass: 'PERMANENT',
        channel: null,
        message,
        alimtalkAttempts: alimtalkAttemptsUsed,
        smsAttempts: 0,
        providerReceipt: null,
        attemptId,
        needsVerify: false,
        errorMessage,
        permanentErrorReason: alimtalkPermanentReason,
      };
    }

    const smsResult = await this.sendSmsMessage(receiver, message);
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
      permanentErrorReason: smsResult.permanentReason ?? null,
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
    if (this.outboundProxyError || !this.aligoFetch) {
      return localRejection(
        message,
        0,
        0,
        this.outboundProxyError ?? 'ALIGO 송신 프록시 설정이 올바르지 않습니다.',
      );
    }
    const receiver = normalizeAligoRecipientPhone(phone);
    if (!receiver) {
      return localRejection(message, 0, 0, ALIGO_INVALID_RECIPIENT_MESSAGE);
    }
    const attemptId = uuidv4();
    const result = await this.sendSmsMessage(receiver, message);
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
      permanentErrorReason: result.permanentReason ?? null,
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
    const timeout = startAligoRequestTimeout();
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

      const res = await this.requireAligoFetch()('https://kakaoapi.aligo.in/akv10/alimtalk/send/', {
        method: 'POST',
        body: params,
        signal: timeout.signal,
      });
      let json: unknown;
      try {
        json = (await res.json()) as unknown;
      } catch (e) {
        return {
          outcome: 'UNKNOWN',
          providerReceipt: null,
          errorClass: 'UNKNOWN',
          errorMessage: timeout.signal.aborted
            ? aligoTimeoutMessage('알림톡')
            : `알림톡 응답 파싱 실패: ${String(e)}`,
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
        const errorInput = {
          code: record['code'],
          message: messageText,
          httpStatus: res.status,
        };
        const errorClass = classifyAlimtalkProviderError(errorInput);
        return {
          outcome: 'REJECTED',
          providerReceipt: null,
          errorClass,
          permanentReason:
            errorClass === 'PERMANENT' ? classifyAligoPermanentError(errorInput) : null,
          errorMessage: messageText,
        };
      }
      return { outcome: 'ACCEPTED', providerReceipt: parseAlimtalkReceipt(json) };
    } catch (e) {
      return {
        outcome: 'UNKNOWN',
        providerReceipt: null,
        errorClass: 'UNKNOWN',
        errorMessage: timeout.signal.aborted
          ? aligoTimeoutMessage('알림톡')
          : `알림톡 transport 불확실: ${String(e)}`,
      };
    } finally {
      timeout.clear();
    }
  }

  private requireAligoFetch(): AligoFetch {
    if (!this.aligoFetch) {
      throw new Error(this.outboundProxyError ?? 'ALIGO 송신 프록시 설정이 올바르지 않습니다.');
    }
    return this.aligoFetch;
  }

  private async sendSmsMessage(
    phone: string,
    message: string,
  ): Promise<ProviderAttemptResult> {
    const timeout = startAligoRequestTimeout();
    try {
      const params = new URLSearchParams({
        key: this.apiKey,
        user_id: this.userId,
        sender: this.senderPhone,
        receiver: phone,
        msg: message,
      });

      const res = await this.requireAligoFetch()('https://apis.aligo.in/send/', {
        method: 'POST',
        body: params,
        signal: timeout.signal,
      });
      let json: unknown;
      try {
        json = (await res.json()) as unknown;
      } catch (e) {
        return {
          outcome: 'UNKNOWN',
          providerReceipt: null,
          errorClass: 'UNKNOWN',
          errorMessage: timeout.signal.aborted
            ? aligoTimeoutMessage('문자')
            : `문자 응답 파싱 실패: ${String(e)}`,
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
        const errorInput = { code: resultCode, message: messageText, httpStatus: res.status };
        const errorClass = classifySmsProviderError(errorInput);
        return {
          outcome: 'REJECTED',
          providerReceipt: null,
          errorClass,
          permanentReason:
            errorClass === 'PERMANENT' ? classifyAligoPermanentError(errorInput) : null,
          errorMessage: messageText,
        };
      }
      return { outcome: 'ACCEPTED', providerReceipt: parseSmsReceipt(json) };
    } catch (e) {
      return {
        outcome: 'UNKNOWN',
        providerReceipt: null,
        errorClass: 'UNKNOWN',
        errorMessage: timeout.signal.aborted
          ? aligoTimeoutMessage('문자')
          : `문자 transport 불확실: ${String(e)}`,
      };
    } finally {
      timeout.clear();
    }
  }
}
