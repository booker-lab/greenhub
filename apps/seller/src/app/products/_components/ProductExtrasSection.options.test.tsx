import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { defaultExtras, type ProductExtrasForm } from './productExtras';
import { ProductExtrasSection } from './ProductExtrasSection';

// 옵션 시트가 켜졌을 때 선택지마다 "재고 연결" 칸을 그리고, 고른 재고를 그 선택지에만 넣는다.
vi.mock('@/lib/features', () => ({ isFeatureOn: (key: string) => key === 'option-sheet' }));

type Props = {
  children?: ReactNode;
  label?: string;
  value?: string;
  data?: Array<{ value: string; label: string }>;
  onChange?: (event: { currentTarget: { value: string } }) => void;
};

function collect(node: ReactNode): ReactElement<Props>[] {
  const found: ReactElement<Props>[] = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (typeof current !== 'object' || current === null || !('props' in current)) return;
    const element = current as ReactElement<Props>;
    found.push(element);
    visit(element.props.children);
  };
  visit(node);
  return found;
}

const STOCK = {
  id: 'stock-pot',
  storeId: 'store-1',
  name: '흰색 출력 화분',
  stockQuantity: 5,
  reservedQuantity: 0,
  orderedQuantity: 0,
  remainingQuantity: 5,
};

function extrasWithPot(): ProductExtrasForm {
  return {
    ...defaultExtras(),
    options: [
      {
        id: 'g1',
        name: '화분',
        choices: [
          { id: 'c1', label: '기본 화분', priceDelta: '', stockId: '' },
          { id: 'c2', label: '출력 화분', priceDelta: '7000', stockId: '' },
        ],
      },
    ],
  };
}

describe('ProductExtrasSection 옵션 재고 연결', () => {
  it('선택지마다 재고 연결 칸을 그리고 재고 목록을 보여 준다', () => {
    const tree = ProductExtrasSection({
      extras: extrasWithPot(),
      onChange: () => {},
      optionStocks: [STOCK],
    });
    const selects = collect(tree).filter((element) => element.props.label === '재고 연결');
    expect(selects).toHaveLength(2);
    expect(selects[0].props.data).toEqual([
      { value: '', label: '연결 안 함 (수량 제한 없음)' },
      { value: 'stock-pot', label: '흰색 출력 화분 (남은 5개)' },
    ]);
  });

  it('고른 재고는 그 선택지에만 넣는다', () => {
    const onChange = vi.fn();
    const extras = extrasWithPot();
    const selects = collect(
      ProductExtrasSection({ extras, onChange, optionStocks: [STOCK] }),
    ).filter((element) => element.props.label === '재고 연결');
    selects[1].props.onChange?.({ currentTarget: { value: 'stock-pot' } });

    const next = onChange.mock.calls[0][0] as ProductExtrasForm;
    expect(next.options[0].choices.map((choice) => choice.stockId)).toEqual(['', 'stock-pot']);
  });

  it('재고를 불러오지 못하면 알린다', () => {
    const tree = ProductExtrasSection({
      extras: extrasWithPot(),
      onChange: () => {},
      optionStocksError: '옵션 재고를 불러오지 못했어요.',
    });
    const alerts = collect(tree).filter(
      (element) => element.props.children === '옵션 재고를 불러오지 못했어요.',
    );
    expect(alerts).toHaveLength(1);
  });
});
