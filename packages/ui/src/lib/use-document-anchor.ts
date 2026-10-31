'use client';

import type * as React from 'react';
import { useCallback, useLayoutEffect, useState } from 'react';

// ① 외형 유지: Mantine Combobox 목록 자리. Mantine은 목록을 body에 두고 입력칸 아래 offset 자리를
// 문서 좌표(top·left, 반올림 없음)로 준다. Base UI Positioner는 위치를 transform으로 주며 정수 픽셀로
// 반올림하고 will-change: transform을 붙여, 입력칸이 소수점 위치에 있으면 목록 글자가 1px 어긋난다.
// 이 훅이 잰 값을 Positioner에 CSS 변수로 넘기고, popupPositionClassName으로 transform·will-change를 끈다.

const popupPositionClassName =
  'top-(--popup-top)! left-(--popup-left)! transform-none! will-change-auto!';

function useDocumentAnchor(
  anchorRef: React.RefObject<HTMLElement | null>,
  { offset = 8, measureOnMount = false }: { offset?: number; measureOnMount?: boolean } = {},
) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const measure = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + window.scrollY + offset, left: rect.left + window.scrollX });
  }, [anchorRef, offset]);

  useLayoutEffect(() => {
    if (measureOnMount) measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, measureOnMount]);

  const style = position
    ? ({
        '--popup-top': `${position.top}px`,
        '--popup-left': `${position.left}px`,
      } as React.CSSProperties)
    : undefined;

  return { measure, style };
}

export { popupPositionClassName, useDocumentAnchor };
