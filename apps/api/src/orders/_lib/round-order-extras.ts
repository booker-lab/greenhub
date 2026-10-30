import {
  GIFT_MESSAGE_MAX_LENGTH,
  type GiftInfo,
  PACKAGE_LABEL_MAX_LENGTH,
  type SelectedProductOption,
} from '@greenhub/shared';
import { BadRequestException } from '@nestjs/common';
import { toSingleLineText } from '../../notifications/notification-templates';
import { normalizeKoreanMobilePhone } from './korean-mobile-phone';

// 팔도감 벤치마킹 비교용 회차 주문 부가 정보(옵션·선물·포장 라벨). 없는 요청은 기존 계산과 같다.

/**
 * 상품의 옵션 묶음과 고객이 고른 선택지 id로 옵션 스냅샷과 추가 금액을 만든다.
 * - 상품에 옵션이 없으면 선택지를 받지 않는다.
 * - 옵션이 있으면 묶음마다 정확히 하나를 골라야 한다.
 * 축하 문구는 미리 출력한 토퍼 선택지로 고르고, 자유 문구는 주문의 포장 라벨(resolvePackageLabel)로 받는다.
 * 예전 상품 문서에 남은 needsText는 보지 않는다.
 */
export function resolveSelectedOptions(
  productOptions: unknown,
  choiceIds: readonly string[] | undefined,
): { selected: SelectedProductOption[]; priceDelta: number } {
  const groups = Array.isArray(productOptions) ? (productOptions as Array<Record<string, any>>) : [];
  const picked = choiceIds ?? [];
  if (groups.length === 0) {
    if (picked.length > 0) throw new BadRequestException('옵션이 없는 상품입니다.');
    return { selected: [], priceDelta: 0 };
  }
  if (picked.length !== groups.length || new Set(picked).size !== picked.length) {
    throw new BadRequestException('옵션을 묶음마다 하나씩 골라 주세요.');
  }
  const selected: SelectedProductOption[] = groups.map((group) => {
    const choices = Array.isArray(group['choices']) ? (group['choices'] as Array<Record<string, any>>) : [];
    const matches = choices.filter((choice) => picked.includes(choice['id']));
    if (matches.length !== 1) throw new BadRequestException('옵션 선택이 올바르지 않습니다.');
    const choice = matches[0];
    const priceDelta = Number(choice['priceDelta']);
    if (!Number.isSafeInteger(priceDelta) || priceDelta < 0) {
      throw new BadRequestException('옵션 금액을 확인할 수 없습니다.');
    }
    const snapshot: SelectedProductOption = {
      groupId: String(group['id']),
      groupName: String(group['name']),
      choiceId: String(choice['id']),
      choiceLabel: String(choice['label']),
      priceDelta,
    };
    // 재고 품목에 연결된 선택지는 주문 스냅샷에 품목 id를 남긴다(늦은 결제 재확보가 이 값으로 다시 잡는다).
    if (typeof choice['stockId'] === 'string' && choice['stockId'] !== '') {
      snapshot.stockId = choice['stockId'];
    }
    return snapshot;
  });
  return { selected, priceDelta: selected.reduce((sum, option) => sum + option.priceDelta, 0) };
}

/** 주문 예약이 잡는 옵션 재고 한 줄: 품목 id와 수량. */
export type OptionStockLine = { stockId: string; quantity: number };

/**
 * 주문 품목들의 옵션 스냅샷에서 재고 품목별로 잡을 수량을 모은다(품목 수량 × 선택 1개).
 * 재고에 연결되지 않은 선택지는 세지 않는다. 결과는 품목 id 순서라 같은 입력이면 같은 값이다.
 */
export function collectOptionStockLines(
  items: ReadonlyArray<{ quantity: number; selectedOptions?: ReadonlyArray<{ stockId?: string }> }>,
): OptionStockLine[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    for (const option of item.selectedOptions ?? []) {
      if (!option.stockId) continue;
      totals.set(option.stockId, (totals.get(option.stockId) ?? 0) + item.quantity);
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([stockId, quantity]) => ({ stockId, quantity }));
}

/**
 * 선물 정보는 한 줄로 정리한다. 받는 분 이름·연락처, 보내는 분 이름은 꼭 있어야 한다.
 * 보내는 분 이름은 포장 라벨로 출력되므로 잘라 내지 않고 넘치면 막는다.
 */
export function normalizeGift(gift: Partial<GiftInfo> | undefined | null): GiftInfo | null {
  if (!gift) return null;
  const recipientName = toSingleLineText(gift.recipientName, 20);
  const senderName = toSingleLineText(gift.senderName, PACKAGE_LABEL_MAX_LENGTH * 10);
  if (!recipientName || !senderName) {
    throw new BadRequestException('선물 받는 분과 보내는 분 이름을 적어 주세요.');
  }
  if (Array.from(senderName).length > PACKAGE_LABEL_MAX_LENGTH) {
    throw new BadRequestException(`보내는 분 이름은 ${PACKAGE_LABEL_MAX_LENGTH}자까지 쓸 수 있어요.`);
  }
  const recipientPhone = normalizeKoreanMobilePhone(gift.recipientPhone);
  if (!recipientPhone) {
    throw new BadRequestException('받는 분 휴대폰 번호를 확인해 주세요.');
  }
  return {
    recipientName,
    recipientPhone,
    senderName,
    cardMessage: toSingleLineText(gift.cardMessage, GIFT_MESSAGE_MAX_LENGTH),
  };
}

/**
 * 포장 겉면에 붙일 라벨 문구(주문마다 한 장, 무료). 없으면 null.
 * - 선물이면 보내는 분 이름이 라벨이다. 이때 따로 보낸 라벨 문구는 받지 않는다(두 값이 어긋나지 않게).
 * - 선물이 아니면 고객이 "넣기"를 고른 경우에만 보낸다. 한 줄로 정리한 뒤 PACKAGE_LABEL_MAX_LENGTH자를
 *   넘으면 잘라 내지 않고 막는다. 정리 뒤 비어 있으면 라벨 없음이다.
 */
export function resolvePackageLabel(packageLabel: string | undefined, gift: GiftInfo | null): string | null {
  if (gift) {
    if (packageLabel !== undefined) {
      throw new BadRequestException('선물은 보내는 분 이름이 포장 라벨로 붙어요. 라벨 문구를 따로 보낼 수 없어요.');
    }
    return gift.senderName;
  }
  const text = toSingleLineText(packageLabel, PACKAGE_LABEL_MAX_LENGTH * 10);
  if (!text) return null;
  if (Array.from(text).length > PACKAGE_LABEL_MAX_LENGTH) {
    throw new BadRequestException(`포장 라벨 문구는 ${PACKAGE_LABEL_MAX_LENGTH}자까지 쓸 수 있어요.`);
  }
  return text;
}
