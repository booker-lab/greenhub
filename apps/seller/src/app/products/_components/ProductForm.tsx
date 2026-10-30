'use client';

import { Button } from '@greenhub/ui/components/button';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { useStoreSalesMode } from '@/hooks/useStoreSalesMode';
import AIPreviewPanel from './AIPreviewPanel';
import type { ProductFormProps } from './productForm.types';
import SellerNoteInput from './SellerNoteInput';
import { StepIndicator } from './StepIndicator';
import { Step1Basic } from './steps/Step1Basic';
import { Step5Pricing } from './steps/Step5Pricing';
import TouchSelector from './TouchSelector';
import { useProductForm } from './useProductForm';

export type { ProductFormData, ProductFormProps } from './productForm.types';

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 16px·줄 높이 1.55·여백 0)·UnstyledButton·Container(sm = 720px) 값.
const TEXT = 'm-0 p-0 text-base font-normal';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';

export default function ProductForm(props: ProductFormProps) {
  const { mode, storeId, token } = props;
  const router = useRouter();
  const f = useProductForm(props);
  const salesMode = useStoreSalesMode(storeId, token);

  function renderStep() {
    switch (f.step) {
      case 1:
        return (
          <Step1Basic
            storeId={storeId}
            token={token}
            form={f.form}
            set={f.set}
            setAvailableStemTypes={f.setAvailableStemTypes}
            setError={f.setError}
          />
        );
      case 2:
        return (
          <TouchSelector
            value={f.form.selection}
            onChange={(s) => f.set('selection', s)}
            availableStemTypes={f.availableStemTypes}
          />
        );
      case 3:
        return (
          <SellerNoteInput value={f.form.sellerNote} onChange={(v) => f.set('sellerNote', v)} />
        );
      case 4:
        return (
          <AIPreviewPanel
            loading={f.aiLoading}
            headline={f.form.content.headline}
            description={f.form.content.description}
            isEditedByUser={f.form.content.isEditedByUser}
            conflicts={f.conflicts}
            onHeadlineChange={(v) => f.setContent({ headline: v, isEditedByUser: true })}
            onDescriptionChange={(v) => f.setContent({ description: v, isEditedByUser: true })}
            onRegenerate={f.generateContent}
            onSellerOverride={() => {
              f.set('sellerOverride', true);
              f.setConflicts([]);
            }}
          />
        );
      case 5:
        return (
          <Step5Pricing
            storeId={storeId}
            token={token}
            form={f.form}
            set={f.set}
            setGroupConfig={f.setGroupConfig}
            salesMode={salesMode}
          />
        );
    }
  }

  return (
    <PageShell>
      <PageHeader
        title={mode === 'create' ? '상품 등록' : '상품 수정'}
        onBack={() => router.back()}
        right={
          <div className="flex flex-row flex-wrap items-center justify-start gap-2.5">
            <button
              type="button"
              onClick={f.handleDraftReset}
              className={UNSTYLED_BUTTON}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              초기화
            </button>
            <button
              type="button"
              onClick={f.handleDraftSave}
              className={UNSTYLED_BUTTON}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: f.draftSaved ? 'var(--color-primary-dark)' : 'var(--color-text-secondary)',
              }}
            >
              {f.draftSaved ? '저장됨 ✓' : '임시저장'}
            </button>
          </div>
        }
      />

      <StepIndicator step={f.step} />

      <div className="mx-auto max-w-[720px] px-4 pt-4 pb-24">
        <div className="flex flex-col gap-3">
          {renderStep()}
          {f.error && (
            <p
              className={`${TEXT} px-2.5 text-center`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
            >
              {f.error}
            </p>
          )}
          <div className="mt-2.5 flex flex-row flex-wrap items-center justify-start gap-2.5">
            {f.step > 1 && (
              <Button onClick={f.goPrev} variant="outline-gray" size="lg" className="flex-1">
                이전
              </Button>
            )}
            {f.step < 5 ? (
              <Button
                onClick={f.goNext}
                size="lg"
                className="flex-1"
                style={{ backgroundColor: 'var(--color-primary)', fontWeight: 'var(--fw-medium)' }}
              >
                다음
              </Button>
            ) : (
              <Button
                onClick={f.handleSubmit}
                disabled={f.submitting}
                size="lg"
                className="flex-1"
                style={{ backgroundColor: 'var(--color-primary)', fontWeight: 'var(--fw-medium)' }}
              >
                {f.submitting ? '처리 중...' : mode === 'create' ? '등록하기' : '저장하기'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
