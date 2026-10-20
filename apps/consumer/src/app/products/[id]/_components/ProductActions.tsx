'use client';

import type { Product, SaleRound, SaleRoundItem } from '@greenhub/shared';
import dynamic from 'next/dynamic';
import RoundDirectProductActions from './RoundDirectProductActions';

// 일반 상품 구매 영역은 배송 희망일 선택(useDailyCap)이 Firestore SDK를 끌어온다.
// 회차 판매 상품은 이 영역을 그리지 않으므로 따로 나눠 상세 화면 첫 청크에서 Firestore를 뺀다.
const LegacyProductActions = dynamic(() => import('./LegacyProductActions'));

export interface RoundProductActionContext {
  item: SaleRoundItem;
  state: 'current' | 'closed' | 'sold_out';
  isPurchasable: boolean;
  /** 주문 시작 전(SCHEDULED) 안내에 쓴다. */
  round?: Pick<SaleRound, 'status'>;
}

interface Props {
  product: Product;
  roundProduct?: RoundProductActionContext;
}

export default function ProductActions({ product, roundProduct }: Props) {
  return roundProduct ? (
    <RoundDirectProductActions product={product} roundProduct={roundProduct} />
  ) : (
    <LegacyProductActions product={product} />
  );
}
