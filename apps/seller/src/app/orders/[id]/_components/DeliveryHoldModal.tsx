'use client';

import { Button } from '@greenhub/ui/components/button';
import { CheckIcon } from '@greenhub/ui/components/checkbox';
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
import { Textarea } from '@greenhub/ui/components/textarea';
import { useEffect, useId, useState } from 'react';
import {
  buildDeliveryHoldPayload,
  type DeliveryHoldPayload,
  deliveryHoldResponsibilityFeeHint,
  HOLD_REASON_LABEL,
  type HoldReason,
} from '../delivery-hold-form';

interface DeliveryHoldModalProps {
  opened: boolean;
  actionLoading: boolean;
  /** 서버가 거절한 이유(상태 변경·검증 실패) */
  actionError: string | null;
  onClose: () => void;
  /** 성공하면 true — 부모가 창을 닫고 주문을 다시 읽는다. */
  onSubmit: (deliveryHold: DeliveryHoldPayload) => Promise<boolean>;
}

// ① 외형 유지(UI 교체 P4): Mantine Modal(가운데, radius lg)·Stack(gap md = 16px)·Text(p, 여백 0, 줄 높이 1.55)·
// Radio.Group·Radio sm(어드민 배송 후 환불 확인창 #714와 같은 계산값)·Textarea(autosize 2줄, 필수 표시 red-6)·
// Checkbox sm(비활성: gray-2 면·gray-3 테두리·gray-5 글자)·NumberInput(오른쪽 24px 위·아래 버튼, 천 단위·'원')·
// TextInput(datetime-local)과 같은 값.
const TEXT = 'm-0 p-0 text-base font-normal';
const GROUP_LABEL =
  'inline-block cursor-default text-sm/[1.55] font-semibold break-words text-black';
const REQUIRED = (
  <span className="text-[#fa5252]" aria-hidden>
    {' *'}
  </span>
);

/** Mantine Checkbox sm(비활성 표시 포함). @greenhub/ui Checkbox와 같은 모양에 disabled만 더했다. */
function HoldCheckbox({
  id,
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div
      className="flex"
      data-disabled={disabled || undefined}
      style={{ '--checkbox-color': 'var(--color-primary)' } as React.CSSProperties}
    >
      <div className="relative order-1 size-5">
        <input
          type="checkbox"
          id={id}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onCheckedChange(event.currentTarget.checked)}
          className="peer m-0 block size-5 cursor-pointer appearance-none rounded-[4px] border border-[#ced4da] bg-white p-0 transition-[border-color,background-color] duration-100 outline-none [-webkit-tap-highlight-color:transparent] checked:border-(--checkbox-color) checked:bg-(--checkbox-color) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--checkbox-color) focus-visible:outline-solid disabled:cursor-not-allowed disabled:border-[#dee2e6] disabled:bg-[#e9ecef]"
        />
        <CheckIcon className="pointer-events-none absolute inset-0 m-auto w-[60%] translate-y-[5px] scale-50 text-white opacity-0 transition-[translate,scale,opacity] duration-100 peer-checked:translate-none peer-checked:scale-100 peer-checked:opacity-100 peer-disabled:text-[#adb5bd]" />
      </div>
      <div className="order-2 inline-flex cursor-pointer flex-col text-sm/[20px]">
        <label
          htmlFor={id}
          className={`ps-3 ${disabled ? 'cursor-not-allowed text-[#adb5bd]' : 'cursor-pointer text-inherit'}`}
        >
          {label}
        </label>
      </div>
    </div>
  );
}

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ width: 14, height: 14, transform: up ? 'rotate(180deg)' : undefined }}
    >
      <path
        d="M3.13523 6.15803C3.3241 5.95657 3.64052 5.94637 3.84197 6.13523L7.5 9.56464L11.158 6.13523C11.3595 5.94637 11.6759 5.95657 11.8648 6.15803C12.0536 6.35949 12.0434 6.67591 11.842 6.86477L7.84197 10.6148C7.64964 10.7951 7.35036 10.7951 7.15803 10.6148L3.15803 6.86477C2.95657 6.67591 2.94637 6.35949 3.13523 6.15803Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

// Mantine Input 글자 줄 높이 = 입력칸 높이 - 2px(34px). 날짜·시각 칸은 안쪽 칸이 줄 높이로 세로 위치를 정한다.
const INPUT_LINE = 'leading-[34px]';

const FEE_STEP = 1000;
const CONTROL =
  'flex h-[17px] w-full flex-[0_0_50%] cursor-pointer appearance-none items-center justify-center border-0 border-s border-solid border-s-[#ced4da] bg-transparent p-0 text-black hover:bg-[#f8f9fa] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[#adb5bd] disabled:opacity-60';

/** Mantine NumberInput(min 0, step 1000, 천 단위 ',', 끝에 '원', 위·아래 버튼). */
function FeeInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string | number;
  disabled: boolean;
  onChange: (value: string | number) => void;
}) {
  const current = typeof value === 'number' ? value : value === '' ? null : Number(value);
  const display =
    current === null || Number.isNaN(current) ? '' : `${current.toLocaleString('en-US')}원`;
  const step = (direction: 1 | -1) => {
    const next = Math.max(0, (current ?? 0) + direction * FEE_STEP);
    onChange(next);
  };
  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={display}
        disabled={disabled}
        onChange={(event) => {
          const digits = event.currentTarget.value.replace(/[^0-9]/g, '');
          onChange(digits === '' ? '' : Number(digits));
        }}
        className={`pe-6 ${INPUT_LINE}`}
      />
      <div
        className="absolute end-px top-px bottom-px z-[1] flex w-6 items-center justify-center rounded-e-lg text-[#868e96]"
        style={{ pointerEvents: disabled ? 'none' : undefined }}
      >
        <div className="ms-auto flex h-[34px] w-full max-w-[23.8px] flex-col">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => step(1)}
            className={`${CONTROL} rounded-none rounded-se-[15px]`}
          >
            <Chevron up />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            // Mantine은 값이 숫자이고 최소값(0) 이하일 때만 아래 버튼을 끈다(빈 칸이면 켜 둔다).
            disabled={disabled || (current !== null && current <= 0)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => step(-1)}
            className={`${CONTROL} rounded-none rounded-ee-[15px]`}
          >
            <Chevron />
          </button>
        </div>
      </div>
    </div>
  );
}

// 판매자 보류: 기사가 가져가기 전 준비 중 주문을 한 건씩 멈춘다(일괄 보류 없음).
// 규칙은 기사 앱 보류 창과 같다 — 기상 보류는 고객 책임·재배송비 없이 새 배송 시각 필수,
// 그 밖에는 고객 책임 ⇔ 재배송비(0원 초과).
export function DeliveryHoldModal({
  opened,
  actionLoading,
  actionError,
  onClose,
  onSubmit,
}: DeliveryHoldModalProps) {
  const [reasonCode, setReasonCode] = useState<HoldReason>('WEATHER');
  const [reasonMessage, setReasonMessage] = useState('');
  const [customerResponsible, setCustomerResponsible] = useState(false);
  const [redeliveryFee, setRedeliveryFee] = useState<string | number>('');
  const [nextContactAt, setNextContactAt] = useState('');
  const [nextDeliveryAt, setNextDeliveryAt] = useState('');
  const [formError, setFormError] = useState('');
  const reasonLabelId = useId();
  const reasonName = useId();
  const messageId = useId();
  const customerId = useId();
  const feeId = useId();
  const contactId = useId();
  const deliveryId = useId();
  const isWeather = reasonCode === 'WEATHER';
  const responsibilityFeeHint = deliveryHoldResponsibilityFeeHint({
    reasonCode,
    customerResponsible,
    redeliveryFee,
  });

  // 창을 새로 열 때마다 빈 입력에서 시작한다.
  useEffect(() => {
    if (!opened) return;
    setReasonCode('WEATHER');
    setReasonMessage('');
    setCustomerResponsible(false);
    setRedeliveryFee('');
    setNextContactAt('');
    setNextDeliveryAt('');
    setFormError('');
  }, [opened]);

  function changeReason(value: string) {
    const next = value as HoldReason;
    setReasonCode(next);
    if (next === 'WEATHER') {
      setCustomerResponsible(false);
      setRedeliveryFee('');
    }
  }

  async function submit() {
    if (actionLoading) return;
    const result = buildDeliveryHoldPayload({
      reasonCode,
      reasonMessage,
      customerResponsible,
      redeliveryFee,
      nextContactAt,
      nextDeliveryAt,
    });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setFormError('');
    await onSubmit(result.payload);
  }

  return (
    <Dialog
      open={opened}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* Mantine Modal 본문은 열린 뒤에도 transform: translateY(0)·backface-visibility: hidden을 갖는다. 이 창은 내용이
          화면 높이(90dvh)보다 길어 본문이 소수점 위치(약 42.2px)에 놓이는데, will-change: opacity만으로는 입력 뒤 다시 그린
          영역이 1px 어긋나고(폰·태블릿) 끄면 처음 열린 모양이 달라져 Mantine과 같은 값을 준다. */}
      <DialogContent className="will-change-auto [backface-visibility:hidden] [transform:translateY(0px)]">
        <DialogHeader>
          <DialogTitle className="leading-[1.55] font-bold">배송 보류</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              기사가 가져가기 전에 이 주문을 멈춰요. 고객에게 배송 보류 알림톡이 가요. 다시 보낼
              때는 주문 상세에서 &lsquo;재배송 준비로 돌리기&rsquo;를 눌러요.
            </p>
            <div>
              <div id={reasonLabelId} className={GROUP_LABEL}>
                보류 유형
              </div>
              <RadioGroup
                aria-labelledby={reasonLabelId}
                name={reasonName}
                value={reasonCode}
                onValueChange={changeReason}
              >
                <div className="mt-2.5 flex flex-col gap-2.5">
                  {Object.entries(HOLD_REASON_LABEL).map(([value, label]) => (
                    <RadioItem key={value} value={value} label={label} />
                  ))}
                </div>
              </RadioGroup>
            </div>
            <Field>
              <FieldLabel htmlFor={messageId}>
                {/* FieldLabel은 자식 사이를 띄우므로 글자와 필수 표시를 한 덩어리로 둔다(Mantine은 " *"가 글자에 붙는다). */}
                <span>
                  보류 사유
                  {REQUIRED}
                </span>
              </FieldLabel>
              <Textarea
                id={messageId}
                value={reasonMessage}
                onChange={(event) => setReasonMessage(event.currentTarget.value)}
                required
                autosize
                minRows={2}
              />
            </Field>
            <HoldCheckbox
              id={customerId}
              label="고객 책임"
              checked={customerResponsible}
              disabled={isWeather}
              onCheckedChange={setCustomerResponsible}
            />
            <Field>
              <FieldLabel htmlFor={feeId}>재배송비</FieldLabel>
              <FeeInput
                id={feeId}
                value={redeliveryFee}
                disabled={isWeather}
                onChange={setRedeliveryFee}
              />
            </Field>
            {responsibilityFeeHint && (
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                {responsibilityFeeHint}
              </p>
            )}
            <Field>
              <FieldLabel htmlFor={contactId}>다음 연락 예정</FieldLabel>
              <Input
                id={contactId}
                type="datetime-local"
                className={INPUT_LINE}
                value={nextContactAt}
                onChange={(event) => setNextContactAt(event.currentTarget.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={deliveryId}>
                {isWeather ? '새 배송 예정 (필수)' : '새 배송 예정'}
              </FieldLabel>
              <Input
                id={deliveryId}
                type="datetime-local"
                className={INPUT_LINE}
                value={nextDeliveryAt}
                onChange={(event) => setNextDeliveryAt(event.currentTarget.value)}
              />
            </Field>
            {(formError || actionError) && (
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                {formError || actionError}
              </p>
            )}
            <div className="flex flex-row flex-wrap items-center justify-start gap-2.5">
              <Button
                onClick={() => void submit()}
                disabled={actionLoading || responsibilityFeeHint !== null}
                variant="destructive"
                className="flex-1"
                style={{ fontWeight: 'var(--fw-medium)' }}
              >
                {actionLoading ? '처리 중...' : '보류 저장'}
              </Button>
              <Button
                onClick={onClose}
                disabled={actionLoading}
                variant="outline-gray"
                className="flex-1"
              >
                닫기
              </Button>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
