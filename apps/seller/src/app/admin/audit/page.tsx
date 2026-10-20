'use client';

import { Badge, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { apiJson } from '@/lib/api';
import {
  type AdminAuditLog,
  actionLabel,
  describeChanges,
  formatLoggedAt,
  targetLabel,
} from './_lib';

// 어드민이 수수료·정지·환불·지급·배너를 바꾼 기록. 최근 100건만 읽기 전용으로 보여 준다.

export default function AdminAuditPage() {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const myId = session?.user.id;
  const [logs, setLogs] = useState<AdminAuditLog[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiJson<AdminAuditLog[]>('/admin/audit-logs', token).then(
      (items) => {
        setLogs(items);
        setFailed(false);
      },
      () => {
        setLogs([]);
        setFailed(true);
      },
    );
  }, [token]);

  return (
    <Stack gap="sm">
      <Title order={3}>행동 기록</Title>
      <Text size="sm" c="var(--color-text-secondary)">
        관리자가 바꾼 내용을 최근 100건까지 보여 줘요. 기록은 고칠 수 없어요.
      </Text>
      {logs === null ? (
        <LoadingState />
      ) : failed ? (
        <EmptyState text="기록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요." />
      ) : logs.length === 0 ? (
        <EmptyState text="아직 기록이 없어요" />
      ) : (
        logs.map((log) => (
          <Paper key={log.id} radius="lg" shadow="xs" p="md">
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Group gap="xs" wrap="nowrap">
                <Badge variant="light" color="gray">
                  {actionLabel(log.action)}
                </Badge>
                <Text size="sm" fw={600}>
                  {targetLabel(log)}
                </Text>
              </Group>
              <Text size="xs" c="var(--color-text-secondary)" style={{ flexShrink: 0 }}>
                {formatLoggedAt(log.createdAt)}
              </Text>
            </Group>
            {describeChanges(log).map((line) => (
              <Text key={line} size="sm" mt={4}>
                {line}
              </Text>
            ))}
            {log.reason && (
              <Text size="sm" mt={4} c="var(--color-text-secondary)">
                사유: {log.reason}
              </Text>
            )}
            <Text size="xs" mt={4} c="var(--color-text-disabled)">
              처리: {log.actorId === myId ? '나' : log.actorId.slice(0, 8)}
            </Text>
          </Paper>
        ))
      )}
    </Stack>
  );
}
