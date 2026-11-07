/**
 * 결제 중 페이지 이탈 경고와 같은 탭 복귀 처리.
 *
 * - 주문 생성 중(`creating`)에는 실수로 나가지 않게 브라우저 이탈 확인창을 띄운다.
 * - 결제사 이동(`paying`)은 모바일에서 같은 탭 이동이라 확인창을 띄우지 않는다.
 *   확인창에서 "머무르기"를 누르면 결제사로 가지도 못하고 버튼이 "처리 중..."에 고정됐다(C-01).
 * - 결제사 화면에서 뒤로 와 이 페이지가 메모리에서 그대로 복원되면(bfcache, `pageshow` persisted)
 *   결제창 Promise가 끝나지 않은 채 남으므로 결제 상태를 되돌려 다시 결제할 수 있게 한다.
 *
 * 판단은 이벤트가 일어난 순간의 단계로 한다. 화면 렌더를 기다리면 결제사 이동 직전까지
 * 이전 단계(`creating`)의 경고가 남을 수 있어서, 호출하는 쪽은 단계를 동기적으로 갱신하는 값(ref)을 넘긴다.
 */

export type PaymentPagePhase = 'idle' | 'creating' | 'paying' | 'done' | 'error';

/** 이탈 확인창을 띄울 단계. 주문 생성 중만 막고 결제사 이동은 막지 않는다. */
export function shouldWarnBeforeUnload(phase: PaymentPagePhase): boolean {
  return phase === 'creating';
}

/** 같은 탭으로 돌아온 페이지에서 결제 상태를 되돌릴지. 메모리에서 복원된 결제사 이동 단계만 되돌린다. */
export function shouldResetPaymentOnPageShow(phase: PaymentPagePhase, persisted: boolean): boolean {
  return persisted && phase === 'paying';
}

interface PaymentPageGuardTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** 이탈 경고·복귀 처리를 붙이고 떼는 함수를 돌려준다. */
export function attachPaymentPageGuard(
  target: PaymentPageGuardTarget,
  options: { getPhase: () => PaymentPagePhase; onRestore: () => void },
): () => void {
  const handleBeforeUnload = (event: Event) => {
    if (!shouldWarnBeforeUnload(options.getPhase())) return;
    event.preventDefault();
    // 일부 브라우저는 returnValue를 설정해야 확인창을 띄운다.
    (event as BeforeUnloadEvent).returnValue = '';
  };
  const handlePageShow = (event: Event) => {
    const persisted = (event as Event & { persisted?: boolean }).persisted === true;
    if (shouldResetPaymentOnPageShow(options.getPhase(), persisted)) options.onRestore();
  };
  target.addEventListener('beforeunload', handleBeforeUnload);
  target.addEventListener('pageshow', handlePageShow);
  return () => {
    target.removeEventListener('beforeunload', handleBeforeUnload);
    target.removeEventListener('pageshow', handlePageShow);
  };
}
