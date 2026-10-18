'use client';

import type { AdminHiddenReview } from '@greenhub/shared';
import { Stack, Text, Title } from '@mantine/core';
import { notFound } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { ApiError, apiJson } from '@/lib/api';
import { isFeatureOn } from '@/lib/features';
import { HiddenReviewCard } from './_components/HiddenReviewCard';

// 판매자·관리자가 숨긴 후기 목록. 숨김 해제는 관리자만 이 화면에서 한다.

export default function AdminReviewsPage() {
  if (!isFeatureOn('reviews')) notFound();
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [items, setItems] = useState<AdminHiddenReview[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) return;
    apiJson<AdminHiddenReview[]>('/admin/reviews/hidden', token).then(setItems, () => setItems([]));
  }, [token]);

  const unhide = async (review: AdminHiddenReview) => {
    if (!token) return;
    if (!window.confirm('이 후기를 다시 고객에게 보이고 별점에 넣을까요?')) return;
    setBusyId(review.id);
    setErrors(({ [review.id]: _old, ...rest }) => rest);
    try {
      await apiJson(`/admin/reviews/${encodeURIComponent(review.id)}/unhide`, token, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setItems((current) => (current ? current.filter((item) => item.id !== review.id) : current));
    } catch (failure) {
      const message =
        failure instanceof ApiError ? failure.message : '처리하지 못했어요. 다시 시도해 주세요.';
      setErrors((current) => ({ ...current, [review.id]: message }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Stack gap="sm">
      <Title order={3}>숨긴 후기</Title>
      <Text size="sm" c="var(--color-text-secondary)">
        숨긴 후기는 고객 화면과 별점에서 빠져 있어요. 사유에 맞지 않게 숨긴 후기는 다시 보이게 해
        주세요.
      </Text>
      {items === null ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState text="숨긴 후기가 없어요" />
      ) : (
        items.map((review) => (
          <HiddenReviewCard
            key={review.id}
            review={review}
            busy={busyId === review.id}
            error={errors[review.id] ?? null}
            onUnhide={() => unhide(review)}
          />
        ))
      )}
    </Stack>
  );
}
