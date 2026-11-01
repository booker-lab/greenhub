'use client';

import { StatusDot } from '@greenhub/ui/components/status-dot';
import type { AdminDriver } from '@/hooks/useAdmin';
import {
  ADMIN_SUB,
  ADMIN_TD,
  ADMIN_TH,
  AdminListError,
  AdminListNotice,
  AdminMissing,
  AdminRowMenu,
  formatAdminDate,
} from '../../_components/adminList';
import { type AdminDriversReadState, type DriverAction, getAdminDriversReadState } from '../_lib';

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

// ② 방향(design-direction.md §5 어드민 "기사", §8 D7): 기사 표 하나.
// 열: 이름(굵게, 아래 회색 이메일) → 연락처 → 상태(점 + 글자, 정지는 빨강) → 가입일 → ⋮(정지… / 정지 풀기…).
// 배송 지역·회차 배송지 수·정지 날짜와 사유는 데이터가 없어 쓰지 않는다(2026-11-01 "데이터가 없는 칸은 뺀다").
// 태블릿(1100px 이하)은 가입일을 이름 아래 보조 줄로, 휴대폰(640px 이하)은 다른 목록과 같은 세 줄 행이다.

export function driverName(driver: Pick<AdminDriver, 'name'>): string {
  // 타입은 string이지만 옛 문서에 필드가 없을 수 있어 ?.로 방어한다.
  return driver.name?.trim() || '이름 없음';
}

/** 연락처 — 전화 걸기 링크. 없으면 "연락처 미등록". */
export function DriverPhone({ phone }: { phone?: string | null }) {
  const value = phone?.trim();
  if (!value) return <span className="text-[var(--color-text-secondary)]">연락처 미등록</span>;
  return (
    <a href={`tel:${value}`} className="whitespace-nowrap text-inherit tabular-nums">
      {value}
    </a>
  );
}

function DriverStatus({ driver, size }: { driver: AdminDriver; size: 13 | 15 }) {
  return driver.suspended ? (
    <StatusDot tone="problem" size={size}>
      정지
    </StatusDot>
  ) : (
    <StatusDot size={size}>활동 중</StatusDot>
  );
}

function DriverJoined({ driver }: { driver: AdminDriver }) {
  const date = formatAdminDate(driver.createdAt);
  return date ? <span className="whitespace-nowrap tabular-nums">{date}</span> : <AdminMissing />;
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

  if (readState === 'LOADING') return <AdminListNotice>불러오는 중...</AdminListNotice>;
  // 조회 실패는 성공-empty와 구조적으로 구분 — "기사가 없습니다."로 collapse 금지.
  if (readState === 'FETCH_ERROR') {
    return (
      <AdminListError title="기사 목록을 불러오지 못했습니다." error={error} onRetry={onRetry} />
    );
  }
  if (readState === 'EMPTY') return <AdminListNotice>기사가 없습니다.</AdminListNotice>;

  const actionsOf = (driver: AdminDriver) =>
    processingId === driver.id ? (
      <span className="text-[13px] whitespace-nowrap text-[var(--color-text-secondary)]">
        처리 중…
      </span>
    ) : (
      <AdminRowMenu
        label={`기사 ${driverName(driver)}`}
        items={[
          driver.suspended
            ? {
                key: 'unsuspend',
                label: '정지 풀기…',
                onSelect: () => onAction(driver.id, 'unsuspend'),
              }
            : { key: 'suspend', label: '정지…', onSelect: () => onAction(driver.id, 'suspend') },
        ]}
      />
    );

  return (
    <>
      {/* 휴대폰(640px 이하): 세 줄 행 — 1줄 이름, 2줄 연락처와 오른쪽 상태, 3줄 이메일·가입일, 옆에 ⋮ 한 자리. */}
      <ul className="m-0 list-none p-0 min-[641px]:hidden" aria-label="기사 목록">
        {drivers.map((driver) => (
          <li
            key={driver.id}
            className="flex items-center gap-2 border-b border-rule py-2.5 [word-break:keep-all]"
          >
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[15px] leading-[22px] font-bold">{driverName(driver)}</p>
              <div className="flex items-start justify-between gap-2">
                <p className={`${ADMIN_SUB} min-w-0`}>
                  <DriverPhone phone={driver.phone} />
                </p>
                <DriverStatus driver={driver} size={13} />
              </div>
              <p className={`${ADMIN_SUB} break-all`}>
                {driver.email ?? '이메일 없음'} · 가입 <DriverJoined driver={driver} />
              </p>
            </div>
            <div className="flex w-11 shrink-0 justify-center">{actionsOf(driver)}</div>
          </li>
        ))}
      </ul>

      {/* 태블릿·데스크톱(641px 이상): 표. 1100px 이하는 가입일을 이름 아래 보조 줄로 옮긴다. */}
      <table className="w-full border-collapse max-[640px]:hidden">
        <thead>
          <tr>
            <th className={ADMIN_TH}>이름</th>
            <th className={ADMIN_TH}>연락처</th>
            <th className={ADMIN_TH}>상태</th>
            <th className={`${ADMIN_TH} max-[1100px]:hidden`}>가입일</th>
            <th className={`${ADMIN_TH} w-[60px]`}>
              <span className="sr-only">동작</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((driver) => (
            <tr key={driver.id}>
              <td className={`${ADMIN_TD} w-[40%] [word-break:keep-all]`}>
                <p className="m-0 font-bold">{driverName(driver)}</p>
                <p className={`${ADMIN_SUB} break-all`}>{driver.email ?? '이메일 없음'}</p>
                <p className={`${ADMIN_SUB} min-[1101px]:hidden`}>
                  가입 <DriverJoined driver={driver} />
                </p>
              </td>
              <td className={ADMIN_TD}>
                <DriverPhone phone={driver.phone} />
              </td>
              <td className={ADMIN_TD}>
                <DriverStatus driver={driver} size={15} />
              </td>
              <td className={`${ADMIN_TD} max-[1100px]:hidden`}>
                <DriverJoined driver={driver} />
              </td>
              <td className={`${ADMIN_TD} py-1 text-right align-middle`}>
                <span className="flex justify-end">{actionsOf(driver)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
