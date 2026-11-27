'use client';

import { Input } from '@greenhub/ui/components/input';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminBanner } from '@/hooks/useAdmin';
import { Field, FieldLabel } from '../../../../components/Field';

interface BannerCtaSectionProps {
  form: AdminBanner;
  setForm: Dispatch<SetStateAction<AdminBanner>>;
}

// 배너 버튼 구역 — 위쪽 1px 선으로 앞 구역과 나누고 구역 제목은 16/800(어드민 틀 규칙). 입력칸 두 줄 배치는 그대로.
// Group grow(gap md): 칸마다 flex-grow 1, 최대 폭 = 100% ÷ 2 - (16px - 16px ÷ 2).
const GROW =
  'flex flex-row flex-wrap items-center justify-start gap-4 [&>*]:max-w-[calc(50%-8px)] [&>*]:grow';

export function BannerCtaSection({ form, setForm }: BannerCtaSectionProps) {
  return (
    <section className="block border-t border-rule pt-4">
      <h2 className="m-0 mb-3 text-[16px] leading-[24px] font-extrabold">버튼</h2>
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
    </section>
  );
}
