'use client';

import { apiPathSegment } from '@greenhub/shared';
import { CloseIcon, closeButtonClassName } from '@greenhub/ui/components/close-button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogHeader,
  DialogOverlay,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { cn } from '@greenhub/ui/lib/utils';
import { useSession } from 'next-auth/react';
import { useEffect, useId, useRef, useState } from 'react';
import { AppButton } from '@/components/app-button';
import {
  CheckboxField,
  NumberField,
  RadioGroupField,
  TextareaField,
  TextField,
} from '@/components/fields';
import { text } from '@/components/look';
import { apiFetch } from '@/lib/api';
import {
  customerResponsibleFeeNotice,
  type DriverHoldReason,
  deliveryHoldResponsibilityFeeHint,
  deliveryHoldSubmitError,
  driverHoldReasonOptions,
  holdResponsibilityAfterReasonChange,
  isCustomerResponsibleOnlyReason,
  isNonRedeliverableDriverHoldReason,
  isSellerResponsibleOnlyReason,
  PRODUCT_DAMAGED_HOLD_NOTICE,
  parseRedeliveryFee,
  redeliveryFeeAfterResponsibilityChange,
} from '../../_lib/delivery-hold-form';
import {
  classifyDriverOrderCommandError,
  readDriverOrderCommandErrorCodeFromResponse,
} from '../../_lib/driver-order-detail';

export type HoldReason = DriverHoldReason;

export type DeliveryHold = {
  reasonCode: HoldReason;
  reasonMessage: string;
  customerResponsible: boolean;
  redeliveryFee: number | null;
  nextContactAt: string | null;
  nextDeliveryAt: string | null;
};

export const HOLD_REASON_LABEL: Record<HoldReason, string> = {
  WEATHER: '기상 악화',
  ACCESS_UNAVAILABLE: '출입 불가',
  ADDRESS_ISSUE: '주소 오류',
  CUSTOMER_UNREACHABLE: '고객 연락 불가',
  RECEIPT_REFUSED: '수령 거부',
  PRODUCT_DAMAGED: '상품 파손',
};

interface DeliveryHoldModalProps {
  opened: boolean;
  loading: boolean;
  orderId: string;
  storeId: string;
  // modal open 이후 authority 이동을 감지하기 위한 최소 prop. version이 아닌
  // 현재 order status만으로 hold command 허용 범위를 판정한다.
  orderStatus: string;
  onClose: () => void;
  onLoading: (loading: boolean) => void;
  onSaved?: () => void;
  // stale/403/409 수렴용 authoritative reread 트리거. 같은 hold command를
  // 자동 재전송하지 않고 parent의 fresh GET으로 수렴한다.
  onConvergence?: () => void;
  // ACK-uncertain(B/C/F/G/H) 수렴용 parent authoritative GET 트리거.
  // parent는 fresh GET 성공 전에는 warning으로 위험 command를 fail-closed하고,
  // modal은 닫혀 immediate same-hold resubmit을 차단한다. 자동 resend 없음.
  onUncertainConvergence?: () => void;
  // authority-loss 수렴용 parent clear 트리거. 401 또는 403 + AUTHORITY_DENIED는
  // modal 내부 표시로 끝나지 않고 parent가 protected order/PII를 즉시 제거하고
  // AUTH_ERROR로 전환하며 modal을 reset/close한다. 자동 resend 없음.
  onAuthorityLoss?: () => void;
  // absence/hiding 수렴용 parent clear 트리거. DRIVER_ORDER_NOT_FOUND code를
  // 직접 받으면 이전 protected order를 신뢰하지 않고 NOT_FOUND 의미로 수렴한다.
  onNotFound?: () => void;
}

// 배송 보류 command가 유효한 order authority 범위.
export const HOLD_COMMAND_ALLOWED_STATUSES = ['PREPARING', 'DELIVERING'] as const;

export function isHoldCommandAllowedStatus(status: string): boolean {
  return (HOLD_COMMAND_ALLOWED_STATUSES as readonly string[]).includes(status);
}

// 403 duplicate-sequential / 409 race-loser / stale-submit 공통 수렴 메시지.
// "실패했으니 다시 제출"이 아니라 상태 재확인을 안내한다.
export const HOLD_STALE_CONVERGENCE_MESSAGE =
  '이미 상태가 바뀌었을 수 있어요. 최신 상태를 다시 확인할게요.';

// HOLD ACK-uncertain(B/C/F/G/H) convergence contract (NO_RESEND + AUTHORITATIVE_GET).
// 같은 HOLD를 자동 재전송하지 않고 parent authoritative GET으로 수렴한다.
// same-command resend 유도 copy를 쓰지 않는다. 같은 보류는 상세의 버튼 비활성(commandsAllowed)이 막으므로
// 안내는 상세 화면의 "상태 확인" 하나만 권한다(D-14, 상세 STATUS_UNCERTAIN_* 문구와 같은 말투).
export const HOLD_UNCERTAIN_CONVERGENCE_MESSAGE = '보류됐는지 확인하는 중이에요.';
export const HOLD_UNCERTAIN_READBACK_WARNING =
  "보류됐는지 아직 확인하지 못했어요. 연결이 돌아오면 '상태 확인'을 눌러 주세요.";

export function DeliveryHoldModal({
  opened,
  loading,
  orderId,
  storeId,
  orderStatus,
  onClose,
  onLoading,
  onSaved,
  onConvergence,
  onUncertainConvergence,
  onAuthorityLoss,
  onNotFound,
}: DeliveryHoldModalProps) {
  const { data: session } = useSession();
  // 기본 선택 없음(D-07): 흔한 문 앞 사유를 기상 악화로 잘못 저장하지 않게 기사가 직접 고른다.
  const [reasonCode, setReasonCode] = useState<HoldReason | null>(null);
  const [reasonMessage, setReasonMessage] = useState('');
  const [customerResponsible, setCustomerResponsible] = useState(false);
  const [redeliveryFee, setRedeliveryFee] = useState<string | number>('');
  const [nextContactAt, setNextContactAt] = useState('');
  const [nextDeliveryAt, setNextDeliveryAt] = useState('');
  const [error, setError] = useState('');
  // 기상·상품 파손은 고객 책임·재배송비를 잠그고, 수령 거부는 고객 책임을 켠 채 잠근다.
  const responsibilityLockedOff = isSellerResponsibleOnlyReason(reasonCode);
  const responsibilityLockedOn = isCustomerResponsibleOnlyReason(reasonCode);
  // 상품 파손은 다시 배송하지 않으므로 새 배송 예정을 받지 않는다.
  const isNonRedeliverable = isNonRedeliverableDriverHoldReason(reasonCode);
  // 기상 외 보류는 고객 책임 ⇔ 재배송비(0원 초과). 어긋나면 저장을 막고 고칠 방법을 보인다.
  const responsibilityFeeHint = deliveryHoldResponsibilityFeeHint({
    reasonCode,
    customerResponsible,
    redeliveryFee,
  });
  // 고객 책임이면 저장 뒤 결과(손님 청구·재개 잠금·기사 앱 수정 불가)를 금액과 함께 칸 바로 아래에 알린다(R-02).
  const customerFeeNotice = customerResponsibleFeeNotice({
    reasonCode,
    customerResponsible,
    redeliveryFee,
  });
  // C3: 부모 loading state와 무관한 로컬 submitting guard. 동일 frame
  // double-submit에서도 두 번째 PATCH를 dispatch하지 않는다.
  const submittingRef = useRef(false);
  const reasonHelpId = useId();

  function resetHoldFormFields() {
    setReasonCode(null);
    setReasonMessage('');
    setCustomerResponsible(false);
    setRedeliveryFee('');
    setNextContactAt('');
    setNextDeliveryAt('');
  }

  // modal open 이후 order authority가 command 허용 범위를 벗어나면 stale form을
  // 남기지 않는다. parent가 이미 fresh authority를 들고 있으므로 별도 reread 없이
  // reset 후 닫는다. submit 경로의 stale 가드와 403/409 수렴이 실제 dispatch를 막는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: opened·orderStatus만의 의도적 stale 감시이며 onClose는 parent setter다
  useEffect(() => {
    if (opened && !isHoldCommandAllowedStatus(orderStatus)) {
      resetHoldFormFields();
      setError('');
      onClose();
    }
  }, [opened, orderStatus]);

  // 창을 새로 열면 지난번(닫기 직전 불확실 안내·유형 미선택 등) 오류 문구를 남기지 않는다.
  useEffect(() => {
    if (opened) setError('');
  }, [opened]);

  // 유형·입력값이 바뀌면 이전 제출 오류는 지금 입력과 맞지 않으므로 지운다(D-15).
  function changeReason(value: string) {
    const next = value as HoldReason;
    setError('');
    setReasonCode(next);
    const fields = holdResponsibilityAfterReasonChange({
      reasonCode: next,
      customerResponsible,
      redeliveryFee,
    });
    setCustomerResponsible(fields.customerResponsible);
    setRedeliveryFee(fields.redeliveryFee);
    if (isNonRedeliverableDriverHoldReason(next)) setNextDeliveryAt('');
  }

  // "고객 책임"을 고르면 비어 있는 재배송비 칸에 기준 금액을 채우고, 풀면 비운다(D-09).
  function changeCustomerResponsible(checked: boolean) {
    setError('');
    setCustomerResponsible(checked);
    setRedeliveryFee(
      redeliveryFeeAfterResponsibilityChange({ customerResponsible: checked, redeliveryFee }),
    );
  }

  async function submit() {
    // C3: 진행 중인 submit이 있으면 두 번째 PATCH를 dispatch하지 않는다.
    if (submittingRef.current) return;
    // modal open 이후 authority가 이동했다면 stale form을 그대로 submit하지 않는다.
    // dispatch 0회, form reset, convergence reread 유도 후 닫는다.
    if (!isHoldCommandAllowedStatus(orderStatus)) {
      resetHoldFormFields();
      setError(HOLD_STALE_CONVERGENCE_MESSAGE);
      onConvergence?.();
      onClose();
      return;
    }
    const message = reasonMessage.trim();
    const token = session?.user.accessToken;
    const inputError = deliveryHoldSubmitError({ reasonCode, reasonMessage, nextDeliveryAt });
    // 유형 미선택(null)은 여기서 돌려보내므로 아래 payload에는 고른 유형만 실린다.
    if (inputError || !reasonCode) {
      setError(inputError ?? '');
      return;
    }
    // 저장 버튼이 막혀 있지만, 어긋난 책임·재배송비는 보내지 않는다(안내는 입력칸 아래에 있다).
    if (responsibilityFeeHint) return;
    if (!token) {
      setError('인증 정보를 확인할 수 없어요.');
      return;
    }
    const deliveryHold = {
      reasonCode,
      reasonMessage: message,
      customerResponsible: responsibilityLockedOff ? false : customerResponsible,
      redeliveryFee: responsibilityLockedOff ? null : parseRedeliveryFee(redeliveryFee),
      nextContactAt: nextContactAt ? new Date(nextContactAt).toISOString() : null,
      nextDeliveryAt:
        nextDeliveryAt && !isNonRedeliverable ? new Date(nextDeliveryAt).toISOString() : null,
    };

    setError('');
    submittingRef.current = true;
    onLoading(true);
    try {
      const response = await apiFetch(
        `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/delivery-hold`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ deliveryHold }),
        },
      );
      if (!response.ok) {
        // 401은 envelope code와 무관하게 authority loss다. modal 내부 표시로
        // 끝나지 않고 parent clear + AUTH_ERROR + modal reset/close로 수렴한다.
        if (response.status === 401) {
          resetHoldFormFields();
          setError('로그인 정보를 다시 확인해 주세요.');
          onAuthorityLoss?.();
          onClose();
          return;
        }
        // error-code aware hold recovery: envelope code를 안전하게 읽는다.
        // body 파싱 실패는 null이며 그 자체가 same-hold resend를 유도하지 않는다.
        const errorCode = await readDriverOrderCommandErrorCodeFromResponse(response);
        const recovery = classifyDriverOrderCommandError({
          status: response.status,
          code: errorCode,
        });
        // 403 + AUTHORITY_DENIED (및 unknown/missing-code 403 fail-closed):
        // stale/state convergence로 오분류하지 않고 authority-loss 경로로 보낸다.
        // parent가 protected data를 즉시 제거하므로 modal 내부 표시에 그치지 않는다.
        if (recovery === 'AUTHORITY_LOSS') {
          resetHoldFormFields();
          setError('로그인 정보를 다시 확인해 주세요.');
          onAuthorityLoss?.();
          onClose();
          return;
        }
        // 403/409 + STATE_CONFLICT: authority loss로 오분류하지 않는다.
        // 같은 hold를 자동 재전송하지 않고 convergence path로 보낸다.
        if (recovery === 'STATE_CONFLICT') {
          resetHoldFormFields();
          setError(HOLD_STALE_CONVERGENCE_MESSAGE);
          onConvergence?.();
          return;
        }
        // DRIVER_ORDER_NOT_FOUND: authoritative absence/hiding. 이전 protected
        // order를 신뢰하지 않고 NOT_FOUND 의미로 수렴한다. 자동 resend 없음.
        if (recovery === 'NOT_FOUND') {
          resetHoldFormFields();
          setError('주문을 찾을 수 없어요.');
          onNotFound?.();
          onClose();
          return;
        }
        // F/G: 403/409 STATE·AUTHORITY·NOT_FOUND 이외 4xx·5xx ACK-uncertain.
        // 같은 HOLD를 자동 재전송하지 않고 modal을 닫아 immediate resubmit을
        // 차단한 뒤 parent authoritative GET으로 수렴한다.
        resetHoldFormFields();
        setError(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE);
        onUncertainConvergence?.();
        onClose();
        return;
      }
      // B: 2xx이지만 malformed JSON 등으로 ACK 파싱 불가. 자동 resend 없이 GET 수렴한다.
      let result: { orderId?: unknown; status?: unknown };
      try {
        result = (await response.json()) as { orderId?: unknown; status?: unknown };
      } catch {
        resetHoldFormFields();
        setError(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE);
        onUncertainConvergence?.();
        onClose();
        return;
      }
      // C: 2xx이지만 ACK orderId/status mismatch. 자동 resend 없이 GET 수렴한다.
      if (result.orderId !== orderId || result.status !== 'DELIVERY_HELD') {
        resetHoldFormFields();
        setError(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE);
        onUncertainConvergence?.();
        onClose();
        return;
      }
      resetHoldFormFields();
      setError('');
      onClose();
      // Order 합성 없이 parent가 authoritative GET으로 수렴한다.
      onSaved?.();
    } catch {
      // H: network/transport error ACK-uncertain. 같은 HOLD를 자동 재전송하지 않고
      // modal을 닫아 immediate resubmit을 차단한 뒤 parent authoritative GET으로 수렴한다.
      resetHoldFormFields();
      setError(HOLD_UNCERTAIN_CONVERGENCE_MESSAGE);
      onUncertainConvergence?.();
      onClose();
    } finally {
      submittingRef.current = false;
      onLoading(false);
    }
  }

  return (
    <Dialog
      open={opened}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        {/* 머리·닫기·본문은 packages/ui Dialog(Mantine Modal 구조)를 쓴다. 하단 탭(z 100) 위를 덮도록 Mantine과 같은
            z 200을 써야 하는데 DialogContent는 오버레이·뷰포트 z가 50으로 고정이라 풀어서 둔다. 가운데 정렬은 flex
            뷰포트 대신 m-auto로 한다(flex로 두면 Mantine 화면과 라디오 원 가장자리 안티앨리어싱이 1~4 다르게 그려진다).
            창 본체는 DialogContent와 같은 DialogPopup이라 Tab 순회가 창 안에서만 돌고 aria-modal이 붙는다. */}
        <DialogOverlay className="z-[200]" />
        <DialogPopup
          data-slot="dialog-content"
          className="fixed inset-0 z-[200] m-auto flex h-fit max-h-[90dvh] w-[min(440px,90vw)] flex-col overflow-y-auto rounded-lg bg-background text-ui-ink shadow-[0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_36px_28px_-7px,rgba(0,0,0,0.04)_0_17px_17px_-7px] outline-none"
        >
          <DialogHeader>
            <DialogTitle className="m-0 p-0 text-ui-ink">배송 보류</DialogTitle>
          </DialogHeader>
          {/* preflight 없이 연결한 앱이라 버튼 기본 테두리·여백을 지운다. */}
          <DialogClose
            aria-label="닫기"
            className={cn(closeButtonClassName, 'appearance-none border-0 p-0')}
          >
            <CloseIcon />
          </DialogClose>
          <DialogBody>
            <div className="flex flex-col gap-4">
              <RadioGroupField
                label="보류 유형"
                value={reasonCode ?? ''}
                onChange={changeReason}
                options={driverHoldReasonOptions(orderStatus).map((value) => ({
                  value,
                  label: HOLD_REASON_LABEL[value],
                }))}
              />
              {isNonRedeliverable && (
                <p className={`${text} text-sm/[1.45] text-ui-red`} style={keepWords}>
                  {PRODUCT_DAMAGED_HOLD_NOTICE}
                </p>
              )}
              <div className="flex flex-col gap-1">
                {/* 이 글은 손님 주문 화면에 그대로 보이고 저장하면 보류 알림이 간다(D-08). 내부 메모처럼 쓰지 않게 알린다. */}
                <TextareaField
                  label="손님에게 보일 사유"
                  value={reasonMessage}
                  onChange={(event) => {
                    setError('');
                    setReasonMessage(event.currentTarget.value);
                  }}
                  aria-describedby={reasonHelpId}
                  required
                />
                <p
                  id={reasonHelpId}
                  className={`${text} text-sm/[1.45] text-ui-ink`}
                  style={keepWords}
                >
                  손님 주문 화면에 그대로 보여요. 저장하면 손님에게 배송 보류 알림이 가요.
                </p>
              </div>
              <CheckboxField
                label="고객 책임"
                checked={customerResponsible}
                disabled={responsibilityLockedOff || responsibilityLockedOn}
                onChange={changeCustomerResponsible}
              />
              <NumberField
                label="재배송비"
                value={redeliveryFee}
                disabled={responsibilityLockedOff}
                min={0}
                step={1000}
                suffix="원"
                thousandSeparator
                onChange={(value) => {
                  setError('');
                  setRedeliveryFee(value);
                }}
              />
              {customerFeeNotice && (
                <p className={`${text} text-sm/[1.45] text-ui-ink`} style={keepWords}>
                  {customerFeeNotice}
                </p>
              )}
              {responsibilityFeeHint && (
                <p className={`${text} text-sm/[1.45] text-ui-red`}>{responsibilityFeeHint}</p>
              )}
              <TextField
                label="다음 연락 예정"
                type="datetime-local"
                value={nextContactAt}
                onChange={(event) => {
                  setError('');
                  setNextContactAt(event.currentTarget.value);
                }}
              />
              <TextField
                label="새 배송 예정"
                type="datetime-local"
                value={nextDeliveryAt}
                disabled={isNonRedeliverable}
                onChange={(event) => {
                  setError('');
                  setNextDeliveryAt(event.currentTarget.value);
                }}
              />
              {error && <p className={`${text} text-ui-red`}>{error}</p>}
              <div className="flex flex-wrap items-center justify-end gap-4">
                <AppButton tone="default" onClick={onClose} disabled={loading}>
                  취소
                </AppButton>
                <AppButton
                  tone="red"
                  onClick={submit}
                  loading={loading}
                  disabled={loading || responsibilityFeeHint !== null}
                >
                  보류하기
                </AppButton>
              </div>
            </div>
          </DialogBody>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

// 한국어 안내가 낱말 중간에서 줄을 바꾸지 않게 한다(R-09). 긴 낱말만 아무 데서나 끊는다.
const keepWords = { wordBreak: 'keep-all', overflowWrap: 'anywhere' } as const;
