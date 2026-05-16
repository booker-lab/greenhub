'use client';

import { Stack, TextInput } from '@mantine/core';
import ImageUpload from '../ImageUpload';
import VarietySelector from '../VarietySelector';
import { ChoiceRow, FieldCard } from '../FormPrimitives';
import { CATEGORIES, type ProductFormData } from '../productForm.types';

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
    </Stack>
  );
}
