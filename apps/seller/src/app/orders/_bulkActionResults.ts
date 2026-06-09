import type { NotificationData } from '@mantine/notifications';

export type BulkActionKind = 'prepare' | 'parcelShip';

interface BulkResultOrder {
  id: string;
}

interface BulkActionSummary {
  completedIds: Set<string>;
  failed: number;
  success: number;
}

export function summarizeBulkActionResults<TOrder extends BulkResultOrder>(
  orders: TOrder[],
  results: PromiseSettledResult<unknown>[],
): BulkActionSummary {
  const completedIds = new Set(
    orders.filter((_, index) => results[index]?.status === 'fulfilled').map((order) => order.id),
  );
  const failed = results.filter((result) => result.status === 'rejected').length;

  return {
    completedIds,
    failed,
    success: results.length - failed,
  };
}

export function bulkActionNotification(
  kind: BulkActionKind,
  summary: Pick<BulkActionSummary, 'failed' | 'success'>,
): NotificationData {
  if (kind === 'prepare') {
    return {
      color: summary.failed === 0 ? 'green' : 'orange',
      title: summary.failed === 0 ? '준비 시작 완료' : '일부 주문만 처리됐습니다',
      message:
        summary.failed === 0
          ? `${summary.success}건을 준비 중으로 변경했습니다.`
          : `성공 ${summary.success}건, 실패 ${summary.failed}건`,
    };
  }

  return {
    color: summary.failed === 0 ? 'green' : 'orange',
    title: summary.failed === 0 ? '택배 발송 완료' : '일부 주문만 처리됐습니다',
    message:
      summary.failed === 0
        ? `${summary.success}건을 배송 완료로 변경했습니다.`
        : `성공 ${summary.success}건, 실패 ${summary.failed}건`,
  };
}
