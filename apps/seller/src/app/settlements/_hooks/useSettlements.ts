'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { todayKST } from '@greenhub/shared';
import { ApiError, apiJson } from '@/lib/api';
import type { Settlement, SettlementStatus, SettlementTab, Summary } from '../_constants';

export interface UseSettlementsResult {
  selectedDate: string;
  setSelectedDate: (v: string) => void;
  selectedDateLabel: string;
  today: string;

  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;

  summary: Summary | null;
  summaryLoading: boolean;
  summaryError: string;

  settlements: Settlement[];
  listLoading: boolean;
  listError: string;

  fetchSummary: () => Promise<void>;
  fetchSettlements: (f?: string, t?: string, status?: SettlementStatus) => Promise<void>;
}

export function useSettlements(activeTab: SettlementTab): UseSettlementsResult {
  const { data: session } = useSession();
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const today = todayKST();
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedDateLabel, setSelectedDateLabel] = useState('');

  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  // 기간별 조회는 이번 달 1일~오늘(한국 날짜)을 미리 채워 빈 날짜 칸(yyyy-mm-dd)으로 시작하지 않는다.
  const [from, setFrom] = useState(() => `${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  useEffect(() => {
    // 브라우저마다 요일 표기가 달라("4일 일" 등) 직접 "2026년 10월 4일 (일)" 형태로 만든다.
    const date = new Date(`${selectedDate}T00:00:00`);
    const weekday = date.toLocaleDateString('ko-KR', { weekday: 'short' });
    setSelectedDateLabel(
      `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday})`,
    );
  }, [selectedDate]);

  const fetchSummary = useCallback(async () => {
    if (!storeId || !token) return;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const data = await apiJson<Summary>(
        `/stores/${storeId}/settlements/summary?date=${selectedDate}`,
        token,
      );
      setSummary(data);
    } catch (e) {
      setSummaryError(e instanceof ApiError ? e.message : `네트워크 오류: ${String(e)}`);
    } finally {
      setSummaryLoading(false);
    }
  }, [storeId, token, selectedDate]);

  const fetchSettlements = useCallback(
    async (f?: string, t?: string, status?: SettlementStatus) => {
      if (!storeId || !token) return;
      setListLoading(true);
      setListError('');
      try {
        const params = new URLSearchParams();
        if (f) params.set('from', f);
        if (t) params.set('to', t);
        if (status) params.set('status', status);
        const data = await apiJson<{ settlements: Settlement[] }>(
          `/stores/${storeId}/settlements?${params.toString()}`,
          token,
        );
        setSettlements(data.settlements);
      } catch (e) {
        setListError(e instanceof ApiError ? e.message : '조회에 실패했습니다');
      } finally {
        setListLoading(false);
      }
    },
    [storeId, token],
  );

  useEffect(() => {
    if (activeTab === 'daily') fetchSummary();
    if (activeTab === 'orders') fetchSettlements();
  }, [activeTab, fetchSummary, fetchSettlements]);

  return {
    selectedDate,
    setSelectedDate,
    selectedDateLabel,
    today,
    from,
    setFrom,
    to,
    setTo,
    summary,
    summaryLoading,
    summaryError,
    settlements,
    listLoading,
    listError,
    fetchSummary,
    fetchSettlements,
  };
}
