'use client';

import type * as React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { cn } from '../lib/utils';
import { inputClassName } from './input';

// ① 외형 유지: Mantine Textarea(입력칸과 같은 테두리·색, 여러 줄이라 높이 auto·최소 36, 위아래 5.5px,
// 줄 높이 1.55). rows를 주지 않으면 브라우저 기본 2줄 높이다.
// autosize면 Mantine Autosize와 같은 식으로 높이를 글 양에 맞춘다: 같은 크기 값의 숨긴 textarea에
// 글(비면 자리표시, 그것도 없으면 'x')과 'x'를 넣어 정수 scrollHeight로 글 높이·한 줄 높이를 재고,
// max(minRows × 한 줄 높이 + 위아래 여백, 글 높이) + 위아래 테두리. 한 줄 높이가 정수로 잘리므로
// 줄 높이 계산값(예: 15px × 1.55 = 23.25)을 그대로 곱하면 Mantine보다 커진다.
const SIZING_KEYS = [
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderTopWidth',
  'boxSizing',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'tabSize',
  'textIndent',
  'textRendering',
  'textTransform',
  'width',
  'wordBreak',
  'wordSpacing',
  'scrollbarGutter',
] as const;
const HIDDEN_STYLE: Record<string, string> = {
  'min-height': '0',
  'max-height': 'none',
  height: '0',
  visibility: 'hidden',
  overflow: 'hidden',
  position: 'absolute',
  'z-index': '-1000',
  top: '0',
  right: '0',
  display: 'block',
};
let measurer: HTMLTextAreaElement | null = null;

/** 숨긴 textarea에 text를 넣었을 때의 scrollHeight(정수). */
function measure(style: CSSStyleDeclaration, text: string) {
  if (!measurer) {
    measurer = document.createElement('textarea');
    measurer.setAttribute('tabindex', '-1');
    measurer.setAttribute('aria-hidden', 'true');
  }
  if (measurer.parentNode === null) document.body.appendChild(measurer);
  for (const key of SIZING_KEYS) measurer.style[key] = style[key];
  for (const [key, value] of Object.entries(HIDDEN_STYLE)) {
    measurer.style.setProperty(key, value, 'important');
  }
  measurer.value = text;
  return measurer.scrollHeight;
}

function Textarea({
  className,
  autosize = false,
  minRows,
  ref,
  onChange,
  value,
  ...props
}: React.ComponentProps<'textarea'> & { autosize?: boolean; minRows?: number }) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el || !autosize) return;
    const style = getComputedStyle(el);
    const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const borderY =
      Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    const lineHeight = Number.parseFloat(style.lineHeight);
    // 스타일이 아직 붙기 전(줄 높이 normal 등)에는 재지 않는다. 폭이 바뀌면 아래 관찰자가 다시 부른다.
    if (![paddingY, borderY, lineHeight].every(Number.isFinite)) return;
    const content = measure(style, el.value || el.placeholder || 'x');
    const rowHeight = measure(style, 'x') - paddingY;
    const rows = minRows ? minRows * rowHeight + paddingY : 0;
    el.style.height = `${Math.max(rows, content) + borderY}px`;
  }, [autosize, minRows]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 글이 바뀔 때마다 높이를 다시 잰다.
  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  // react-textarea-autosize처럼 폭이 바뀌거나(창 크기·늦게 붙은 스타일) 글꼴을 다 받은 뒤에도 다시 잰다.
  useEffect(() => {
    const el = innerRef.current;
    if (!autosize || !el) return;
    let width = el.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      resize();
    });
    observer.observe(el);
    document.fonts?.addEventListener('loadingdone', resize);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', resize);
    };
  }, [autosize, resize]);

  return (
    <textarea
      data-slot="textarea"
      ref={(el) => {
        innerRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      value={value}
      onChange={onChange}
      // 화면이 살아나기(hydration) 전 서버 HTML도 Mantine처럼 minRows 높이로 그린다.
      rows={autosize && minRows ? minRows : undefined}
      className={cn(
        inputClassName,
        'h-auto min-h-9 resize-none py-[5.5px] leading-[1.55]',
        autosize && 'overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
