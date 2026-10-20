import { describe, expect, it } from 'vitest';
import { normalizeSuspendReason, SUSPEND_REASON_MAX_LENGTH } from './SuspendReasonMessage';

describe('normalizeSuspendReason', () => {
  it('빈 사유와 공백만 있는 사유는 보내지 않는다', () => {
    expect(normalizeSuspendReason('')).toBeUndefined();
    expect(normalizeSuspendReason('   ')).toBeUndefined();
  });

  it('앞뒤 공백을 지우고 API 한도(200자)로 자른다', () => {
    expect(normalizeSuspendReason('  결제 분쟁 확인  ')).toBe('결제 분쟁 확인');
    expect(normalizeSuspendReason('가'.repeat(250))).toHaveLength(SUSPEND_REASON_MAX_LENGTH);
  });
});
