'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import type { ConflictWarning } from './AIPreviewPanel';
import {
  type GroupConfigForm,
  type ProductFormData,
  type ProductFormProps,
  defaultForm,
} from './productForm.types';

/** ProductForm의 상태·검증·임시저장·제출 로직을 모두 담는 훅. */
export function useProductForm({
  mode,
  productId,
  storeId,
  token,
  initialData,
  onSuccess,
}: ProductFormProps) {
  const draftKey = mode === 'create' ? 'product_draft_new' : `product_draft_${productId}`;

  const [form, setForm] = useState<ProductFormData>(() =>
    initialData ? { ...defaultForm(), ...initialData } : defaultForm(),
  );
  const [step, setStep] = useState(1);
  const [availableStemTypes, setAvailableStemTypes] = useState<string[] | undefined>(undefined);
  const [conflicts, setConflicts] = useState<ConflictWarning[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);

  // 신규 등록 시에만 localStorage 임시저장 복원
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

  // 수정 모드: 비동기로 도착한 initialData 반영
  useEffect(() => {
    if (initialData?.name) setForm({ ...defaultForm(), ...initialData });
  }, [initialData?.name, initialData]);

  function set<K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setGroupConfig<K extends keyof GroupConfigForm>(key: K, value: GroupConfigForm[K]) {
    setForm((prev) => ({ ...prev, groupConfig: { ...prev.groupConfig, [key]: value } }));
  }

  function setContent(patch: Partial<ProductFormData['content']>) {
    setForm((prev) => ({ ...prev, content: { ...prev.content, ...patch } }));
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
      const data = await apiJson<{
        headline: string;
        description: string;
        conflicts?: ConflictWarning[];
      }>('/ai/generate-content', token, {
        method: 'POST',
        body: JSON.stringify({
          varietyId: form.varietyId || undefined,
          category: form.category || undefined,
          selection: form.selection,
          sellerNote: form.sellerNote,
        }),
      });
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

  function validateSubmit(): string | null {
    if (!form.price || Number.isNaN(Number(form.price)) || Number(form.price) < 0) {
      return '올바른 가격을 입력해주세요.';
    }
    if (form.saleType === 'group') {
      const g = form.groupConfig;
      if (!g.minQuantity || Number(g.minQuantity) < 1) return '최소 수량을 입력해주세요.';
      if (!g.targetQuantity || Number(g.targetQuantity) < 1) return '목표 수량을 입력해주세요.';
      if (!g.maxPerPerson || Number(g.maxPerPerson) < 1)
        return '1인 최대 구매 수량을 입력해주세요.';
      if (!g.recruitDeadline) return '모집 마감일시를 입력해주세요.';
      if (!g.groupDeliveryDate) return '배송 예정일을 입력해주세요.';
      if (Number(g.minQuantity) > Number(g.targetQuantity))
        return '최소 수량은 목표 수량보다 클 수 없습니다.';
      if (new Date(g.recruitDeadline) <= new Date())
        return '모집 마감일시는 현재 시각 이후여야 합니다.';
      if (new Date(g.groupDeliveryDate) <= new Date(g.recruitDeadline))
        return '배송 예정일은 모집 마감일 이후여야 합니다.';
    }
    return null;
  }

  async function handleSubmit() {
    const err = validateSubmit();
    if (err) {
      setError(err);
      return;
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
      await apiJson(url, token, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      });
      localStorage.removeItem(draftKey);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return {
    form,
    set,
    setGroupConfig,
    setContent,
    step,
    availableStemTypes,
    setAvailableStemTypes,
    conflicts,
    setConflicts,
    aiLoading,
    submitting,
    error,
    setError,
    draftSaved,
    handleDraftSave,
    handleDraftReset,
    generateContent,
    goNext,
    goPrev,
    handleSubmit,
  };
}
