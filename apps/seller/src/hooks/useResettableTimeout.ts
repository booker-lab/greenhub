'use client';

import { useEffect, useState } from 'react';

/**
 * 한 번에 하나만 걸리는 타이머. 새로 걸면 이전 타이머를 먼저 해제한다.
 * "저장됨" 표시처럼 잠깐 뒤 상태를 되돌리는 용도다.
 */
export function createResettableTimer() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (fn: () => void, ms: number) => {
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, ms);
  };
  return { schedule, clear };
}

/** 화면이 닫히면(언마운트) 남은 타이머를 해제하는 createResettableTimer. */
export function useResettableTimeout() {
  const [timer] = useState(createResettableTimer);
  useEffect(() => timer.clear, [timer]);
  return timer;
}
