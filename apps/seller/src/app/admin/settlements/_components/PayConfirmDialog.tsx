'use client';

import { useState } from 'react';
import type { AdminSettlement } from '@/hooks/useAdmin';
import { AdminConfirmDialog } from '../../_components/AdminConfirmDialog';
import { describePayConfirm } from '../_lib';

// 정산 지급 완료 기록 확인창(design-direction.md §5 어드민 "위험 동작 확인창"). 기록은 돈을 보내지 않는다.
// 스스로 확인하는 장치는 "이체를 마쳤습니다" 체크다(비운 채 열고 처음 초점도 여기). 계좌가 없거나 보류·지급 대기 아님이면
// 체크를 두지 않고 확정을 끈 채 이유를 버튼 위에 쓴다(canPay와 같은 조건).
export function PayConfirmDialog({
  target,
  loading,
  onConfirm,
  onClose,
}: {
  /** 지급 완료로 기록할 정산. null이면 닫힌다. */
  target: AdminSettlement | null;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // 체크는 열 때마다 비운다(미리 켜 둔 확인창 금지). 대상이 바뀌면(닫힘 포함) 렌더 중에 지운다.
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [shownTarget, setShownTarget] = useState(target);
  if (shownTarget !== target) {
    setShownTarget(target);
    setCheckedFor(null);
  }
  const view = target ? describePayConfirm(target) : null;
  const payable = view !== null && view.blocked === null;
  const checked = target !== null && checkedFor === target.id;
  return (
    <AdminConfirmDialog
      open={target !== null}
      title={view?.title ?? ''}
      lead="기록은 돈을 보내지 않습니다. 은행 앱에서 이체를 마쳤을 때만 기록하세요."
      facts={view?.facts}
      flow={view?.flow}
      check={
        payable
          ? {
              label: view.checkLabel,
              checked,
              onChange: (next) => setCheckedFor(next && target ? target.id : null),
            }
          : undefined
      }
      confirmLabel={view?.confirmLabel ?? ''}
      confirmDisabled={!payable || !checked}
      disabledHint={view?.blocked ?? '이체를 마쳤다고 체크하면 기록 버튼이 켜집니다.'}
      loading={loading}
      initialFocus={payable ? 'check' : 'close'}
      onConfirm={() => {
        if (payable && checked) onConfirm();
      }}
      onClose={() => {
        if (!loading) onClose();
      }}
    />
  );
}
