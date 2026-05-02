'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ImageUpload from './ImageUpload';
import GroupConfigSection from './GroupConfigSection';
import VarietySelector from './VarietySelector';
import TouchSelector, { type SelectionForm } from './TouchSelector';
import SellerNoteInput from './SellerNoteInput';
import AIPreviewPanel, { type ConflictWarning } from './AIPreviewPanel';
import {
  ActionIcon,
  Box,
  Button,
  Container,
  Group,
  NumberInput,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';

const CATEGORIES = [
  { value: 'cut_flower', label: '절화' },
  { value: 'orchid', label: '난' },
  { value: 'foliage', label: '관엽' },
] as const;

const DELIVERY_SIZES = [
  { value: 'small', label: '소형' },
  { value: 'medium', label: '중형' },
  { value: 'large', label: '대형' },
] as const;

const STEP_LABELS = ['사진·품종', '터치 선택', '판매자 메모', 'AI 미리보기', '가격·배송'];

interface GroupConfigForm {
  minQuantity: string;
  targetQuantity: string;
  maxPerPerson: string;
  recruitDeadline: string;
  groupDeliveryDate: string;
  groupDeliveryMethod: 'direct' | 'parcel';
}

interface ContentForm {
  headline: string;
  description: string;
  isEditedByUser: boolean;
}

export interface ProductFormData {
  name: string;
  category: string;
  deliverySize: string;
  price: string;
  saleType: 'normal' | 'group';
  groupConfig: GroupConfigForm;
  images: string[];
  varietyId: string;
  selection: SelectionForm;
  sellerNote: string;
  content: ContentForm;
  sellerOverride: boolean;
}

export interface ProductFormProps {
  mode: 'create' | 'edit';
  productId?: string;
  storeId: string;
  token: string;
  initialData?: Partial<ProductFormData>;
  onSuccess: () => void;
}

function defaultForm(): ProductFormData {
  return {
    name: '',
    category: 'cut_flower',
    deliverySize: 'small',
    price: '',
    saleType: 'normal',
    groupConfig: {
      minQuantity: '10',
      targetQuantity: '50',
      maxPerPerson: '5',
      recruitDeadline: '',
      groupDeliveryDate: '',
      groupDeliveryMethod: 'direct',
    },
    images: [],
    varietyId: '',
    selection: {
      colors: [],
      stemType: '외대',
      fragrance: 'none',
      bloomCondition: 'half',
      careLevel: 'normal',
      bundleUnit: '',
    },
    sellerNote: '',
    content: { headline: '', description: '', isEditedByUser: false },
    sellerOverride: false,
  };
}

export default function ProductForm({
  mode,
  productId,
  storeId,
  token,
  initialData,
  onSuccess,
}: ProductFormProps) {
  const router = useRouter();
  const draftKey = mode === 'create' ? 'product_draft_new' : `product_draft_${productId}`;

  const [form, setForm] = useState<ProductFormData>(() =>
    initialData ? { ...defaultForm(), ...initialData } : defaultForm(),
  );

  useEffect(() => {
    if (initialData) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const p = JSON.parse(saved);
        const def = defaultForm();
        setForm({
          ...def,
          ...p,
          groupConfig: { ...def.groupConfig, ...(p.groupConfig ?? {}) },
          selection: { ...def.selection, ...(p.selection ?? {}) },
          content: { ...def.content, ...(p.content ?? {}) },
        });
        if (p._step) setStep(p._step);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, initialData]);

  const [step, setStep] = useState(1);
  const [availableStemTypes, setAvailableStemTypes] = useState<string[] | undefined>(undefined);
  const [conflicts, setConflicts] = useState<ConflictWarning[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);

  useEffect(() => {
    if (initialData?.name) setForm({ ...defaultForm(), ...initialData });
  }, [initialData?.name, initialData]);

  function set<K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setGroupConfig<K extends keyof GroupConfigForm>(key: K, value: GroupConfigForm[K]) {
    setForm((prev) => ({ ...prev, groupConfig: { ...prev.groupConfig, [key]: value } }));
  }

  function handleDraftSave() {
    try {
      localStorage.setItem(draftKey, JSON.stringify(form));
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    } catch {}
  }

  function handleDraftReset() {
    try {
      localStorage.removeItem(draftKey);
    } catch {}
    setForm(defaultForm());
    setStep(1);
    setError(null);
  }

  async function generateContent() {
    setAiLoading(true);
    setConflicts([]);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai/generate-content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          varietyId: form.varietyId || undefined,
          category: form.category || undefined,
          selection: form.selection,
          sellerNote: form.sellerNote,
        }),
      });
      if (!res.ok) throw new Error('AI 생성 실패');
      const data = await res.json();
      setConflicts(data.conflicts ?? []);
      setError(null);
      setForm((prev) => ({
        ...prev,
        content: { headline: data.headline, description: data.description, isEditedByUser: false },
      }));
    } catch {
      setError('AI 생성 중 오류가 발생했습니다.');
    } finally {
      setAiLoading(false);
    }
  }

  function validateStep(s: number): string | null {
    if (s === 1 && !form.name.trim()) return '상품명을 입력해주세요.';
    if (s === 2 && form.selection.colors.length === 0) return '색상을 하나 이상 선택해주세요.';
    return null;
  }

  async function goNext() {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    const next = step + 1;
    setStep(next);
    localStorage.setItem(draftKey, JSON.stringify({ ...form, _step: next }));
    if (next === 4 && !form.content.headline) {
      await generateContent();
    }
  }

  function goPrev() {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  async function handleSubmit() {
    if (!form.price || Number.isNaN(Number(form.price)) || Number(form.price) < 0) {
      setError('올바른 가격을 입력해주세요.');
      return;
    }
    if (form.saleType === 'group') {
      const g = form.groupConfig;
      if (!g.minQuantity || Number(g.minQuantity) < 1) {
        setError('최소 수량을 입력해주세요.');
        return;
      }
      if (!g.targetQuantity || Number(g.targetQuantity) < 1) {
        setError('목표 수량을 입력해주세요.');
        return;
      }
      if (!g.maxPerPerson || Number(g.maxPerPerson) < 1) {
        setError('1인 최대 구매 수량을 입력해주세요.');
        return;
      }
      if (!g.recruitDeadline) {
        setError('모집 마감일시를 입력해주세요.');
        return;
      }
      if (!g.groupDeliveryDate) {
        setError('배송 예정일을 입력해주세요.');
        return;
      }
      if (Number(g.minQuantity) > Number(g.targetQuantity)) {
        setError('최소 수량은 목표 수량보다 클 수 없습니다.');
        return;
      }
      if (new Date(g.recruitDeadline) <= new Date()) {
        setError('모집 마감일시는 현재 시각 이후여야 합니다.');
        return;
      }
      if (new Date(g.groupDeliveryDate) <= new Date(g.recruitDeadline)) {
        setError('배송 예정일은 모집 마감일 이후여야 합니다.');
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      images: form.images,
      price: Number(form.price),
      category: form.category,
      saleType: form.saleType,
      deliverySize: form.deliverySize,
      varietyId: form.varietyId || undefined,
      selection: form.selection,
      sellerNote: form.sellerNote,
      content: form.content,
      sellerOverride: form.sellerOverride,
    };
    if (form.saleType === 'group') {
      body.groupConfig = {
        minQuantity: Number(form.groupConfig.minQuantity),
        targetQuantity: Number(form.groupConfig.targetQuantity),
        maxPerPerson: Number(form.groupConfig.maxPerPerson),
        recruitDeadline: new Date(form.groupConfig.recruitDeadline).toISOString(),
        groupDeliveryDate: new Date(form.groupConfig.groupDeliveryDate).toISOString(),
        groupDeliveryMethod: form.groupConfig.groupDeliveryMethod,
        deliveryFeeDiscount: 0,
      };
    }
    try {
      const url =
        mode === 'create'
          ? `/stores/${storeId}/products`
          : `/stores/${storeId}/products/${productId}`;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${url}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `서버 오류 (${res.status})`);
      }
      localStorage.removeItem(draftKey);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  function renderStep() {
    switch (step) {
      case 1:
        return (
          <Stack gap="sm">
            <ImageUpload
              storeId={storeId}
              images={form.images}
              onChange={(images) => set('images', images)}
              onError={(msg) => setError(msg)}
            />
            <TextInput
              placeholder="상품명"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              radius="xl"
              size="md"
            />
            <Paper radius="lg" shadow="xs" p="md">
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-medium)',
                  color: 'var(--color-text-disabled)',
                }}
                mb="xs"
              >
                카테고리
              </Text>
              <Group gap="xs">
                {CATEGORIES.map(({ value, label }) => (
                  <Button
                    key={value}
                    onClick={() => set('category', value)}
                    flex={1}
                    size="sm"
                    radius="xl"
                    variant={form.category === value ? 'filled' : 'outline'}
                    color="gray"
                    style={
                      form.category === value
                        ? {
                            backgroundColor: 'var(--color-primary)',
                            borderColor: 'var(--color-primary)',
                            color: 'white',
                          }
                        : {}
                    }
                  >
                    {label}
                  </Button>
                ))}
              </Group>
            </Paper>
            <Paper radius="lg" shadow="xs" p="md">
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-medium)',
                  color: 'var(--color-text-disabled)',
                }}
                mb="xs"
              >
                품종 선택
              </Text>
              <VarietySelector
                category={form.category}
                value={form.varietyId}
                onChange={(id) => set('varietyId', id)}
                onVarietyChange={(v) => setAvailableStemTypes(v?.availableStemTypes)}
                token={token}
              />
            </Paper>
          </Stack>
        );
      case 2:
        return (
          <TouchSelector
            value={form.selection}
            onChange={(s) => set('selection', s)}
            availableStemTypes={availableStemTypes}
          />
        );
      case 3:
        return <SellerNoteInput value={form.sellerNote} onChange={(v) => set('sellerNote', v)} />;
      case 4:
        return (
          <AIPreviewPanel
            loading={aiLoading}
            headline={form.content.headline}
            description={form.content.description}
            isEditedByUser={form.content.isEditedByUser}
            conflicts={conflicts}
            onHeadlineChange={(v) =>
              setForm((p) => ({
                ...p,
                content: { ...p.content, headline: v, isEditedByUser: true },
              }))
            }
            onDescriptionChange={(v) =>
              setForm((p) => ({
                ...p,
                content: { ...p.content, description: v, isEditedByUser: true },
              }))
            }
            onRegenerate={generateContent}
            onSellerOverride={() => {
              set('sellerOverride', true);
              setConflicts([]);
            }}
          />
        );
      case 5:
        return (
          <Stack gap="sm">
            <NumberInput
              placeholder="가격"
              leftSection={
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  ₩
                </Text>
              }
              thousandSeparator=","
              min={0}
              hideControls
              value={form.price === '' ? '' : Number(form.price)}
              onChange={(val) => set('price', val === '' ? '' : String(val))}
              radius="xl"
              size="md"
            />
            <Paper radius="lg" shadow="xs" p="md">
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-medium)',
                  color: 'var(--color-text-disabled)',
                }}
                mb="xs"
              >
                배송 사이즈
              </Text>
              <Group gap="xs">
                {DELIVERY_SIZES.map(({ value, label }) => (
                  <Button
                    key={value}
                    onClick={() => set('deliverySize', value)}
                    flex={1}
                    size="sm"
                    radius="xl"
                    variant="outline"
                    color="gray"
                    style={
                      form.deliverySize === value
                        ? {
                            backgroundColor: 'var(--color-primary)',
                            borderColor: 'var(--color-primary)',
                            color: 'white',
                          }
                        : {}
                    }
                  >
                    {label}
                  </Button>
                ))}
              </Group>
            </Paper>
            <Paper radius="lg" shadow="xs" p="md">
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-medium)',
                  color: 'var(--color-text-disabled)',
                }}
                mb="sm"
              >
                판매 방식
              </Text>
              <Group gap="xl">
                {(['normal', 'group'] as const).map((type) => (
                  <label
                    key={type}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name="saleType"
                      checked={form.saleType === type}
                      onChange={() => set('saleType', type)}
                      style={{ accentColor: 'var(--color-primary)', width: 16, height: 16 }}
                    />
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {type === 'normal' ? '일반 판매' : '공동구매'}
                    </Text>
                  </label>
                ))}
              </Group>
              <GroupConfigSection
                visible={form.saleType === 'group'}
                config={form.groupConfig}
                setGroupConfig={setGroupConfig}
              />
            </Paper>
          </Stack>
        );
    }
  }

  return (
    <Box
      component="main"
      style={{ minHeight: '100vh', backgroundColor: 'var(--color-surface-muted)' }}
    >
      <Box
        component="header"
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          padding: '16px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Group justify="space-between">
            <Group gap="sm">
              <ActionIcon variant="subtle" color="gray" onClick={() => router.back()}>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M19 12H5M12 5l-7 7 7 7" />
                </svg>
              </ActionIcon>
              <Title order={3}>{mode === 'create' ? '상품 등록' : '상품 수정'}</Title>
            </Group>
            <Group gap="xs">
              <UnstyledButton
                onClick={handleDraftReset}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                초기화
              </UnstyledButton>
              <UnstyledButton
                onClick={handleDraftSave}
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-medium)',
                  color: draftSaved ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                }}
              >
                {draftSaved ? '저장됨 ✓' : '임시저장'}
              </UnstyledButton>
            </Group>
          </Group>
        </Container>
      </Box>

      <Box
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          padding: '8px 16px',
        }}
      >
        <Container size="sm">
          <Group gap={0}>
            {STEP_LABELS.map((label, i) => {
              const s = i + 1;
              const active = s === step;
              const done = s < step;
              return (
                <Box key={s} style={{ flex: 1, textAlign: 'center', padding: '4px 2px' }}>
                  <Box
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      margin: '0 auto 2px',
                      backgroundColor: active
                        ? 'var(--color-primary)'
                        : done
                          ? 'var(--color-primary-surface)'
                          : 'var(--color-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--fw-medium)',
                      color: active
                        ? 'white'
                        : done
                          ? 'var(--color-primary)'
                          : 'var(--color-text-disabled)',
                    }}
                  >
                    {done ? '✓' : s}
                  </Box>
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: active ? 'var(--color-primary)' : 'var(--color-text-disabled)',
                      fontWeight: active ? 'var(--fw-medium)' : 400,
                    }}
                  >
                    {label}
                  </Text>
                </Box>
              );
            })}
          </Group>
        </Container>
      </Box>

      <Container size="sm" px="md" py="md" pb={96}>
        <Stack gap="sm">
          {renderStep()}
          {error && (
            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              ta="center"
              px="xs"
            >
              {error}
            </Text>
          )}
          <Group gap="xs" mt="xs">
            {step > 1 && (
              <Button
                onClick={goPrev}
                variant="outline"
                color="gray"
                flex={1}
                size="lg"
                radius="xl"
              >
                이전
              </Button>
            )}
            {step < 5 ? (
              <Button
                onClick={goNext}
                flex={1}
                size="lg"
                radius="xl"
                style={{ backgroundColor: 'var(--color-primary)', fontWeight: 'var(--fw-medium)' }}
              >
                다음
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                flex={1}
                size="lg"
                radius="xl"
                style={{ backgroundColor: 'var(--color-primary)', fontWeight: 'var(--fw-medium)' }}
              >
                {submitting ? '처리 중...' : mode === 'create' ? '등록하기' : '저장하기'}
              </Button>
            )}
          </Group>
        </Stack>
      </Container>
    </Box>
  );
}
