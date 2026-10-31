'use client';

import { Input } from '@greenhub/ui/components/input';
import { Label } from '@greenhub/ui/components/label';
import { cn } from '@greenhub/ui/lib/utils';
import type * as React from 'react';
import { useId, useState } from 'react';

// ① 외형 유지(ui-stack-migration-plan.md §7): Mantine TextInput·PasswordInput·Textarea·NumberInput·Radio·Checkbox와
// 같은 모양의 입력 부품. 값은 Mantine 9.7 기본(입력칸 gray-4 테두리, 비활성 gray-2 바탕·60% 불투명)과
// theme.ts(입력칸 radius 16)에서 그린 계산값이다. 화면 방향 적용(②)에서 packages/ui 부품으로 옮긴다.

const SIZE = {
  // 높이 36·글자 15·좌우 12(높이/3)
  sm: 'h-9 min-h-9 px-3 text-sm leading-[34px]',
  // 높이 42·글자 16·좌우 14(높이/3)
  md: 'h-[42px] min-h-[42px] px-[14px] text-base leading-[40px]',
} as const;

const inputBase =
  'block w-full min-w-0 cursor-text appearance-none rounded-[16px] border border-solid border-[#ced4da] bg-white text-start text-black transition-[border-color] duration-100 ease-[ease] outline-none placeholder:text-[#adb5bd] placeholder:opacity-100 focus:border-primary disabled:cursor-not-allowed disabled:bg-[#e9ecef] disabled:text-[#adb5bd] disabled:opacity-60 [-webkit-tap-highlight-color:transparent]';

const labelClass =
  'inline-flex cursor-default text-sm/[1.55] font-semibold break-words text-black select-auto';

function FieldLabel({
  htmlFor,
  id,
  required,
  children,
}: {
  htmlFor?: string;
  id?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor} id={id} className={cn(labelClass, 'inline-block')}>
      {children}
      {required && (
        <span aria-hidden="true" className="text-[#fa5252]">
          {' *'}
        </span>
      )}
    </Label>
  );
}

type TextFieldProps = Omit<React.ComponentProps<'input'>, 'size'> & {
  label?: string;
  size?: keyof typeof SIZE;
  /** Mantine radius xl(완전히 둥근 입력칸). 기본은 theme.ts의 16px. */
  rounded?: boolean;
};

/** Mantine TextInput. */
export function TextField({
  label,
  size = 'sm',
  rounded,
  className,
  id,
  required,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const field = (
    <div className="relative">
      <Input
        id={inputId}
        required={required}
        className={cn(
          inputBase,
          SIZE[size],
          (rounded || size === 'md') && 'rounded-[32px]',
          className,
        )}
        {...props}
      />
    </div>
  );
  if (!label) return field;
  return (
    <div>
      <FieldLabel htmlFor={inputId} required={required}>
        {label}
      </FieldLabel>
      {field}
    </div>
  );
}

/** Mantine PasswordInput(md, radius xl). 눈 모양 버튼으로 글자를 보이거나 숨긴다. */
export function PasswordField({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'size' | 'type'>) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="relative">
      <div className="relative h-[42px] min-h-[42px] cursor-text overflow-hidden rounded-[32px] border border-solid border-[#ced4da] bg-white ps-[14px] pe-10 text-base leading-[40px] text-black transition-[border-color] duration-100 ease-[ease] focus-within:border-primary">
        <input
          type={reveal ? 'text' : 'password'}
          className={cn(
            'absolute inset-0 h-full w-full cursor-text border-0 bg-transparent ps-[14px] pe-10 text-inherit leading-[1.55] outline-0 placeholder:text-[#adb5bd] placeholder:opacity-100',
            className,
          )}
          {...props}
        />
      </div>
      <div className="absolute top-px right-px bottom-px z-[1] flex w-10 items-center justify-center rounded-r-[32px] text-[#868e96]">
        {/* Mantine은 Tab으로 가지 않는 버튼이었지만, 키보드·읽기 도구로도 비밀번호를 볼 수 있게 초점을 받는다. */}
        <button
          type="button"
          aria-label={reveal ? '비밀번호 숨기기' : '비밀번호 보기'}
          aria-pressed={reveal}
          onClick={() => setReveal((value) => !value)}
          className="relative flex size-[28px] min-h-[28px] min-w-[28px] cursor-pointer appearance-none items-center justify-center overflow-hidden rounded-[32px] border border-solid border-transparent bg-transparent p-0 leading-none text-[#212529] hover:bg-[#f1f3f5]"
        >
          <span className="flex size-[26px] items-center justify-center">
            <PasswordToggleIcon reveal={reveal} />
          </span>
        </button>
      </div>
    </div>
  );
}

// Mantine PasswordToggleIcon과 같은 그림.
function PasswordToggleIcon({ reveal }: { reveal: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      className="size-[22px]"
      aria-hidden="true"
    >
      <path fill="none" d="M0 0h256v256H0z" />
      {reveal ? (
        <>
          <path
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="16"
            d="M48 40l160 176M154.91 157.6a40 40 0 01-53.82-59.2M135.53 88.71a40 40 0 0132.3 35.53"
          />
          <path
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="16"
            d="M208.61 169.1C230.41 149.58 240 128 240 128s-32-72-112-72a126 126 0 00-20.68 1.68M74 68.6C33.23 89.24 16 128 16 128s32 72 112 72a118.05 118.05 0 0054-12.6"
          />
        </>
      ) : (
        <>
          <path
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="16"
            d="M128 56c-80 0-112 72-112 72s32 72 112 72 112-72 112-72-32-72-112-72z"
          />
          <circle
            cx="128"
            cy="128"
            r="40"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="16"
          />
        </>
      )}
    </svg>
  );
}

/** Mantine Textarea(autosize, minRows 2). 줄이 늘면 칸도 늘어난다. */
export function TextareaField({
  label,
  required,
  className,
  ...props
}: React.ComponentProps<'textarea'> & { label: string }) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <div className="relative">
        <textarea
          id={id}
          required={required}
          rows={1}
          className={cn(
            inputBase,
            'm-0 h-auto min-h-[59px] resize-none overflow-hidden px-3 py-[5.5px] text-sm/[1.55] [field-sizing:content]',
            className,
          )}
          {...props}
        />
      </div>
    </div>
  );
}

// Mantine NumberInput 위·아래 화살표 그림.
function Chevron({ up }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('size-[14px]', up && 'rotate-180')}
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

/**
 * Mantine NumberInput(suffix, min, step). 값은 숫자 또는 빈 문자열이다(Mantine onChange와 같다).
 * 칸에는 숫자 뒤에 suffix를 붙여 보이고, 위·아래 화살표와 키보드 화살표로 step만큼 바꾼다.
 */
export function NumberField({
  label,
  value,
  onChange,
  disabled,
  min = 0,
  step = 1,
  suffix = '',
}: {
  label: string;
  value: number | string;
  onChange: (value: number | string) => void;
  disabled?: boolean;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  const id = useId();
  const display = value === '' ? '' : `${value}${suffix}`;
  const stepBy = (direction: 1 | -1) => {
    const current = typeof value === 'number' ? value : Number(value) || 0;
    onChange(Math.max(min, current + direction * step));
  };
  const control =
    'flex h-[17px] w-full flex-[0_0_50%] cursor-pointer appearance-none items-center justify-center border-0 border-s border-solid border-s-[#ced4da] bg-transparent p-0 text-black hover:bg-[#f8f9fa] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[#adb5bd] disabled:opacity-60';
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={display}
          onChange={(event) => {
            const digits = event.currentTarget.value.replace(/[^0-9]/g, '');
            onChange(digits === '' ? '' : Math.max(min, Number(digits)));
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              stepBy(event.key === 'ArrowUp' ? 1 : -1);
            }
          }}
          className={cn(inputBase, SIZE.sm, 'pe-6')}
        />
        <div className="absolute top-px right-px bottom-px z-[1] flex w-6 items-center justify-center rounded-r-[16px] text-[#868e96]">
          <div className="ms-auto flex h-[34px] w-full max-w-[calc(14px*1.7)] flex-col">
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              disabled={disabled}
              onClick={() => stepBy(1)}
              className={cn(control, 'rounded-none rounded-se-[15px]')}
            >
              <Chevron up />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              disabled={disabled}
              onClick={() => stepBy(-1)}
              className={cn(control, 'rounded-none rounded-ee-[15px]')}
            >
              <Chevron />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mantine Radio.Group + Radio(세로 목록, 간격 10px). */
export function RadioGroupField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const labelId = useId();
  const name = useId();
  return (
    <div>
      <div id={labelId} className={cn(labelClass, 'inline-block')}>
        {label}
      </div>
      <div role="radiogroup" aria-labelledby={labelId}>
        <div className="mt-2.5 flex flex-col gap-2.5">
          {options.map((option) => (
            <InlineControl
              key={option.value}
              type="radio"
              name={name}
              label={option.label}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Mantine Checkbox. */
export function CheckboxField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <InlineControl
      type="checkbox"
      label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

function InlineControl({
  type,
  name,
  label,
  checked,
  disabled,
  onChange,
}: {
  type: 'radio' | 'checkbox';
  name?: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const id = useId();
  const isRadio = type === 'radio';
  return (
    <div className="flex [-webkit-tap-highlight-color:transparent]">
      <div className="relative order-1 size-5">
        <input
          id={id}
          type={type}
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className={cn(
            'peer m-0 size-5 cursor-default appearance-none border border-solid border-[#ced4da] bg-white transition-[background-color,border-color] duration-100 ease-[ease] [-webkit-tap-highlight-color:transparent]',
            'checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:border-[#dee2e6] disabled:bg-[#e9ecef]',
            isRadio
              ? 'relative flex items-center justify-center rounded-[20px]'
              : 'block rounded-[4px] p-0',
          )}
        />
        {isRadio ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 5 5"
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 size-2 text-white opacity-0 transition-[opacity,transform] duration-[100ms,200ms] ease-[ease] [transform:scale(0.2)_translateY(10px)] [translate:-50%_-50%] peer-checked:opacity-100 peer-checked:[transform:scale(1)] peer-disabled:text-[#adb5bd]"
          >
            <circle cx="2.5" cy="2.5" r="2.5" fill="currentColor" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 10 7"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 m-auto w-[60%] text-white opacity-0 transition-[transform,opacity] duration-100 ease-[ease] [transform:translateY(5px)_scale(0.5)] peer-checked:opacity-100 peer-checked:[transform:none] peer-disabled:text-[#adb5bd]"
          >
            <path
              d="M4 4.586L1.707 2.293A1 1 0 1 0 .293 3.707l3 3a.997.997 0 0 0 1.414 0l5-5A1 1 0 1 0 8.293.293L4 4.586z"
              fill="currentColor"
              fillRule="evenodd"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
      <div
        className={cn(
          'order-2 inline-flex flex-col text-sm/[20px] [-webkit-tap-highlight-color:transparent]',
          disabled ? 'cursor-not-allowed' : 'cursor-default',
        )}
      >
        <label
          htmlFor={id}
          className={cn(
            'block ps-3',
            disabled ? 'cursor-not-allowed text-[#adb5bd]' : 'cursor-default text-inherit',
          )}
        >
          {label}
        </label>
      </div>
    </div>
  );
}
