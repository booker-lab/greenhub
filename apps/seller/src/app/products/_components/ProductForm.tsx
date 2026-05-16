'use client';

import { useRouter } from 'next/navigation';
import { Button, Container, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import TouchSelector from './TouchSelector';
import SellerNoteInput from './SellerNoteInput';
import AIPreviewPanel from './AIPreviewPanel';
import { StepIndicator } from './StepIndicator';
import { Step1Basic } from './steps/Step1Basic';
import { Step5Pricing } from './steps/Step5Pricing';
import { useProductForm } from './useProductForm';
import type { ProductFormProps } from './productForm.types';

export type { ProductFormData, ProductFormProps } from './productForm.types';

export default function ProductForm(props: ProductFormProps) {
  const { mode, storeId, token } = props;
  const router = useRouter();
  const f = useProductForm(props);

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
          <SellerNoteInput
            value={f.form.sellerNote}
            onChange={(v) => f.set('sellerNote', v)}
          />
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
        return <Step5Pricing form={f.form} set={f.set} setGroupConfig={f.setGroupConfig} />;
    }
  }

  return (
    <PageShell>
      <PageHeader
        title={mode === 'create' ? '상품 등록' : '상품 수정'}
        onBack={() => router.back()}
        right={
          <Group gap="xs">
            <UnstyledButton
              onClick={f.handleDraftReset}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              초기화
            </UnstyledButton>
            <UnstyledButton
              onClick={f.handleDraftSave}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: f.draftSaved ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              }}
            >
              {f.draftSaved ? '저장됨 ✓' : '임시저장'}
            </UnstyledButton>
          </Group>
        }
      />

      <StepIndicator step={f.step} />

      <Container size="sm" px="md" py="md" pb={96}>
        <Stack gap="sm">
          {renderStep()}
          {f.error && (
            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              ta="center"
              px="xs"
            >
              {f.error}
            </Text>
          )}
          <Group gap="xs" mt="xs">
            {f.step > 1 && (
              <Button
                onClick={f.goPrev}
                variant="outline"
                color="gray"
                flex={1}
                size="lg"
                radius="xl"
              >
                이전
              </Button>
            )}
            {f.step < 5 ? (
              <Button
                onClick={f.goNext}
                flex={1}
                size="lg"
                radius="xl"
                style={{ backgroundColor: 'var(--color-primary)', fontWeight: 'var(--fw-medium)' }}
              >
                다음
              </Button>
            ) : (
              <Button
                onClick={f.handleSubmit}
                disabled={f.submitting}
                flex={1}
                size="lg"
                radius="xl"
                style={{ backgroundColor: 'var(--color-primary)', fontWeight: 'var(--fw-medium)' }}
              >
                {f.submitting ? '처리 중...' : mode === 'create' ? '등록하기' : '저장하기'}
              </Button>
            )}
          </Group>
        </Stack>
      </Container>
    </PageShell>
  );
}
