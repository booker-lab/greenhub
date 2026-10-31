'use client';

import { Button } from '@greenhub/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { Textarea } from '@greenhub/ui/components/textarea';
import { useEffect, useState } from 'react';
import { BUTTON_LOADING, ButtonLoader } from '@/app/orders/[id]/_components/ButtonLoading';
import { ISSUE_LABELS } from '@/app/orders/[id]/operation-issues';
import {
  isValidManualResolveMemo,
  MANUAL_RESOLVE_MEMO_MAX_LENGTH,
  normalizeManualResolveMemo,
  type StoreOperationIssue,
} from './manual-resolve';

// ① 외형 유지(UI 교체 P4): Mantine Modal(가운데, radius lg)·Stack(gap sm = 12px)·Text(p, 여백 0, 줄 높이 1.55)·
// Textarea(autosize 3줄, radius md)·Group(gap xs)·Button(loading)과 같은 값.
const TEXT = 'm-0 p-0 text-base font-normal';

interface ResolveIssueModalProps {
  issue: StoreOperationIssue | null;
  onClose: () => void;
  onConfirm: (issue: StoreOperationIssue, memo: string) => Promise<void>;
}

export function ResolveIssueModal({ issue, onClose, onConfirm }: ResolveIssueModalProps) {
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (issue) {
      setMemo('');
      setError(null);
    }
  }, [issue]);

  const normalizedLength = normalizeManualResolveMemo(memo).length;
  const valid = isValidManualResolveMemo(memo);

  const handleConfirm = async () => {
    if (!issue || !valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(issue, memo);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '기록을 닫지 못했어요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={issue !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="leading-[1.55] font-bold">해결로 닫기</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            {issue && (
              <p className={TEXT} style={{ fontWeight: 'var(--fw-medium)' }}>
                {ISSUE_LABELS[issue.type]}
              </p>
            )}
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              어떻게 처리했는지 메모로 남겨 주세요. 닫으면 홈 "운영 확인"과 아침 요약에서 빠지고,
              누가 언제 닫았는지 함께 남아요. 같은 문제가 다시 생기면 자동으로 다시 열려요.
            </p>
            <Textarea
              value={memo}
              onChange={(event) => setMemo(event.currentTarget.value)}
              placeholder="예: 고객과 통화해 배송 사진을 다시 확인했어요"
              aria-label="닫는 이유 메모"
              autosize
              minRows={3}
              maxLength={MANUAL_RESOLVE_MEMO_MAX_LENGTH}
              className="rounded-[8px]"
              disabled={submitting}
            />
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-disabled)',
                textAlign: 'right',
              }}
            >
              {normalizedLength}/{MANUAL_RESOLVE_MEMO_MAX_LENGTH}
            </p>
            {error && (
              <p
                role="alert"
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                {error}
              </p>
            )}
            <div className="flex flex-row flex-wrap items-center justify-start gap-2.5">
              <Button
                onClick={() => void handleConfirm()}
                disabled={!valid || submitting}
                data-loading={submitting || undefined}
                aria-busy={submitting || undefined}
                className={`flex-1 ${submitting ? BUTTON_LOADING.default : ''}`}
                style={{ fontWeight: 'var(--fw-medium)' }}
              >
                {submitting && <ButtonLoader variant="default" height={36} />}
                해결로 닫기
              </Button>
              <Button
                onClick={onClose}
                disabled={submitting}
                variant="outline-gray"
                className="flex-1"
              >
                취소
              </Button>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
