import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { InviteHistoryTable } from './InviteHistoryTable';

type Props = ComponentProps<typeof InviteHistoryTable>;

const FETCH_ERROR_MESSAGE = '초대 토큰 조회 중 오류 발생';

const baseProps: Props = {
  invites: [],
  loading: false,
  error: null,
  onRetry: () => {},
};

// 보안: 실제 토큰 원문이 아닌 구조 검증용 더미 식별자만 사용한다.
function invite(token: string): Props['invites'][number] {
  return {
    token,
    createdBy: 'admin-test',
    usedAt: null,
    usedBy: null,
    expiresAt: '2026-12-31T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

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

describe('InviteHistoryTable read state', () => {
  it('loading은 로딩 UI를 표시한다', () => {
    const tree = InviteHistoryTable({ ...baseProps, loading: true });
    expect(textsOf(tree)).toContain('불러오는 중...');
  });

  it('조회 실패 + 0건은 empty copy 대신 error UI와 retry를 표시한다', () => {
    const tree = InviteHistoryTable({ ...baseProps, error: FETCH_ERROR_MESSAGE });
    const texts = textsOf(tree);
    expect(texts).not.toContain('발급된 토큰이 없습니다.');
    expect(texts).toContain('발급 내역을 불러오지 못했습니다.');
    expect(texts).toContain(FETCH_ERROR_MESSAGE);
    expect(handlersFor(tree, '다시 조회').length).toBeGreaterThan(0);
  });

  it('성공 + 0건은 기존 empty copy를 표시하고 retry를 노출하지 않는다', () => {
    const tree = InviteHistoryTable({ ...baseProps });
    expect(textsOf(tree)).toContain('발급된 토큰이 없습니다.');
    expect(handlersFor(tree, '다시 조회')).toHaveLength(0);
  });

  it('성공 + 결과 1건은 기존 내역 렌더링을 유지하고 retry를 노출하지 않는다', () => {
    const tree = InviteHistoryTable({ ...baseProps, invites: [invite('test-invite-aaa')] });
    const texts = textsOf(tree);
    expect(texts).toContain('test-invite-aaa');
    expect(texts).not.toContain('발급된 토큰이 없습니다.');
    expect(handlersFor(tree, '다시 조회')).toHaveLength(0);
  });

  it('error는 결과 유무보다 우선한다(실패를 성공으로 취급하지 않음)', () => {
    const tree = InviteHistoryTable({
      ...baseProps,
      error: FETCH_ERROR_MESSAGE,
      invites: [invite('test-invite-aaa')],
    });
    const texts = textsOf(tree);
    expect(texts).toContain('발급 내역을 불러오지 못했습니다.');
    expect(handlersFor(tree, '다시 조회').length).toBeGreaterThan(0);
  });

  it('retry 실행 시 onRetry를 호출한다', () => {
    const onRetry = vi.fn();
    const tree = InviteHistoryTable({ ...baseProps, error: FETCH_ERROR_MESSAGE, onRetry });
    const handlers = handlersFor(tree, '다시 조회');
    expect(handlers.length).toBeGreaterThan(0);
    handlers[0]();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
