import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { Children, cloneElement, isValidElement, useId } from 'react';

import { cn } from '../lib/utils';
import { CloseIcon } from './close-button';

// ① 외형 유지: Mantine Alert variant="light"(안쪽 16, 모서리 16, 투명 테두리 1px, 제목 15px·700, 본문 15px 검정,
// 제목·본문 사이 10px). 색은 Mantine 계산값이다: 기본 brand-1 면·brand-9 글자, 빨강 red-1·red-9,
// 노랑은 theme.ts가 경고 토큰(#FFF4CC·#7A5B00)으로 바꾼 값.
// 줄 높이는 Mantine처럼 물려받는다(text-sm을 쓰면 1.45로 바뀌므로 글자 크기만 준다).
const alertVariants = cva(
  'relative overflow-hidden rounded-lg border border-transparent p-4 text-[15px]',
  {
    variants: {
      variant: {
        default: 'bg-[#d2f2df] text-[#005c32]',
        destructive: 'bg-[#ffe3e3] text-[#c92a2a]',
        warning: 'bg-[#fff4cc] text-[#7a5b00]',
        // Mantine light gray(gray-1 면·gray-9 글자).
        secondary: 'bg-[#f1f3f5] text-[#212529]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

// icon: Mantine Alert icon(20px 칸, 오른쪽 16px·위 1px, 줄 높이 1).
// onClose: Mantine withCloseButton(본문 오른쪽 20px 투명 닫기 버튼, X 16px, 글자색). 제목은 오른쪽을 16px 비운다.
// 접근성 유지: Mantine Alert처럼 역할 기본값은 alert이고(호출부 role="status" 등으로 바꾼다), 바로 아래 자식에
// AlertTitle이 있으면 그 제목이 상자의 이름이 된다(aria-labelledby). 제목이 없으면 이름도 없다(Mantine과 같다).
function Alert({
  className,
  variant,
  children,
  icon,
  onClose,
  closeButtonLabel,
  role = 'alert',
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof alertVariants> & {
    icon?: React.ReactNode;
    onClose?: () => void;
    closeButtonLabel?: string;
  }) {
  const autoTitleId = useId();
  let titleId: string | undefined;
  const content = Children.map(children, (child) => {
    if (
      titleId !== undefined ||
      !isValidElement<{ id?: string }>(child) ||
      child.type !== AlertTitle
    ) {
      return child;
    }
    titleId = child.props.id ?? autoTitleId;
    return child.props.id ? child : cloneElement(child, { id: titleId });
  });

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role은 alert(기본)·status로 둘 다 aria-labelledby를 받는다. 값이 변수라 린트가 못 본다.
    <div
      data-slot="alert"
      role={role}
      aria-labelledby={titleId}
      className={cn(
        alertVariants({ variant }),
        onClose && '[&_[data-slot=alert-title]]:pe-4',
        className,
      )}
      {...props}
    >
      <div className="flex">
        {icon && (
          <div
            data-slot="alert-icon"
            className="me-4 mt-px flex size-5 items-center justify-start leading-none"
          >
            {icon}
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2.5">{content}</div>
        {onClose && (
          <button
            type="button"
            data-slot="alert-close"
            aria-label={closeButtonLabel}
            onClick={onClose}
            className="relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 leading-none text-inherit outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid"
          >
            <CloseIcon style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>
    </div>
  );
}

function AlertTitle({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('flex items-center justify-between text-[15px] font-bold', className)}
      {...props}
    >
      <span className="block overflow-hidden text-ellipsis">{children}</span>
    </div>
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('overflow-hidden text-[15px] text-ellipsis text-black', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
