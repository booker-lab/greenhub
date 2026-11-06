'use client';

import { Button } from '@greenhub/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { Field, FieldDescription, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { useEffect, useId, useState } from 'react';
import { isRoundCancelConfirmationValid } from './page.logic';

interface RoundCancelModalProps {
  opened: boolean;
  roundName: string;
  /** 멈춘 취소를 이어서 진행하는지 */
  resume: boolean;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

// ① 외형 유지(UI 교체 P4): Mantine Modal(radius lg, 가운데)·Stack(sm 12px)·Text·TextInput(설명 포함)·Group·Button과 같은 값.
const TEXT = 'm-0 p-0 text-base font-normal';

// 회차 취소(관리자 전용). 되돌릴 수 없으므로 회차 이름을 그대로 입력해야 보낸다.
// 서버는 결제된 주문을 하나씩 환불하므로 끝날 때까지 창을 닫지 못하게 한다.
export function RoundCancelModal({
  opened,
  roundName,
  resume,
  loading,
  onConfirm,
  onClose,
}: RoundCancelModalProps) {
  const [typedName, setTypedName] = useState('');
  const confirmed = isRoundCancelConfirmationValid(typedName, roundName);
  const inputId = useId();

  useEffect(() => {
    if (opened) setTypedName('');
  }, [opened]);

  const close = () => {
    if (!loading) onClose();
  };

  return (
    <Dialog
      open={opened}
      onOpenChange={(open) => {
        // 처리 중에는 바깥 누름·Esc로 닫지 않는다(close가 막는다).
        if (!open) close();
      }}
    >
      <DialogContent showCloseButton={!loading}>
        <DialogHeader>
          <DialogTitle className="leading-[1.55] font-bold">
            {resume ? '회차 취소 다시 진행' : '회차 취소'}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-stretch justify-start gap-3">
            {resume && (
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}
              >
                멈춘 회차 취소를 이어서 진행해요. 이미 환불한 주문은 다시 환불하지 않아요.
              </p>
            )}
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              결제된 주문은 모두 환불되고, 고객에게 회차 취소 안내 알림톡(정해진 사유 문구)이 가요.
              되돌릴 수 없어요.
            </p>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              환불을 주문마다 하나씩 처리해서 몇 분 걸릴 수 있어요. 끝날 때까지 이 화면을 닫지
              마세요.
            </p>
            <Field>
              <FieldLabel htmlFor={inputId}>
                확인을 위해 회차 이름을 그대로 입력해 주세요
              </FieldLabel>
              <FieldDescription id={`${inputId}-description`}>{roundName}</FieldDescription>
              <Input
                id={inputId}
                aria-describedby={`${inputId}-description`}
                value={typedName}
                onChange={(event) => setTypedName(event.currentTarget.value)}
                disabled={loading}
                autoComplete="off"
              />
            </Field>
            <div className="flex flex-row flex-wrap items-center justify-start gap-2.5">
              <Button
                onClick={onConfirm}
                disabled={!confirmed || loading}
                variant="destructive"
                className="flex-1"
                style={{ fontWeight: 'var(--fw-medium)' }}
              >
                {loading ? '취소하는 중…' : resume ? '다시 진행' : '회차 취소'}
              </Button>
              <Button onClick={close} disabled={loading} variant="outline-gray" className="flex-1">
                닫기
              </Button>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
