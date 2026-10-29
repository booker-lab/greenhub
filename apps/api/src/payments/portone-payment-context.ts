import type { ConfigService } from '@nestjs/config';
import { getConfigValues, isProductionRuntime } from '../config/runtime-config';

/**
 * PortOne V2 결제 재조회 결과의 상점·통화·채널 확인.
 *
 * PortOne V2 `PaidPayment`는 `storeId: string`, `currency: Currency`,
 * `channel: { type: 'LIVE' | 'TEST', ... }`를 필수 필드로 돌려준다
 * (PortOne V2 OpenAPI `PaidPayment`·`SelectedChannelType` 기준).
 *
 * - 운영 runtime: 세 필드를 모두 요구한다. 필드가 없거나 다르면 불일치다.
 *   `PORTONE_STORE_ID`가 비어 있으면 상점 비교만 건너뛴다(통화·LIVE 채널은 계속 요구).
 *   운영 판정은 `isProductionRuntime`만 따르고, 어떤 환경 변수로도 TEST 채널을 허용하지 않는다.
 * - 비운영 runtime(스테이징·E2E stub·로컬): TEST 채널을 허용하고, 필드가 없으면 건너뛴다.
 *   필드가 있으면 통화와(설정된 경우) 상점은 그대로 비교한다.
 *
 * 본 결제 확정(웹훅·15분 정리·늦은 결제)과 재배송비 결제 확정이 같은 정책을 쓴다.
 */
export const PORTONE_EXPECTED_CURRENCY = 'KRW';
export const PORTONE_LIVE_CHANNEL_TYPE = 'LIVE';

export type PortonePaymentContextPolicy = {
  expectedStoreId: string | null;
  requireLiveChannel: boolean;
  requireContextFields: boolean;
};

export type PortonePaymentContextField = 'storeId' | 'currency' | 'channel.type';

export type PortonePaymentContextMismatch = {
  field: PortonePaymentContextField;
  expected: string;
  actual: string | null;
};

export type PortonePaymentContextInput = {
  storeId?: unknown;
  currency?: unknown;
  channel?: { type?: unknown } | null;
};

function readTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function safeActual(value: string | null): string | null {
  return value === null ? null : value.replace(/[^\x21-\x7E]/g, '').slice(0, 80);
}

export function resolvePortonePaymentContextPolicy(
  values: Record<string, unknown>,
): PortonePaymentContextPolicy {
  const production = isProductionRuntime(values);
  return {
    expectedStoreId: readTrimmed(values['PORTONE_STORE_ID']),
    requireLiveChannel: production,
    requireContextFields: production,
  };
}

/** Nest DI는 전역 ConfigService를 항상 주입한다. 직접 생성하는 테스트만 process.env를 쓴다. */
export function resolvePortonePaymentContextPolicyFromConfig(
  config?: ConfigService,
): PortonePaymentContextPolicy {
  return resolvePortonePaymentContextPolicy(
    config
      ? { ...getConfigValues(config), PORTONE_STORE_ID: config.get<string>('PORTONE_STORE_ID') }
      : process.env,
  );
}

export function findPortonePaymentContextMismatch(
  payment: PortonePaymentContextInput,
  policy: PortonePaymentContextPolicy,
): PortonePaymentContextMismatch | null {
  if (policy.expectedStoreId) {
    const storeId = readTrimmed(payment.storeId);
    if (storeId === null ? policy.requireContextFields : storeId !== policy.expectedStoreId) {
      return { field: 'storeId', expected: policy.expectedStoreId, actual: safeActual(storeId) };
    }
  }

  const currency = readTrimmed(payment.currency);
  if (currency === null ? policy.requireContextFields : currency !== PORTONE_EXPECTED_CURRENCY) {
    return { field: 'currency', expected: PORTONE_EXPECTED_CURRENCY, actual: safeActual(currency) };
  }

  if (policy.requireLiveChannel) {
    const channel = payment.channel;
    const channelType = channel && typeof channel === 'object' ? readTrimmed(channel.type) : null;
    if (channelType !== PORTONE_LIVE_CHANNEL_TYPE) {
      return {
        field: 'channel.type',
        expected: PORTONE_LIVE_CHANNEL_TYPE,
        actual: safeActual(channelType),
      };
    }
  }

  return null;
}
