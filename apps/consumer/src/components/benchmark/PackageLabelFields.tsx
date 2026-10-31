'use client';

import { PACKAGE_LABEL_MAX_LENGTH } from '@greenhub/shared';
import { FieldDescription, FieldLabel } from '@greenhub/ui/components/field';
import { Input, InputSection } from '@greenhub/ui/components/input';
import { useId } from 'react';

// 포장 라벨(무료). 화분 포장 겉면에 붙일 문구를 주문마다 한 장 받는다.
// 직접 사는 손님은 "없음"이 기본이고, "넣기"를 고르면 문구 칸이 열린다(보내는 분 이름이 아니어도 된다).
// 선물로 보내면 이 칸 대신 선물 칸의 보내는 분 이름이 라벨이 된다(결제 폼이 이 칸을 숨긴다).
// 축하 문구는 상품 옵션 시트의 축하 토퍼로 고른다.

export type PackageLabelState = { enabled: boolean; text: string };

export const EMPTY_PACKAGE_LABEL: PackageLabelState = { enabled: false, text: '' };

/** 줄바꿈·앞뒤 공백을 정리한 문구. 서버(resolvePackageLabel)와 같은 기준으로 한 줄로 만든다. */
export function normalizePackageLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 주문에 실을 라벨 문구. "없음"이면 null, "넣기"인데 비었거나 너무 길면 'invalid'(결제를 막는다).
 */
export function packageLabelPayload(state: PackageLabelState): string | null | 'invalid' {
  if (!state.enabled) return null;
  const text = normalizePackageLabel(state.text);
  if (!text || Array.from(text).length > PACKAGE_LABEL_MAX_LENGTH) return 'invalid';
  return text;
}

// Mantine Radio(크기 sm 20px·원형·gray-4 테두리, 고르면 주색 면·흰 점 8px, 라벨 15px/20px·왼쪽 12px) 계산값.
function LabelRadio({
  name,
  value,
  label,
  checked,
  onSelect,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  const id = useId();
  return (
    <div className="flex [-webkit-tap-highlight-color:transparent]">
      <div className="relative order-1 size-5">
        <input
          id={id}
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={onSelect}
          className="peer relative m-0 flex size-5 cursor-default appearance-none items-center justify-center rounded-[20px] border border-solid border-[#ced4da] bg-white transition-[background-color,border-color] duration-100 ease-[ease] outline-none [-webkit-tap-highlight-color:transparent] checked:border-(--color-primary) checked:bg-(--color-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary) focus-visible:outline-solid"
        />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 5 5"
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 transition-[opacity,transform] duration-100 [transform:scale(0.2)_translateY(10px)] peer-checked:opacity-100 peer-checked:[transform:scale(1)]"
        >
          <circle cx="2.5" cy="2.5" r="2.5" fill="currentColor" />
        </svg>
      </div>
      <div className="order-2 inline-flex cursor-default flex-col text-sm leading-5">
        <label htmlFor={id} className="cursor-default ps-3 text-inherit">
          {label}
        </label>
      </div>
    </div>
  );
}

export default function PackageLabelFields({
  value,
  onChange,
}: {
  value: PackageLabelState;
  onChange: (next: PackageLabelState) => void;
}) {
  const length = Array.from(normalizePackageLabel(value.text)).length;
  const groupId = useId();
  const textId = useId();
  const radioValue = value.enabled ? 'on' : 'off';
  const select = (next: string) => onChange({ ...value, enabled: next === 'on' });
  return (
    // Mantine Stack gap sm·p md, Radio.Group(라벨 div·설명 13px/1.2·radiogroup)·Group gap lg mt 8,
    // TextInput(라벨·설명 입력칸 위 5px·오른쪽 칸 52px) 계산값
    <div
      className="flex flex-col gap-3 p-4"
      style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}
    >
      <div className="leading-[1.55]">
        <div
          id={`${groupId}-label`}
          className="inline-block cursor-default text-sm font-semibold break-words [-webkit-tap-highlight-color:transparent]"
        >
          포장 라벨 (무료)
        </div>
        <FieldDescription id={`${groupId}-description`} className="m-0 block p-0 break-words">
          화분 포장 겉면에 붙이는 라벨이에요.
        </FieldDescription>
        <div
          role="radiogroup"
          aria-labelledby={`${groupId}-label`}
          aria-describedby={`${groupId}-description`}
        >
          <div className="mt-2 flex flex-wrap items-center justify-start gap-5">
            <LabelRadio
              name={groupId}
              value="off"
              label="없음"
              checked={radioValue === 'off'}
              onSelect={() => select('off')}
            />
            <LabelRadio
              name={groupId}
              value="on"
              label="문구 넣기"
              checked={radioValue === 'on'}
              onSelect={() => select('on')}
            />
          </div>
        </div>
      </div>
      {value.enabled && (
        <div className="leading-[1.55]">
          <FieldLabel htmlFor={textId} required className="inline-block">
            라벨 문구
          </FieldLabel>
          <FieldDescription id={`${textId}-description`} className="m-0 mb-[5px] block p-0">
            {`한 줄, ${PACKAGE_LABEL_MAX_LENGTH}자까지. 보내는 분 이름이나 가게 이름을 적어요.`}
          </FieldDescription>
          <div className="relative">
            <Input
              id={textId}
              placeholder="예) 그린플라워 대표 김그린"
              required
              aria-describedby={`${textId}-description`}
              value={value.text}
              maxLength={PACKAGE_LABEL_MAX_LENGTH}
              onChange={(event) => onChange({ ...value, text: event.currentTarget.value })}
              className="pe-[52px]"
            />
            <InputSection side="right" className="w-[52px]">
              <p
                className="m-0 p-0 text-xs font-normal"
                style={{ color: 'var(--color-text-disabled)', fontVariantNumeric: 'tabular-nums' }}
              >
                {length}/{PACKAGE_LABEL_MAX_LENGTH}
              </p>
            </InputSection>
          </div>
        </div>
      )}
    </div>
  );
}
