'use client';

import { apiPathSegment, type CustomerFaultClosureEligibility } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import {
  parseCustomerFaultClosureEligibility,
  SETTLEMENT_RECONCILE_BUTTON_LABEL,
} from '../customer-fault-closure';

/** 고객 사유 종결 API 경로. 매장·주문 id는 경로 조각으로 인코딩한다. */
export function buildCustomerFaultClosurePath(storeId: string, orderId: string): string {
  return `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/customer-fault-closure`;
}

/** 종결 요청 본문. 메모 앞뒤 공백은 지운다. */
export function buildCustomerFaultClosureRequest(memo: string): RequestInit {
  return { method: 'POST', body: JSON.stringify({ memo: memo.trim() }) };
}

/**
 * 정산 다시 맞추기 요청 본문. 이미 종결한 주문에 같은 종결 요청을 보내면 서버는 메모를 쓰지 않고
 * 정산만 맞춘다(종결 기록은 첫 종결 그대로). 서버가 빈 메모를 거절하므로 고정 문구를 보낸다.
 */
export function buildSettlementReconcileRequest(): RequestInit {
  return buildCustomerFaultClosureRequest(SETTLEMENT_RECONCILE_BUTTON_LABEL);
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
  /** 종결한 주문의 정산을 다시 맞춘다. 성공하면 판정을 다시 읽고 true. */
  reconcileSettlement: () => Promise<boolean>;
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
  // 정산 다시 맞추기 뒤 판정을 다시 읽는다(주문 상태는 그대로라 다른 의존값이 바뀌지 않는다).
  const [reloadKey, setReloadKey] = useState(0);
  const path = storeId ? buildCustomerFaultClosurePath(storeId, orderId) : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey는 다시 읽기 신호다.
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
  }, [enabled, path, token, reloadKey]);

  const send = useCallback(
    async (init: RequestInit, fallbackError: string) => {
      if (!path || !token) return false;
      setSubmitting(true);
      setError(null);
      try {
        await apiJson(path, token, init);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : fallbackError);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [path, token],
  );

  const submit = useCallback(
    (memo: string) => send(buildCustomerFaultClosureRequest(memo), '주문을 종결하지 못했어요'),
    [send],
  );

  const reconcileSettlement = useCallback(async () => {
    const ok = await send(buildSettlementReconcileRequest(), '정산을 맞추지 못했어요');
    if (ok) setReloadKey((key) => key + 1);
    return ok;
  }, [send]);

  const clearError = useCallback(() => setError(null), []);

  return { eligibility, submitting, error, clearError, submit, reconcileSettlement };
}
