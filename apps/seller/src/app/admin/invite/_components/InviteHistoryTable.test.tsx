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
  copiedToken: null,
  onCopy: () => {},
  revokingToken: null,
  onRevoke: () => {},
};

// 보안: 실제 토큰 원문이 아닌 구조 검증용 더미 식별자만 사용한다.
function invite(token: string): Props['invites'][number] {
  return {
    token,
    createdBy: 'admin-test',
    usedAt: null,
    usedBy: null,
    // 실행 시각과 무관하게 유효 상태를 유지하도록 먼 미래 만료일을 쓴다.
    expiresAt: '2999-12-31T00:00:00.000Z',
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

interface CopyButtonProps {
  token: string;
  copied: boolean;
  onCopy: (token: string) => void;
}

/** 행별 복사 버튼(CopyTokenButton) 요소를 수집한다 — token·onCopy prop으로 식별. */
function copyButtonsOf(tree: ReactNode): Array<ReactElement<CopyButtonProps>> {
  const out: Array<ReactElement<CopyButtonProps>> = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    const props = current.props as Partial<CopyButtonProps> & Clickable;
    if (typeof props.token === 'string' && typeof props.onCopy === 'function') {
      out.push(current as unknown as ReactElement<CopyButtonProps>);
    }
    visit(props.children);
  };
  visit(tree);
  return out;
}

/** 복사 버튼 컴포넌트를 한 단계 전개(DOM 없이 함수 호출)해 실제 Button 트리를 얻는다. */
function expand(el: ReactElement<CopyButtonProps>): ReactNode {
  return (el.type as (p: CopyButtonProps) => ReactNode)(el.props);
}

describe('InviteHistoryTable 받는 사람 표시', () => {
  it('받는 사람을 지정한 초대는 모바일 카드와 데스크톱 행 모두에 이메일을 보여 준다', () => {
    const tree = InviteHistoryTable({
      ...baseProps,
      invites: [{ ...invite('test-invite-aaa'), recipientEmail: 'seller@example.com' }],
    });
    expect(textsOf(tree).filter((t) => t === 'seller@example.com')).toHaveLength(2);
  });

  it('받는 사람이 없거나 필드가 없는 기존 초대는 받는 사람 줄을 그리지 않는다', () => {
    const tree = InviteHistoryTable({
      ...baseProps,
      invites: [{ ...invite('test-invite-aaa'), recipientEmail: null }, invite('test-invite-bbb')],
    });
    expect(textsOf(tree).some((t) => t.includes('받는 사람'))).toBe(false);
  });
});

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

describe('InviteHistoryTable 행별 토큰 복사', () => {
  it('결과 행마다 모바일 카드·데스크톱 표 양쪽에 복사 버튼을 노출한다', () => {
    const tree = InviteHistoryTable({
      ...baseProps,
      invites: [invite('test-invite-aaa'), invite('test-invite-bbb')],
    });
    const buttons = copyButtonsOf(tree);
    // 2행 × 2레이아웃(hiddenFrom/visibleFrom sm)
    expect(buttons).toHaveLength(4);
    expect(buttons.map((b) => b.props.token).sort()).toEqual([
      'test-invite-aaa',
      'test-invite-aaa',
      'test-invite-bbb',
      'test-invite-bbb',
    ]);
  });

  it('복사 버튼 클릭은 해당 행의 토큰으로 onCopy를 호출한다', () => {
    const onCopy = vi.fn();
    const tree = InviteHistoryTable({
      ...baseProps,
      onCopy,
      invites: [invite('test-invite-aaa'), invite('test-invite-bbb')],
    });
    for (const button of copyButtonsOf(tree)) {
      const handlers = handlersFor(expand(button), '복사');
      expect(handlers).toHaveLength(1);
      handlers[0]();
    }
    expect(onCopy.mock.calls.map(([token]) => token).sort()).toEqual([
      'test-invite-aaa',
      'test-invite-aaa',
      'test-invite-bbb',
      'test-invite-bbb',
    ]);
  });

  it('사용된 토큰에도 복사 버튼을 노출한다(모든 상태 노출)', () => {
    const used = {
      ...invite('test-invite-used'),
      usedAt: '2026-09-02T00:00:00.000Z',
      usedBy: 'seller-test',
    };
    const tree = InviteHistoryTable({ ...baseProps, invites: [used] });
    expect(copyButtonsOf(tree)).toHaveLength(2);
  });

  it('copiedToken과 일치하는 행만 복사됨! 피드백을 표시한다', () => {
    const tree = InviteHistoryTable({
      ...baseProps,
      copiedToken: 'test-invite-bbb',
      invites: [invite('test-invite-aaa'), invite('test-invite-bbb')],
    });
    for (const button of copyButtonsOf(tree)) {
      const texts = textsOf(expand(button));
      if (button.props.token === 'test-invite-bbb') {
        expect(texts).toContain('복사됨!');
      } else {
        expect(texts).toContain('복사');
        expect(texts).not.toContain('복사됨!');
      }
    }
  });

  it('loading·조회 실패·빈 결과에서는 행 복사 버튼이 없다', () => {
    expect(copyButtonsOf(InviteHistoryTable({ ...baseProps, loading: true }))).toHaveLength(0);
    expect(
      copyButtonsOf(InviteHistoryTable({ ...baseProps, error: FETCH_ERROR_MESSAGE })),
    ).toHaveLength(0);
    expect(copyButtonsOf(InviteHistoryTable({ ...baseProps }))).toHaveLength(0);
  });
});

interface RevokeButtonProps {
  token: string;
  revokingToken: string | null;
  onRevoke: (token: string) => void;
}

interface RenderedRevokeButtonProps {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  'aria-label': string;
  children?: ReactNode;
}

/** 행별 취소 버튼(RevokeInviteButton) 요소를 수집한다 — token·onRevoke prop으로 식별. */
function revokeButtonsOf(tree: ReactNode): Array<ReactElement<RevokeButtonProps>> {
  const out: Array<ReactElement<RevokeButtonProps>> = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    const props = current.props as Partial<RevokeButtonProps> & Clickable;
    if (typeof props.token === 'string' && typeof props.onRevoke === 'function') {
      out.push(current as unknown as ReactElement<RevokeButtonProps>);
    }
    visit(props.children);
  };
  visit(tree);
  return out;
}

/** 취소 버튼 컴포넌트를 한 단계 전개해 실제 Button 요소를 얻는다. */
function expandRevoke(
  el: ReactElement<RevokeButtonProps>,
): ReactElement<RenderedRevokeButtonProps> {
  return (el.type as (p: RevokeButtonProps) => ReactElement<RenderedRevokeButtonProps>)(el.props);
}

describe('InviteHistoryTable 초대 취소', () => {
  const revoked = {
    ...invite('test-invite-revoked'),
    revokedAt: '2026-09-02T00:00:00.000Z',
    revokedBy: 'admin-test',
  };
  const used = {
    ...invite('test-invite-used'),
    usedAt: '2026-09-02T00:00:00.000Z',
    usedBy: 'seller-test',
  };
  const expired = { ...invite('test-invite-expired'), expiresAt: '2020-01-01T00:00:00.000Z' };

  it('취소된 토큰은 유효 대신 취소됨으로 표시한다', () => {
    const texts = textsOf(InviteHistoryTable({ ...baseProps, invites: [revoked] }));
    expect(texts).toContain('취소됨');
    expect(texts).not.toContain('유효');
  });

  it('취소 버튼은 유효 행에만 모바일·데스크톱 양쪽에 노출한다', () => {
    const tree = InviteHistoryTable({
      ...baseProps,
      invites: [invite('test-invite-aaa'), revoked, used, expired],
    });
    expect(revokeButtonsOf(tree).map((b) => b.props.token)).toEqual([
      'test-invite-aaa',
      'test-invite-aaa',
    ]);
  });

  it('취소 버튼은 토큰을 담은 접근 가능한 이름을 갖고 해당 토큰으로 onRevoke를 호출한다', () => {
    const onRevoke = vi.fn();
    const tree = InviteHistoryTable({
      ...baseProps,
      onRevoke,
      invites: [invite('test-invite-aaa')],
    });
    for (const el of revokeButtonsOf(tree)) {
      const button = expandRevoke(el);
      expect(button.props['aria-label']).toBe('토큰 test-invite-aaa 초대 취소');
      expect(textsOf(button)).toContain('취소');
      button.props.onClick();
    }
    expect(onRevoke.mock.calls).toEqual([['test-invite-aaa'], ['test-invite-aaa']]);
  });

  it('취소 처리 중에는 모든 취소 버튼을 잠그고 처리 중인 행만 로딩으로 표시한다', () => {
    const tree = InviteHistoryTable({
      ...baseProps,
      revokingToken: 'test-invite-aaa',
      invites: [invite('test-invite-aaa'), invite('test-invite-bbb')],
    });
    const buttons = revokeButtonsOf(tree);
    expect(buttons).toHaveLength(4);
    for (const el of buttons) {
      const button = expandRevoke(el);
      expect(button.props.disabled).toBe(true);
      expect(button.props.loading).toBe(el.props.token === 'test-invite-aaa');
    }
  });

  it('취소된 토큰에도 복사 버튼은 유지한다', () => {
    expect(copyButtonsOf(InviteHistoryTable({ ...baseProps, invites: [revoked] }))).toHaveLength(2);
  });
});
