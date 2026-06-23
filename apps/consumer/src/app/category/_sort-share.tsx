'use client';

import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SORT_CHOICES, type SortOption } from './_constants';

interface CategorySortShareProps {
  resultCountText: string;
  sharePath: string;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
}

export default function CategorySortShare({
  onSortChange,
  resultCountText,
  sharePath,
  sort,
}: CategorySortShareProps) {
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'fallback'>('idle');
  const [fallbackUrl, setFallbackUrl] = useState('');

  useEffect(() => {
    if (shareState === 'idle') return;
    const timer = window.setTimeout(() => setShareState('idle'), 2400);
    return () => window.clearTimeout(timer);
  }, [shareState]);

  async function copyShareLink() {
    const url = `${window.location.origin}${sharePath}`;
    try {
      await navigator.clipboard.writeText(url);
      setFallbackUrl('');
      setShareState('copied');
    } catch {
      setFallbackUrl(url);
      setShareState('fallback');
    }
  }

  return (
    <Box mb="sm">
      <Group justify="space-between" align="center" mb={8} gap={8}>
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-disabled)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          {resultCountText}
        </Text>
        <UnstyledButton
          data-testid="category-share-link"
          onClick={copyShareLink}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: 'var(--color-primary)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          {shareState === 'copied' ? <Check size={15} /> : <Copy size={15} />}
          {shareState === 'copied' ? '복사됨' : '링크 복사'}
        </UnstyledButton>
      </Group>

      <Group role="radiogroup" aria-label="상품 정렬" gap={6} wrap="nowrap">
        {SORT_CHOICES.map((choice) => {
          const isActive = sort === choice.value;
          return (
            <UnstyledButton
              key={choice.value}
              role="radio"
              aria-checked={isActive}
              data-testid={`category-sort-${choice.value}`}
              onClick={() => onSortChange(choice.value)}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                minHeight: 34,
                padding: '6px 8px',
                border: isActive ? '1px solid var(--color-primary)' : 'var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: isActive ? 'var(--color-primary-surface)' : 'var(--color-bg)',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: isActive ? 'var(--fw-bold)' : 'var(--fw-medium)',
                textAlign: 'center',
              }}
            >
              {choice.label}
            </UnstyledButton>
          );
        })}
      </Group>

      {shareState === 'fallback' && (
        <Text
          data-testid="category-share-fallback"
          mt={6}
          style={{
            overflowWrap: 'anywhere',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {fallbackUrl}
        </Text>
      )}
    </Box>
  );
}
