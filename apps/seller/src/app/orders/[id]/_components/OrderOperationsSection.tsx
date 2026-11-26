'use client';

import {
  isNonRedeliverableHoldReason,
  type OperationIssueActionType,
  type OperationIssueStatus,
  type Order,
} from '@greenhub/shared';
import { StatusDot } from '@greenhub/ui/components/status-dot';
import { LoadingButton } from '../../../../components/Button';
import { STATUS_LABEL } from '../../_constants';
import { HOLD_REASON_LABEL } from '../delivery-hold-form';
import {
  describeIssue,
  getAllowedOperationAction,
  ISSUE_LABELS,
  type OrderOperationIssue,
} from '../operation-issues';
import { Row } from './OrderRow';

// ② 디자인 방향(D2·2026-11-01 결정): 카드는 그림자·바깥 테두리 없이 흰 면. 흰 카드 안의 기록 카드는 테두리 대신
// --frame 면, 그 안 조치 기록은 흰 면이다. 상태는 점 + 글자(StatusDot). 나머지는 ① 값(radius·Group·Stack·Text) 유지.
const TEXT = 'm-0 p-0 text-base font-normal';
const PAPER = 'block rounded-[16px] bg-card';
const GROUP_BETWEEN = 'flex flex-row flex-wrap items-center justify-between gap-4';

// 상태는 배지 면 대신 점 + 글자(2026-11-01 결정): 문제(빨강)=problem, 끝남(회색)=done, 나머지=검정.
const TONE: Record<string, 'default' | 'problem' | 'done'> = {
  brand: 'default',
  red: 'problem',
  yellow: 'default',
  gray: 'done',
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

// 상품 파손 보류는 다시 배송하지 않는다. 재배송 준비 버튼 대신 취소·환불로 마무리하도록 알린다.
export const NON_REDELIVERABLE_HOLD_BANNER =
  '상품 파손 · 재배송 불가 — 상품을 돌려받은 뒤 주문 취소·환불을 진행해 주세요';

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

function getRedeliveryPaymentPresentation(payment: Order['redeliveryPayment']) {
  if (!payment?.required) return null;

  if (payment.requiresRecovery || ['FAILED', 'REFUNDED', 'MISMATCHED'].includes(payment.status)) {
    return {
      label: '운영 확인 필요',
      description: '재배송비 결제 상태를 운영팀에서 확인해야 합니다.',
      color: 'red',
    };
  }

  if (payment.status === 'PAID' && payment.paid) {
    return {
      label: '재배송비 결제 완료',
      description: '재배송비 결제가 끝난 것을 확인했습니다.',
      color: 'brand',
    };
  }

  if (payment.status === 'PENDING') {
    return {
      label: '재배송비 결제 대기',
      description: '주문자의 재배송비 결제를 기다리는 중입니다.',
      color: 'yellow',
    };
  }

  return {
    label: '운영 확인 필요',
    description: '재배송비 결제 정보를 확인해야 합니다.',
    color: 'red',
  };
}

function RedeliveryPaymentPanel({ payment }: { payment: Order['redeliveryPayment'] }) {
  const presentation = getRedeliveryPaymentPresentation(payment);
  if (!presentation) return null;

  return (
    <div className={`${PAPER} p-4`} data-testid="seller-redelivery-payment">
      <div className={`${GROUP_BETWEEN} mb-2.5`}>
        <p className={TEXT} style={{ fontWeight: 'var(--fw-bold)' }}>
          재배송비 결제
        </p>
        <StatusDot tone={TONE[presentation.color]}>{presentation.label}</StatusDot>
      </div>
      <p
        className={TEXT}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
      >
        {presentation.description}
      </p>
    </div>
  );
}

function issueColor(issue: OrderOperationIssue) {
  if (issue.status !== 'OPEN') return 'gray';
  if (issue.severity === 'critical') return 'red';
  if (issue.severity === 'warning') return 'yellow';
  return 'gray';
}

// 결제 상태 이름(packages/shared PaymentStatus). 운영 기록은 값을 글자로 싣기 때문에 표에 없는 값도 올 수 있다.
const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: '결제 대기',
  PAID: '결제 완료',
  FAILED: '결제 실패',
  CANCELLED: '결제 취소',
};

/** 상태 값을 한국어 이름으로 바꾼다. 표에 없는 값은 "확인 안 됨"(known: false → 회색). */
function readableState(
  labels: Readonly<Record<string, string>>,
  value: string,
): { value: string; known: boolean } {
  const label = Object.hasOwn(labels, value) ? labels[value] : undefined;
  return label ? { value: label, known: true } : { value: '확인 안 됨', known: false };
}

function IssueCard({
  issue,
  role,
  actionIssueId,
  onAction,
}: {
  issue: OrderOperationIssue;
  role: string | null;
  actionIssueId: string | null;
  onAction: (issue: OrderOperationIssue) => Promise<void>;
}) {
  const allowedAction = getAllowedOperationAction(issue);
  const actionVariant = allowedAction === 'RETRY_REFUND' ? 'destructive' : 'default';
  const actionLoading = actionIssueId === issue.id;
  const orderStatus = issue.currentState?.orderStatus ?? issue.latestSnapshot.orderStatus;
  const paymentStatus = issue.currentState?.paymentStatus ?? issue.latestSnapshot.paymentStatus;
  // 주문·결제 상태는 영어 값 대신 한국어 이름으로 쓴다. 표에 없는 값은 회색 "확인 안 됨"이다.
  const stateRows: { label: string; value: string; known: boolean }[] = [];
  if (typeof orderStatus === 'string') {
    stateRows.push({ label: '주문 상태', ...readableState(STATUS_LABEL, orderStatus) });
  }
  if (typeof paymentStatus === 'string') {
    stateRows.push({ label: '결제 상태', ...readableState(PAYMENT_STATUS_LABEL, paymentStatus) });
  }
  const snapshotRows = [
    ['실패 단계', issue.latestSnapshot.failureStage],
    ['알림 코드', issue.latestSnapshot.templateCode],
    ['결제사 상태', issue.latestSnapshot.providerStatus],
    ['결제사 알림', issue.latestSnapshot.providerEvent],
    ['정산 상태', issue.latestSnapshot.settlementStatus],
  ].filter((row): row is [string, string] => typeof row[1] === 'string');

  return (
    <div className="block rounded-[8px] p-3" style={{ backgroundColor: 'var(--frame)' }}>
      <div className="flex flex-row flex-wrap items-start justify-between gap-2.5">
        <div className="flex flex-col gap-0.5" style={{ flex: 1 }}>
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}
          >
            {ISSUE_LABELS[issue.type]}
          </p>
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            {describeIssue(issue.type, role)}
          </p>
        </div>
        <StatusDot tone={TONE[issueColor(issue)]}>{STATUS_LABELS[issue.status]}</StatusDot>
      </div>

      <div className="mt-3 flex flex-col gap-1">
        {stateRows.map((row) => (
          <Row key={row.label} label={row.label} value={row.value} highlight={row.known} />
        ))}
        {snapshotRows.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
        <Row label="최근 갱신" value={formatDateTime(issue.updatedAt)} />
      </div>

      {issue.actions.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              fontWeight: 'var(--fw-bold)',
            }}
          >
            {issue.type === 'CUSTOMER_NOTICE_FAILED' ? '고객 연락 기록' : '조치 감사 기록'}
          </p>
          {issue.actions.map((action) => (
            <div
              key={`${action.actorId}-${action.performedAt}-${action.actionType}-${action.status}`}
              className="block rounded-[4px] bg-card p-2.5"
              style={{ backgroundColor: 'var(--color-surface-muted)' }}
            >
              <div className="flex flex-row flex-wrap items-center justify-between gap-2.5">
                <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                  {ACTION_LABELS[action.actionType]}
                </p>
                <StatusDot tone={action.status === 'SUCCEEDED' ? 'done' : 'problem'}>
                  {action.status === 'SUCCEEDED' ? '성공' : '실패'}
                </StatusDot>
              </div>
              <p
                className={`${TEXT} mt-0.5`}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                {formatDateTime(action.performedAt)}
                {action.failureReason ? ` · ${action.failureReason}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {allowedAction && (
        <>
          <LoadingButton
            measured
            variant={actionVariant}
            className="mt-3 w-full"
            loading={actionLoading}
            disabled={actionIssueId !== null}
            onClick={() => void onAction(issue)}
          >
            {ACTION_LABELS[allowedAction]}
          </LoadingButton>
          <p
            className={`${TEXT} text-center mt-1`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            누르면 주문·결제 상태를 한 번 더 확인한 뒤 실행합니다.
          </p>
        </>
      )}
    </div>
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
  role,
}: {
  order: Order;
  issues: OrderOperationIssue[];
  loading: boolean;
  actionIssueId: string | null;
  error: string | null;
  onReload: () => Promise<void>;
  onAction: (issue: OrderOperationIssue) => Promise<void>;
  /** 로그인한 역할. 관리자만 닫는 기록의 설명 문장을 역할에 맞게 고른다. */
  role: string | null;
}) {
  return (
    <>
      <RedeliveryPaymentPanel payment={order.redeliveryPayment} />

      {order.deliveryHold && (
        <div className={`${PAPER} p-4`}>
          <div className={`${GROUP_BETWEEN} mb-2.5`}>
            <p className={TEXT} style={{ fontWeight: 'var(--fw-bold)' }}>
              배송 보류 운영
            </p>
            <StatusDot tone={order.status === 'DELIVERY_HELD' ? 'problem' : 'done'}>
              {order.status === 'DELIVERY_HELD' ? '조치 중' : '해소 기록'}
            </StatusDot>
          </div>
          {order.status === 'DELIVERY_HELD' &&
            isNonRedeliverableHoldReason(order.deliveryHold.reasonCode) && (
              <p
                className={`${TEXT} mb-2.5`}
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-danger)',
                }}
                data-testid="seller-non-redeliverable-hold"
              >
                {NON_REDELIVERABLE_HOLD_BANNER}
              </p>
            )}
          <div className="flex flex-col gap-1.5">
            <Row
              label="보류 유형"
              value={
                HOLD_REASON_LABEL[order.deliveryHold.reasonCode] ?? order.deliveryHold.reasonCode
              }
            />
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
                  ? '아직 정해지지 않음'
                  : `${order.deliveryHold.redeliveryFee.toLocaleString('ko-KR')}원`
              }
            />
            <Row
              label="다음 고객 연락"
              value={
                order.deliveryHold.nextContactAt
                  ? formatDateTime(order.deliveryHold.nextContactAt)
                  : '아직 정해지지 않음'
              }
            />
            <Row
              label="새 배송 일정"
              value={
                order.deliveryHold.nextDeliveryAt
                  ? formatDateTime(order.deliveryHold.nextDeliveryAt)
                  : '아직 정해지지 않음'
              }
              highlight
            />
          </div>
          <p
            className={`${TEXT} mt-3`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            재배송비는 주문자가 결제합니다. 판매자는 정해진 금액과 일정만 확인할 수 있습니다.
          </p>
        </div>
      )}

      <div className={`${PAPER} p-4`}>
        <div className={`${GROUP_BETWEEN} mb-3`}>
          <div className="flex flex-col gap-0.5">
            <p className={TEXT} style={{ fontWeight: 'var(--fw-bold)' }}>
              연락·환불·분쟁 기록
            </p>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              이 주문에 남은 연락·환불·분쟁 기록과 할 수 있는 조치입니다.
            </p>
          </div>
          <LoadingButton
            measured
            size="xs"
            variant="ghost"
            loading={loading}
            disabled={actionIssueId !== null}
            onClick={() => void onReload()}
          >
            새로고침
          </LoadingButton>
        </div>

        {error && (
          <p
            className={`${TEXT} mb-3`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
          >
            {error}
          </p>
        )}
        {!loading && issues.length === 0 && (
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            이 주문에 연결된 운영 기록이 없습니다.
          </p>
        )}
        {issues.length > 0 && (
          <div className="flex flex-col gap-3">
            {issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                role={role}
                actionIssueId={actionIssueId}
                onAction={onAction}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
