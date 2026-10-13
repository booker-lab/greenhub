'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { todayKST } from '@greenhub/shared';
import { ApiError, apiJson } from '@/lib/api';
import type {
  Settlement,
  SettlementListQuery,
  SettlementListResponse,
  SettlementStatus,
  SettlementTab,
  Summary,
} from '../_constants';
import { appendSettlementPage, readSettlementPage, settlementListPath } from '../_lib';

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
  /** 서버가 같은 조건의 정산이 더 있다고 알려 준 경우만 true. */
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string;

  fetchSummary: () => Promise<void>;
  fetchSettlements: (f?: string, t?: string, status?: SettlementStatus) => Promise<void>;
  loadMoreSettlements: () => Promise<void>;
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
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  // 지금 보이는 목록의 조회 조건과 다음 위치. 응답을 반영할 때 함께 바꿔 더 보기가 다른 조건으로 이어지지 않게 한다.
  const pageRef = useRef<{ query: SettlementListQuery; nextCursor: string | null }>({
    query: {},
    nextCursor: null,
  });
  // 새 조회를 시작하면 늦게 도착한 이전 조회·더 보기 응답은 버린다.
  const listRequestRef = useRef(0);
  const loadingMoreRef = useRef(false);

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
      const requestId = ++listRequestRef.current;
      const query: SettlementListQuery = { from: f, to: t, status };
      setListLoading(true);
      setListError('');
      setLoadMoreError('');
      try {
        const data = await apiJson<SettlementListResponse>(
          settlementListPath(storeId, query),
          token,
        );
        if (requestId !== listRequestRef.current) return;
        const page = readSettlementPage(data);
        pageRef.current = { query, nextCursor: page.nextCursor };
        setSettlements(page.settlements);
        setHasMore(page.hasMore);
      } catch (e) {
        if (requestId !== listRequestRef.current) return;
        setListError(e instanceof ApiError ? e.message : '조회에 실패했습니다');
      } finally {
        if (requestId === listRequestRef.current) setListLoading(false);
      }
    },
    [storeId, token],
  );

  const loadMoreSettlements = useCallback(async () => {
    const { query, nextCursor } = pageRef.current;
    if (!storeId || !token || !nextCursor || loadingMoreRef.current) return;
    const requestId = listRequestRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const data = await apiJson<SettlementListResponse>(
        settlementListPath(storeId, query, nextCursor),
        token,
      );
      if (requestId !== listRequestRef.current) return;
      const page = readSettlementPage(data);
      pageRef.current = { query, nextCursor: page.nextCursor };
      setSettlements((current) => appendSettlementPage(current, page.settlements));
      setHasMore(page.hasMore);
    } catch (e) {
      if (requestId !== listRequestRef.current) return;
      setLoadMoreError(e instanceof ApiError ? e.message : '더 불러오지 못했습니다');
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [storeId, token]);

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
    hasMore,
    loadingMore,
    loadMoreError,
    fetchSummary,
    fetchSettlements,
    loadMoreSettlements,
  };
}
