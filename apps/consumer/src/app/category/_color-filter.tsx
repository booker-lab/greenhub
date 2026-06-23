'use client';

import type { ColorOption } from '@greenhub/shared';
import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { COLOR_CHIPS, COLOR_FILTER_HELP_TEXT, COLOR_GROUPS } from './_constants';

interface CategoryColorFilterProps {
  colors: ColorOption[];
  colorsOpen: boolean;
  onResetColors: () => void;
  onToggleColor: (color: ColorOption) => void;
  onToggleOpen: () => void;
}

export default function CategoryColorFilter({
  colors,
  colorsOpen,
  onResetColors,
  onToggleColor,
  onToggleOpen,
}: CategoryColorFilterProps) {
  return (
    <Box px="md" py="sm">
      <Group justify="space-between" align="center" wrap="nowrap">
        <UnstyledButton
          aria-expanded={colorsOpen}
          aria-controls="category-color-panel"
          onClick={onToggleOpen}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--color-text)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          색상
          {colors.length > 0 && (
            <Text span style={{ color: 'var(--color-primary)', fontWeight: 'var(--fw-bold)' }}>
              {colors.length}
            </Text>
          )}
          {colorsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </UnstyledButton>
        {colors.length > 0 && (
          <UnstyledButton
            data-testid="category-reset-colors"
            onClick={onResetColors}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
            }}
          >
            <X size={14} />
            초기화
          </UnstyledButton>
        )}
      </Group>

      {!colorsOpen && colors.length > 0 && (
        <Text mt={6} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }}>
          {colors.join(' · ')}
        </Text>
      )}

      {colorsOpen && (
        <Stack id="category-color-panel" mt="sm" gap="sm">
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {COLOR_FILTER_HELP_TEXT}
          </Text>
          {COLOR_GROUPS.map((group) => (
            <Box key={group.label}>
              <Text
                mb={6}
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-secondary)',
                  fontWeight: 'var(--fw-bold)',
                }}
              >
                {group.label}
              </Text>
              <Group gap={10} wrap="wrap">
                {group.values.map((color) => {
                  const chip = COLOR_CHIPS.find((item) => item.value === color);
                  if (!chip) return null;
                  const isActive = colors.includes(chip.value);

                  return (
                    <UnstyledButton
                      key={chip.value}
                      aria-pressed={isActive}
                      data-testid={`category-color-${chip.value}`}
                      onClick={() => onToggleColor(chip.value)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        minHeight: 34,
                        padding: '5px 9px',
                        border: isActive ? '1px solid var(--color-primary)' : 'var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        background: isActive ? 'var(--color-primary-surface)' : 'var(--color-bg)',
                        color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: isActive ? 'var(--fw-bold)' : 'var(--fw-medium)',
                      }}
                    >
                      <Box
                        aria-hidden
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          backgroundColor: chip.hex,
                          border: 'var(--border)',
                        }}
                      />
                      {chip.label}
                    </UnstyledButton>
                  );
                })}
              </Group>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
