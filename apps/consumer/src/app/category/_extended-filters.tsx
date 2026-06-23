'use client';

import type { DeliveryMethod } from '@greenhub/shared';
import { Box, Group, UnstyledButton } from '@mantine/core';
import type { CSSProperties, Dispatch, FormEvent, SetStateAction } from 'react';
import { DELIVERY_METHOD_CHOICES } from './_constants';

interface CategoryExtendedFiltersProps {
  deliveryMethod?: DeliveryMethod;
  onApplyPriceFilter: (event: FormEvent<HTMLFormElement>) => void;
  onToggleDeliveryMethod: (method: DeliveryMethod | null) => void;
  priceMaxInput: string;
  priceMinInput: string;
  setPriceMaxInput: Dispatch<SetStateAction<string>>;
  setPriceMinInput: Dispatch<SetStateAction<string>>;
}

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export default function CategoryExtendedFilters({
  deliveryMethod,
  onApplyPriceFilter,
  onToggleDeliveryMethod,
  priceMaxInput,
  priceMinInput,
  setPriceMaxInput,
  setPriceMinInput,
}: CategoryExtendedFiltersProps) {
  return (
    <Box px="md" py="sm">
      <form onSubmit={onApplyPriceFilter}>
        <Group align="flex-end" gap={8} wrap="nowrap">
          <PriceInput
            id="category-price-min"
            label="최소 가격"
            placeholder="최소"
            testId="category-price-min"
            value={priceMinInput}
            onChange={setPriceMinInput}
          />
          <PriceInput
            id="category-price-max"
            label="최대 가격"
            placeholder="최대"
            testId="category-price-max"
            value={priceMaxInput}
            onChange={setPriceMaxInput}
          />
          <UnstyledButton
            data-testid="category-price-apply"
            type="submit"
            style={{
              flexShrink: 0,
              height: 34,
              padding: '0 12px',
              border: 'var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-primary)',
              color: 'white',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
            }}
          >
            적용
          </UnstyledButton>
        </Group>
      </form>

      <Group mt="sm" gap={8} wrap="nowrap" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        {DELIVERY_METHOD_CHOICES.map((choice) => {
          const isActive = deliveryMethod === choice.value;
          return (
            <UnstyledButton
              key={choice.value}
              aria-pressed={isActive}
              data-testid={`category-delivery-${choice.value}`}
              onClick={() => onToggleDeliveryMethod(isActive ? null : choice.value)}
              style={{
                flexShrink: 0,
                minHeight: 32,
                padding: '6px 10px',
                border: isActive ? '1px solid var(--color-primary)' : 'var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: isActive ? 'var(--color-primary-surface)' : 'var(--color-bg)',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: isActive ? 'var(--fw-bold)' : 'var(--fw-medium)',
              }}
            >
              {choice.label}
            </UnstyledButton>
          );
        })}
      </Group>
    </Box>
  );
}

function PriceInput({
  id,
  label,
  onChange,
  placeholder,
  testId,
  value,
}: {
  id: string;
  label: string;
  onChange: Dispatch<SetStateAction<string>>;
  placeholder: string;
  testId: string;
  value: string;
}) {
  return (
    <Box style={{ flex: 1, minWidth: 0 }}>
      <label htmlFor={id} style={visuallyHidden}>
        {label}
      </label>
      <input
        id={id}
        data-testid={testId}
        inputMode="numeric"
        min={0}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        type="number"
        value={value}
        style={{
          width: '100%',
          height: 34,
          border: 'var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          padding: '0 10px',
          fontSize: 'var(--font-size-sm)',
        }}
      />
    </Box>
  );
}
