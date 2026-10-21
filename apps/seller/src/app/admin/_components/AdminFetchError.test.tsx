import { readFileSync } from 'node:fs';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AdminFetchError } from './AdminFetchError';

// 후기·입점문의 화면은 '@/' alias를 써서 vitest에서 직접 import할 수 없다.
// 실패 화면 자체는 컴포넌트로, 화면 배선은 소스로 고정한다.

interface Node {
  children?: ReactNode;
  onClick?: unknown;
}

function isElement(node: ReactNode): node is ReactElement<Node> {
  return typeof node === 'object' && node !== null && 'props' in node;
}

function textsOf(node: ReactNode): string[] {
  const out: string[] = [];
  const visit = (current: ReactNode): void => {
    if (typeof current === 'string') out.push(current);
    else if (Array.isArray(current)) for (const child of current) visit(child);
    else if (isElement(current)) visit(current.props.children);
  };
  visit(node);
  return out;
}

function clickHandlers(node: ReactNode): Array<() => void> {
  const out: Array<() => void> = [];
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) for (const child of current) visit(child);
    else if (isElement(current)) {
      if (typeof current.props.onClick === 'function')
        out.push(current.props.onClick as () => void);
      visit(current.props.children);
    }
  };
  visit(node);
  return out;
}

describe('AdminFetchError', () => {
  it('제목·상세·다시 조회를 보여 주고 다시 조회가 onRetry를 부른다', () => {
    const onRetry = vi.fn();
    const tree = AdminFetchError({
      title: '불러오지 못했습니다.',
      detail: '조회 중 오류',
      onRetry,
    });
    const texts = textsOf(tree);
    expect(texts).toContain('불러오지 못했습니다.');
    expect(texts).toContain('조회 중 오류');
    expect(texts).toContain('다시 조회');
    const handlers = clickHandlers(tree);
    expect(handlers).toHaveLength(1);
    handlers[0]();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  ['reviews', '숨긴 후기를 불러오지 못했습니다.', '숨긴 후기가 없어요'],
  ['partner-inquiries', '입점 문의를 불러오지 못했습니다.', '입점 문의가 아직 없어요'],
])('%s 화면 조회 실패 배선', (dir, failTitle, emptyText) => {
  const source = readFileSync(new URL(`../${dir}/page.tsx`, import.meta.url), 'utf8');

  it('조회 실패를 빈 목록으로 바꾸지 않는다', () => {
    expect(source).not.toContain('() => setItems([])');
    expect(source).toContain('setLoadFailed(true)');
  });

  it('실패 화면과 다시 조회를 보여 주고, 빈 목록 문구는 성공 0건에만 남는다', () => {
    expect(source).toContain('<AdminFetchError');
    expect(source).toContain(failTitle);
    expect(source).toContain('onRetry={load}');
    // 분기 순서: 실패 → 로딩 → 빈 목록 → 결과
    const failAt = source.indexOf('loadFailed ?');
    const loadingAt = source.indexOf('items === null ?');
    // 주석에도 같은 문구가 있어 렌더 분기(마지막 등장)를 본다.
    const emptyAt = source.lastIndexOf(emptyText);
    expect(failAt).toBeGreaterThan(-1);
    expect(failAt).toBeLessThan(loadingAt);
    expect(loadingAt).toBeLessThan(emptyAt);
  });

  it('다시 조회는 실패 표시를 지우고 로딩부터 다시 시작한다', () => {
    expect(source).toContain('setItems(null);');
    expect(source).toContain('setLoadFailed(false);');
  });
});
