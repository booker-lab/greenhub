// 옵션 시트의 남은 수량·품절 판단(직접 출력한 화분 등 재고에 연결된 선택지).
// 서버 GET /products/:productId/option-availability 응답을 쓴다. 최종 판단은 주문할 때 서버가 다시 한다.
// node:test가 그대로 옮겨 실행하도록 런타임 import 없이 쓴다.

/** 선택지 id → 남은 수량. 재고에 연결되지 않은 선택지는 없다(수량 제한 없음). */
export type OptionAvailabilityMap = Record<string, number>;

/** 이 수량 이하로 남으면 "N개 남음"을 보여 준다. */
export const LOW_STOCK_THRESHOLD = 5;

/** 한 번에 담을 수 있는 최대 수량(옵션 시트 수량 버튼 상한과 같다). */
export const OPTION_SHEET_QUANTITY_MAX = 99;

export function toAvailabilityMap(body: unknown): OptionAvailabilityMap {
  const map: OptionAvailabilityMap = {};
  const choices = (body as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices)) return map;
  for (const entry of choices) {
    const choiceId = (entry as { choiceId?: unknown } | null)?.choiceId;
    const remaining = (entry as { remainingQuantity?: unknown } | null)?.remainingQuantity;
    if (typeof choiceId !== 'string' || typeof remaining !== 'number' || !Number.isFinite(remaining)) {
      continue;
    }
    map[choiceId] = Math.max(0, Math.floor(remaining));
  }
  return map;
}

/** 남은 수량. 재고에 연결되지 않았거나 아직 모르면 null(제한 없음으로 본다). */
export function choiceRemaining(map: OptionAvailabilityMap | null | undefined, choiceId: string): number | null {
  if (!map || !(choiceId in map)) return null;
  return map[choiceId];
}

export function isChoiceSoldOut(map: OptionAvailabilityMap | null | undefined, choiceId: string): boolean {
  return choiceRemaining(map, choiceId) === 0;
}

/** 선택지 옆에 붙일 재고 안내. 넉넉하면 null. */
export function choiceStockLabel(remaining: number | null): string | null {
  if (remaining === null) return null;
  if (remaining <= 0) return '품절';
  return remaining <= LOW_STOCK_THRESHOLD ? `${remaining}개 남음` : null;
}

/** 묶음의 첫 선택지 중 품절이 아닌 것. 모두 품절이면 빈 문자열. */
export function firstAvailableChoiceId(
  choices: ReadonlyArray<{ id: string }>,
  map: OptionAvailabilityMap | null | undefined,
): string {
  return choices.find((choice) => !isChoiceSoldOut(map, choice.id))?.id ?? '';
}

/** 고른 선택지들로 담을 수 있는 최대 수량. 같은 화분을 여러 묶음이 쓰는 일은 없다고 보고 가장 적은 값을 쓴다. */
export function maxQuantityFor(
  map: OptionAvailabilityMap | null | undefined,
  pickedChoiceIds: readonly string[],
): number {
  let max = OPTION_SHEET_QUANTITY_MAX;
  for (const choiceId of pickedChoiceIds) {
    const remaining = choiceRemaining(map, choiceId);
    if (remaining !== null) max = Math.min(max, remaining);
  }
  return max;
}
