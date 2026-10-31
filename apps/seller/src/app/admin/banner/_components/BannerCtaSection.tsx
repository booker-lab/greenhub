'use client';

import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminBanner } from '@/hooks/useAdmin';

interface BannerCtaSectionProps {
  form: AdminBanner;
  setForm: Dispatch<SetStateAction<AdminBanner>>;
}

// ① 외형 유지(UI 교체 P2b): Mantine Paper(lg·xs·lg)·Text·Stack(gap sm)·Group grow·TextInput과 같은 값.
// Group grow(gap md): 칸마다 flex-grow 1, 최대 폭 = 100% ÷ 2 - (16px - 16px ÷ 2).
const GROW =
  'flex flex-row flex-wrap items-center justify-start gap-4 [&>*]:max-w-[calc(50%-8px)] [&>*]:grow';

export function BannerCtaSection({ form, setForm }: BannerCtaSectionProps) {
  return (
    <div
      className="block rounded-[16px] bg-white p-5 shadow-mantine-xs"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <p
        className="m-0 mb-3 p-0 text-base"
        style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}
      >
        버튼
      </p>
      <div className="flex flex-col gap-3">
        <div className={GROW}>
          <Field>
            <FieldLabel htmlFor="banner-cta1-label">버튼1 텍스트</FieldLabel>
            <Input
              id="banner-cta1-label"
              placeholder="지금 인기상품 보기"
              value={form.cta1?.label ?? ''}
              onChange={(e) =>
                // biome-ignore lint/style/noNonNullAssertion: cta1 undefined 시 spread는 빈 객체로 안전하게 처리됨
                setForm((f) => ({ ...f, cta1: { ...f.cta1!, label: e.target.value } }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="banner-cta1-href">버튼1 링크</FieldLabel>
            <Input
              id="banner-cta1-href"
              placeholder="/products"
              value={form.cta1?.href ?? ''}
              onChange={(e) =>
                // biome-ignore lint/style/noNonNullAssertion: cta1 undefined 시 spread는 빈 객체로 안전하게 처리됨
                setForm((f) => ({ ...f, cta1: { ...f.cta1!, href: e.target.value } }))
              }
            />
          </Field>
        </div>
        <div className={GROW}>
          <Field>
            <FieldLabel htmlFor="banner-cta2-label">버튼2 텍스트</FieldLabel>
            <Input
              id="banner-cta2-label"
              placeholder="공구 참여하기"
              value={form.cta2?.label ?? ''}
              onChange={(e) =>
                // biome-ignore lint/style/noNonNullAssertion: cta2 undefined 시 spread는 빈 객체로 안전하게 처리됨
                setForm((f) => ({ ...f, cta2: { ...f.cta2!, label: e.target.value } }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="banner-cta2-href">버튼2 링크</FieldLabel>
            <Input
              id="banner-cta2-href"
              placeholder="/groupbuy"
              value={form.cta2?.href ?? ''}
              onChange={(e) =>
                // biome-ignore lint/style/noNonNullAssertion: cta2 undefined 시 spread는 빈 객체로 안전하게 처리됨
                setForm((f) => ({ ...f, cta2: { ...f.cta2!, href: e.target.value } }))
              }
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
