'use client';

import { Container, Stack } from '@mantine/core';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState } from '@/components/StateViews';
import { OrderPriorityAlert } from '../../orders/_components/OrderPriorityAlert';
import { GROUP_TABS } from '../../orders/_constants';

const EMPTY_META = {
  actionRequiredCount: 0,
  overdueCount: 0,
  overdueTab: null,
} as const;

const ALERT_META = {
  actionRequiredCount: 2,
  overdueCount: 3,
  overdueTab: 'WAITING',
} as const;

export function OrderPriorityAlertFixture() {
  return (
    <Container size="sm" py="md">
      <Stack gap="md">
        <section aria-label="빈 알림 상태">
          <OrderPriorityAlert
            meta={EMPTY_META}
            onOpenActionRequired={() => undefined}
            onOpenOverdue={() => undefined}
          />
          <SegmentedTabs tabs={GROUP_TABS} value="ACTION_REQUIRED" onChange={() => undefined} />
          <EmptyState text="현재 해당 주문이 없습니다" />
        </section>

        <section aria-label="알림 노출 상태">
          <OrderPriorityAlert
            meta={ALERT_META}
            onOpenActionRequired={() => undefined}
            onOpenOverdue={() => undefined}
          />
        </section>
      </Stack>
    </Container>
  );
}
