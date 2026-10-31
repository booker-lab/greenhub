'use client';

import type * as React from 'react';
import { createContext, useContext, useId } from 'react';

import { cn } from '../lib/utils';

// ① 외형 유지: Mantine Radio.Group + Radio sm(판매자 앱 theme 기본값). 원 20px·gray-4 테두리, 고르면 주색 면에
// 흰 점(8px)이 커지며 나타나고, 글자는 15px/20px로 원 오른쪽 12px에 둔다. 판매자 앱 네 곳에 복사돼 있던 RadioItem과
// 같은 DOM이다(대조 화면·촬영 픽셀 비교로 확인).
// 접근성: 그룹은 role="radiogroup"(aria-labelledby로 그룹 이름), 항목은 같은 name을 나눠 가진 진짜
// input type="radio"다. 그래서 Tab은 그룹에 한 번만 들어가고(고른 항목, 없으면 첫 항목), 화살표 키로 고른 항목을
// 옮기는 브라우저 기본 동작을 그대로 쓴다(Mantine Radio.Group도 네이티브 radio다).

interface RadioGroupContextValue {
  name: string;
  value: string | null;
  onValueChange: (value: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

function RadioGroup<T extends string>({
  name,
  value,
  onValueChange,
  required,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'onChange' | 'role'> & {
  /** 항목들이 나눠 갖는 input name. 주지 않으면 useId로 만든다. */
  name?: string;
  /** 고른 값. 아직 고르지 않았으면 null·빈 문자열. */
  value: T | null | '';
  onValueChange: (value: T) => void;
  /** 꼭 골라야 하는 그룹이면 aria-required를 단다. */
  required?: boolean;
}) {
  const autoName = useId();
  return (
    <div role="radiogroup" aria-required={required || undefined} {...props}>
      <RadioGroupContext.Provider
        value={{
          name: name ?? autoName,
          value: value || null,
          onValueChange: onValueChange as (value: string) => void,
        }}
      >
        {children}
      </RadioGroupContext.Provider>
    </div>
  );
}

function RadioItem({
  value,
  label,
  className,
}: {
  value: string;
  label: React.ReactNode;
  className?: string;
}) {
  const group = useContext(RadioGroupContext);
  if (!group) throw new Error('RadioItem은 RadioGroup 안에서만 쓴다.');
  const id = useId();
  return (
    <div className={cn('flex [-webkit-tap-highlight-color:transparent]', className)}>
      <div className="relative order-1 size-5">
        <input
          id={id}
          type="radio"
          name={group.name}
          value={value}
          checked={group.value === value}
          onChange={() => group.onValueChange(value)}
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

export { RadioGroup, RadioItem };
