'use client';

import {
  apiPathSegment,
  type OrderStatus,
  POST_DELIVERY_REFUND_MEMO_MAX_LENGTH,
  POST_DELIVERY_REFUND_REASON_CODES,
  POST_DELIVERY_REFUND_REASON_LABEL,
  type PostDeliveryRefundReasonCode,
} from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { RadioGroup, RadioItem } from '@greenhub/ui/components/radio';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useId, useState } from 'react';
import { apiJson } from '@/lib/api';
import {
  canSubmitPostDeliveryRefund,
  formatRefundDeadline,
  isPostDeliveryRefundRetry,
  postDeliveryRefundBlockedMessage,
  type SellerRefundEligibility,
  shouldCheckPostDeliveryRefund,
} from '../post-delivery-refund';

interface PostDeliveryRefundSectionProps {
  storeId: string | null;
  orderId: string;
  status: OrderStatus;
  /** 환불이 끝난 뒤 주문 상세를 다시 불러온다. */
  onRefunded: () => void;
}

const smallText = { fontSize: 'var(--font-size-sm)' } as const;

// ① 외형 유지(UI 교체 P4): Mantine Text(p, 여백 0, 줄 높이 1.55)·Stack·Button·Modal(가운데 아님, radius lg)·
// Radio.Group(라벨 600, Radio sm)·TextInput(radius md)과 같은 값. 라디오는 어드민 배송 후 환불 확인창(#714)과 같은 계산값이다.
const TEXT = 'm-0 p-0 text-base font-normal';
const GROUP_LABEL =
  'inline-block cursor-default text-sm/[1.55] font-semibold break-words text-black';

/**
 * 배송 완료 주문의 "배송 후 환불" 버튼과 확인 창(계획서 R6).
 * 판매자는 배송 완료 7일까지·정산 지급 전까지만 직접 환불하고, 그 밖에는 관리자 문의 안내를 보여 준다.
 * 실제 허용 여부는 서버가 같은 규칙으로 다시 확인한다.
 */
export function PostDeliveryRefundSection({
  storeId,
  orderId,
  status,
  onRefunded,
}: PostDeliveryRefundSectionProps) {
  const { data: session } = useSession();
  const token = session?.user.accessToken ?? '';
  const [eligibility, setEligibility] = useState<SellerRefundEligibility | null>(null);
  const [opened, setOpened] = useState(false);
  const [reasonCode, setReasonCode] = useState<PostDeliveryRefundReasonCode | null>(null);
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonLabelId = useId();
  const reasonName = useId();
  const memoId = useId();

  const basePath =
    storeId &&
    `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/post-delivery-refund`;
  const check = shouldCheckPostDeliveryRefund(status);

  useEffect(() => {
    if (!check || !basePath || !token) return;
    let cancelled = false;
    apiJson<SellerRefundEligibility>(basePath, token)
      .then((result) => {
        if (!cancelled) setEligibility(result);
      })
      .catch(() => {
        // 판단을 못 하면 버튼을 숨긴다(fail closed). 서버도 실행 때 다시 확인한다.
        if (!cancelled) setEligibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, [check, basePath, token]);

  const close = useCallback(() => {
    setOpened(false);
    setReasonCode(null);
    setMemo('');
    setError(null);
  }, []);

  async function submit() {
    if (!basePath || !canSubmitPostDeliveryRefund(reasonCode, memo)) return;
    setLoading(true);
    setError(null);
    try {
      await apiJson(basePath, token, {
        method: 'POST',
        body: JSON.stringify({ reasonCode, memo: memo.trim() }),
      });
      close();
      onRefunded();
    } catch (e) {
      setError(e instanceof Error ? e.message : '환불을 처리하지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  if (!check) {
    // 배송 중(DELIVERING·HUB_ARRIVED) 주문은 판매자가 취소·환불할 수 없다.
    return (
      <p
        className={`${TEXT} py-2.5 text-center`}
        style={{ ...smallText, color: 'var(--color-text-disabled)' }}
      >
        배송 중입니다. 취소·환불이 필요하면 관리자에게 문의해 주세요.
      </p>
    );
  }
  if (!eligibility) return null;

  if (!eligibility.eligible) {
    const message = postDeliveryRefundBlockedMessage(eligibility.reason);
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

  const retry = isPostDeliveryRefundRetry(eligibility.reason);
  const deadline = retry ? null : formatRefundDeadline(eligibility.deadline);
  const amountText =
    eligibility.amount != null ? `${eligibility.amount.toLocaleString('ko-KR')}원` : '결제 금액';

  return (
    <>
      <div className="flex flex-col gap-1.5 py-2.5">
        <Button
          onClick={() => setOpened(true)}
          size="md"
          variant="outline-destructive"
          className="w-full"
        >
          {retry ? '배송 후 환불 다시 시도' : '배송 후 환불'}
        </Button>
        {retry && (
          <p
            className={`${TEXT} text-center`}
            style={{ ...smallText, color: 'var(--color-text-secondary)' }}
          >
            앞선 환불이 끝나지 않았어요. 다시 시도하면 처음 고른 사유로 이어서 처리합니다.
          </p>
        )}
        {deadline && (
          <p
            className={`${TEXT} text-center`}
            style={{ ...smallText, color: 'var(--color-text-secondary)' }}
          >
            {deadline}까지 직접 환불할 수 있어요. 그 뒤는 관리자에게 문의해 주세요.
          </p>
        )}
      </div>

      <Dialog
        open={opened}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent align="top">
          <DialogHeader>
            <DialogTitle className="leading-[1.55] font-bold">배송 후 환불</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-3">
              <p className={TEXT} style={{ ...smallText, color: 'var(--color-text-secondary)' }}>
                손님에게 {amountText} 전액을 돌려주고 주문을 취소합니다. 되돌릴 수 없어요.
                손님에게는 카카오 알림톡으로 취소 안내가 갑니다.
              </p>
              <div>
                <div id={reasonLabelId} className={GROUP_LABEL}>
                  환불 사유
                </div>
                <RadioGroup
                  aria-labelledby={reasonLabelId}
                  name={reasonName}
                  value={reasonCode}
                  onValueChange={setReasonCode}
                >
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    {POST_DELIVERY_REFUND_REASON_CODES.map((code) => (
                      <RadioItem
                        key={code}
                        value={code}
                        label={POST_DELIVERY_REFUND_REASON_LABEL[code]}
                      />
                    ))}
                  </div>
                </RadioGroup>
              </div>
              <Field>
                <FieldLabel htmlFor={memoId}>메모 (손님에게는 보이지 않아요)</FieldLabel>
                <Input
                  id={memoId}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  maxLength={POST_DELIVERY_REFUND_MEMO_MAX_LENGTH}
                  placeholder="예: 받은 날 꽃잎이 시들어 사진과 함께 연락 옴"
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
                  onClick={submit}
                  disabled={loading || !canSubmitPostDeliveryRefund(reasonCode, memo)}
                  variant="destructive"
                  className="flex-1"
                >
                  {loading ? '처리 중...' : '전액 환불 확정'}
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
