import { describe, expect, it } from 'vitest';
import {
  buildDashboardSummaryPath,
  DASHBOARD_SUMMARY_AUTH_ERROR,
  DASHBOARD_SUMMARY_INVALID_RESPONSE_ERROR,
  formatDashboardSummaryAmount,
  isDashboardSummaryBackgroundRefresh,
  isDashboardSummaryStale,
  isValidDashboardSummaryPayload,
  nextDashboardSummaryRetryKey,
  parseDashboardSummaryPayload,
  resolveDashboardSummaryAfterFailure,
  resolveDashboardSummaryAmountText,
  resolveDashboardSummaryAuthState,
  resolveDashboardSummaryView,
  shouldIgnoreDashboardSummaryResponse,
  shouldInvalidateDashboardSummaryScope,
  type DashboardSummaryData,
} from './useDashboardSummary.recovery';

function validSummary(overrides: Partial<DashboardSummaryData> = {}): DashboardSummaryData {
  return {
    date: '2026-09-10',
    count: 2,
    totalAmount: 30000,
    totalPlatformFee: 3000,
    totalNetAmount: 27000,
    byStatus: { pending: 1, confirmed: 1, paid: 0, cancelled: 0 },
    ...overrides,
  };
}

describe('Dashboard settlement summary — no auth scope does not hang', () => {
  it('세션 transient은 recoverable loading으로 유지한다', () => {
    expect(resolveDashboardSummaryAuthState('loading', null, null)).toBe('loading');
    expect(resolveDashboardSummaryAuthState('loading', 'store-1', 'token-1')).toBe('loading');
  });

  it('확정된 prerequisite 부재는 missing으로 닫고 무한 loading에 남기지 않는다', () => {
    expect(resolveDashboardSummaryAuthState('unauthenticated', null, null)).toBe('missing');
    expect(resolveDashboardSummaryAuthState('authenticated', null, 'token-1')).toBe('missing');
    expect(resolveDashboardSummaryAuthState('authenticated', 'store-1', null)).toBe('missing');
    expect(resolveDashboardSummaryAuthState('authenticated', 'store-1', '')).toBe('missing');
    expect(resolveDashboardSummaryAuthState('unauthenticated', null, null)).not.toBe('loading');
  });

  it('인증된 store+token 조합만 network fetch 가능하다', () => {
    expect(resolveDashboardSummaryAuthState('authenticated', 'store-1', 'token-1')).toBe('ready');
  });

  it('인증 오류는 빈 결과로 확정하지 않고 명시적 메시지로 닫는다', () => {
    expect(DASHBOARD_SUMMARY_AUTH_ERROR).toBe('셀러 스토어 인증 정보를 확인할 수 없습니다.');
    expect(
      resolveDashboardSummaryView({ hasLoaded: false, loading: false, error: DASHBOARD_SUMMARY_AUTH_ERROR }),
    ).toBe('READ_FAILED');
  });
});

describe('Dashboard settlement summary — successful 0원 summary', () => {
  it('0원은 유효한 성공 값으로 파싱된다', () => {
    const payload = validSummary({
      count: 0,
      totalAmount: 0,
      totalPlatformFee: 0,
      totalNetAmount: 0,
      byStatus: { pending: 0, confirmed: 0, paid: 0, cancelled: 0 },
    });
    expect(isValidDashboardSummaryPayload(payload)).toBe(true);
    expect(parseDashboardSummaryPayload(payload).totalNetAmount).toBe(0);
  });

  it('0원 성공은 READY이며 "0원"으로 표시한다', () => {
    const summary = validSummary({ totalNetAmount: 0, count: 0 });
    const view = resolveDashboardSummaryView({ hasLoaded: true, loading: false, error: null });
    expect(view).toBe('READY');
    expect(resolveDashboardSummaryAmountText({ summary, view })).toBe('0원');
    expect(formatDashboardSummaryAmount(0)).toBe('0원');
  });
});

describe('Dashboard settlement summary — malformed response failure', () => {
  it('null·배열·빈 객체를 0원 summary로 승격하지 않는다', () => {
    expect(isValidDashboardSummaryPayload(null)).toBe(false);
    expect(isValidDashboardSummaryPayload([])).toBe(false);
    expect(isValidDashboardSummaryPayload({})).toBe(false);
    expect(() => parseDashboardSummaryPayload(null)).toThrow(
      DASHBOARD_SUMMARY_INVALID_RESPONSE_ERROR,
    );
    expect(() => parseDashboardSummaryPayload([])).toThrow(
      DASHBOARD_SUMMARY_INVALID_RESPONSE_ERROR,
    );
  });

  it('부분 필드·문자열 금액·NaN을 거부한다', () => {
    const missingFee = validSummary();
    // @ts-expect-error intentional malformed fixture
    delete missingFee.totalPlatformFee;
    expect(isValidDashboardSummaryPayload(missingFee)).toBe(false);

    expect(
      isValidDashboardSummaryPayload(validSummary({ totalNetAmount: '27000' as never })),
    ).toBe(false);
    expect(isValidDashboardSummaryPayload(validSummary({ totalNetAmount: NaN }))).toBe(false);
    expect(
      isValidDashboardSummaryPayload(validSummary({ totalNetAmount: Number.POSITIVE_INFINITY })),
    ).toBe(false);
    expect(() =>
      parseDashboardSummaryPayload(validSummary({ totalNetAmount: '27000' as never })),
    ).toThrow(DASHBOARD_SUMMARY_INVALID_RESPONSE_ERROR);
  });

  it('byStatus 누락·날짜 형식 오류를 거부한다', () => {
    const noByStatus = { ...validSummary() } as Record<string, unknown>;
    delete noByStatus.byStatus;
    expect(isValidDashboardSummaryPayload(noByStatus)).toBe(false);

    const badStatus = validSummary({ byStatus: { pending: 1, confirmed: 0, paid: 0 } as never });
    expect(isValidDashboardSummaryPayload(badStatus)).toBe(false);

    expect(isValidDashboardSummaryPayload(validSummary({ date: '2026/09/10' }))).toBe(false);
    expect(isValidDashboardSummaryPayload(validSummary({ date: '' }))).toBe(false);
  });
});

describe('Dashboard settlement summary — initial failure', () => {
  it('첫 실패는 READ_FAILED이며 empty·0원이 아니다', () => {
    const view = resolveDashboardSummaryView({
      hasLoaded: false,
      loading: false,
      error: '정산 정보를 불러오지 못했습니다.',
    });
    expect(view).toBe('READ_FAILED');
    expect(view).not.toBe('READY');
    expect(resolveDashboardSummaryAmountText({ summary: null, view })).toBe('—');
  });

  it('첫 실패는 합성 0원 summary를 만들지 않는다', () => {
    expect(resolveDashboardSummaryAfterFailure(null)).toBeNull();
  });
});

describe('Dashboard settlement summary — success to retry start preserves summary', () => {
  it('이전 성공이 있으면 background 갱신으로 취급한다', () => {
    expect(isDashboardSummaryBackgroundRefresh(true)).toBe(true);
    expect(isDashboardSummaryBackgroundRefresh(false)).toBe(false);
  });

  it('retry 시작(loading) 중에도 이전 금액 표시를 LOADING으로 되돌리지 않는다', () => {
    const prev = validSummary({ totalNetAmount: 27000 });
    const view = resolveDashboardSummaryView({ hasLoaded: true, loading: true, error: null });
    expect(view).toBe('READY');
    expect(resolveDashboardSummaryAmountText({ summary: prev, view })).toBe('27,000원');
  });

  it('실패 시 이전 summary 참조를 보존한다', () => {
    const prev = validSummary({ totalNetAmount: 27000 });
    expect(resolveDashboardSummaryAfterFailure(prev)).toBe(prev);
  });
});

describe('Dashboard settlement summary — success to retry failure is stale', () => {
  it('이전 성공 뒤 재조회 실패는 STALE이며 이전 금액을 유지한다', () => {
    const prev = validSummary({ totalNetAmount: 27000 });
    const view = resolveDashboardSummaryView({
      hasLoaded: true,
      loading: false,
      error: '정산 정보를 불러오지 못했습니다.',
    });
    expect(view).toBe('STALE');
    expect(isDashboardSummaryStale('정산 정보를 불러오지 못했습니다.', true)).toBe(true);
    expect(resolveDashboardSummaryAmountText({ summary: prev, view })).toBe('27,000원');
    expect(resolveDashboardSummaryAmountText({ summary: prev, view })).not.toBe('—');
  });

  it('stale은 최신 확정값이 아니다', () => {
    expect(isDashboardSummaryStale(null, true)).toBe(false);
    expect(isDashboardSummaryStale('boom', false)).toBe(false);
  });
});

describe('Dashboard settlement summary — retry success clears stale', () => {
  it('재조회 성공은 error를 해제하고 최신 summary로 교체한다', () => {
    const next = validSummary({ totalNetAmount: 35000 });
    const view = resolveDashboardSummaryView({ hasLoaded: true, loading: false, error: null });
    expect(view).toBe('READY');
    expect(isDashboardSummaryStale(null, true)).toBe(false);
    expect(resolveDashboardSummaryAmountText({ summary: next, view })).toBe('35,000원');
  });
});

describe('Dashboard settlement summary — store scope change invalidates', () => {
  it('scope 변경(A→B, A→null, null→A)은 이전 summary를 무효화한다', () => {
    expect(shouldInvalidateDashboardSummaryScope('store-a', 'store-b')).toBe(true);
    expect(shouldInvalidateDashboardSummaryScope('store-a', null)).toBe(true);
    expect(shouldInvalidateDashboardSummaryScope(null, 'store-a')).toBe(true);
  });

  it('동일 scope는 무효화하지 않는다', () => {
    expect(shouldInvalidateDashboardSummaryScope('store-a', 'store-a')).toBe(false);
    expect(shouldInvalidateDashboardSummaryScope(null, null)).toBe(false);
  });

  it('scope 미확정·미로드 상태는 READY로 승격하지 않는다', () => {
    expect(resolveDashboardSummaryView({ hasLoaded: false, loading: true, error: null })).toBe(
      'LOADING',
    );
    expect(resolveDashboardSummaryView({ hasLoaded: false, loading: false, error: null })).toBe(
      'LOADING',
    );
  });
});

describe('Dashboard settlement summary — request race suppression', () => {
  it('취소·stale 응답을 무시하고 최신 응답만 허용한다', () => {
    expect(shouldIgnoreDashboardSummaryResponse(false, 2, 2)).toBe(true);
    expect(shouldIgnoreDashboardSummaryResponse(true, 2, 1)).toBe(true);
    expect(shouldIgnoreDashboardSummaryResponse(true, 1, 2)).toBe(true);
    expect(shouldIgnoreDashboardSummaryResponse(true, 2, 2)).toBe(false);
  });

  it('중복 retry가 guard를 깨지 않는다', () => {
    const current = 5;
    expect(shouldIgnoreDashboardSummaryResponse(true, current, 3)).toBe(true);
    expect(shouldIgnoreDashboardSummaryResponse(true, current, 4)).toBe(true);
    expect(shouldIgnoreDashboardSummaryResponse(true, current, 5)).toBe(false);
  });

  it('retry 키는 단조 증가하고 동일한 network 경로를 재사용한다', () => {
    expect(nextDashboardSummaryRetryKey(0)).toBe(1);
    expect(nextDashboardSummaryRetryKey(1)).toBe(2);
    expect(buildDashboardSummaryPath('store-1', '2026-09-10')).toBe(
      '/stores/store-1/settlements/summary?date=2026-09-10',
    );
    expect(buildDashboardSummaryPath('store id/한글', '2026-09-10')).toBe(
      `/stores/${encodeURIComponent('store id/한글')}/settlements/summary?date=2026-09-10`,
    );
  });
});

describe('SettlementCard does not turn failure into 0원', () => {
  it('초기 실패는 "—"이며 "0원"이 아니다', () => {
    const view = resolveDashboardSummaryView({
      hasLoaded: false,
      loading: false,
      error: '정산 정보를 불러오지 못했습니다.',
    });
    expect(resolveDashboardSummaryAmountText({ summary: null, view })).toBe('—');
    expect(resolveDashboardSummaryAmountText({ summary: null, view })).not.toBe('0원');
    expect(resolveDashboardSummaryAmountText({ summary: null, view })).not.toContain('0');
  });

  it('stale은 이전 금액을 유지하고 실패를 0원으로 바꾸지 않는다', () => {
    const prev = validSummary({ totalNetAmount: 5000 });
    const text = resolveDashboardSummaryAmountText({ summary: prev, view: 'STALE' });
    expect(text).toBe('5,000원');
    expect(text).not.toBe('—');
    expect(text).not.toBe('0원');
  });

  it('로딩 중에는 금액을 단정하지 않는다', () => {
    expect(resolveDashboardSummaryAmountText({ summary: null, view: 'LOADING' })).toBe(
      '불러오는 중…',
    );
    expect(resolveDashboardSummaryAmountText({ summary: null, view: 'LOADING' })).not.toBe('0원');
  });
});
