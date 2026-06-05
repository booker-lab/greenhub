'use client';

import {
  type OrderStatus,
  STATUS_COLOR as SETTLEMENT_STATUS_COLOR,
  STATUS_LABEL as SETTLEMENT_STATUS_LABEL,
  type SettlementStatus,
} from '@greenhub/shared';
import { Badge, Box, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useAdminPlatformConfig } from '@/hooks/useAdmin';
import { useAdminStoreDetail } from '@/hooks/useAdminStoreDetail';
import {
  getStatusColor as getOrderStatusColor,
  STATUS_LABEL as ORDER_STATUS_LABEL,
} from '../../orders/_lib';
import {
  formatRate,
  STATUS_COLOR as STORE_STATUS_COLOR,
  STATUS_LABEL as STORE_STATUS_LABEL,
} from '../_lib';

function toKRW(value: number): string {
  return `₩${value.toLocaleString('ko-KR')}`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Paper radius="md" p="md" shadow="xs" style={{ border: '1px solid var(--color-border)' }}>
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
        {label}
      </Text>
      <Text mt={4} style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--fw-semibold)' }}>
        {value}
      </Text>
    </Paper>
  );
}

function StatusBuckets({
  title,
  buckets,
  kind,
}: {
  title: string;
  buckets: Record<string, number>;
  kind: 'orders' | 'settlements';
}) {
  const entries = Object.entries(buckets);
  const getLabel = (status: string) =>
    kind === 'orders'
      ? (ORDER_STATUS_LABEL[status as OrderStatus] ?? status)
      : (SETTLEMENT_STATUS_LABEL[status as SettlementStatus] ?? status);
  const getColor = (status: string) =>
    kind === 'orders'
      ? getOrderStatusColor(status as OrderStatus)
      : (SETTLEMENT_STATUS_COLOR[status as SettlementStatus] ?? 'gray');

  return (
    <Paper radius="md" p="md" shadow="xs" style={{ border: '1px solid var(--color-border)' }}>
      <Title order={5} mb="sm">
        {title}
      </Title>
      {entries.length === 0 ? (
        <Text style={{ color: 'var(--color-text-disabled)' }}>기록이 없습니다.</Text>
      ) : (
        <Stack gap="xs">
          {entries.map(([status, count]) => (
            <Group key={status} justify="space-between">
              <Badge color={getColor(status)} variant="light" radius="xl">
                {getLabel(status)}
              </Badge>
              <Text style={{ color: 'var(--color-text-secondary)' }}>{count}건</Text>
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

export default function AdminStoreDetailClient() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const storeId = params.id;
  const backHref = searchParams.get('back') || '/admin/stores';
  const { summary, loading, error, reload } = useAdminStoreDetail(storeId);
  const { config } = useAdminPlatformConfig();

  return (
    <Box>
      <Group justify="space-between" align="flex-start" mb="md">
        <Box>
          <Button component={Link} href={backHref} size="xs" variant="subtle" color="gray" mb="xs">
            목록으로
          </Button>
          <Title order={4}>판매자 상세</Title>
        </Box>
        <Button size="xs" variant="light" color="gray" onClick={reload} disabled={loading}>
          새로고침
        </Button>
      </Group>

      {loading && (
        <Paper radius="md" p="xl" shadow="xs" style={{ border: '1px solid var(--color-border)' }}>
          <Text ta="center" style={{ color: 'var(--color-text-disabled)' }}>
            불러오는 중...
          </Text>
        </Paper>
      )}

      {!loading && error && (
        <Paper radius="md" p="xl" shadow="xs" style={{ border: '1px solid var(--color-border)' }}>
          <Text ta="center" style={{ color: 'var(--color-danger)' }}>
            {error}
          </Text>
        </Paper>
      )}

      {!loading && summary && (
        <Stack gap="md">
          <Paper radius="md" p="md" shadow="xs" style={{ border: '1px solid var(--color-border)' }}>
            <Group justify="space-between" align="flex-start">
              <Box>
                <Title order={5}>{summary.store.name || '(미설정)'}</Title>
                <Text
                  mt={4}
                  ff="monospace"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {summary.store.id}
                </Text>
              </Box>
              <Badge color={STORE_STATUS_COLOR[summary.store.status] ?? 'gray'} variant="light">
                {STORE_STATUS_LABEL[summary.store.status] ?? summary.store.status}
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 3 }} mt="md" spacing="sm">
              <StatCard
                label="수수료율"
                value={formatRate(summary.store.commissionRate, config.defaultCommissionRate)}
              />
              <StatCard label="담당자" value={summary.owner?.name || '-'} />
              <StatCard label="이메일" value={summary.owner?.email || '-'} />
            </SimpleGrid>
          </Paper>

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
            <StatCard label="주문 수" value={`${summary.orders.totalCount}건`} />
            <StatCard label="주문 금액" value={toKRW(summary.orders.totalAmount)} />
            <StatCard label="플랫폼 수수료" value={toKRW(summary.settlements.platformFee)} />
            <StatCard label="실지급 합계" value={toKRW(summary.settlements.netAmount)} />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <StatusBuckets title="주문 상태" buckets={summary.orders.byStatus} kind="orders" />
            <StatusBuckets
              title="정산 상태"
              buckets={summary.settlements.byStatus}
              kind="settlements"
            />
          </SimpleGrid>
        </Stack>
      )}
    </Box>
  );
}
