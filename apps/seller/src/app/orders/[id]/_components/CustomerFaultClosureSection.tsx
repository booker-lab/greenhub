'use client';

import {
  CUSTOMER_FAULT_CLOSURE_MEMO_MAX_LENGTH,
  type CustomerFaultClosureEligibility,
  type Order,
} from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { useCallback, useId, useState } from 'react';
import {
  CUSTOMER_FAULT_CLOSURE_BUTTON_LABEL,
  CUSTOMER_FAULT_CLOSURE_CONFIRM_MESSAGE,
  canSubmitCustomerFaultClosure,
  customerFaultClosureBlockedMessage,
  describeCustomerFaultClosureEligible,
  describeCustomerFaultClosureRecord,
  SETTLEMENT_RECONCILE_BUTTON_LABEL,
  shouldCheckCustomerFaultClosure,
  shouldCheckCustomerFaultClosureSettlement,
} from '../customer-fault-closure';
import { useCustomerFaultClosure } from '../_hooks/useCustomerFaultClosure';

type ClosureOrder = Pick<
  Order,
  | 'status'
  | 'roundId'
  | 'deliveryMethod'
  | 'deliveryHold'
  | 'redeliveryPayment'
  | 'customerFaultClosure'
>;

interface CustomerFaultClosureSectionProps {
  storeId: string | null;
  orderId: string;
  order: ClosureOrder;
  /** 종결이 끝난 뒤 주문 상세를 다시 불러온다. */
  onClosed: () => void;
}

const smallText = { fontSize: 'var(--font-size-sm)' } as const;
// PostDeliveryRefundSection과 같은 글자·버튼·확인 창 모양을 쓴다.
const TEXT = 'm-0 p-0 text-base font-normal';

/**
 * 고객 사유 종결(환불 없음). 고객 책임 보류 주문에서 손님이 수령을 거부했거나 재배송비를 기한까지
 * 결제하지 않았을 때 판매자가 손님과 연락한 내용을 남기고 주문을 종결한다. 종결한 주문은 기록을 보여 준다.
 */
export function CustomerFaultClosureSection({
  storeId,
  orderId,
  order,
  onClosed,
}: CustomerFaultClosureSectionProps) {
  const closed = shouldCheckCustomerFaultClosureSettlement(order);
  // 종결한 주문도 판정을 물어 정산이 없는지(종결 뒤 정산 생성 실패) 확인한다.
  const enabled = closed || shouldCheckCustomerFaultClosure(order);
  const { eligibility, submitting, error, clearError, submit, reconcileSettlement } =
    useCustomerFaultClosure(storeId, orderId, enabled);

  if (closed) {
    return (
      <CustomerFaultClosureRecordView
        record={order.customerFaultClosure ?? null}
        settlementMissing={
          eligibility?.reason === 'ALREADY_CLOSED' && eligibility.settlementMissing === true
        }
        reconciling={submitting}
        error={error}
        onReconcileSettlement={() => {
          void reconcileSettlement();
        }}
      />
    );
  }
  if (!enabled || !eligibility) return null;
  return (
    <CustomerFaultClosurePanel
      eligibility={eligibility}
      submitting={submitting}
      error={error}
      onClearError={clearError}
      onSubmit={async (memo) => {
        const ok = await submit(memo);
        if (ok) onClosed();
        return ok;
      }}
    />
  );
}

interface CustomerFaultClosureRecordViewProps {
  record: Order['customerFaultClosure'] | null;
  /** 종결 뒤 정산 생성이 실패해 정산이 없다. */
  settlementMissing?: boolean;
  reconciling?: boolean;
  error?: string | null;
  onReconcileSettlement?: () => void;
}

/**
 * 종결한 주문의 기록. 손님과 연락한 메모는 판매자에게만 보인다.
 * 종결 뒤 정산이 만들어지지 않았으면 "정산 다시 맞추기"로 같은 종결 요청을 다시 보낸다.
 */
export function CustomerFaultClosureRecordView({
  record,
  settlementMissing = false,
  reconciling = false,
  error = null,
  onReconcileSettlement,
}: CustomerFaultClosureRecordViewProps) {
  const summary = describeCustomerFaultClosureRecord(record);
  return (
    <div
      className="flex flex-col gap-1.5 py-2.5"
      style={{ borderTop: '1px solid var(--color-border)' }}
    >
      <p className={TEXT} style={{ ...smallText, fontWeight: 'var(--fw-medium)' }}>
        고객 사유 종결
      </p>
      <p className={TEXT} style={{ ...smallText, color: 'var(--color-text-secondary)' }}>
        {summary ?? '환불 없이 종결한 주문이에요. 상품은 직접 처리해 주세요.'}
      </p>
      {record?.memo && (
        <p className={TEXT} style={{ ...smallText, color: 'var(--color-text-secondary)' }}>
          손님과 연락한 내용: {record.memo}
        </p>
      )}
      {settlementMissing && onReconcileSettlement && (
        <>
          <p className={TEXT} style={{ ...smallText, color: 'var(--color-danger)' }}>
            종결은 됐지만 정산이 아직 만들어지지 않았어요. 아래 버튼으로 다시 맞춰 주세요.
          </p>
          {error && (
            <p className={TEXT} style={{ ...smallText, color: 'var(--color-danger)' }}>
              {error}
            </p>
          )}
          <Button
            onClick={onReconcileSettlement}
            disabled={reconciling}
            size="md"
            variant="outline-gray"
            className="w-full"
          >
            {reconciling ? '맞추는 중...' : SETTLEMENT_RECONCILE_BUTTON_LABEL}
          </Button>
        </>
      )}
    </div>
  );
}

interface CustomerFaultClosurePanelProps {
  eligibility: CustomerFaultClosureEligibility;
  submitting: boolean;
  error: string | null;
  onClearError: () => void;
  onSubmit: (memo: string) => Promise<boolean>;
}

/** 판정에 따라 안내 또는 종결 버튼·확인 창을 보여 준다. */
export function CustomerFaultClosurePanel({
  eligibility,
  submitting,
  error,
  onClearError,
  onSubmit,
}: CustomerFaultClosurePanelProps) {
  const [opened, setOpened] = useState(false);
  const [memo, setMemo] = useState('');
  const memoId = useId();

  const close = useCallback(() => {
    setOpened(false);
    setMemo('');
    onClearError();
  }, [onClearError]);

  if (!eligibility.eligible) {
    const message = customerFaultClosureBlockedMessage(eligibility);
    if (!message) return null;
    return (
      <p
        className={`${TEXT} py-2.5 text-center`}
        style={{ ...smallText, color: 'var(--color-text-secondary)' }}
      >
        {message}
      </p>
    );
  }

  async function confirm() {
    if (!canSubmitCustomerFaultClosure(memo)) return;
    const ok = await onSubmit(memo);
    if (ok) {
      setOpened(false);
      setMemo('');
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1.5 py-2.5">
        <p
          className={`${TEXT} text-center`}
          style={{ ...smallText, color: 'var(--color-text-secondary)' }}
        >
          {describeCustomerFaultClosureEligible(eligibility)}
        </p>
        <Button
          onClick={() => setOpened(true)}
          size="md"
          variant="outline-destructive"
          className="w-full"
        >
          {CUSTOMER_FAULT_CLOSURE_BUTTON_LABEL}
        </Button>
      </div>

      <Dialog
        open={opened}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent align="top">
          <DialogHeader>
            <DialogTitle className="leading-[1.55] font-bold">
              {CUSTOMER_FAULT_CLOSURE_BUTTON_LABEL}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-3">
              <p className={TEXT} style={{ ...smallText, color: 'var(--color-text-secondary)' }}>
                {CUSTOMER_FAULT_CLOSURE_CONFIRM_MESSAGE}
              </p>
              <Field>
                <FieldLabel htmlFor={memoId}>
                  손님과 연락한 내용 (손님에게는 보이지 않아요)
                </FieldLabel>
                <Input
                  id={memoId}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  maxLength={CUSTOMER_FAULT_CLOSURE_MEMO_MAX_LENGTH}
                  placeholder="예: 11/14 두 번 통화, 수령하지 않겠다고 함"
                  className="rounded-[8px]"
                />
              </Field>
              {error && (
                <p className={TEXT} style={{ ...smallText, color: 'var(--color-danger)' }}>
                  {error}
                </p>
              )}
              <div className="flex flex-row flex-wrap items-center justify-start gap-2.5">
                <Button
                  onClick={confirm}
                  disabled={submitting || !canSubmitCustomerFaultClosure(memo)}
                  variant="destructive"
                  className="flex-1"
                >
                  {submitting ? '처리 중...' : '종결 확정'}
                </Button>
                <Button onClick={close} variant="outline-gray" className="flex-1">
                  닫기
                </Button>
              </div>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
