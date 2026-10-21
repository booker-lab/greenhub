'use client';

import type { ManagedReview, ProductRequestItem, RestockSummaryItem } from '@greenhub/shared';
import { Container, Group, Paper, Stack, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { ApiError, apiJson } from '@/lib/api';
import { isFeatureOn } from '@/lib/features';
import { ReviewCard } from './_components/ReviewCard';
import { buildHideRequest, replaceReview, visibleReviewSummary } from './_lib';

// 고객 반응: 후기, 다음 회차 알림 신청 수, 찾는 상품 제안. 다음 회차 상품을 고를 때 참고한다.

type Tab = 'reviews' | 'restock' | 'requests';

const TABS: Array<{ value: Tab; label: string; feature: Parameters<typeof isFeatureOn>[0] }> = [
  { value: 'reviews', label: '후기', feature: 'reviews' },
  { value: 'restock', label: '알림 신청', feature: 'restock-alert' },
  { value: 'requests', label: '찾는 상품', feature: 'product-request' },
];

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

export default function ReactionsPage() {
  const tabs = TABS.filter((tab) => isFeatureOn(tab.feature));
  if (tabs.length === 0) notFound();
  const { data: session } = useSession();
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;
  const [tab, setTab] = useState<Tab>(tabs[0].value);
  const [reviews, setReviews] = useState<ManagedReview[] | null>(null);
  // 숨기기: 사유를 고르는 후기 하나, 요청 중인 후기 하나, 후기별 오류 문구.
  const [hidingId, setHidingId] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<RestockSummaryItem[] | null>(null);
  const [requests, setRequests] = useState<ProductRequestItem[] | null>(null);

  useEffect(() => {
    if (!storeId || !token) return;
    const base = `/stores/${storeId}`;
    if (tab === 'reviews' && !reviews)
      apiJson<ManagedReview[]>(`${base}/reviews`, token).then(setReviews, () => setReviews([]));
    if (tab === 'restock' && !restock)
      apiJson<RestockSummaryItem[]>(`${base}/restock-subscriptions/summary`, token).then(
        setRestock,
        () => setRestock([]),
      );
    if (tab === 'requests' && !requests)
      apiJson<ProductRequestItem[]>(`${base}/product-requests`, token).then(setRequests, () =>
        setRequests([]),
      );
  }, [storeId, token, tab, reviews, restock, requests]);

  const summary = visibleReviewSummary(reviews ?? []);

  // 판매자는 숨기기만 한다. 숨김 해제는 관리자 콘솔에서만 한다.
  const hide = async (review: ManagedReview) => {
    if (!token) return;
    const { body, error } = buildHideRequest(reasonCode, note);
    if (!body) {
      setErrors((current) => ({ ...current, [review.id]: error }));
      return;
    }
    setBusyId(review.id);
    setErrors(({ [review.id]: _old, ...rest }) => rest);
    try {
      const updated = await apiJson<ManagedReview>(
        `/reviews/${encodeURIComponent(review.id)}/hide`,
        token,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setReviews((current) => (current ? replaceReview(current, updated) : current));
      setHidingId(null);
      setReasonCode(null);
      setNote('');
    } catch (failure) {
      const message =
        failure instanceof ApiError ? failure.message : '처리하지 못했어요. 다시 시도해 주세요.';
      setErrors((current) => ({ ...current, [review.id]: message }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageShell>
      <PageHeader title="고객 반응" />
      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          {tabs.length > 1 && (
            <SegmentedTabs<Tab>
              value={tab}
              onChange={setTab}
              tabs={tabs.map(({ value, label }) => ({ key: value, label }))}
            />
          )}

          {tab === 'reviews' &&
            (reviews === null ? (
              <LoadingState />
            ) : reviews.length === 0 ? (
              <EmptyState text="아직 후기가 없어요" />
            ) : (
              <>
                <Text fw={700}>
                  {summary.average === null ? '보이는 후기 없음' : `평균 ★ ${summary.average}`} ·{' '}
                  {summary.count}개
                  {summary.hiddenCount > 0 ? ` (숨김 ${summary.hiddenCount}개 제외)` : ''}
                </Text>
                {reviews.map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    editing={hidingId === review.id}
                    reasonCode={hidingId === review.id ? reasonCode : null}
                    note={hidingId === review.id ? note : ''}
                    busy={busyId === review.id}
                    error={errors[review.id] ?? null}
                    onStartHide={() => {
                      setHidingId(review.id);
                      setReasonCode(null);
                      setNote('');
                    }}
                    onReasonChange={setReasonCode}
                    onNoteChange={setNote}
                    onCancel={() => setHidingId(null)}
                    onConfirmHide={() => hide(review)}
                  />
                ))}
              </>
            ))}

          {tab === 'restock' &&
            (restock === null ? (
              <LoadingState />
            ) : restock.length === 0 ? (
              <EmptyState text="알림 신청이 아직 없어요" />
            ) : (
              <>
                <Text size="sm" c="var(--color-text-secondary)">
                  다음 회차에 다시 올리면 좋을 상품이에요. 알림은 아직 자동으로 보내지 않아요.
                </Text>
                {restock.map((item) => (
                  <Paper key={item.productId} radius="lg" shadow="xs" p="md">
                    <Group justify="space-between">
                      <Text fw={700}>{item.productName ?? '삭제된 상품'}</Text>
                      <Text fw={800} c="var(--color-primary-dark)">
                        {item.count}명
                      </Text>
                    </Group>
                  </Paper>
                ))}
              </>
            ))}

          {tab === 'requests' &&
            (requests === null ? (
              <LoadingState />
            ) : requests.length === 0 ? (
              <EmptyState text="찾는 상품 제안이 아직 없어요" />
            ) : (
              requests.map((request) => (
                <Paper key={request.id} radius="lg" shadow="xs" p="md">
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm">{request.text}</Text>
                    <Text size="sm" c="var(--color-text-secondary)" style={{ flexShrink: 0 }}>
                      {day(request.createdAt)}
                    </Text>
                  </Group>
                </Paper>
              ))
            ))}
        </Stack>
      </Container>
    </PageShell>
  );
}
