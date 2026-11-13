'use client';

import { apiPathSegment, type CustomerFaultClosureEligibility } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import { parseCustomerFaultClosureEligibility } from '../customer-fault-closure';

/** 고객 사유 종결 API 경로. 매장·주문 id는 경로 조각으로 인코딩한다. */
export function buildCustomerFaultClosurePath(storeId: string, orderId: string): string {
  return `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/customer-fault-closure`;
}

/** 종결 요청 본문. 메모 앞뒤 공백은 지운다. */
export function buildCustomerFaultClosureRequest(memo: string): RequestInit {
  return { method: 'POST', body: JSON.stringify({ memo: memo.trim() }) };
}

/** 판정을 읽는다. 요청이 실패하거나 응답 모양이 다르면 null(버튼을 숨긴다). */
export async function loadCustomerFaultClosureEligibility(
  path: string,
  request: (path: string) => Promise<unknown>,
): Promise<CustomerFaultClosureEligibility | null> {
  try {
    return parseCustomerFaultClosureEligibility(await request(path));
  } catch {
    return null;
  }
}

export interface UseCustomerFaultClosureResult {
  eligibility: CustomerFaultClosureEligibility | null;
  submitting: boolean;
  error: string | null;
  clearError: () => void;
  /** 종결을 보내고 성공하면 true. 실패 문구는 error에 남긴다. */
  submit: (memo: string) => Promise<boolean>;
}

/**
 * 고객 사유 종결 판정 조회와 종결 요청. enabled가 false면 묻지 않는다.
 * 성공 뒤 주문 상세 재조회는 호출부(onClosed)가 맡는다.
 */
export function useCustomerFaultClosure(
  storeId: string | null,
  orderId: string,
  enabled: boolean,
): UseCustomerFaultClosureResult {
  const { data: session } = useSession();
  const token = session?.user.accessToken ?? '';
  const [eligibility, setEligibility] = useState<CustomerFaultClosureEligibility | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = storeId ? buildCustomerFaultClosurePath(storeId, orderId) : null;

  useEffect(() => {
    setEligibility(null);
    if (!enabled || !path || !token) return;
    let cancelled = false;
    void loadCustomerFaultClosureEligibility(path, (p) => apiJson(p, token)).then((result) => {
      if (!cancelled) setEligibility(result);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, path, token]);

  const submit = useCallback(
    async (memo: string) => {
      if (!path || !token) return false;
      setSubmitting(true);
      setError(null);
      try {
        await apiJson(path, token, buildCustomerFaultClosureRequest(memo));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : '주문을 종결하지 못했어요');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [path, token],
  );

  const clearError = useCallback(() => setError(null), []);

  return { eligibility, submitting, error, clearError, submit };
}
