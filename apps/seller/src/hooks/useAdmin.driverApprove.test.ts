import { describe, expect, it, vi } from 'vitest';
import {
  DRIVER_APPLICATION_CHANGED_MESSAGE,
  buildDriverApproveRequest,
  driverApplicationRevision,
  executeDriverApprove,
} from './useAdmin.driverApprove';
import { ADMIN_COMMAND_MISSING_TOKEN_MESSAGE } from './useAdmin.outcome';

// lib/api의 ApiError와 같은 모양(status·message·code). lib/api는 '@/' 별칭을 써서 여기서 직접 import하지 않는다.
function apiError(status: number, message: string, code?: string) {
  return Object.assign(new Error(message), { name: 'ApiError', status, code });
}

describe('기사 승인 요청', () => {
  it('본 가입 신청 회차를 expectedRevision으로 보낸다', () => {
    expect(buildDriverApproveRequest('driver/1', 3)).toEqual({
      path: '/admin/drivers/driver%2F1/approve',
      init: { method: 'PATCH', body: JSON.stringify({ expectedRevision: 3 }) },
    });
  });

  it('신청 정보가 없으면 회차 0을 쓴다', () => {
    expect(driverApplicationRevision({ driverApplication: null })).toBe(0);
    expect(driverApplicationRevision({})).toBe(0);
    expect(driverApplicationRevision({ driverApplication: { revision: 4 } })).toBe(4);
    expect(driverApplicationRevision({ driverApplication: { revision: '4' } })).toBe(0);
  });
});

describe('기사 승인 결과', () => {
  it('승인되면 목록을 다시 읽고 확정한다', async () => {
    const reload = vi.fn().mockResolvedValue(null);
    await expect(
      executeDriverApprove({ invoke: vi.fn().mockResolvedValue(undefined), reload }),
    ).resolves.toEqual({ kind: 'confirmed', reconciled: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('신청 내용이 바뀌었으면(409 DRIVER_APPLICATION_CHANGED) 목록을 다시 읽고 다시 확인하라고 알린다', async () => {
    const reload = vi.fn().mockResolvedValue(null);
    const invoke = vi
      .fn()
      .mockRejectedValue(
        apiError(409, '가입 신청 내용이 바뀌었습니다.', 'DRIVER_APPLICATION_CHANGED'),
      );

    await expect(executeDriverApprove({ invoke, reload })).resolves.toEqual({
      kind: 'rejected',
      status: 409,
      message: DRIVER_APPLICATION_CHANGED_MESSAGE,
    });
    expect(DRIVER_APPLICATION_CHANGED_MESSAGE).toBe('신청 내용이 바뀌었어요. 다시 확인해 주세요.');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('다른 409(이미 승인·정지)는 서버 사유를 그대로 두고 목록을 다시 읽지 않는다', async () => {
    const reload = vi.fn();
    const invoke = vi.fn().mockRejectedValue(apiError(409, '이미 승인된 기사입니다.'));

    await expect(executeDriverApprove({ invoke, reload })).resolves.toEqual({
      kind: 'rejected',
      status: 409,
      message: '이미 승인된 기사입니다.',
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('토큰이 없으면 보내지 않는다', async () => {
    const invoke = vi.fn();
    await expect(
      executeDriverApprove({ invoke, reload: vi.fn(), missingToken: true }),
    ).resolves.toEqual({
      kind: 'rejected',
      status: null,
      message: ADMIN_COMMAND_MISSING_TOKEN_MESSAGE,
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
