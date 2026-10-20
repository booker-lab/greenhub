import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { defaultExtras } from './productExtras';
import { ProductExtrasSection } from './ProductExtrasSection';

// 기능 토글이 모두 꺼진 운영 기본값에서도 상품정보제공고시 칸은 그려야 한다.
vi.mock('@/lib/features', () => ({ isFeatureOn: () => false }));

type Props = {
  children?: ReactNode;
  label?: string;
  value?: string;
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

describe('ProductExtrasSection 상품 정보 고시', () => {
  it('기능 토글이 모두 꺼져도 고시 다섯 항목을 그린다', () => {
    const tree = ProductExtrasSection({ extras: defaultExtras(), onChange: () => {} });
    const labels = collect(tree)
      .map((element) => element.props.label)
      .filter(Boolean);
    expect(labels).toEqual([
      '상품 정보 고시 (손님 상품 화면에 항상 보여요)',
      '품명',
      '원산지',
      '생산자',
      '인증·허가 사항',
      '소비자 상담 전화',
    ]);
  });

  it('미리 채운 기본값을 보여주고, 고친 값은 그 칸에만 반영한다', () => {
    const onChange = vi.fn();
    const extras = defaultExtras();
    const inputs = collect(ProductExtrasSection({ extras, onChange })).filter(
      (element) => element.props.onChange,
    );
    const origin = inputs.find((element) => element.props.label === '원산지');
    expect(origin?.props.value).toBe('국내산(경기도 이천)');

    origin?.props.onChange?.({ currentTarget: { value: '국내산(경기도 여주)' } });
    expect(onChange).toHaveBeenCalledWith({
      ...extras,
      notice: { ...extras.notice, origin: '국내산(경기도 여주)' },
    });
  });
});
