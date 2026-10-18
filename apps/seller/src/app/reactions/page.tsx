'use client';

import type { ProductRequestItem, RestockSummaryItem, ReviewPublic } from '@greenhub/shared';
import { Container, Group, Paper, Stack, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { apiJson } from '@/lib/api';
import { isFeatureOn } from '@/lib/features';

// 고객 반응: 후기, 다음 회차 알림 신청 수, 찾는 상품 제안. 다음 회차 상품을 고를 때 참고한다.

type Tab = 'reviews' | 'restock' | 'requests';

const TABS: Array<{ value: Tab; label: string; feature: Parameters<typeof isFeatureOn>[0] }> = [
  { value: 'reviews', label: '후기', feature: 'reviews' },
  { value: 'restock', label: '알림 신청', feature: 'restock-alert' },
  { value: 'requests', label: '찾는 상품', feature: 'product-request' },
];

const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

export default function ReactionsPage() {
  const tabs = TABS.filter((tab) => isFeatureOn(tab.feature));
  if (tabs.length === 0) notFound();
  const { data: session } = useSession();
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;
  const [tab, setTab] = useState<Tab>(tabs[0].value);
  const [reviews, setReviews] = useState<ReviewPublic[] | null>(null);
  const [restock, setRestock] = useState<RestockSummaryItem[] | null>(null);
  const [requests, setRequests] = useState<ProductRequestItem[] | null>(null);

  useEffect(() => {
    if (!storeId || !token) return;
    const base = `/stores/${storeId}`;
    if (tab === 'reviews' && !reviews)
      apiJson<ReviewPublic[]>(`${base}/reviews`, token).then(setReviews, () => setReviews([]));
    if (tab === 'restock' && !restock)
      apiJson<RestockSummaryItem[]>(`${base}/restock-subscriptions/summary`, token).then(setRestock, () =>
        setRestock([]),
      );
    if (tab === 'requests' && !requests)
      apiJson<ProductRequestItem[]>(`${base}/product-requests`, token).then(setRequests, () => setRequests([]));
  }, [storeId, token, tab, reviews, restock, requests]);

  const average =
    reviews && reviews.length > 0
      ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10
      : null;

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
                  평균 ★ {average} · {reviews.length}개
                </Text>
                {reviews.map((review) => (
                  <Paper key={review.id} radius="lg" shadow="xs" p="md">
                    <Group justify="space-between">
                      <Text fw={700} c="var(--color-primary-dark)">
                        {'★'.repeat(review.rating)}
                      </Text>
                      <Text size="sm" c="var(--color-text-secondary)">
                        {review.authorName} · {day(review.createdAt)}
                      </Text>
                    </Group>
                    <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
                      {review.text}
                    </Text>
                  </Paper>
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
