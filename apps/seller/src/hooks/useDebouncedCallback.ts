'use client';

import { useEffect, useRef, useState } from 'react';

/** 지연 호출 함수. 부르면 앞서 걸린 호출을 지우고 마지막 인자로 delay 뒤 한 번 실행한다. */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** 걸린 호출을 실행하지 않고 지운다. */
  cancel: () => void;
  /** 걸린 호출이 있으면 지금 실행한다. */
  flush: () => void;
  /** 실행을 기다리는 호출이 있는지. */
  isPending: () => boolean;
}

/**
 * 마지막 호출만 delay 뒤 실행하는 지연 함수(trailing). 실행할 함수는 run()이 그때그때 돌려준다
 * (훅에서는 늘 최신 렌더의 콜백을 부르기 위해서다).
 */
export function createDebounced<A extends unknown[]>(
  run: () => (...args: A) => void,
  delay: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: A | null = null;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pendingArgs = null;
  };
  const flush = () => {
    if (pendingArgs === null) return;
    const args = pendingArgs;
    clear();
    run()(...args);
  };
  const debounced = ((...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    pendingArgs = args;
    timer = setTimeout(flush, delay);
  }) as Debounced<A>;
  debounced.cancel = clear;
  debounced.flush = flush;
  debounced.isPending = () => pendingArgs !== null;
  return debounced;
}

/**
 * Mantine useDebouncedCallback(delay 숫자)과 같은 동작: 마지막 호출만 delay 뒤 실행하고,
 * 화면이 닫히면(언마운트) 걸린 호출을 실행하지 않고 지운다. 콜백은 늘 최신 렌더의 것을 부른다.
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delay: number,
): Debounced<A> {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const [debounced] = useState(() => createDebounced<A>(() => callbackRef.current, delay));
  useEffect(() => debounced.cancel, [debounced]);
  return debounced;
}
