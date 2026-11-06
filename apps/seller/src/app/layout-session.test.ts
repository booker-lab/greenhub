import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 루트 layout의 첫 세션 계약(#698). proxy가 확인한 세션을 요청 헤더로만 받고, layout에서
// auth()를 다시 부르지 않는다(proxy가 회전한 refresh token을 layout이 재사용하지 않게).
// 화면 모드(#809)의 head 스크립트·suppressHydrationWarning·요청마다 렌더링은 그대로 둔다.
const source = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('판매자 루트 layout 첫 세션', () => {
  it('auth()를 부르지 않고 proxy가 넘긴 헤더만 읽는다', () => {
    expect(code).not.toMatch(/from '@\/auth'/);
    expect(code).not.toMatch(/\bauth\(/);
    expect(code).not.toMatch(/getServerSession|getSession\(/);
    expect(code).toContain('decodeInitialSession((await headers()).get(INITIAL_SESSION_HEADER))');
    expect(code).toContain('<Providers session={initialSession}>');
  });

  it('화면 모드 첫 페인트 계약(#809)을 그대로 둔다', () => {
    expect(code).toContain('await connection();');
    expect(code).toContain('<html lang="ko" suppressHydrationWarning>');
    expect(code).toContain('<script dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_SCRIPT }} />');
  });
});
