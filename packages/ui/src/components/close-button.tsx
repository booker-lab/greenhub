import type * as React from 'react';

// ① 외형 유지: Mantine CloseButton의 X 모양(Mantine CloseIcon = Radix Cross2Icon, MIT)을 그대로 그린다.
// lucide X는 선 굵기·끝 모양이 달라 Modal을 바꿀 때 화면 차이가 난다. 크기는 부모(닫기 버튼)의 70%다.
function CloseIcon({ style, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-slot="close-icon"
      style={{ width: '70%', height: '70%', ...style }}
      {...props}
    >
      <path
        d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ① 외형 유지: Mantine CloseButton(28px, 모서리 16, gray-7, 마우스를 올리면 gray-0, 초점 시 주색 2px 외곽선).
// Dialog는 머리 안 flex 끝(margin-left auto)에, Sheet는 머리 자리에 absolute로 둔다.
const closeButtonClassName =
  'inline-flex size-7 cursor-pointer items-center justify-center rounded-lg bg-transparent text-[#495057] outline-none select-none hover:bg-[#f8f9fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid';

export { CloseIcon, closeButtonClassName };
