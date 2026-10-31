'use client';

import { Button } from '@greenhub/ui/components/button';
import { notify } from '@/components/AppToaster';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { todayKST } from '@greenhub/shared';
import { ApiError, apiJson } from '@/lib/api';

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·Paper(sm 그림자)·UnstyledButton·SimpleGrid(7칸, 간격 16) 값.
const TEXT = 'm-0 p-0 text-base';
const PAPER = 'block rounded-[16px] bg-white shadow-mantine-sm';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';
const GRID7 = 'grid grid-cols-7 gap-4';
const BACK_ICON = (d: string) => (
  <svg
    className="size-5"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
    focusable="false"
  >
    <path d={d} />
  </svg>
);

interface DailyCap {
  date: string;
  totalCap: number;
  usedSlots?: number;
}

function buildCalendar(year: number, month: number): (string | null)[][] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: (string | null)[][] = [];
  let week: (string | null)[] = Array(firstDay).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    week.push(`${year}-${mm}-${dd}`);
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

export default function DailyCapsPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [caps, setCaps] = useState<Record<string, DailyCap>>({});
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const fetchCaps = useCallback(async () => {
    if (!storeId || !token) return;
    setLoading(true);
    const mm = String(month + 1).padStart(2, '0');
    const from = `${year}-${mm}-01`;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;
    try {
      const data = await apiJson<{ caps: DailyCap[] }>(
        `/stores/${storeId}/daily-caps?from=${from}&to=${to}`,
        token,
      );
      const map: Record<string, DailyCap> = {};
      for (const cap of data.caps) map[cap.date] = cap;
      setCaps(map);
    } catch {
      // GET 실패는 silent (초기 로딩 노이즈 방지)
    } finally {
      setLoading(false);
    }
  }, [storeId, token, year, month]);

  useEffect(() => {
    fetchCaps();
  }, [fetchCaps]);

  function prevMonth() {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else setMonth((m) => m + 1);
  }

  function startEdit(date: string) {
    setEditing(date);
    setEditValue(String(caps[date]?.totalCap ?? 0));
  }

  async function saveCap(date: string) {
    if (!storeId || !token) return;
    const totalCap = parseInt(editValue, 10);
    if (Number.isNaN(totalCap) || totalCap < 0) return;
    setSaving(true);
    try {
      await apiJson(`/stores/${storeId}/daily-caps/${date}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ totalCap }),
      });
      setCaps((prev) => ({ ...prev, [date]: { ...prev[date], date, totalCap } }));
      setEditing(null);
    } catch (e) {
      notify({
        color: 'red',
        title: '설정 저장 실패',
        message: e instanceof ApiError ? e.message : '일일 캡 저장에 실패했습니다',
      });
    } finally {
      setSaving(false);
    }
  }

  const calendar = buildCalendar(year, month);
  const todayStr = todayKST();
  const monthLabel = new Date(year, month).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
  });

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-surface-muted)',
        padding: '32px 16px',
      }}
    >
      <div className="mx-auto max-w-[540px] px-4">
        <div className="mb-5 flex flex-row flex-wrap items-center justify-start gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label="뒤로"
            onClick={() => router.back()}
          >
            {BACK_ICON('M15 18l-6-6 6-6')}
          </Button>
          <h2
            className="m-0 leading-[1.35] font-extrabold"
            style={{ fontSize: 'var(--font-size-xl)' }}
          >
            배송 슬롯 설정
          </h2>
        </div>

        <p
          className={`${TEXT} mb-4`}
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-disabled)',
            lineHeight: 1.6,
          }}
        >
          날짜를 탭하면 해당 날짜의 최대 배송 슬롯(총 수량)을 설정할 수 있습니다.
        </p>

        {/* 월 이동 */}
        <div className={`${PAPER} mb-4 p-4`}>
          <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-4">
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              aria-label="이전 달"
              onClick={prevMonth}
            >
              {BACK_ICON('M15 18l-6-6 6-6')}
            </Button>
            <p className={TEXT} style={{ fontWeight: 'var(--fw-medium)' }}>
              {monthLabel}
            </p>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              aria-label="다음 달"
              onClick={nextMonth}
            >
              {BACK_ICON('M9 18l6-6-6-6')}
            </Button>
          </div>

          {/* 요일 헤더 */}
          <div className={`${GRID7} mb-1`}>
            {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
              <p
                key={d}
                className={`${TEXT} py-1 text-center`}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                {d}
              </p>
            ))}
          </div>

          {/* 날짜 그리드 */}
          {loading ? (
            <div className="py-8" style={{ textAlign: 'center' }}>
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                불러오는 중...
              </p>
            </div>
          ) : (
            calendar.map((week, wi) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 캘린더 주 인덱스 — 5~6주 고정, reorder 없음
              <div key={wi} className={GRID7}>
                {week.map((date, di) => {
                  // biome-ignore lint/suspicious/noArrayIndexKey: 캘린더 빈칸(요일 시프트) — 위치 고정 키
                  if (!date) return <div key={di} />;
                  const cap = caps[date];
                  const isToday = date === todayStr;
                  const isPast = date < todayStr;
                  return (
                    <button
                      type="button"
                      key={date}
                      className={UNSTYLED_BUTTON}
                      onClick={() => !isPast && startEdit(date)}
                      disabled={isPast}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        padding: '6px 0',
                        borderRadius: 12,
                        opacity: isPast ? 0.4 : 1,
                        cursor: isPast ? 'not-allowed' : 'pointer',
                        backgroundColor: isToday ? 'var(--color-primary-surface)' : undefined,
                      }}
                    >
                      <p
                        className={TEXT}
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: 'var(--fw-medium)',
                          color: isToday
                            ? 'var(--color-primary-dark)'
                            : 'var(--color-text-secondary)',
                        }}
                      >
                        {parseInt(date.split('-')[2], 10)}
                      </p>
                      <p
                        className={`${TEXT} mt-0.5`}
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: cap ? 'var(--fw-medium)' : undefined,
                          color: cap
                            ? 'var(--color-status-info-text)'
                            : 'var(--color-text-disabled)',
                        }}
                      >
                        {cap ? cap.totalCap : '—'}
                      </p>
                      {cap && (cap.usedSlots ?? 0) > 0 && (
                        <p
                          className={TEXT}
                          style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--color-text-disabled)',
                          }}
                        >
                          {cap.usedSlots}↑
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* 편집 패널 */}
        {editing && (
          <div className={`${PAPER} p-5`}>
            <p
              className={`${TEXT} mb-3`}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-text)',
              }}
            >
              {editing} 슬롯 설정
            </p>
            <div className="flex flex-row flex-wrap items-center justify-start gap-3">
              <input
                type="number"
                min="0"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 12,
                  fontSize: 'var(--font-size-sm)',
                  textAlign: 'right',
                }}
              />
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                개
              </p>
            </div>
            <p
              className={`${TEXT} mt-1.5`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              0 = 해당일 배송 불가
            </p>
            <div className="mt-4 flex flex-row flex-wrap items-center justify-start gap-2.5">
              <Button onClick={() => setEditing(null)} className="flex-1" variant="outline-gray">
                취소
              </Button>
              <Button
                onClick={() => saveCap(editing)}
                disabled={saving}
                className="flex-1"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {saving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
