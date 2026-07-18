import type { CreateSaleRoundInput } from '@/hooks/useSaleRounds';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const KST_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function toKstDateTimeInput(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp + KST_OFFSET_MS).toISOString().slice(0, 16);
}

export function parseKstDateTimeInput(value: string): string | null {
  if (!KST_INPUT_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}:00+09:00`);
  if (!Number.isFinite(parsed.getTime()) || toKstDateTimeInput(parsed.toISOString()) !== value) {
    return null;
  }
  return parsed.toISOString();
}

export function readSafeHttpUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function pushUnique(errors: string[], message: string) {
  if (!errors.includes(message)) errors.push(message);
}

export function validateRoundFormInput(input: CreateSaleRoundInput): string[] {
  const errors: string[] = [];
  const schedule = input.schedule;
  const timestamps = [
    schedule.orderOpenAt,
    schedule.orderCloseAt,
    schedule.auctionAt,
    schedule.deliveryStartAt,
    schedule.deliveryEndAt,
  ].map(Date.parse);

  if (!isNonEmptyString(input.name)) {
    errors.push('회차 이름을 입력해 주세요.');
  }
  if (schedule.timezone !== 'Asia/Seoul') {
    errors.push('시간대는 Asia/Seoul이어야 합니다.');
  }
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    errors.push('모든 일정을 올바른 날짜와 시각으로 입력해 주세요.');
  } else {
    const [orderOpenAt, orderCloseAt, auctionAt, deliveryStartAt, deliveryEndAt] = timestamps;
    if (
      !(
        orderOpenAt < orderCloseAt &&
        orderCloseAt <= auctionAt &&
        auctionAt <= deliveryStartAt &&
        deliveryStartAt < deliveryEndAt
      )
    ) {
      errors.push(
        '일정 순서를 확인해 주세요. 주문 시작 < 주문 마감 <= 경매 시각 <= 배송 시작 < 배송 종료여야 합니다.',
      );
    }
  }

  const region = input.deliveryRegion;
  if (
    !isNonEmptyString(region.id) ||
    !isNonEmptyString(region.label) ||
    !isNonEmptyString(region.province) ||
    !isNonEmptyString(region.city) ||
    typeof region.enabled !== 'boolean'
  ) {
    errors.push('검증된 배송 지역 정보를 확인할 수 없습니다.');
  }
  if (
    !isPositiveInteger(input.limits.maxDeliveryAddresses) ||
    !isPositiveInteger(input.limits.maxItemQuantity)
  ) {
    errors.push('배송지 한도와 판매 수량 한도는 1 이상의 정수여야 합니다.');
  }
  if (input.items.length === 0) {
    errors.push('회차 상품을 한 개 이상 선택해 주세요.');
  }

  const productIds = new Set<string>();
  for (const item of input.items) {
    if (!isNonEmptyString(item.productId)) {
      pushUnique(errors, '검증된 상품 식별자를 확인할 수 없습니다.');
    } else if (productIds.has(item.productId)) {
      pushUnique(errors, '같은 상품을 회차에 두 번 포함할 수 없습니다.');
    } else {
      productIds.add(item.productId);
    }
    if (!isPositiveInteger(item.roundPrice) || !isPositiveInteger(item.saleLimitQuantity)) {
      pushUnique(errors, '각 상품의 회차 가격과 상품별 한도는 1 이상의 정수여야 합니다.');
    }
    if (!Number.isSafeInteger(item.displayOrder) || item.displayOrder < 0) {
      pushUnique(errors, '상품 노출 순서는 0 이상의 정수여야 합니다.');
    }
  }

  if (input.carrotLandingUrl !== undefined && readSafeHttpUrl(input.carrotLandingUrl) === null) {
    errors.push('당근 대표 링크는 http 또는 https URL이어야 합니다.');
  }
  return errors;
}
