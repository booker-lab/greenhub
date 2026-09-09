import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { InviteGenerator } from './InviteGenerator';

type Props = ComponentProps<typeof InviteGenerator>;

const GENERATE_ERROR_MESSAGE = '초대 토큰 발급 중 오류 발생';

const baseProps: Props = {
  generating: false,
  lastToken: null,
  copied: false,
  generateError: null,
  onGenerate: () => {},
  onCopy: () => {},
};

interface Clickable {
  children?: ReactNode;
  onClick?: unknown;
}

function isElement(node: ReactNode): node is ReactElement<Clickable> {
  return typeof node === 'object' && node !== null && 'props' in node;
}

/** 렌더 트리(DOM 불필요)에서 모든 텍스트 리프를 수집한다. */
function textsOf(node: ReactNode): string[] {
  const out: string[] = [];
  const visit = (current: ReactNode): void => {
    if (typeof current === 'string') {
      out.push(current);
      return;
    }
    if (typeof current === 'number') {
      out.push(String(current));
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (isElement(current)) visit(current.props.children);
  };
  visit(node);
  return out;
}

/** 주어진 라벨을 포함한 버튼의 onClick 핸들러를 수집한다. */
function handlersFor(tree: ReactNode, label: string): Array<() => void> {
  const handlers: Array<() => void> = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    if (typeof current.props.onClick === 'function' && textsOf(current).includes(label)) {
      handlers.push(current.props.onClick as () => void);
    }
    visit(current.props.children);
  };
  visit(tree);
  return handlers;
}

describe('InviteGenerator command state', () => {
  it('대기 상태에서는 생성 버튼을 표시하고 실패 UI를 노출하지 않는다', () => {
    const tree = InviteGenerator({ ...baseProps });
    const texts = textsOf(tree);
    expect(texts).toContain('새 토큰 생성');
    expect(texts).not.toContain('토큰 발급에 실패했습니다.');
    expect(texts).not.toContain('생성된 초대 토큰');
  });

  it('생성 중에는 진행 copy를 표시한다', () => {
    const tree = InviteGenerator({ ...baseProps, generating: true });
    expect(textsOf(tree)).toContain('생성중…');
  });

  it('발급 실패는 성공과 구분되는 실패 UI로 알린다', () => {
    const tree = InviteGenerator({ ...baseProps, generateError: GENERATE_ERROR_MESSAGE });
    const texts = textsOf(tree);
    expect(texts).toContain('토큰 발급에 실패했습니다.');
    expect(texts).toContain(GENERATE_ERROR_MESSAGE);
  });

  it('발급 실패가 이전 성공 token 표시를 덮어쓰지 않는다', () => {
    const tree = InviteGenerator({
      ...baseProps,
      generateError: GENERATE_ERROR_MESSAGE,
      // 보안: 실제 토큰 원문이 아닌 구조 검증용 더미 식별자만 사용한다.
      lastToken: { token: 'test-issued-aaa', expiresAt: '2026-12-31T00:00:00.000Z' },
    });
    const texts = textsOf(tree);
    expect(texts).toContain('토큰 발급에 실패했습니다.');
    expect(texts).toContain('생성된 초대 토큰');
    expect(texts).toContain('test-issued-aaa');
  });

  it('성공 시 lastToken 블록·복사 버튼·만료 표기를 유지한다', () => {
    const tree = InviteGenerator({
      ...baseProps,
      lastToken: { token: 'test-issued-aaa', expiresAt: '2026-12-31T00:00:00.000Z' },
    });
    const texts = textsOf(tree);
    expect(texts).toContain('생성된 초대 토큰');
    expect(texts).toContain('test-issued-aaa');
    expect(texts).toContain('복사');
    expect(texts.some((t) => t.includes('만료'))).toBe(true);
    expect(texts).not.toContain('토큰 발급에 실패했습니다.');
  });

  it('copy feedback 계약을 보존한다(복사/복사됨!)', () => {
    const idleTree = InviteGenerator({
      ...baseProps,
      lastToken: { token: 'test-issued-aaa', expiresAt: '2026-12-31T00:00:00.000Z' },
      copied: false,
    });
    expect(textsOf(idleTree)).toContain('복사');
    const copiedTree = InviteGenerator({
      ...baseProps,
      copied: true,
      lastToken: { token: 'test-issued-aaa', expiresAt: '2026-12-31T00:00:00.000Z' },
    });
    expect(textsOf(copiedTree)).toContain('복사됨!');
  });

  it('lastToken이 없으면 복사 버튼을 노출하지 않는다', () => {
    const tree = InviteGenerator({ ...baseProps });
    expect(handlersFor(tree, '복사')).toHaveLength(0);
  });

  it('생성 버튼은 onGenerate에, 복사 버튼은 onCopy에 연결된다', () => {
    const onGenerate = vi.fn();
    const genTree = InviteGenerator({ ...baseProps, onGenerate });
    const genHandlers = handlersFor(genTree, '새 토큰 생성');
    expect(genHandlers.length).toBeGreaterThan(0);
    genHandlers[0]();
    expect(onGenerate).toHaveBeenCalledTimes(1);

    const onCopy = vi.fn();
    const copyTree = InviteGenerator({
      ...baseProps,
      onCopy,
      lastToken: { token: 'test-issued-aaa', expiresAt: '2026-12-31T00:00:00.000Z' },
    });
    const copyHandlers = handlersFor(copyTree, '복사');
    expect(copyHandlers.length).toBeGreaterThan(0);
    copyHandlers[0]();
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
