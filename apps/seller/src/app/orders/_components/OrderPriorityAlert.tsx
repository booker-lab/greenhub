'use client';

import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { Bell } from 'lucide-react';
import type { OrderAlertMeta, OrderGroup } from '../_constants';

interface OrderPriorityAlertProps {
  meta: OrderAlertMeta;
  onOpenActionRequired: () => void;
  onOpenOverdue: (tab: OrderGroup) => void;
}

export function OrderPriorityAlert({
  meta,
  onOpenActionRequired,
  onOpenOverdue,
}: OrderPriorityAlertProps) {
  if (meta.actionRequiredCount === 0 && meta.overdueCount === 0) return null;

  return (
    <Alert color="orange" radius="md" icon={<Bell size={18} aria-hidden="true" />}>
      <Stack gap="xs">
        <div>
          <Text fw={700}>먼저 확인할 주문이 있습니다</Text>
          <Text size="sm" c="dimmed">
            {[
              meta.actionRequiredCount > 0 ? `처리 필요 ${meta.actionRequiredCount}건` : null,
              meta.overdueCount > 0 ? `지연 ${meta.overdueCount}건` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </div>
        <Group gap="xs">
          {meta.actionRequiredCount > 0 && (
            <Button size="xs" radius="xl" color="orange" onClick={onOpenActionRequired}>
              처리 필요 보기
            </Button>
          )}
          {meta.overdueCount > 0 && meta.overdueTab && (
            <Button
              size="xs"
              radius="xl"
              color="red"
              variant="light"
              onClick={() => onOpenOverdue(meta.overdueTab ?? 'ACTION_REQUIRED')}
            >
              지연 주문 보기
            </Button>
          )}
        </Group>
      </Stack>
    </Alert>
  );
}
