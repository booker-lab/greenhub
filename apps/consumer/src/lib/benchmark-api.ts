'use client';

import type {
  CreateReviewRequest,
  PartnerInquiryRequest,
  ProductReviewsResponse,
  ReviewPublic,
  ReviewSummary,
} from '@greenhub/shared';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { sharedRequest } from '@/lib/shared-request';

// 팔도감 벤치마킹 비교 기능의 API 호출. 화면은 기능 토글이 켜졌을 때만 이 함수들을 부른다.

export class BenchmarkApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BenchmarkApiError';
  }
}

async function request<T>(
  path: string,
  init: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const message = Array.isArray(payload?.message)
      ? String(payload?.message[0])
      : typeof payload?.message === 'string'
        ? payload.message
        : `요청을 처리하지 못했어요 (${res.status})`;
    throw new BenchmarkApiError(message, res.status);
  }
  return (await res.json().catch(() => null)) as T;
}

const enc = encodeURIComponent;
const SHARE_MS = 30_000;

// ── 후기 ──
export function fetchStoreReviewStats(storeId: string): Promise<Record<string, ReviewSummary>> {
  return sharedRequest(
    `review-stats:${storeId}`,
    () => request<Record<string, ReviewSummary>>(`/stores/${enc(storeId)}/review-stats`),
    { ttlMs: SHARE_MS },
  );
}

export function fetchProductReviews(productId: string): Promise<ProductReviewsResponse> {
  // 상세 위쪽 별점과 아래 후기 칸이 같은 응답을 함께 쓴다.
  return sharedRequest(
    `product-reviews:${productId}`,
    () => request<ProductReviewsResponse>(`/products/${enc(productId)}/reviews`),
    { ttlMs: SHARE_MS },
  );
}

export function fetchOrderReviews(orderId: string, token: string): Promise<ReviewPublic[]> {
  return request<ReviewPublic[]>(`/orders/${enc(orderId)}/reviews`, { token });
}

export function createReview(
  orderId: string,
  token: string,
  body: CreateReviewRequest,
): Promise<ReviewPublic> {
  return request<ReviewPublic>(`/orders/${enc(orderId)}/reviews`, { method: 'POST', token, body });
}

// ── 다음 회차 알림 ──
export function fetchRestockSubscriptions(token: string): Promise<string[]> {
  return request<string[]>('/me/restock-subscriptions', { token });
}

export function setRestockSubscription(token: string, productId: string, on: boolean): Promise<unknown> {
  return request(`/me/restock-subscriptions/${enc(productId)}`, {
    method: on ? 'PUT' : 'DELETE',
    token,
  });
}

// ── 찾는 상품·입점 문의 ──
export function createProductRequest(storeId: string, text: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/stores/${enc(storeId)}/product-requests`, {
    method: 'POST',
    body: { text },
  });
}

export function createPartnerInquiry(body: PartnerInquiryRequest): Promise<{ id: string }> {
  return request<{ id: string }>('/partner-inquiries', { method: 'POST', body });
}
