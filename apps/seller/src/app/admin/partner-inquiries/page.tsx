'use client';

import type { PartnerInquiryItem } from '@greenhub/shared';
import { Group, Paper, Stack, Text, Title } from '@mantine/core';
import { notFound } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { apiJson } from '@/lib/api';
import { isFeatureOn } from '@/lib/features';
import { AdminFetchError } from '../_components/AdminFetchError';

// 소비자 앱 '입점 문의'로 들어온 농가·생산자 연락. 개인정보라 1년 뒤 지우는 것을 전제로 받는다.

export default function AdminPartnerInquiriesPage() {
  if (!isFeatureOn('partner-inquiry')) notFound();
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [items, setItems] = useState<PartnerInquiryItem[] | null>(null);
  // 조회 실패는 빈 목록("입점 문의가 아직 없어요")과 구분해 실패 화면 + 다시 조회로 보여 준다.
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setItems(null);
    setLoadFailed(false);
    try {
      setItems(await apiJson<PartnerInquiryItem[]>('/admin/partner-inquiries', token));
    } catch {
      setLoadFailed(true);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Stack gap="sm">
      <Title order={3}>입점 문의</Title>
      <Text size="sm" c="var(--color-text-secondary)">
        받은 날부터 1년 동안만 보관해요. 연락처는 입점 상담에만 써 주세요.
      </Text>
      {loadFailed ? (
        <AdminFetchError
          title="입점 문의를 불러오지 못했습니다."
          detail="입점 문의 조회 중 오류 발생"
          onRetry={load}
        />
      ) : items === null ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState text="입점 문의가 아직 없어요" />
      ) : (
        items.map((item) => (
          <Paper key={item.id} radius="lg" shadow="xs" p="md">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={700}>
                {item.farmName} · {item.region}
              </Text>
              <Text size="sm" c="var(--color-text-secondary)">
                {new Date(item.createdAt).toLocaleDateString('ko-KR')}
              </Text>
            </Group>
            <Text size="sm" mt={2}>
              {item.contact}
            </Text>
            <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
              {item.message}
            </Text>
          </Paper>
        ))
      )}
    </Stack>
  );
}
