'use client';

import type { PartnerInquiryItem } from '@greenhub/shared';
import { Group, Paper, Stack, Text, Title } from '@mantine/core';
import { notFound } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { apiJson } from '@/lib/api';
import { isFeatureOn } from '@/lib/features';

// 소비자 앱 '입점 문의'로 들어온 농가·생산자 연락. 개인정보라 1년 뒤 지우는 것을 전제로 받는다.

export default function AdminPartnerInquiriesPage() {
  if (!isFeatureOn('partner-inquiry')) notFound();
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [items, setItems] = useState<PartnerInquiryItem[] | null>(null);

  useEffect(() => {
    if (!token) return;
    apiJson<PartnerInquiryItem[]>('/admin/partner-inquiries', token).then(setItems, () => setItems([]));
  }, [token]);

  return (
    <Stack gap="sm">
      <Title order={3}>입점 문의</Title>
      <Text size="sm" c="var(--color-text-secondary)">
        받은 날부터 1년 동안만 보관해요. 연락처는 입점 상담에만 써 주세요.
      </Text>
      {items === null ? (
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
