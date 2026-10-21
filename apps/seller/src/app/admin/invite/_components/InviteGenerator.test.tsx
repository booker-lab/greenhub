import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { InviteGenerator } from './InviteGenerator';

type Props = ComponentProps<typeof InviteGenerator>;

const GENERATE_ERROR_MESSAGE = '초대 토큰 발급 중 오류 발생';

const baseProps: Props = {
  generating: false,
  lastToken: null,
  lastLink: null,
  copied: false,
  generateError: null,
  recipientEmail: '',
  recipientEmailError: null,
  onRecipientEmailChange: () => {},
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
    expect(texts).toContain('새 초대 링크 만들기');
    expect(texts).not.toContain('초대 링크 발급에 실패했습니다.');
    expect(texts).not.toContain('생성된 초대 링크');
  });

  it('토큰 유효 기간을 서버와 같은 72시간으로 안내한다', () => {
    const texts = textsOf(InviteGenerator({ ...baseProps }));
    expect(texts).toContain('72시간');
    expect(texts.some((t) => t.includes('7일'))).toBe(false);
  });

  it('생성 중에는 진행 copy를 표시한다', () => {
    const tree = InviteGenerator({ ...baseProps, generating: true });
    expect(textsOf(tree)).toContain('만드는 중…');
  });

  it('발급 실패는 성공과 구분되는 실패 UI로 알린다', () => {
    const tree = InviteGenerator({ ...baseProps, generateError: GENERATE_ERROR_MESSAGE });
    const texts = textsOf(tree);
    expect(texts).toContain('초대 링크 발급에 실패했습니다.');
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
    expect(texts).toContain('초대 링크 발급에 실패했습니다.');
    expect(texts).toContain('생성된 초대 링크');
    expect(texts).toContain('test-issued-aaa');
  });

  it('성공 시 lastToken 블록·복사 버튼·만료 표기를 유지한다', () => {
    const tree = InviteGenerator({
      ...baseProps,
      lastToken: { token: 'test-issued-aaa', expiresAt: '2026-12-31T00:00:00.000Z' },
    });
    const texts = textsOf(tree);
    expect(texts).toContain('생성된 초대 링크');
    expect(texts).toContain('test-issued-aaa');
    expect(texts).toContain('링크 복사');
    expect(texts.some((t) => t.includes('만료'))).toBe(true);
    expect(texts).not.toContain('초대 링크 발급에 실패했습니다.');
  });

  it('초대 링크가 있으면 토큰 대신 링크를 보여 준다', () => {
    const tree = InviteGenerator({
      ...baseProps,
      lastToken: { token: 'test-issued-aaa', expiresAt: '2026-12-31T00:00:00.000Z' },
      lastLink: 'https://seller.example.test/invite/test-issued-aaa',
    });
    const texts = textsOf(tree);
    expect(texts).toContain('https://seller.example.test/invite/test-issued-aaa');
    expect(texts).not.toContain('test-issued-aaa');
    // 만료는 KST 날짜+시각으로 보여 준다(2026-12-31T00:00Z = KST 09:00).
    expect(texts.some((t) => t.includes('2026. 12. 31. 09:00'))).toBe(true);
  });

  it('copy feedback 계약을 보존한다(링크 복사/복사됨!)', () => {
    const idleTree = InviteGenerator({
      ...baseProps,
      lastToken: { token: 'test-issued-aaa', expiresAt: '2026-12-31T00:00:00.000Z' },
      copied: false,
    });
    expect(textsOf(idleTree)).toContain('링크 복사');
    const copiedTree = InviteGenerator({
      ...baseProps,
      copied: true,
      lastToken: { token: 'test-issued-aaa', expiresAt: '2026-12-31T00:00:00.000Z' },
    });
    expect(textsOf(copiedTree)).toContain('복사됨!');
  });

  it('lastToken이 없으면 복사 버튼을 노출하지 않는다', () => {
    const tree = InviteGenerator({ ...baseProps });
    expect(handlersFor(tree, '링크 복사')).toHaveLength(0);
  });

  it('생성 버튼은 onGenerate에, 복사 버튼은 onCopy에 연결된다', () => {
    const onGenerate = vi.fn();
    const genTree = InviteGenerator({ ...baseProps, onGenerate });
    const genHandlers = handlersFor(genTree, '새 초대 링크 만들기');
    expect(genHandlers.length).toBeGreaterThan(0);
    genHandlers[0]();
    expect(onGenerate).toHaveBeenCalledTimes(1);

    const onCopy = vi.fn();
    const copyTree = InviteGenerator({
      ...baseProps,
      onCopy,
      lastToken: { token: 'test-issued-aaa', expiresAt: '2026-12-31T00:00:00.000Z' },
    });
    const copyHandlers = handlersFor(copyTree, '링크 복사');
    expect(copyHandlers.length).toBeGreaterThan(0);
    copyHandlers[0]();
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});

interface InputLike {
  label?: unknown;
  required?: unknown;
  error?: unknown;
  value?: unknown;
  onChange?: unknown;
}

/** 받는 사람 이메일 입력란(label로 식별)의 props를 찾는다. */
function recipientInputProps(tree: ReactNode): InputLike | null {
  let found: InputLike | null = null;
  const visit = (current: ReactNode): void => {
    if (found) return;
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    const props = current.props as InputLike & Clickable;
    if (props.label === '받는 사람 이메일') {
      found = props;
      return;
    }
    visit(props.children);
  };
  visit(tree);
  return found;
}

/** 주어진 라벨을 포함한 버튼의 disabled 값을 찾는다. */
function disabledFor(tree: ReactNode, label: string): unknown {
  let found: { disabled?: unknown } | null = null;
  const visit = (current: ReactNode): void => {
    if (found) return;
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    if (typeof current.props.onClick === 'function' && textsOf(current).includes(label)) {
      found = current.props as { disabled?: unknown };
      return;
    }
    visit(current.props.children);
  };
  visit(tree);
  return (found as { disabled?: unknown } | null)?.disabled;
}

describe('InviteGenerator 받는 사람 이메일', () => {
  it('받는 사람 이메일을 필수 입력란으로 표시하고 (선택) 문구를 쓰지 않는다', () => {
    const tree = InviteGenerator({ ...baseProps });
    const input = recipientInputProps(tree);
    expect(input).not.toBeNull();
    expect(input?.required).toBe(true);
    expect(textsOf(tree).some((t) => t.includes('(선택)'))).toBe(false);
  });

  it.each([
    '',
    '   ',
  ])('받는 사람 이메일이 비어 있으면(%p) 생성 버튼을 막는다', (recipientEmail) => {
    const tree = InviteGenerator({ ...baseProps, recipientEmail });
    expect(disabledFor(tree, '새 초대 링크 만들기')).toBe(true);
  });

  it('받는 사람 이메일을 입력하면 생성 버튼을 누를 수 있고, 생성 중에는 막는다', () => {
    const filled = { ...baseProps, recipientEmail: 'seller@example.com' };
    expect(disabledFor(InviteGenerator(filled), '새 초대 링크 만들기')).toBe(false);
    expect(disabledFor(InviteGenerator({ ...filled, generating: true }), '만드는 중…')).toBe(true);
  });

  it('입력란에 현재 값과 오류를 전달한다', () => {
    const tree = InviteGenerator({
      ...baseProps,
      recipientEmail: 'seller@example.com',
      recipientEmailError: '이메일 형식이 올바르지 않아요.',
    });
    const input = recipientInputProps(tree);
    expect(input).not.toBeNull();
    expect(input?.value).toBe('seller@example.com');
    expect(input?.error).toBe('이메일 형식이 올바르지 않아요.');
  });

  it('입력 변경은 onRecipientEmailChange로 값을 넘긴다', () => {
    const onRecipientEmailChange = vi.fn();
    const input = recipientInputProps(InviteGenerator({ ...baseProps, onRecipientEmailChange }));
    (input?.onChange as (event: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: 'a@b.co' },
    });
    expect(onRecipientEmailChange).toHaveBeenCalledWith('a@b.co');
  });

  it('받는 사람을 지정해 발급한 토큰은 받는 사람을 함께 보여 준다', () => {
    const tree = InviteGenerator({
      ...baseProps,
      lastToken: {
        token: 'test-issued-aaa',
        expiresAt: '2026-12-31T00:00:00.000Z',
        recipientEmail: 'seller@example.com',
      },
    });
    expect(textsOf(tree)).toContain('seller@example.com');
  });

  it('받는 사람 없이 발급한 토큰은 받는 사람 줄을 그리지 않는다', () => {
    const tree = InviteGenerator({
      ...baseProps,
      lastToken: {
        token: 'test-issued-aaa',
        expiresAt: '2026-12-31T00:00:00.000Z',
        recipientEmail: null,
      },
    });
    expect(textsOf(tree).some((t) => t.includes('받는 사람:'))).toBe(false);
  });
});
