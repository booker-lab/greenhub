'use client';

import { Alert, Badge, Button, Container, Group, Paper, Stack, Text } from '@mantine/core';
import { CheckCircle2, ChevronRight, RefreshCcw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ISSUE_DESCRIPTIONS, ISSUE_LABELS } from '@/app/orders/[id]/operation-issues';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { useStoreOperationIssues } from '@/hooks/useStoreOperationIssues';
import {
  canManuallyResolve,
  manualResolverLabel,
  type StoreOperationIssue,
} from './manual-resolve';
import { ResolveIssueModal } from './ResolveIssueModal';

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

function IssueRow({
  issue,
  canResolve,
  onResolve,
}: {
  issue: StoreOperationIssue;
  canResolve: boolean;
  onResolve: (issue: StoreOperationIssue) => void;
}) {
  const severity = SEVERITY_META[issue.severity];
  const open = issue.status === 'OPEN';
  const resolution = issue.resolution;
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
          {resolution && (
            <Stack
              gap={2}
              mt={4}
              p="xs"
              style={{
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--color-surface-muted)',
              }}
            >
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                {manualResolverLabel(resolution)}가 직접 닫았어요 ·{' '}
                {formatDateTime(resolution.resolvedAt)}
              </Text>
              <Text style={{ fontSize: 'var(--font-size-sm)', wordBreak: 'break-word' }}>
                {resolution.memo}
              </Text>
            </Stack>
          )}
        </Stack>
        <Stack gap={6} align="flex-end" style={{ flexShrink: 0 }}>
          <Button
            component={Link}
            href={`/orders/${encodeURIComponent(issue.orderId)}`}
            size="xs"
            variant="light"
            rightSection={<ChevronRight size={14} />}
          >
            주문 보기
          </Button>
          {canResolve && (
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<CheckCircle2 size={14} />}
              onClick={() => onResolve(issue)}
            >
              해결로 닫기
            </Button>
          )}
        </Stack>
      </Group>
    </Paper>
  );
}

type IssueTab = 'OPEN' | 'ALL';

export default function OperationsPage() {
  const { issues, openIssues, loading, error, hasLoaded, reload, resolveIssue, role } =
    useStoreOperationIssues();
  const [tab, setTab] = useState<IssueTab>('OPEN');
  const [resolving, setResolving] = useState<StoreOperationIssue | null>(null);
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
            재시도·문자 재발송)는 각 주문 화면에서 하고, 직접 처리를 마친 기록은 메모를 남기고
            &quot;해결로 닫기&quot;로 닫아 주세요.
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
            <IssueRow
              key={issue.id}
              issue={issue}
              canResolve={canManuallyResolve(issue, role)}
              onResolve={setResolving}
            />
          ))}
        </Stack>
      </Container>
      <ResolveIssueModal
        issue={resolving}
        onClose={() => setResolving(null)}
        onConfirm={resolveIssue}
      />
    </PageShell>
  );
}
