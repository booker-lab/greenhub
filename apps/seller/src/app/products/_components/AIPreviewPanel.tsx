'use client';

import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Button, ButtonLabel } from '@greenhub/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { Input } from '@greenhub/ui/components/input';
import { Loader } from '@greenhub/ui/components/loader';
import { Textarea } from '@greenhub/ui/components/textarea';
import { useState } from 'react';

// ① 외형 유지(UI 교체 P2b): Mantine Paper(흰 바탕·모서리 16·그림자 xs·안쪽 16)·Text(p, 여백 0)·Group·Stack 값.
const PAPER = 'block rounded-[16px] bg-white p-4';
const TEXT = 'm-0 p-0 text-base font-normal';
const LABEL_STYLE = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--color-text-disabled)',
} as const;

export interface ConflictWarning {
  field: string;
  message: string;
  suggestion: string;
}

interface Props {
  loading: boolean;
  headline: string;
  description: string;
  isEditedByUser: boolean;
  conflicts: ConflictWarning[];
  onHeadlineChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onRegenerate: () => Promise<void>;
  onSellerOverride: () => void;
}

export default function AIPreviewPanel({
  loading,
  headline,
  description,
  isEditedByUser,
  conflicts,
  onHeadlineChange,
  onDescriptionChange,
  onRegenerate,
  onSellerOverride,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function handleRegenerate() {
    setConfirmOpen(false);
    setRegenerating(true);
    await onRegenerate();
    setRegenerating(false);
  }

  if (loading || regenerating) {
    return (
      <div className="flex flex-col items-center justify-start gap-4 py-8">
        <Loader size="md" />
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          AI가 상세 페이지를 작성하는 중...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {conflicts.length > 0 && (
        <Alert variant="warning">
          <AlertTitle>가드레일 충돌 감지</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-2.5">
              {conflicts.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: AI 응답 1회성 list — reorder/insert 없음
                <p key={i} className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                  {c.message}
                  <br />
                  <span
                    className={TEXT}
                    style={{
                      color: 'var(--color-text-secondary)',
                      fontSize: 'var(--font-size-sm)',
                    }}
                  >
                    {c.suggestion}
                  </span>
                </p>
              ))}
            </div>
            <div className="mt-3 flex flex-row flex-wrap items-center justify-start gap-2.5">
              <Button size="xs" variant="outline-warning" onClick={handleRegenerate}>
                수정 반영하기
              </Button>
              <Button size="xs" variant="ghost" onClick={onSellerOverride}>
                그대로 등록하기
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className={PAPER}>
        <p className={`${TEXT} mb-2.5`} style={LABEL_STYLE}>
          헤드라인 (AI 생성)
        </p>
        <Input
          value={headline}
          onChange={(e) => onHeadlineChange(e.target.value)}
          placeholder="AI가 생성한 마케팅 문구"
          size="md"
          className="rounded-[8px]"
        />
        <p
          className={`${TEXT} mt-1 text-right`}
          style={{
            fontSize: 'var(--font-size-sm)',
            color:
              headline.length > 15
                ? 'var(--color-status-warning-text)'
                : 'var(--color-text-disabled)',
          }}
        >
          {headline.length} / 15자 권장
        </p>
      </div>

      <div className={PAPER}>
        <p className={`${TEXT} mb-2.5`} style={LABEL_STYLE}>
          상세 설명 (AI 생성)
        </p>
        <Textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="AI가 생성한 상세 설명"
          autosize
          minRows={5}
          className="rounded-[8px]"
          style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.7 }}
        />
      </div>

      <Button
        variant="ghost"
        onClick={() => (isEditedByUser ? setConfirmOpen(true) : handleRegenerate())}
      >
        다시 생성하기
      </Button>

      {/* Mantine Modal size xs = 320px. */}
      <Dialog open={confirmOpen} onOpenChange={(open) => !open && setConfirmOpen(false)}>
        <DialogContent className="w-[320px]">
          <DialogHeader>
            <DialogTitle>다시 생성하기</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className={`${TEXT} mb-4`} style={{ fontSize: 'var(--font-size-sm)' }}>
              직접 편집한 내용이 있습니다. 새로 생성하면 편집 내용이 사라집니다.
            </p>
            <div className="flex flex-row flex-wrap items-center justify-end gap-2.5">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                <ButtonLabel>취소</ButtonLabel>
              </Button>
              <Button variant="destructive" onClick={handleRegenerate}>
                <ButtonLabel>새로 생성</ButtonLabel>
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
