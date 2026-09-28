import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// useTokenCopy는 React 훅이라 DOM 없는 vitest(node)에서 직접 실행하지 않는다.
// 클립보드 성공/실패 분기 자체는 _clipboard.test.ts(copyText)가 소유하고,
// 여기서는 결과 → UI 피드백 배선만 고정한다.
const source = readFileSync(new URL('./_useTokenCopy.ts', import.meta.url), 'utf8');

describe('useTokenCopy 배선', () => {
  it('복사는 공용 copyText 헬퍼를 경유한다(클립보드 직접 호출 금지)', () => {
    expect(source).toContain("from './_clipboard'");
    expect(source).toContain('await copyText(token)');
    expect(source).not.toContain('navigator.clipboard');
  });

  it('실패 시 빨간 알림을 띄우고 직접 복사 창용 토큰을 기록한다', () => {
    const failed = source.slice(source.indexOf("if (result === 'failed')"));
    expect(failed).toContain("color: 'red'");
    expect(failed).toContain('setManualToken(token)');
    expect(failed).toContain('setCopiedToken(null)');
  });

  it('성공 시 토큰별 복사됨 피드백을 2초 뒤 해제하고, 언마운트 시 타이머를 정리한다', () => {
    expect(source).toContain('setCopiedToken(token)');
    expect(source).toContain('const COPIED_FEEDBACK_MS = 2000');
    expect(source).toContain('setTimeout(() => setCopiedToken(null), COPIED_FEEDBACK_MS)');
    expect(source).toContain('if (timerRef.current) clearTimeout(timerRef.current)');
  });
});
