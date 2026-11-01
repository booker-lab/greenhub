import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AdminRowMenu, type AdminRowMenuItem } from '../../_components/adminList';
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

type AnyElement = ReactElement<{ children?: ReactNode; items?: AdminRowMenuItem[] }> & {
  type: unknown;
};

function isElement(node: ReactNode): node is AnyElement {
  return typeof node === 'object' && node !== null && 'props' in node;
}

/**
 * 요소 하나를 한 단계 펼친다(DOM 불필요). 함수 컴포넌트는 호출해 그린 결과를 보고,
 * 행 끝 ⋮ 메뉴(AdminRowMenu)는 드롭다운을 그리지 않는다(항목은 menuItemsOf가 본다).
 */
function expand(element: AnyElement): ReactNode {
  if (element.type === AdminRowMenu) return null;
  if (typeof element.type === 'function') {
    return (element.type as (props: AnyElement['props']) => ReactNode)(element.props);
  }
  return element.props.children;
}

/** 렌더 트리에 포함된 모든 텍스트 리프를 수집한다. */
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
    if (isElement(current)) visit(expand(current));
  };
  visit(node);
  return out;
}

/** ⋮ 메뉴 항목을 모두 수집한다. */
function menuItemsOf(node: ReactNode): AdminRowMenuItem[] {
  const out: AdminRowMenuItem[] = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    if (current.type === AdminRowMenu) out.push(...(current.props.items ?? []));
    visit(expand(current));
  };
  visit(node);
  return out;
}

const render = (users: User[]) => UsersTable({ users, processingId: null, onToggle: () => {} });

describe('Admin UsersTable 가입일·전화 표시 (T1)', () => {
  it('데스크톱 표는 이름·연락처·상태·가입일 칸을 갖고, 이메일은 이름 아래 보조 줄이다', () => {
    const texts = textsOf(render([user()]));
    for (const header of ['이름', '연락처', '상태', '가입일']) {
      expect(texts).toContain(header);
    }
    expect(texts).not.toContain('이메일');
    // 잘린 계정 id는 보여 주지 않는다.
    expect(texts.some((t) => t.includes('user-abc'))).toBe(false);
  });

  it('휴대폰 행과 데스크톱 표 모두 전화·KST 가입일을 표시한다', () => {
    const texts = textsOf(render([user()]));
    expect(texts.filter((t) => t === '010-1234-5678')).toHaveLength(2);
    // 휴대폰 행 1번 + 데스크톱 가입일 칸 1번 + 태블릿 보조 줄 1번
    expect(texts.filter((t) => t === '2026-09-01')).toHaveLength(3);
  });

  it('전화·가입일이 없으면 두 레이아웃 모두 자리표시자를 표시한다', () => {
    const texts = textsOf(render([user({ phone: undefined, createdAt: undefined })]));
    expect(texts.filter((t) => t === '연락처 미등록')).toHaveLength(2);
    expect(texts.filter((t) => t === '–')).toHaveLength(3);
  });

  it('기존 이름·이메일·상태 렌더와 ⋮ 정지 배선을 보존한다', () => {
    const onToggle = vi.fn();
    const active = user();
    const tree = UsersTable({ users: [active], processingId: null, onToggle });
    const texts = textsOf(tree);
    expect(texts).toContain('홍길동');
    expect(texts).toContain('buyer@example.com');
    expect(texts).toContain('정상');
    const items = menuItemsOf(tree);
    expect(items.map((item) => item.label)).toContain('정지…');
    items[0].onSelect();
    expect(onToggle).toHaveBeenCalledWith(active);
  });

  it('정지된 소비자는 정지 상태와 ⋮ 정지 풀기…를 보인다', () => {
    const tree = render([user({ suspended: true })]);
    expect(textsOf(tree)).toContain('정지');
    expect(menuItemsOf(tree).map((item) => item.label)).toContain('정지 풀기…');
  });

  it('처리 중인 행은 ⋮ 대신 처리 중 표시를 한다', () => {
    const tree = UsersTable({ users: [user()], processingId: 'user-abcdef12', onToggle: () => {} });
    expect(textsOf(tree)).toContain('처리 중…');
    expect(menuItemsOf(tree)).toHaveLength(0);
  });

  it('0건이면 기존 빈 목록 문구를 유지한다', () => {
    expect(textsOf(render([]))).toContain('등록된 소비자가 없습니다.');
  });
});
