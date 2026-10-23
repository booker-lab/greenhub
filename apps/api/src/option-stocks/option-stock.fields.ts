import { type OptionStock, optionStockRemaining } from '@greenhub/shared';

// 매장 옵션 재고 품목(예: 판매자가 직접 출력한 화분). 클라이언트 직접 접근은 firestore.rules 기본 거부.
export const OPTION_STOCKS_COLLECTION = 'optionStocks';

/** 재고 품목 id. 서버가 만든 UUID만 쓰지만 상품 옵션 저장 때 넘어오는 값도 같은 모양으로 막는다. */
export const OPTION_STOCK_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function optionStockPath(stockId: string): string {
  return `${OPTION_STOCKS_COLLECTION}/${stockId}`;
}

/** 저장된 문서를 응답 모양으로 바꾼다. 남은 수량은 서버가 계산해 붙인다. */
export function toOptionStock(id: string, data: Record<string, unknown> | undefined): OptionStock {
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    id,
    storeId: String(data?.['storeId'] ?? ''),
    name: String(data?.['name'] ?? ''),
    stockQuantity: count(data?.['stockQuantity']),
    reservedQuantity: count(data?.['reservedQuantity']),
    orderedQuantity: count(data?.['orderedQuantity']),
    remainingQuantity: optionStockRemaining(data ?? {}),
  };
}
