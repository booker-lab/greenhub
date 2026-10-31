'use client';

import { Badge } from '@greenhub/ui/components/badge';
import type { AdminDriver } from '@/hooks/useAdmin';

// ① 외형 유지(UI 교체 P2b): Mantine Badge radius="xl"(32px) 모서리를 그대로 둔다.
export function DriverBadge({ driver }: { driver: AdminDriver }) {
  if (driver.suspended)
    return (
      <Badge variant="destructive" className="rounded-[32px]">
        정지됨
      </Badge>
    );
  if (driver.driverApproved)
    return (
      <Badge variant="light" className="rounded-[32px]">
        승인 완료
      </Badge>
    );
  return (
    <Badge variant="warning" className="rounded-[32px]">
      승인 대기
    </Badge>
  );
}
