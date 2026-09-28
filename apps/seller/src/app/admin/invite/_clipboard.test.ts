import { describe, expect, it, vi } from 'vitest';
import { browserClipboardDeps, copyText } from './_clipboard';

// 보안: 실제 토큰 원문이 아닌 구조 검증용 더미 식별자만 사용한다.
const TOKEN = 'test-invite-aaa';

describe('copyText', () => {
  it('클립보드 API가 성공하면 clipboard를 반환하고 폴백을 쓰지 않는다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const legacyCopy = vi.fn().mockReturnValue(true);
    await expect(copyText(TOKEN, { writeText, legacyCopy })).resolves.toBe('clipboard');
    expect(writeText).toHaveBeenCalledWith(TOKEN);
    expect(legacyCopy).not.toHaveBeenCalled();
  });

  it('클립보드 API가 거부되면(권한 거부) 레거시 폴백으로 복사한다', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const legacyCopy = vi.fn().mockReturnValue(true);
    await expect(copyText(TOKEN, { writeText, legacyCopy })).resolves.toBe('legacy');
    expect(legacyCopy).toHaveBeenCalledWith(TOKEN);
  });

  it('클립보드 API가 없으면(비보안 컨텍스트) 레거시 폴백으로 복사한다', async () => {
    const legacyCopy = vi.fn().mockReturnValue(true);
    await expect(copyText(TOKEN, { legacyCopy })).resolves.toBe('legacy');
    expect(legacyCopy).toHaveBeenCalledWith(TOKEN);
  });

  it('클립보드 거부 + 레거시 false면 failed를 반환한다', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const legacyCopy = vi.fn().mockReturnValue(false);
    await expect(copyText(TOKEN, { writeText, legacyCopy })).resolves.toBe('failed');
  });

  it('레거시 폴백이 예외를 던져도 밖으로 전파하지 않고 failed를 반환한다', async () => {
    const legacyCopy = vi.fn(() => {
      throw new Error('execCommand unsupported');
    });
    await expect(copyText(TOKEN, { legacyCopy })).resolves.toBe('failed');
  });

  it('사용 가능한 수단이 없으면 failed를 반환한다', async () => {
    await expect(copyText(TOKEN, {})).resolves.toBe('failed');
  });
});

describe('browserClipboardDeps', () => {
  it('DOM이 없는 환경에서는 레거시 폴백을 비워 둔다', () => {
    // vitest 기본 환경(node)에는 document가 없다.
    expect(typeof document).toBe('undefined');
    expect(browserClipboardDeps().legacyCopy).toBeUndefined();
  });
});
