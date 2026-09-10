import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyAdminCommandError,
  describeAdminCommandOutcome,
  executeAdminCommand,
  resolveConfirmedOutcome,
} from './useAdmin.outcome';

// Mock/local only — 실제 API 호출 없음. invoke/reload를 주입해 outcome 판정만 검증한다.

function apiError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.name = 'ApiError';
  error.status = status;
  return error;
}

const useAdminSource = readFileSync(new URL('./useAdmin.ts', import.meta.url), 'utf8');
const ordersClient = readFileSync(new URL('../app/admin/orders/_client.tsx', import.meta.url), 'utf8');
const settlementsClient = readFileSync(
  new URL('../app/admin/settlements/_client.tsx', import.meta.url),
  'utf8',
);
const usersClient = readFileSync(new URL('../app/admin/users/_client.tsx', import.meta.url), 'utf8');
const driversClient = readFileSync(
  new URL('../app/admin/drivers/_client.tsx', import.meta.url),
  'utf8',
);
const storesClient = readFileSync(
  new URL('../app/admin/stores/_client.tsx', import.meta.url),
  'utf8',
);

describe('1. 2xx command + reload success → confirmed/reconciled', () => {
  it('invoke 성공 + readError null이면 reconciled true다', async () => {
    const outcome = await executeAdminCommand({
      invoke: async () => undefined,
      reload: async () => null,
    });
    expect(outcome).toEqual({ kind: 'confirmed', reconciled: true });
  });
});

describe('2. 2xx command + reload failure → confirmed/stale (실패로 붕괴 금지)', () => {
  it('invoke 성공 + readError string이면 reconciled false + readError 보존이다', async () => {
    const outcome = await executeAdminCommand({
      invoke: async () => undefined,
      reload: async () => '정산 목록 조회 중 오류 발생',
    });
    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind !== 'confirmed' || outcome.reconciled !== false) throw new Error('stale 기대');
    expect(outcome.readError).toBe('정산 목록 조회 중 오류 발생');
  });

  it('stale은 rejected/unknown이 아니다', async () => {
    const outcome = resolveConfirmedOutcome('주문 목록 조회 중 오류 발생');
    expect(outcome.kind).toBe('confirmed');
    expect(outcome).not.toMatchObject({ kind: 'rejected' });
    expect(outcome).not.toMatchObject({ kind: 'unknown' });
  });
});

describe('3. ApiError 4xx failure preserves server reason', () => {
  it('400 reason/status를 그대로 전달한다', async () => {
    const outcome = await executeAdminCommand({
      invoke: async () => {
        throw apiError(400, '기록이 있는 판매자는 정리할 수 없습니다');
      },
      reload: async () => null,
    });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') throw new Error('rejected 기대');
    expect(outcome.status).toBe(400);
    expect(outcome.message).toContain('기록이 있는 판매자는 정리할 수 없습니다');
  });

  it('403/404도 rejected로 분류하고 reload를 호출하지 않는다', async () => {
    let reloaded = false;
    const outcome = await executeAdminCommand({
      invoke: async () => {
        throw apiError(403, '관리자 권한이 필요합니다');
      },
      reload: async () => {
        reloaded = true;
        return null;
      },
    });
    expect(outcome.kind).toBe('rejected');
    expect(reloaded).toBe(false);
  });
});

describe('4. ApiError 5xx handling', () => {
  it('500은 rejected가 아니라 unknown이다', async () => {
    const outcome = await executeAdminCommand({
      invoke: async () => {
        throw apiError(500, '내부 서버 오류');
      },
      reload: async () => null,
    });
    expect(outcome.kind).toBe('unknown');
  });

  it('5xx unknown도 서버 reason을 버리지 않고 재확인 가이드를 함께 제공한다', () => {
    const classified = classifyAdminCommandError(apiError(500, '내부 서버 오류'));
    expect(classified.kind).toBe('unknown');
    if (classified.kind !== 'unknown') throw new Error('unknown 기대');
    expect(classified.message).toContain('내부 서버 오류');
    expect(classified.message).toContain('다시 조회');
  });
});

describe('5. transport/network unknown outcome', () => {
  it('TypeError(fetch failed)는 unknown이다', async () => {
    const outcome = await executeAdminCommand({
      invoke: async () => {
        throw new TypeError('fetch failed');
      },
      reload: async () => null,
    });
    expect(outcome.kind).toBe('unknown');
  });

  it('일반 Error도 unknown이며 상태를 단정하지 않는다', () => {
    const classified = classifyAdminCommandError(new Error('network down'));
    expect(classified.kind).toBe('unknown');
  });
});

describe('6. unknown outcome does not advertise blind retry', () => {
  it('unknown presentation은 command 재시도를 허용하지 않고 read retry를 요구한다', () => {
    const presentation = describeAdminCommandOutcome(
      { kind: 'unknown', message: 'x — 먼저 목록을 다시 조회해 상태를 확인하세요.' },
      '환불',
    );
    expect(presentation.allowCommandRetry).toBe(false);
    expect(presentation.needsReadRetry).toBe(true);
  });

  it('unknown copy는 재확인을 우선하고 즉시 재실행을 금지한다', () => {
    const classified = classifyAdminCommandError(new TypeError('fetch failed'));
    if (classified.kind !== 'unknown') throw new Error('unknown 기대');
    const presentation = describeAdminCommandOutcome(classified, '지급');
    expect(presentation.message).toContain('다시 조회');
    expect(presentation.message).toContain('다시 실행하지 마세요');
    expect(presentation.message).not.toContain('다시 시도');
    expect(presentation.title).toContain('확인할 수 없습니다');
  });
});

describe('7. force refund confirmed + reload failure does not become refund failed', () => {
  it('stale presentation은 실패 copy로 붕괴하지 않는다', () => {
    const presentation = describeAdminCommandOutcome(
      { kind: 'confirmed', reconciled: false, readError: '주문 목록 조회 중 오류 발생' },
      '환불',
    );
    expect(presentation.title).not.toBe('환불 처리 실패');
    expect(presentation.message).not.toContain('환불 처리 실패');
    expect(presentation.title).toContain('완료');
    expect(presentation.message).toContain('다시 조회');
    expect(presentation.message).toContain('중복 실행하지 마세요');
    expect(presentation.allowCommandRetry).toBe(false);
    expect(presentation.needsReadRetry).toBe(true);
  });

  it('orders _client는 stale을 실패 토스트로 표시하지 않는다', () => {
    expect(ordersClient).toContain('describeAdminCommandOutcome(outcome,');
    expect(ordersClient).not.toContain('환불 처리 실패');
    expect(ordersClient).not.toContain('잠시 후 다시 시도해 주세요');
  });
});

describe('8. settlement paid confirmed + reload failure same invariant', () => {
  it('stale presentation은 실패 copy로 붕괴하지 않는다', () => {
    const presentation = describeAdminCommandOutcome(
      { kind: 'confirmed', reconciled: false, readError: '정산 목록 조회 중 오류 발생' },
      '지급',
    );
    expect(presentation.title).not.toBe('지급 처리 실패');
    expect(presentation.message).not.toContain('지급 처리 실패');
    expect(presentation.title).toContain('완료');
    expect(presentation.message).toContain('다시 조회');
    expect(presentation.message).toContain('중복 실행하지 마세요');
    expect(presentation.allowCommandRetry).toBe(false);
  });

  it('settlements _client는 stale을 실패 토스트로 표시하지 않는다', () => {
    expect(settlementsClient).toContain('describeAdminCommandOutcome(outcome,');
    expect(settlementsClient).not.toContain('지급 처리 실패');
    expect(settlementsClient).not.toContain('잠시 후 다시 시도해 주세요');
  });
});

describe('9. user/driver command consumers preserve reason', () => {
  it('rejected presentation은 서버 reason을 그대로 전달한다', () => {
    const rejected = { kind: 'rejected' as const, status: 400, message: '이미 정지된 계정입니다' };
    expect(describeAdminCommandOutcome(rejected, '정지').message).toContain('이미 정지된 계정입니다');
    const approveRejected = {
      kind: 'rejected' as const,
      status: 404,
      message: '드라이버를 찾을 수 없습니다',
    };
    expect(describeAdminCommandOutcome(approveRejected, '승인').message).toContain(
      '드라이버를 찾을 수 없습니다',
    );
  });

  it('users _client는 outcome reason을 표시한다 (silent close 금지)', () => {
    expect(usersClient).toContain('describeAdminCommandOutcome(outcome,');
    expect(usersClient).toContain('notifications.show');
    // 기존 ConfirmModal + reload 배선 유지
    expect(usersClient).toContain('await toggleSuspend(pending.userId, !pending.currentlySuspended)');
    expect(usersClient).toContain('onConfirm={runPending}');
  });

  it('drivers _client는 approve/suspend reason을 표시한다', () => {
    expect(driversClient).toContain('describeAdminCommandOutcome(outcome,');
    expect(driversClient).toContain('notifications.show');
    expect(driversClient).toContain('approve(pending.userId)');
    expect(driversClient).toContain('toggleSuspend(pending.userId');
  });

  it('stores commission도 서버 reason을 버리지 않는다', () => {
    expect(storesClient).toContain('describeAdminCommandOutcome(outcome,');
    const rejected = { kind: 'rejected' as const, status: 400, message: '수수료율 범위 오류' };
    expect(describeAdminCommandOutcome(rejected, '수수료율 변경').message).toContain(
      '수수료율 범위 오류',
    );
  });
});

describe('10. existing admin list error/reload behavior regression', () => {
  it('useAdminList는 read failure를 error state에 남기고 readError를 반환한다', () => {
    expect(useAdminSource).toContain('setError(readError)');
    expect(useAdminSource).toContain('조회 중 오류 발생');
    expect(useAdminSource).toContain('Promise<string | null>');
    expect(useAdminSource).toContain('return readError');
    expect(useAdminSource).toContain('return null');
  });

  it('reload 실패가 이전 items를 비우지 않는다 (stale 보존)', () => {
    // catch 분기는 setItems를 호출하지 않고 error만 설정한다.
    const loadBlock = useAdminSource.slice(
      useAdminSource.indexOf('const load = useCallback'),
      useAdminSource.indexOf('}, [token'),
    );
    expect(loadBlock).toContain('setItems(extract(data))');
    expect(loadBlock).toContain('setError(readError)');
    expect(loadBlock).not.toContain('setItems([])');
  });

  it('command 성공 뒤 reload를 호출하고 outcome 단일 소유자를 사용한다', () => {
    expect(useAdminSource).toContain('executeAdminCommand');
    expect(useAdminSource).toContain('runAdminCommand');
    expect(useAdminSource).toContain('Promise<AdminCommandOutcome>');
    // 구 boolean 축약이 남지 않는다 (banner save의 독립 boolean 계약은 범위 밖이므로 제외).
    expect(useAdminSource).not.toContain('runAction');
    expect(useAdminSource).not.toContain('성공 여부만 boolean으로 반환');
  });

  it('Banner/Invite 독립 error 계약을 깨뜨리지 않는다', () => {
    expect(useAdminSource).toContain('useAdminBanner');
    expect(useAdminSource).toContain('saveError');
    expect(useAdminSource).toContain('useAdminInvite');
    expect(useAdminSource).toContain('generateError');
    // banner save / invite generate는 outcome 계약으로 흡수하지 않는다.
    expect(useAdminSource).not.toContain("describeAdminCommandOutcome(outcome, '배너')");
    expect(useAdminSource).not.toContain("describeAdminCommandOutcome(outcome, '초대')");
  });
});
