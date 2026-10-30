import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isLocalPreviewEnabled } from './local-preview';

describe('isLocalPreviewEnabled', () => {
  it('하네스·dev:local(next dev + GREENHUB_LOCAL_RUNTIME=true)에서만 연다', () => {
    expect(isLocalPreviewEnabled({ GREENHUB_LOCAL_RUNTIME: 'true', NODE_ENV: 'development' })).toBe(
      true,
    );
  });

  it('운영 빌드(NODE_ENV=production)에서는 로컬 표시가 있어도 열지 않는다', () => {
    expect(isLocalPreviewEnabled({ GREENHUB_LOCAL_RUNTIME: 'true', NODE_ENV: 'production' })).toBe(
      false,
    );
  });

  it('로컬 표시가 없으면 dev에서도 열지 않는다', () => {
    expect(isLocalPreviewEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isLocalPreviewEnabled({ GREENHUB_LOCAL_RUNTIME: '1', NODE_ENV: 'development' })).toBe(
      false,
    );
    expect(isLocalPreviewEnabled({})).toBe(false);
  });
});

describe('UI 교체 대조 화면', () => {
  const page = readFileSync(new URL('../app/dev/ui-compare/page.tsx', import.meta.url), 'utf8');

  it('그리기 전에 로컬 조건을 확인하고 아니면 404로 보낸다', () => {
    expect(page).toMatch(/if \(!isLocalPreviewEnabled\(\)\) notFound\(\);/);
    expect(page.indexOf('notFound()')).toBeLessThan(page.indexOf('<UiCompare'));
  });

  it('요청마다 조건을 다시 읽는다(빌드 때 한 번 그린 결과를 쓰지 않는다)', () => {
    expect(page).toContain("export const dynamic = 'force-dynamic';");
  });
});
