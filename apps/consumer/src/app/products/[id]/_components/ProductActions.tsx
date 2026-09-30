'use client';

import type { Product, SaleRound, SaleRoundItem } from '@greenhub/shared';
import LegacyProductActions from './LegacyProductActions';
import RoundDirectProductActions from './RoundDirectProductActions';

export interface RoundProductActionContext {
  item: SaleRoundItem;
  state: 'current' | 'closed';
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
