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

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  useEffect(() => {
    setSelectedDateLabel(
      new Date(`${selectedDate}T00:00:00`).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }),
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
