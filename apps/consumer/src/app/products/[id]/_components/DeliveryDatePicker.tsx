'use client';

import { todayKST } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { useState } from 'react';
import { isDeliveryDateSelectable, useDeliverySlots } from '@/hooks/useDailyCap';

interface Props {
  storeId: string | null;
  /** 선택된 배송일 'YYYY-MM-DD' — 미선택 시 null */
  value: string | null;
  onChange: (date: string) => void;
}

/** 'YYYY-MM-DD' 문자열 생성 */
function toDateStr(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** 해당 월의 주 단위 날짜 그리드 (앞쪽 빈칸은 null) */
function buildCalendar(year: number, month: number): (string | null)[][] {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const weeks: (string | null)[][] = [];
  let week: (string | null)[] = Array(firstDay).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    week.push(toDateStr(year, month, d));
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

/**
 * 소비자 배송일 선택 캘린더 — 셀러 `daily-caps` 캘린더의 거울상.
 * 셀러가 슬롯(totalCap)을 연 날짜 중 잔여(totalCap - usedSlots)가 남은
 * 날짜만 선택 가능. 과거·문서 없음·마감(잔여 0) 날짜는 disabled.
 * 월 이동은 당월 + 익월 2개월로 제한.
 */
// Mantine ActionIcon(size md 28px·subtle gray·기본 모서리 16px) 계산값: 투명 1px 테두리, gray-9 글자, 줄 높이 1,
// hover(가능한 기기만) gray-2 면, 비활성은 gray-2 면·gray-5 글자.
const MONTH_NAV_BUTTON =
  'relative m-0 inline-flex size-7 min-h-7 min-w-7 cursor-pointer appearance-none items-center justify-center overflow-hidden rounded-[16px] border border-solid border-transparent bg-transparent p-0 text-left leading-none text-[#212529] no-underline select-none [font-family:inherit] [font-size:inherit] [font-weight:inherit] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid active:translate-y-px enabled:[@media(hover:hover)]:hover:bg-[#e9ecef] disabled:cursor-not-allowed disabled:bg-[#e9ecef] disabled:text-[#adb5bd] disabled:active:translate-y-0';

export default function DeliveryDatePicker({ storeId, value, onChange }: Props) {
  const todayStr = todayKST();
  const [todayYear, todayMonth] = todayStr.split('-').map(Number);
  // 0 = 당월, 1 = 익월
  const [monthOffset, setMonthOffset] = useState(0);

  const viewYear = todayYear + Math.floor((todayMonth - 1 + monthOffset) / 12);
  const viewMonth = (todayMonth - 1 + monthOffset) % 12;

  // 당월 1일 ~ 익월 말일 범위를 한 번에 구독 (월 이동 시 재쿼리 불필요)
  const from = toDateStr(todayYear, todayMonth - 1, 1);
  const toMonthDate = new Date(Date.UTC(todayYear, todayMonth + 1, 0));
  const to = toDateStr(
    toMonthDate.getUTCFullYear(),
    toMonthDate.getUTCMonth(),
    toMonthDate.getUTCDate(),
  );

  const { slots, loading, refreshing, error, isStale, hasLoaded, retry } = useDeliverySlots(
    storeId,
    from,
    to,
  );

  // read failure/stale/loading/refreshing 중에는 이전 remainingSlots 값만 믿고
  // 새 날짜 선택을 허용하지 않는다 (fail-closed). 기존 선택 value는 유지한다.
  const readBlocked = error !== null || isStale || loading || refreshing;
  const isInitialFailure = error !== null && !hasLoaded && !isStale;
  const isStaleFailure = isStale && error !== null;

  const calendar = buildCalendar(viewYear, viewMonth);
  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
  });

  return (
    // ① 외형 유지(UI 교체 P5): Mantine Paper(radius md 8px·p md·mb md)·Group·SimpleGrid(7열·간격 md)·
    // Text(16/1.55)·ActionIcon·Button subtle xs 계산값.
    <div
      className="mb-4 block rounded-[8px] p-4"
      style={{ background: 'var(--color-surface-muted)' }}
    >
      <p
        className="m-0 mb-3 p-0 leading-[1.55] font-normal"
        style={{
          fontWeight: 'var(--fw-bold)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text)',
        }}
      >
        배송 희망일
      </p>

      {/* 월 이동 */}
      <div className="mb-3 flex flex-row flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          className={MONTH_NAV_BUTTON}
          disabled={monthOffset === 0}
          onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
          aria-label="이전 달"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <p className="m-0 p-0 text-base" style={{ fontWeight: 'var(--fw-medium)' }}>
          {monthLabel}
        </p>
        <button
          type="button"
          className={MONTH_NAV_BUTTON}
          disabled={monthOffset === 1}
          onClick={() => setMonthOffset((o) => Math.min(1, o + 1))}
          aria-label="다음 달"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* 최초 조회 실패: 정상 슬롯 없음과 구분되는 explicit read failure */}
      {isInitialFailure && (
        <div data-testid="delivery-slots-error" className="mb-3">
          <p
            className="m-0 p-0 leading-[1.55] font-normal"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}
          >
            배송 가능 날짜를 확인하지 못했습니다
          </p>
          <Button
            variant="subtle"
            size="xs"
            className="mt-1"
            onClick={retry}
            disabled={refreshing}
            data-testid="delivery-slots-retry"
          >
            다시 조회
          </Button>
        </div>
      )}

      {/* 성공 후 실패: 이전 slots는 정보 표시용으로 보존하되 stale 표시 + fail-closed */}
      {isStaleFailure && (
        <div data-testid="delivery-slots-stale" className="mb-3">
          <p
            className="m-0 p-0 leading-[1.55] font-normal"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}
          >
            최신 잔여 수량을 확인하지 못했습니다
          </p>
          <p
            className="m-0 p-0 leading-[1.55] font-normal"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            이전 정보를 표시하고 있습니다
          </p>
          <Button
            variant="subtle"
            size="xs"
            className="mt-1"
            onClick={retry}
            disabled={refreshing}
            data-testid="delivery-slots-retry"
          >
            다시 조회
          </Button>
        </div>
      )}

      {refreshing && (
        <div className="mb-3">
          <p
            data-testid="delivery-slots-refreshing"
            className="m-0 p-0 leading-[1.55] font-normal"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            최신 정보를 다시 불러오는 중...
          </p>
        </div>
      )}

      {/* 요일 헤더 */}
      <div className="mb-1 grid grid-cols-7 gap-4">
        {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
          <p
            key={d}
            className="m-0 px-0 py-1 text-center leading-[1.55] font-normal"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {d}
          </p>
        ))}
      </div>

      {/* 날짜 그리드 */}
      {loading && !hasLoaded && !error ? (
        <div className="py-8" style={{ textAlign: 'center' }}>
          <p
            className="m-0 p-0 leading-[1.55] font-normal"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            불러오는 중...
          </p>
        </div>
      ) : (
        calendar.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-4">
            {week.map((date, di) => {
              if (!date) return <div key={di} />;
              const slot = slots[date];
              // 슬롯 미설정(문서 없음)·과거·잔여 0·readBlocked → 선택 불가 (fail-closed)
              const available = isDeliveryDateSelectable(date, todayStr, slot, readBlocked);
              const isSelected = date === value;
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!available}
                  onClick={() => available && onChange(date)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '6px 0',
                    border: 'none',
                    borderRadius: 12,
                    opacity: available ? 1 : 0.35,
                    cursor: available ? 'pointer' : 'not-allowed',
                    background: isSelected ? 'var(--color-primary)' : 'transparent',
                  }}
                >
                  <p
                    className="m-0 p-0 leading-[1.55]"
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--fw-medium)',
                      color: isSelected ? 'var(--color-surface)' : 'var(--color-text-secondary)',
                    }}
                  >
                    {parseInt(date.split('-')[2], 10)}
                  </p>
                  <p
                    className="m-0 mt-0.5 p-0 leading-[1.55] font-normal"
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: available ? 'var(--fw-medium)' : undefined,
                      color: isSelected
                        ? 'var(--color-surface)'
                        : available
                          ? 'var(--color-status-info-text)'
                          : 'var(--color-text-disabled)',
                    }}
                  >
                    {slot && slot.remainingSlots > 0 ? `${slot.remainingSlots}석` : '—'}
                  </p>
                </button>
              );
            })}
          </div>
        ))
      )}

      <p
        className="m-0 mt-2.5 p-0 leading-[1.55] font-normal"
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
      >
        {value
          ? `선택: ${new Date(`${value}T00:00:00+09:00`).toLocaleDateString('ko-KR', {
              timeZone: 'Asia/Seoul',
              month: 'long',
              day: 'numeric',
              weekday: 'short',
            })}`
          : '배송 가능한 날짜를 선택해 주세요'}
      </p>
    </div>
  );
}
