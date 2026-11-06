'use client';

import { Button } from '@greenhub/ui/components/button';
import type { AdminDriver } from '@/hooks/useAdmin';
import { ADMIN_SUB, formatAdminDate, parseAdminTime } from '../../_components/adminList';
import { waitingDays } from '../_lib';
import { DriverPhone, driverName } from './DriverList';

interface PendingDriversProps {
  drivers: AdminDriver[];
  /** 사이드바와 같은 승인 대기 건수(서버). 아직 모르면 불러온 수를 쓴다. */
  count: number;
  /** 서버에 더 있을 수 있음(사이드바 "+"와 같은 뜻). */
  more: boolean;
  processingId: string | null;
  onApprove: (userId: string) => void;
}

// ② 방향(design-direction.md §5 어드민 "기사"): 승인 대기는 표 위 1px 테두리 요약 상자로 뺀다.
// 이름 · 연락처 · 신청일과 대기 일수, 초록 "승인…" 하나. 거절 API가 없어 "거절…"은 두지 않고(2026-11-01),
// 대기 중인 사람에게 "정지"를 보이지 않는다. 배송 가능 지역은 데이터가 없어 쓰지 않는다.
export function PendingDrivers({
  drivers,
  count,
  more,
  processingId,
  onApprove,
}: PendingDriversProps) {
  if (drivers.length === 0) return null;
  return (
    <section
      aria-labelledby="pending-drivers-title"
      className="mb-5 rounded-[8px] border border-rule px-4 py-3"
    >
      <h2
        id="pending-drivers-title"
        className="m-0 text-[15px] leading-[22px] font-bold text-foreground"
      >
        승인 대기 <span className="tabular-nums">{count}</span>
        {more ? '+' : ''}명
      </h2>
      <ul className="m-0 list-none p-0">
        {drivers.map((driver) => {
          const appliedAt = parseAdminTime(driver.createdAt);
          const applied = formatAdminDate(appliedAt);
          const days = waitingDays(appliedAt);
          const processing = processingId === driver.id;
          return (
            <li
              key={driver.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule py-2.5 last:border-b-0 [word-break:keep-all]"
            >
              <div className="min-w-0">
                <p className="m-0 text-[15px] leading-[22px] font-bold">{driverName(driver)}</p>
                <p className={ADMIN_SUB}>
                  <DriverPhone phone={driver.phone} />
                  {applied && (
                    <>
                      {' · '}
                      <span className="whitespace-nowrap tabular-nums">신청 {applied}</span>
                    </>
                  )}
                  {days !== null && (
                    <>
                      {' · '}
                      <span className="whitespace-nowrap tabular-nums">
                        {days === 0 ? '오늘 신청' : `${days}일째 대기`}
                      </span>
                    </>
                  )}
                </p>
              </div>
              <Button
                onClick={() => onApprove(driver.id)}
                disabled={processing}
                className="rounded-[8px]"
                aria-label={`기사 ${driverName(driver)} 승인`}
              >
                {processing ? '처리 중…' : '승인…'}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
