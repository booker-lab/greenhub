'use client';

import type { Product, SaleRoundItem } from '@greenhub/shared';
import LegacyProductActions from './LegacyProductActions';
import RoundDirectProductActions from './RoundDirectProductActions';

export interface RoundProductActionContext {
  item: SaleRoundItem;
  state: 'current' | 'closed';
  isPurchasable: boolean;
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
