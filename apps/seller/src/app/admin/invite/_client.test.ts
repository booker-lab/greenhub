import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// AdminInviteClient는 '@/hooks/useAdmin' alias를 사용하므로 vitest에서 직접 import하지 않는다.
// (seller vitest에는 tsconfig paths 매핑이 없어 '@/hooks/useAdmin' 해석이 실패한다.)
// 따라서 focused test는 _client.tsx 배선(wiring)을 고정하고,
// 실제 상태 분기는 _lib 순수 함수와 각 컴포넌트 focused test가 소유한다.

const source = readFileSync(new URL('./_client.tsx', import.meta.url), 'utf8');
const hookSource = readFileSync(
  new URL('../../../hooks/useAdmin.ts', import.meta.url),
  'utf8',
);

// useAdminInvite 블록만 추출 — shared hook 회귀 검증은 이 블록 범위로 한정한다.
function inviteBlock(): string {
  const start = hookSource.indexOf('export function useAdminInvite()');
  if (start === -1) throw new Error('useAdminInvite not found');
  const nextExport = hookSource.indexOf('export function', start + 1);
  const nextEnd = hookSource.indexOf('// ──', start + 1);
  const candidates = [nextExport, nextEnd].filter((i) => i !== -1);
  return hookSource.slice(start, candidates.length > 0 ? Math.min(...candidates) : undefined);
}

describe('AdminInviteClient recovery wiring', () => {
  it('useAdminInvite에서 error/reload를 구조분해한다', () => {
    expect(source).toContain('useAdminInvite()');
    expect(source).toMatch(/const\s*\{[\s\S]*?\}\s*=\s*\n?\s*useAdminInvite\(\)/);
    for (const key of [
      'invites',
      'loading',
      'error',
      'reload',
      'generating',
      'generateError',
      'generate',
    ]) {
      expect(source).toContain(key);
    }
  });

  it('history read error를 명시하고 reload로 retry한다', () => {
    // _client가 error를 table에 전달한다.
    expect(source).toContain('error={error}');
    // retry가 reload 경로를 사용한다.
    expect(source).toContain('onRetry={reload}');
    // 실패를 invites=[] 성공으로 취급하지 않음 — table 분기가 소유한다.
    expect(source).not.toContain('발급된 토큰이 없습니다.');
  });

  it('generate 실패를 사용자에게 알리고 성공한 경우에만 lastToken을 갱신한다', () => {
    // 발급 실패 UI에 hook의 generateError를 전달한다.
    expect(source).toContain('generateError={generateError}');
    // 성공(result non-null)한 경우에만 lastToken 갱신 — 실패가 이전 성공 token을 덮어쓰지 않음.
    expect(source).toContain('if (result) setLastToken(result)');
    expect(source).not.toContain('setLastToken(null)');
  });

  it('기존 token copy 계약을 보존한다', () => {
    expect(source).toContain('navigator.clipboard.writeText(lastToken.token)');
    expect(source).toContain('setCopied(true)');
    expect(source).toContain('setTimeout(() => setCopied(false), 2000)');
    expect(source).toContain('onCopy={handleCopy}');
    expect(source).toContain('if (!lastToken) return;');
  });

  it('기존 generate/copy 컴포넌트 배선을 유지한다', () => {
    expect(source).toContain('<InviteGenerator');
    expect(source).toContain('generating={generating}');
    expect(source).toContain('lastToken={lastToken}');
    expect(source).toContain('copied={copied}');
    expect(source).toContain('onGenerate={handleGenerate}');
    expect(source).toContain('<InviteHistoryTable');
    expect(source).toContain('invites={invites}');
    expect(source).toContain('loading={loading}');
  });
});

describe('useAdminInvite hook recovery wiring', () => {
  it('invite history error를 hook 밖으로 노출한다', () => {
    const block = inviteBlock();
    expect(block).toContain('error,');
    expect(block).toContain('return { invites, loading, error, generating, generateError, generate, reload }');
  });

  it('generate 실패를 silent null로 끝내지 않고 generateError에 기록한다', () => {
    const block = inviteBlock();
    expect(block).toContain('setGenerateError(null)');
    expect(block).toContain("setGenerateError('초대 토큰 발급 중 오류 발생')");
    expect(block).toContain('return null');
  });

  it('성공 경로에서만 reload 후 데이터를 반환한다', () => {
    const block = inviteBlock();
    const tryIndex = block.indexOf('await reload()');
    const catchIndex = block.indexOf('} catch {');
    expect(tryIndex).toBeGreaterThan(-1);
    expect(catchIndex).toBeGreaterThan(tryIndex);
  });
});
