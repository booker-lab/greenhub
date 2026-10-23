import {
  OPTION_STOCK_NAME_MAX_LENGTH,
  OPTION_STOCK_QUANTITY_MAX,
  type OptionStock,
} from '@greenhub/shared';

// 옵션 재고(직접 출력한 화분 등) 화면 순수 함수. 검증 규칙은 API `CreateOptionStockDto`·`UpdateOptionStockDto`와
// 같다(apps/api/src/option-stocks/dto/option-stock.dto.ts). 최종 판단은 서버가 다시 한다.

export { OPTION_STOCK_NAME_MAX_LENGTH };

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStock(raw: unknown): OptionStock | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const { id, storeId, name } = record;
  const stockQuantity = count(record.stockQuantity);
  const reservedQuantity = count(record.reservedQuantity);
  const orderedQuantity = count(record.orderedQuantity);
  const remainingQuantity = count(record.remainingQuantity);
  if (
    typeof id !== 'string' ||
    typeof storeId !== 'string' ||
    typeof name !== 'string' ||
    stockQuantity === null ||
    reservedQuantity === null ||
    orderedQuantity === null ||
    remainingQuantity === null
  ) {
    return null;
  }
  return { id, storeId, name, stockQuantity, reservedQuantity, orderedQuantity, remainingQuantity };
}

/** 목록 응답 `{ stocks }`를 읽는다. 모양이 틀린 항목은 버린다. */
export function readOptionStocks(body: unknown): OptionStock[] {
  if (typeof body !== 'object' || body === null) return [];
  const stocks = (body as Record<string, unknown>).stocks;
  if (!Array.isArray(stocks)) return [];
  return stocks.map(readStock).filter((stock): stock is OptionStock => stock !== null);
}

/** 추가·수정 응답 `{ stock }`을 읽는다. */
export function readOptionStock(body: unknown): OptionStock | null {
  if (typeof body !== 'object' || body === null) return null;
  return readStock((body as Record<string, unknown>).stock);
}

/** 숫자 칸 입력을 정수로 바꾼다. 비었거나 범위 밖이면 null. */
export function parseQuantity(text: string, min: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= OPTION_STOCK_QUANTITY_MAX ? value : null;
}

/** 새 재고 품목 본문. 틀리면 화면에 보일 문구를 돌려준다. */
export function toCreateBody(form: { name: string; quantity: string }):
  | { name: string; quantity: number }
  | string {
  const name = form.name.trim();
  if (!name) return '재고 이름을 입력해 주세요. 예: 흰색 출력 화분';
  if (name.length > OPTION_STOCK_NAME_MAX_LENGTH) {
    return `재고 이름은 ${OPTION_STOCK_NAME_MAX_LENGTH}자까지 쓸 수 있어요.`;
  }
  if (/\p{Cc}/u.test(name)) return '재고 이름에는 줄바꿈을 쓸 수 없어요.';
  const quantity = parseQuantity(form.quantity, 0);
  if (quantity === null) return `지금 있는 개수를 0~${OPTION_STOCK_QUANTITY_MAX}개로 입력해 주세요.`;
  return { name, quantity };
}

/** 새로 출력한 개수 더하기 본문. */
export function toAddBody(text: string): { addQuantity: number } | string {
  const addQuantity = parseQuantity(text, 1);
  if (addQuantity === null) return `더할 개수를 1~${OPTION_STOCK_QUANTITY_MAX}개로 입력해 주세요.`;
  return { addQuantity };
}

/** 실제 남은 개수로 맞추기 본문. */
export function toRemainingBody(text: string): { remainingQuantity: number } | string {
  const remainingQuantity = parseQuantity(text, 0);
  if (remainingQuantity === null) {
    return `남은 개수를 0~${OPTION_STOCK_QUANTITY_MAX}개로 입력해 주세요.`;
  }
  return { remainingQuantity };
}

/** 품목 한 줄 아래에 보일 수량 설명. */
export function describeStockCounts(stock: OptionStock): string {
  const parts = [`남은 ${stock.remainingQuantity}개`];
  if (stock.reservedQuantity > 0) parts.push(`결제 중 ${stock.reservedQuantity}개`);
  if (stock.orderedQuantity > 0) parts.push(`판매 ${stock.orderedQuantity}개`);
  return parts.join(' · ');
}

/** 목록 순서는 서버와 같은 이름 순. 추가·수정한 품목을 끼워 넣을 때 쓴다. */
export function upsertStock(stocks: readonly OptionStock[], next: OptionStock): OptionStock[] {
  return [...stocks.filter((stock) => stock.id !== next.id), next].sort((a, b) =>
    a.name.localeCompare(b.name, 'ko'),
  );
}
