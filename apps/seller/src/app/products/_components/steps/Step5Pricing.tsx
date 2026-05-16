'use client';

import { Group, NumberInput, Stack, Text } from '@mantine/core';
import GroupConfigSection from '../GroupConfigSection';
import { ChoiceRow, FieldCard } from '../FormPrimitives';
import {
  DELIVERY_SIZES,
  type GroupConfigForm,
  type ProductFormData,
} from '../productForm.types';

interface Step5PricingProps {
  form: ProductFormData;
  set: <K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) => void;
  setGroupConfig: <K extends keyof GroupConfigForm>(key: K, value: GroupConfigForm[K]) => void;
}

export function Step5Pricing({ form, set, setGroupConfig }: Step5PricingProps) {
  return (
    <Stack gap="sm">
      <NumberInput
        placeholder="가격"
        leftSection={
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
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
      <FieldCard label="배송 사이즈">
        <ChoiceRow
          options={DELIVERY_SIZES}
          value={form.deliverySize}
          onChange={(v) => set('deliverySize', v)}
        />
      </FieldCard>
      <FieldCard label="판매 방식" labelGap="sm">
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
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
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
      </FieldCard>
    </Stack>
  );
}
