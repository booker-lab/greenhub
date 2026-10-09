'use client';

import { Alert, Badge, Button, Container, Group, Paper, Stack, Text } from '@mantine/core';
import { ChevronRight, RefreshCcw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  ISSUE_DESCRIPTIONS,
  ISSUE_LABELS,
  type OrderOperationIssue,
} from '@/app/orders/[id]/operation-issues';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { useStoreOperationIssues } from '@/hooks/useStoreOperationIssues';

const SEVERITY_META = {
  critical: { label: '긴급', color: 'red' },
  warning: { label: '주의', color: 'yellow' },
  info: { label: '참고', color: 'gray' },
} as const;

const STATUS_LABELS = { OPEN: '확인 필요', RESOLVED: '해결', DISMISSED: '종료' } as const;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

function IssueRow({ issue }: { issue: OrderOperationIssue }) {
  const severity = SEVERITY_META[issue.severity];
  const open = issue.status === 'OPEN';
  return (
    <Paper
      radius="lg"
      shadow="xs"
      p="md"
      style={
        open && issue.severity === 'critical'
          ? { border: '1px solid var(--color-danger)' }
          : undefined
      }
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Group gap={6}>
            <Badge color={open ? severity.color : 'gray'} variant="light">
              {open ? severity.label : STATUS_LABELS[issue.status]}
            </Badge>
            <Text style={{ fontWeight: 'var(--fw-bold)' }}>{ISSUE_LABELS[issue.type]}</Text>
          </Group>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {ISSUE_DESCRIPTIONS[issue.type]}
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {formatDateTime(issue.updatedAt)}
          </Text>
        </Stack>
        <Button
          component={Link}
          href={`/orders/${encodeURIComponent(issue.orderId)}`}
          size="xs"
          variant="light"
          rightSection={<ChevronRight size={14} />}
          style={{ flexShrink: 0 }}
        >
          주문 보기
        </Button>
      </Group>
    </Paper>
  );
}

type IssueTab = 'OPEN' | 'ALL';

export default function OperationsPage() {
  const { issues, openIssues, loading, error, hasLoaded, reload } = useStoreOperationIssues();
  const [tab, setTab] = useState<IssueTab>('OPEN');
  const visible = tab === 'OPEN' ? openIssues : issues;

  return (
    <PageShell>
      <PageHeader
        title="운영 확인"
        right={
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={() => void reload()}
            loading={loading}
            aria-label="운영 기록 다시 조회"
          >
            <RefreshCcw size={16} />
          </Button>
        }
      />
      <Container size="sm" px="md" py="md">
        <Stack gap="md">
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            결제·환불·고객 연락·배송 사진에서 자동으로 끝내지 못한 일을 모아 보여 줘요. 조치(환불
            재시도·문자 재발송)는 각 주문 화면에서 합니다.
          </Text>
          <SegmentedTabs<IssueTab>
            value={tab}
            onChange={setTab}
            tabs={[
              {
                key: 'OPEN',
                label: '확인 필요',
                count: openIssues.length,
                badgeColor: openIssues.length > 0 ? 'red' : 'gray',
              },
              { key: 'ALL', label: '전체', count: issues.length },
            ]}
          />
          {error && (
            <Alert color="red" title="운영 기록을 불러오지 못했습니다" role="alert">
              {error}
            </Alert>
          )}
          {loading && !hasLoaded && <LoadingState />}
          {hasLoaded && visible.length === 0 && (
            <EmptyState
              icon={<ShieldCheck size={48} strokeWidth={1.5} />}
              text={tab === 'OPEN' ? '확인할 운영 기록이 없어요' : '운영 기록이 없어요'}
            />
          )}
          {visible.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </Stack>
      </Container>
    </PageShell>
  );
}
