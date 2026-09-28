import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { EMPTY_FIELD } from '../_lib';
import { UsersTable } from './UsersTable';

type Props = ComponentProps<typeof UsersTable>;
type User = Props['users'][number];

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user-abcdef12',
    email: 'buyer@example.com',
    name: '홍길동',
    phone: '010-1234-5678',
    suspended: false,
    // UTC 15:30 = KST 다음 날 00:30 — KST 보정 여부가 드러나는 시각
    createdAt: '2026-08-31T15:30:00.000Z',
    ...overrides,
  };
}

function isElement(node: ReactNode): node is ReactElement<{ children?: ReactNode }> {
  return typeof node === 'object' && node !== null && 'props' in node;
}

/** 렌더 트리(DOM 불필요)에 포함된 모든 텍스트 리프를 수집한다. */
function textsOf(node: ReactNode): string[] {
  const out: string[] = [];
  const visit = (current: ReactNode): void => {
    if (typeof current === 'string') {
      out.push(current);
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

const render = (users: User[]) => UsersTable({ users, processingId: null, onToggle: () => {} });

describe('Admin UsersTable 가입일·전화 표시 (T1)', () => {
  it('데스크톱 표는 기존 4칸을 유지한다(480px 셸에서 상태·정지 버튼 잘림 방지)', () => {
    const texts = textsOf(render([user()]));
    for (const header of ['이름', '이메일', '상태']) {
      expect(texts).toContain(header);
    }
    // 전화·가입일은 별도 칸이 아니라 이메일 칸의 보조 줄이다.
    expect(texts).not.toContain('전화');
    expect(texts).not.toContain('가입일');
  });

  it('모바일 카드와 데스크톱 표 모두 전화·KST 가입일을 표시한다', () => {
    const texts = textsOf(render([user()]));
    expect(texts.filter((t) => t === '010-1234-5678')).toHaveLength(2);
    expect(texts.filter((t) => t === '2026-09-01')).toHaveLength(2);
    expect(texts.filter((t) => t === '전화 ')).toHaveLength(2);
    expect(texts.filter((t) => t === '가입일 ')).toHaveLength(2);
  });

  it('전화·가입일이 없으면 두 레이아웃 모두 자리표시자를 표시한다', () => {
    const texts = textsOf(render([user({ phone: undefined, createdAt: undefined })]));
    expect(texts.filter((t) => t === EMPTY_FIELD)).toHaveLength(4);
  });

  it('기존 이름·이메일·상태·정지 버튼 렌더를 보존한다', () => {
    const texts = textsOf(render([user()]));
    expect(texts).toContain('홍길동');
    expect(texts).toContain('buyer@example.com');
    expect(texts).toContain('정상');
    expect(texts).toContain('정지');
  });

  it('0건이면 기존 빈 목록 문구를 유지한다', () => {
    expect(textsOf(render([]))).toContain('등록된 소비자가 없습니다.');
  });
});
