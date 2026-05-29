'use client';

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import type { AdminBanner } from '@/hooks/useAdmin';
import {
  BANNER_KIND_LABEL,
  BANNER_STATUS_COLOR,
  BANNER_STATUS_LABEL,
  formatBannerPeriod,
  getBannerStatus,
  todayDateString,
} from '../_lib';

interface BannerListProps {
  banners: AdminBanner[];
  loading: boolean;
  deletingId: string | null;
  onEdit: (banner: AdminBanner) => void;
  onDelete: (banner: AdminBanner) => void;
}

export function BannerList({ banners, loading, deletingId, onEdit, onDelete }: BannerListProps) {
  const today = todayDateString();

  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  if (banners.length === 0) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        등록된 배너가 없습니다.
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      {banners.map((banner) => {
        const status = getBannerStatus(banner, today);
        return (
          <Paper
            key={banner.id}
            radius="md"
            px="md"
            py="sm"
            shadow="xs"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <Group justify="space-between" gap="md" align="flex-start">
              <Box style={{ minWidth: 0 }}>
                <Group gap="xs" mb={4}>
                  <Badge color={banner.kind === 'default' ? 'green' : 'gray'} variant="light">
                    {BANNER_KIND_LABEL[banner.kind]}
                  </Badge>
                  <Badge color={BANNER_STATUS_COLOR[status]} variant="light">
                    {BANNER_STATUS_LABEL[status]}
                  </Badge>
                </Group>
                <Text style={{ fontWeight: 'var(--fw-medium)' }} truncate>
                  {banner.headline || '(헤드라인 없음)'}
                </Text>
                <Text size="sm" style={{ color: 'var(--color-text-disabled)' }}>
                  {formatBannerPeriod(banner)}
                </Text>
              </Box>
              <Group gap="xs" style={{ flexShrink: 0 }}>
                <Button size="xs" variant="subtle" color="blue" onClick={() => onEdit(banner)}>
                  수정
                </Button>
                {banner.kind !== 'default' && (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    loading={deletingId === banner.id}
                    onClick={() => onDelete(banner)}
                  >
                    삭제
                  </Button>
                )}
              </Group>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
