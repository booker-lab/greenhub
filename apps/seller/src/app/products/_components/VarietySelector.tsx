'use client';

import { Select, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';

interface Variety {
  id: string;
  name: string;
  subCategory: string;
  availableStemTypes?: string[];
}

interface Props {
  category: string;
  value: string;
  onChange: (id: string) => void;
  onVarietyChange?: (variety: Variety | null) => void;
  token: string;
}

const SUB_LABEL: Record<string, string> = {
  phalaenopsis: '호접란',
  dendrobium: '덴드로비움',
  cymbidium: '심비디움',
};

export default function VarietySelector({
  category,
  value,
  onChange,
  onVarietyChange,
  token,
}: Props) {
  const [varieties, setVarieties] = useState<Variety[]>([]);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/varieties?category=${category}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setVarieties(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [category, token]);

  if (varieties.length === 0) {
    return (
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
        등록된 품종이 없습니다
      </Text>
    );
  }

  const groups = varieties.reduce<Record<string, Variety[]>>((acc, v) => {
    // biome-ignore lint/suspicious/noAssignInExpressions: groupBy 누적 패턴 — 의도된 inline 초기화
    (acc[v.subCategory] ??= []).push(v);
    return acc;
  }, {});

  const data = Object.entries(groups).map(([sub, items]) => ({
    group: SUB_LABEL[sub] ?? sub,
    items: items.map((v) => ({ value: v.id, label: v.name })),
  }));

  return (
    <Select
      placeholder="품종 선택 (선택사항)"
      data={data}
      value={value || null}
      onChange={(v) => {
        onChange(v ?? '');
        onVarietyChange?.(varieties.find((vr) => vr.id === v) ?? null);
      }}
      clearable
      size="md"
      radius="xl"
      maxDropdownHeight={240}
      comboboxProps={{ position: 'bottom', middlewares: { flip: false } }}
    />
  );
}
