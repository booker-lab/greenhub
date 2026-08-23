import { type ApiNotificationTemplateCode, NOTIFICATION_TEMPLATES } from './notification-templates';

export const ROUND_DIRECT_NOTIFICATION_TEMPLATE_CODES = [
  'ORDER_ACCEPTED',
  'ORDER_PREPARING',
  'ORDER_DELIVERING',
  'ORDER_DELIVERY_HELD',
  'ORDER_REDELIVERY_PAYMENT_REQUESTED',
  'ORDER_REDELIVERY_SCHEDULED',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
] as const satisfies readonly ApiNotificationTemplateCode[];

export class AligoTemplateCodeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AligoTemplateCodeConfigurationError';
  }
}

export function parseAligoTemplateCodes(
  raw: string,
): Partial<Record<ApiNotificationTemplateCode, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AligoTemplateCodeConfigurationError(
      'ALIGO_TEMPLATE_CODES_JSON이 올바른 JSON 객체가 아닙니다.',
    );
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new AligoTemplateCodeConfigurationError(
      'ALIGO_TEMPLATE_CODES_JSON은 JSON 객체여야 합니다.',
    );
  }

  const allowedCodes = new Set<string>(Object.keys(NOTIFICATION_TEMPLATES));
  const result: Partial<Record<ApiNotificationTemplateCode, string>> = {};
  for (const [logicalCode, providerCode] of Object.entries(parsed)) {
    if (!allowedCodes.has(logicalCode)) {
      throw new AligoTemplateCodeConfigurationError(
        `ALIGO_TEMPLATE_CODES_JSON에 허용되지 않은 논리 코드 ${logicalCode}가 있습니다.`,
      );
    }
    if (typeof providerCode !== 'string' || providerCode.trim().length === 0) {
      throw new AligoTemplateCodeConfigurationError(
        `ALIGO_TEMPLATE_CODES_JSON의 ${logicalCode} 값은 비어 있지 않은 문자열이어야 합니다.`,
      );
    }
    result[logicalCode as ApiNotificationTemplateCode] = providerCode.trim();
  }
  return result;
}

export function resolveAligoTemplateCode(
  raw: string,
  logicalCode: ApiNotificationTemplateCode,
): string {
  const providerCode = parseAligoTemplateCodes(raw)[logicalCode];
  if (!providerCode) {
    throw new AligoTemplateCodeConfigurationError(
      `ALIGO_TEMPLATE_CODES_JSON에 ${logicalCode} 매핑이 없습니다.`,
    );
  }
  return providerCode;
}

export function assertRoundDirectAligoTemplateCodes(raw: string): void {
  const mapping = parseAligoTemplateCodes(raw);
  const missing = ROUND_DIRECT_NOTIFICATION_TEMPLATE_CODES.filter((code) => !mapping[code]);
  if (missing.length > 0) {
    throw new AligoTemplateCodeConfigurationError(
      `회차 직배송 ALIGO 템플릿 코드 매핑이 누락되었습니다: ${missing.join(', ')}`,
    );
  }
}
