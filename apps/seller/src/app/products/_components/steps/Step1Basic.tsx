'use client';

import { Input } from '@greenhub/ui/components/input';
import { useId } from 'react';
import { Field, FieldLabel } from '../../../../components/Field';
import { ChoiceRow, FieldCard } from '../FormPrimitives';
import ImageUpload from '../ImageUpload';
import { CATEGORIES, type ProductFormData } from '../productForm.types';
import VarietySelector from '../VarietySelector';

interface Step1BasicProps {
  storeId: string;
  token: string;
  form: ProductFormData;
  set: <K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) => void;
  setAvailableStemTypes: (v: string[] | undefined) => void;
  setError: (msg: string) => void;
}

export function Step1Basic({
  storeId,
  token,
  form,
  set,
  setAvailableStemTypes,
  setError,
}: Step1BasicProps) {
  const nameId = useId();
  return (
    <div className="flex flex-col gap-3">
      <ImageUpload
        storeId={storeId}
        images={form.images}
        onChange={(images) => set('images', images)}
        onError={(msg) => setError(msg)}
      />
      {/* 값이 들어가도 무슨 칸인지 보이게 이름을 둔다(placeholder는 E2E가 찾는 값이라 그대로다). */}
      <Field>
        <FieldLabel htmlFor={nameId}>상품명</FieldLabel>
        <Input
          id={nameId}
          placeholder="상품명"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          size="md"
          className="rounded-xl"
        />
      </Field>
      <FieldCard label="카테고리">
        <ChoiceRow
          options={CATEGORIES}
          value={form.category}
          onChange={(v) => set('category', v)}
        />
      </FieldCard>
      <FieldCard label="품종 선택">
        <VarietySelector
          category={form.category}
          value={form.varietyId}
          onChange={(id) => set('varietyId', id)}
          onVarietyChange={(v) => setAvailableStemTypes(v?.availableStemTypes)}
          token={token}
        />
      </FieldCard>
    </div>
  );
}
