'use client';

import { Button } from '@greenhub/ui/components/button';
import { CheckIcon } from '@greenhub/ui/components/checkbox';
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

function RadioItem({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <div className="flex [-webkit-tap-highlight-color:transparent]">
      <div className="relative order-1 size-5">
        <input
          id={id}
          type="radio"
          name={name}
          checked={checked}
          onChange={onChange}
          className="peer relative m-0 flex size-5 cursor-default appearance-none items-center justify-center rounded-[20px] border border-solid border-[#ced4da] bg-white transition-[background-color,border-color] duration-100 ease-[ease] checked:border-primary checked:bg-primary [-webkit-tap-highlight-color:transparent]"
        />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 5 5"
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 size-2 text-white opacity-0 transition-[opacity,transform] duration-[100ms,200ms] ease-[ease] [transform:scale(0.2)_translateY(10px)] [translate:-50%_-50%] peer-checked:opacity-100 peer-checked:[transform:scale(1)]"
        >
          <circle cx="2.5" cy="2.5" r="2.5" fill="currentColor" />
        </svg>
      </div>
      <div className="order-2 inline-flex cursor-default flex-col text-sm/[20px] [-webkit-tap-highlight-color:transparent]">
        <label htmlFor={id} className="block cursor-default ps-3 text-inherit">
          {label}
        </label>
      </div>
    </div>
  );
}

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
        className="pe-6"
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
            disabled={disabled || current === null || current <= 0}
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
      <DialogContent>
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
              <div role="radiogroup" aria-labelledby={reasonLabelId}>
                <div className="mt-2.5 flex flex-col gap-2.5">
                  {Object.entries(HOLD_REASON_LABEL).map(([value, label]) => (
                    <RadioItem
                      key={value}
                      name={reasonName}
                      label={label}
                      checked={reasonCode === value}
                      onChange={() => changeReason(value)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <Field>
              <FieldLabel htmlFor={messageId}>
                보류 사유
                {REQUIRED}
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
