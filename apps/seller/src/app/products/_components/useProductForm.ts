'use client';

import { apiPathSegment, FEATURE_KEYS } from '@greenhub/shared';
import { useEffect, useRef, useState } from 'react';
import { useResettableTimeout } from '@/hooks/useResettableTimeout';
import { apiJson } from '@/lib/api';
import { marketRefBody } from '@/lib/market-price';
import { isFeatureOn } from '@/lib/features';
import type { ConflictWarning } from './AIPreviewPanel';
import { extrasBody, fillNoticeDefaults, type NoticeStoreDefaults, noticeBody } from './productExtras';
import {
  defaultForm,
  type GroupConfigForm,
  type ProductFormData,
  type ProductFormProps,
} from './productForm.types';
import { useTokenRef } from '@/lib/use-token-ref';

/** 상품정보제공고시의 빈 칸만 기본값(생산자=매장명, 상담 전화=사업자 프로필 연락처)으로 채운다. */
function withNoticeDefaults(form: ProductFormData, defaults: NoticeStoreDefaults): ProductFormData {
  return { ...form, extras: { ...form.extras, notice: fillNoticeDefaults(form.extras.notice, defaults) } };
}

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

  // 매장에서 읽은 고시 기본값. 폼을 새로 채울 때마다 빈 칸에만 넣는다.
  const noticeDefaults = useRef<NoticeStoreDefaults>({ producer: '', csPhone: '' });
  // 토큰 갱신만으로 매장 정보를 다시 읽어 판매자가 비운 고시 칸을 다시 채우지 않는다.
  const { tokenRef, hasToken } = useTokenRef(token);

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
  const draftSavedResetTimer = useResettableTimeout();

  // 신규 등록 시에만 localStorage 임시저장 복원
  useEffect(() => {
    if (initialData) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const p = JSON.parse(saved);
        const def = defaultForm();
        setForm(
          withNoticeDefaults(
            {
              ...def,
              ...p,
              groupConfig: { ...def.groupConfig, ...(p.groupConfig ?? {}) },
              selection: { ...def.selection, ...(p.selection ?? {}) },
              content: { ...def.content, ...(p.content ?? {}) },
              extras: {
                ...def.extras,
                ...(p.extras ?? {}),
                notice: { ...def.extras.notice, ...(p.extras?.notice ?? {}) },
              },
              marketRef: { ...def.marketRef, ...(p.marketRef ?? {}) },
            },
            noticeDefaults.current,
          ),
        );
        if (p._step) setStep(p._step);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, initialData]);

  // 수정 모드: 비동기로 도착한 initialData 반영
  useEffect(() => {
    if (initialData?.name) {
      setForm(withNoticeDefaults({ ...defaultForm(), ...initialData }, noticeDefaults.current));
    }
  }, [initialData?.name, initialData]);

  // 매장 이름·연락처를 읽어 고시의 빈 생산자·상담 전화 칸을 채운다. 실패하면 빈 칸으로 두고 판매자가 직접 쓴다.
  useEffect(() => {
    if (!storeId || !hasToken) return;
    let active = true;
    apiJson<{ name?: string; phone?: string }>(`/stores/${apiPathSegment(storeId)}`, tokenRef.current)
      .then((store) => {
        if (!active) return;
        const defaults = { producer: store.name?.trim() ?? '', csPhone: store.phone?.trim() ?? '' };
        noticeDefaults.current = defaults;
        setForm((prev) => withNoticeDefaults(prev, defaults));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [storeId, hasToken, tokenRef]);

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
      draftSavedResetTimer.schedule(() => setDraftSaved(false), 2000);
    } catch {}
  }

  function handleDraftReset() {
    try {
      localStorage.removeItem(draftKey);
    } catch {}
    setForm(withNoticeDefaults(defaultForm(), noticeDefaults.current));
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
    // 상품정보제공고시는 법정 표시라 기능 토글과 상관없이 항상 보낸다.
    const notice = noticeBody(form.extras.notice);
    if (!notice.ok) {
      setError(notice.error);
      setSubmitting(false);
      return;
    }
    body.notice = notice.body;
    // 경매 시세 연결은 판매자 전용이라 항상 보낸다. 고치기에서 null은 연결을 지운다.
    const marketRef = marketRefBody(form.marketRef);
    if (!marketRef.ok) {
      setError(marketRef.error);
      setSubmitting(false);
      return;
    }
    if (marketRef.body || mode === 'edit') body.marketRef = marketRef.body;
    if (FEATURE_KEYS.some(isFeatureOn)) {
      const extras = extrasBody(form.extras);
      if (!extras.ok) {
        setError(extras.error);
        setSubmitting(false);
        return;
      }
      Object.assign(body, extras.body);
    }
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
          ? `/stores/${apiPathSegment(storeId)}/products`
          : `/stores/${apiPathSegment(storeId)}/products/${apiPathSegment(productId)}`;
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
