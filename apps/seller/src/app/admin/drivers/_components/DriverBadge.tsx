'use client';

import { Badge } from '@mantine/core';
import type { AdminDriver } from '@/hooks/useAdmin';

export function DriverBadge({ driver }: { driver: AdminDriver }) {
  const isSuspended = !!driver.suspended;

  if (isSuspended)
    return (
      <Badge color="red" variant="light" radius="xl">
        정지됨
      </Badge>
    );
  if (driver.driverApproved)
    return (
      <Badge color="green" variant="light" radius="xl">
        승인 완료
      </Badge>
    );
  return (
    <Badge color="yellow" variant="light" radius="xl">
      승인 대기
    </Badge>
  );
}
