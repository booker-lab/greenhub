'use client';

import type {
  OperationIssueActionType,
  OperationIssueStatus,
  OperationIssueType,
  Order,
} from '@greenhub/shared';
import { Badge, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { getAllowedOperationAction, type OrderOperationIssue } from '../operation-issues';
import { Row } from './OrderRow';

const ISSUE_LABELS: Record<OperationIssueType, string> = {
  PAYMENT_LOOKUP_FAILED: '결제 조회 확인',
  AUTO_REFUND_FAILED: '환불 재시도 필요',
  CUSTOMER_NOTICE_FAILED: '고객 연락 실패',
  REDELIVERY_FAILED: '재배송 분쟁 기록',
  RETENTION_DELETE_FAILED: '보관 파기 확인',
};
const ISSUE_DESCRIPTIONS: Record<OperationIssueType, string> = {
  PAYMENT_LOOKUP_FAILED: '결제 조회 결과를 서버에서 확인 중인 기록입니다.',
  AUTO_REFUND_FAILED: '자동 환불이 완료되지 않아 서버 재시도가 필요한 기록입니다.',
  CUSTOMER_NOTICE_FAILED: '알림톡과 문자 대체 발송이 모두 실패한 연락 기록입니다.',
  REDELIVERY_FAILED: '유료 재배송까지 실패해 자동 환불 판단 없이 남긴 분쟁 기록입니다.',
  RETENTION_DELETE_FAILED: '보관 객체 파기 실패로 관리자 확인이 필요한 기록입니다.',
};
const STATUS_LABELS: Record<OperationIssueStatus, string> = {
  OPEN: '확인 필요',
  RESOLVED: '해결',
  DISMISSED: '종료',
};
const ACTION_LABELS: Record<OperationIssueActionType, string> = {
  RETRY_REFUND: '환불 재시도',
  RESEND_SMS: '문자 재발송',
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

function issueColor(issue: OrderOperationIssue) {
  if (issue.status !== 'OPEN') return 'gray';
  if (issue.severity === 'critical') return 'red';
  if (issue.severity === 'warning') return 'orange';
  return 'blue';
}

function IssueCard({
  issue,
  actionIssueId,
  onAction,
}: {
  issue: OrderOperationIssue;
  actionIssueId: string | null;
  onAction: (issue: OrderOperationIssue) => Promise<void>;
}) {
  const allowedAction = getAllowedOperationAction(issue);
  const snapshotRows = [
    ['주문 상태', issue.currentState?.orderStatus ?? issue.latestSnapshot.orderStatus],
    ['결제 상태', issue.currentState?.paymentStatus ?? issue.latestSnapshot.paymentStatus],
    ['실패 단계', issue.latestSnapshot.failureStage],
    ['알림 코드', issue.latestSnapshot.templateCode],
  ].filter((row): row is [string, string] => typeof row[1] === 'string');

  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" align="flex-start" gap="xs">
        <Stack gap={2} style={{ flex: 1 }}>
          <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}>
            {ISSUE_LABELS[issue.type]}
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {ISSUE_DESCRIPTIONS[issue.type]}
          </Text>
        </Stack>
        <Badge color={issueColor(issue)} variant="light">
          {STATUS_LABELS[issue.status]}
        </Badge>
      </Group>

      <Stack gap={4} mt="sm">
        {snapshotRows.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
        <Row label="최근 갱신" value={formatDateTime(issue.updatedAt)} />
      </Stack>

      {issue.actions.length > 0 && (
        <Stack gap={6} mt="sm">
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-disabled)',
              fontWeight: 'var(--fw-medium)',
            }}
          >
            {issue.type === 'CUSTOMER_NOTICE_FAILED' ? '고객 연락 기록' : '조치 감사 기록'}
          </Text>
          {issue.actions.map((action) => (
            <Paper
              key={`${action.actorId}-${action.performedAt}-${action.actionType}-${action.status}`}
              radius="sm"
              p="xs"
              style={{ backgroundColor: 'var(--color-surface-muted)' }}
            >
              <Group justify="space-between" gap="xs">
                <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                  {ACTION_LABELS[action.actionType]}
                </Text>
                <Badge color={action.status === 'SUCCEEDED' ? 'green' : 'red'} variant="light">
                  {action.status === 'SUCCEEDED' ? '성공' : '실패'}
                </Badge>
              </Group>
              <Text
                mt={2}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                {formatDateTime(action.performedAt)}
                {action.failureReason ? ` · ${action.failureReason}` : ''}
              </Text>
            </Paper>
          ))}
        </Stack>
      )}

      {allowedAction && (
        <>
          <Button
            mt="sm"
            fullWidth
            radius="xl"
            color={allowedAction === 'RETRY_REFUND' ? 'red' : 'blue'}
            loading={actionIssueId === issue.id}
            disabled={actionIssueId !== null && actionIssueId !== issue.id}
            onClick={() => void onAction(issue)}
          >
            {ACTION_LABELS[allowedAction]}
          </Button>
          <Text
            ta="center"
            mt={4}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            실행 직전 서버의 최신 주문·결제 상태를 다시 확인합니다.
          </Text>
        </>
      )}
    </Paper>
  );
}

export function OrderOperationsSection({
  order,
  issues,
  loading,
  actionIssueId,
  error,
  onReload,
  onAction,
}: {
  order: Order;
  issues: OrderOperationIssue[];
  loading: boolean;
  actionIssueId: string | null;
  error: string | null;
  onReload: () => Promise<void>;
  onAction: (issue: OrderOperationIssue) => Promise<void>;
}) {
  return (
    <>
      {order.deliveryHold && (
        <Paper radius="lg" shadow="xs" p="md">
          <Group justify="space-between" mb="xs">
            <Text style={{ fontWeight: 'var(--fw-medium)' }}>배송 보류 운영</Text>
            <Badge color={order.status === 'DELIVERY_HELD' ? 'red' : 'gray'} variant="light">
              {order.status === 'DELIVERY_HELD' ? '조치 중' : '해소 기록'}
            </Badge>
          </Group>
          <Stack gap={6}>
            <Row label="보류 사유" value={order.deliveryHold.reasonMessage} />
            <Row label="발생 시각" value={formatDateTime(order.deliveryHold.heldAt)} />
            <Row
              label="고객 책임"
              value={order.deliveryHold.customerResponsible ? '해당' : '해당 없음'}
            />
            <Row
              label="재배송비"
              value={
                order.deliveryHold.redeliveryFee === null
                  ? '서버 미설정'
                  : `${order.deliveryHold.redeliveryFee.toLocaleString('ko-KR')}원`
              }
            />
            <Row
              label="다음 고객 연락"
              value={
                order.deliveryHold.nextContactAt
                  ? formatDateTime(order.deliveryHold.nextContactAt)
                  : '서버 미설정'
              }
            />
            <Row
              label="새 배송 일정"
              value={
                order.deliveryHold.nextDeliveryAt
                  ? formatDateTime(order.deliveryHold.nextDeliveryAt)
                  : '서버 미설정'
              }
              highlight
            />
          </Stack>
          <Text
            mt="sm"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            재배송비 결제 생성은 주문자 전용이며, 셀러는 서버에 기록된 금액과 일정만 확인합니다.
          </Text>
        </Paper>
      )}

      <Paper radius="lg" shadow="xs" p="md">
        <Group justify="space-between" mb="sm">
          <Stack gap={2}>
            <Text style={{ fontWeight: 'var(--fw-medium)' }}>연락·환불·분쟁 기록</Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              서버가 반환한 운영 기록과 허용 조치만 표시합니다.
            </Text>
          </Stack>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            loading={loading}
            disabled={actionIssueId !== null}
            onClick={() => void onReload()}
          >
            새로고침
          </Button>
        </Group>

        {error && (
          <Text mb="sm" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
            {error}
          </Text>
        )}
        {!loading && issues.length === 0 && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            이 주문에 연결된 운영 기록이 없습니다.
          </Text>
        )}
        {issues.length > 0 && (
          <Stack gap="sm">
            {issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                actionIssueId={actionIssueId}
                onAction={onAction}
              />
            ))}
          </Stack>
        )}
      </Paper>
    </>
  );
}
