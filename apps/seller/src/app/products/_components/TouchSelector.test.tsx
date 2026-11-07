import { Button } from '@greenhub/ui/components/button';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import TouchSelector, { type SelectionForm } from './TouchSelector';

// 상품 폼 2단계(터치 선택)의 선택 버튼이 휴대폰 폭(360·390)에서 글자보다 좁아져 글자가 잘렸다.
// 원인: Button(overflow-hidden이라 최소 폭 0)에 flex-1만 줘 글자 폭 아래로 줄어들었고, 두 줄인 출하 형태는
// Button md 높이 42px 고정이라 위아래도 잘렸다. 이 저장소 테스트에는 브라우저 배치 계산이 없어
// 배치 계약(글자 폭 아래로 줄지 않음·터치 높이 44px 이상)을 클래스로 지킨다. 실제 폭 확인은 촬영 하네스로 했다.

type Props = { children?: ReactNode; className?: string; size?: string };

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

const value: SelectionForm = {
  colors: [],
  stemType: '외대',
  fragrance: 'none',
  bloomCondition: 'bud',
  careLevel: 'easy',
  bundleUnit: '',
};

function optionButtons() {
  const tree = TouchSelector({ value, onChange: () => {} });
  return collect(tree).filter((el) => el.type === Button);
}

describe('TouchSelector 선택 버튼 배치', () => {
  it('선택 버튼 13개(출하 형태 4·향기 3·개화 3·관리 3)를 그린다', () => {
    expect(optionButtons()).toHaveLength(13);
  });

  it('버튼이 글자 폭보다 좁아지지 않는다(자리가 모자라면 줄을 바꾼다)', () => {
    for (const button of optionButtons()) {
      expect(button.props.className?.split(/\s+/)).toContain('min-w-fit');
    }
  });

  it('버튼 높이는 44px 이상이고, 두 줄인 출하 형태는 내용 높이에 맞춘다', () => {
    const buttons = optionButtons();
    for (const button of buttons) {
      const classes = button.props.className?.split(/\s+/) ?? [];
      expect(classes.includes('h-11') || classes.includes('min-h-11')).toBe(true);
    }
    for (const stem of buttons.slice(0, 4)) {
      expect(stem.props.className?.split(/\s+/)).toEqual(
        expect.arrayContaining(['h-auto', 'min-h-11']),
      );
    }
  });
});
