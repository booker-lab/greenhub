'use client';

import { Button } from '@greenhub/ui/components/button';
import type { AdminDriver } from '@/hooks/useAdmin';
import { formatJoinedDate, formatPhone } from '../../users/_lib';
import { type AdminDriversReadState, type DriverAction, getAdminDriversReadState } from '../_lib';
import { DriverBadge } from './DriverBadge';

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·Paper·Group·Stack과 같은 값.
const TEXT = 'm-0 p-0 text-base';
const TRUNCATE = 'overflow-hidden text-ellipsis whitespace-nowrap';

interface DriverListProps {
  drivers: AdminDriver[];
  loading: boolean;
  /** useAdminDrivers 조회 실패 메시지. null이면 마지막 조회가 실패하지 않았음. */
  error: string | null;
  processingId: string | null;
  onAction: (userId: string, action: DriverAction) => void;
  /** 조회 실패 시 재시도 — hook의 reload()에 연결된다. 현재 탭을 유지한다. */
  onRetry: () => void;
}

export function DriverList({
  drivers,
  loading,
  error,
  processingId,
  onAction,
  onRetry,
}: DriverListProps) {
  const readState: AdminDriversReadState = getAdminDriversReadState({ loading, error, drivers });

  if (readState === 'LOADING') {
    return (
      <p className={`${TEXT} py-20 text-center`} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </p>
    );
  }

  // 조회 실패는 성공-empty와 구조적으로 구분 — "드라이버가 없습니다."로 collapse 금지.
  if (readState === 'FETCH_ERROR') {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-16">
        <p className={TEXT} style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
          드라이버 목록을 불러오지 못했습니다.
        </p>
        <p
          className={`${TEXT} text-center`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          {error}
        </p>
        <Button onClick={onRetry} variant="outline" className="rounded-[8px]">
          다시 조회
        </Button>
      </div>
    );
  }

  if (readState === 'EMPTY') {
    return (
      <p className={`${TEXT} py-20 text-center`} style={{ color: 'var(--color-text-disabled)' }}>
        드라이버가 없습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {drivers.map((driver) => (
        <div
          key={driver.id}
          className="block rounded-[16px] bg-white px-4 py-3"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <div className="flex flex-row flex-wrap items-center justify-between gap-4">
            <div style={{ minWidth: 0 }}>
              <div className="mb-0.5 flex flex-row flex-wrap items-center justify-start gap-2.5">
                <p
                  className={`${TEXT} ${TRUNCATE}`}
                  style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--font-size-sm)' }}
                >
                  {driver.name}
                </p>
                <DriverBadge driver={driver} />
              </div>
              <p
                className={`${TEXT} ${TRUNCATE}`}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                {driver.email ?? '이메일 없음'}
              </p>
              <p
                className={`${TEXT} ${TRUNCATE}`}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                {driver.phone?.trim() ? (
                  <a href={`tel:${driver.phone.trim()}`} style={{ color: 'inherit' }}>
                    {formatPhone(driver.phone)}
                  </a>
                ) : (
                  formatPhone(driver.phone)
                )}{' '}
                · 가입일 {formatJoinedDate(driver.createdAt)}
              </p>
            </div>

            <div
              className="flex flex-row flex-wrap items-center justify-start gap-2.5"
              style={{ flexShrink: 0 }}
            >
              {!driver.driverApproved && !driver.suspended && (
                <Button
                  onClick={() => onAction(driver.id, 'approve')}
                  disabled={processingId === driver.id}
                  size="xs"
                  className="rounded-[8px]"
                >
                  {processingId === driver.id ? '처리중…' : '승인'}
                </Button>
              )}
              {!driver.suspended ? (
                <Button
                  onClick={() => onAction(driver.id, 'suspend')}
                  disabled={processingId === driver.id}
                  size="xs"
                  variant="light-destructive"
                  className="rounded-[8px]"
                >
                  정지
                </Button>
              ) : (
                <Button
                  onClick={() => onAction(driver.id, 'unsuspend')}
                  disabled={processingId === driver.id}
                  size="xs"
                  variant="secondary"
                  className="rounded-[8px]"
                >
                  정지 해제
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
