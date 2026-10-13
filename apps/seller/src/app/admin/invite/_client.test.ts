import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// AdminInviteClient는 '@/hooks/useAdmin' alias를 사용하므로 vitest에서 직접 import하지 않는다.
// (seller vitest에는 tsconfig paths 매핑이 없어 '@/hooks/useAdmin' 해석이 실패한다.)
// 따라서 focused test는 _client.tsx 배선(wiring)을 고정하고,
// 실제 상태 분기는 _lib 순수 함수와 각 컴포넌트 focused test가 소유한다.

const source = readFileSync(new URL('./_client.tsx', import.meta.url), 'utf8');
const hookSource = readFileSync(new URL('../../../hooks/useAdmin.ts', import.meta.url), 'utf8');

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

  it('발급 직후 토큰과 행별 복사가 공용 복사 훅(useTokenCopy)을 공유한다', () => {
    expect(source).toContain('useTokenCopy()');
    // 클립보드 직접 호출 금지 — 폴백 포함 복사 로직은 _clipboard/_useTokenCopy가 소유한다.
    expect(source).not.toContain('navigator.clipboard');
    expect(source).toContain('void copy(lastToken.token)');
    expect(source).toContain('onCopy={handleCopy}');
    expect(source).toContain('if (!lastToken) return;');
    // lastToken 복사됨 피드백은 토큰별 상태에서 파생한다.
    expect(source).toContain('copiedToken === lastToken.token');
    // 발급 내역 행별 복사 배선.
    expect(source).toContain('copiedToken={copiedToken}');
    expect(source).toContain('onCopy={(token) => void copy(token)}');
  });

  it('복사 실패 시 직접 복사 창(ManualCopyModal)을 배선한다', () => {
    expect(source).toContain('<ManualCopyModal token={manualToken} onClose={closeManual} />');
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

describe('받는 사람 이메일 배선', () => {
  it('형식이 틀리면 발급 요청 없이 입력 오류를 보여 주고, 맞으면 정리한 값을 generate에 넘긴다', () => {
    const parseIndex = source.indexOf('parseInviteRecipientEmail(recipientEmail)');
    const errorIndex = source.indexOf('setRecipientEmailError(recipient.error)');
    const generateIndex = source.indexOf('await generate(recipient.value ?? undefined)');
    expect(parseIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeGreaterThan(parseIndex);
    expect(generateIndex).toBeGreaterThan(errorIndex);
    expect(source).toContain('recipientEmail={recipientEmail}');
    expect(source).toContain('recipientEmailError={recipientEmailError}');
    expect(source).toContain('onRecipientEmailChange={handleRecipientEmailChange}');
  });

  it('발급에 성공한 뒤에만 입력을 비운다', () => {
    expect(source).toContain("if (result) setRecipientEmail('')");
  });

  it('hook은 받는 사람이 있을 때만 발급 본문에 담는다', () => {
    const block = inviteBlock();
    expect(block).toContain('generate = async (recipientEmail?: string)');
    expect(block).toContain(
      '...(recipientEmail ? { body: JSON.stringify({ recipientEmail }) } : {})',
    );
  });
});

describe('useAdminInvite hook recovery wiring', () => {
  it('invite history error를 hook 밖으로 노출한다', () => {
    const block = inviteBlock();
    expect(block).toContain('error,');
    expect(block).toContain(
      'return { invites, loading, error, generating, generateError, generate, revoke, reload }',
    );
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

describe('초대 취소 화면 배선', () => {
  it('행 버튼은 확인 창만 열고, 확인한 뒤에만 revoke를 호출한다', () => {
    expect(source).toContain('onRevoke={setPendingRevoke}');
    expect(source).toContain('<ConfirmModal');
    expect(source).toContain('opened={pendingRevoke !== null}');
    expect(source).toContain('onConfirm={runRevoke}');
    expect(source).toContain('await revoke(pendingRevoke)');
    expect(source).not.toContain('onRevoke={revoke}');
  });

  it('처리 중에는 확인 창을 닫지 않고 행 버튼에 처리 중 토큰을 전달한다', () => {
    expect(source).toContain('loading={revokingToken !== null}');
    expect(source).toContain('if (revokingToken === null) setPendingRevoke(null)');
    expect(source).toContain('revokingToken={revokingToken}');
  });

  it('결과 안내는 _lib describeInviteRevokeOutcome이 소유하고 필요할 때 다시 조회한다', () => {
    expect(source).toContain('describeInviteRevokeOutcome(outcome)');
    expect(source).toContain('if (notice.needsReload) void reload()');
  });
});

describe('useAdminInvite revoke', () => {
  it('취소 엔드포인트를 토큰 인코딩 후 인증 헤더가 붙는 apiFetch로 POST한다', () => {
    const block = inviteBlock();
    expect(block).toMatch(
      /apiFetch\(`\/admin\/invite\/\$\{encodeURIComponent\(inviteToken\)\}\/revoke`/,
    );
    expect(block).toContain("method: 'POST'");
  });

  it('토큰이 없으면 요청하지 않고 거부로 돌려준다', () => {
    expect(inviteBlock()).toContain(
      'if (!token) return { ...missingTokenOutcome(), reason: null }',
    );
  });

  it('거부 응답의 reason을 보존하고 5xx·네트워크 오류는 불확정으로 분류한다', () => {
    const block = inviteBlock();
    expect(block).toContain('const outcome = classifyAdminCommandError(err)');
    expect(block).toContain('classifyAdminCommandError({ status: res.status, message })');
    expect(block).toContain("if (outcome.kind === 'unknown') return outcome");
    expect(block).toContain("reason: typeof body?.reason === 'string' ? body.reason : null");
  });

  it('성공하면 목록을 다시 불러와 reconciliation 결과를 돌려준다', () => {
    expect(inviteBlock()).toContain('return resolveConfirmedOutcome(await reload())');
  });
});
