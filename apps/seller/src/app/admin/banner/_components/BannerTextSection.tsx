'use client';

import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { Textarea } from '@greenhub/ui/components/textarea';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminBanner } from '@/hooks/useAdmin';

interface BannerTextSectionProps {
  form: AdminBanner;
  setForm: Dispatch<SetStateAction<AdminBanner>>;
}

// ① 외형 유지(UI 교체 P2b): Mantine Paper(lg·xs·lg)·Text·Stack(gap sm)·TextInput·Textarea(autosize 2줄)와 같은 값.
export function BannerTextSection({ form, setForm }: BannerTextSectionProps) {
  return (
    <div
      className="block rounded-[16px] bg-white p-5 shadow-paper-xs"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <p
        className="m-0 mb-3 p-0 text-base"
        style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}
      >
        텍스트
      </p>
      <div className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="banner-tag">태그 문구</FieldLabel>
          <Input
            id="banner-tag"
            placeholder="예: 산지 직배송"
            value={form.tagText ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, tagText: e.target.value }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="banner-headline">헤드라인</FieldLabel>
          <Textarea
            id="banner-headline"
            placeholder="예: 오늘 수확한&#10;싱그러운 식물을&#10;집에서 만나보세요"
            autosize
            minRows={2}
            value={form.headline ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="banner-subtext">서브텍스트</FieldLabel>
          <Textarea
            id="banner-subtext"
            placeholder="예: 시중가 대비 최대 30% 저렴하게"
            autosize
            minRows={2}
            value={form.subText ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, subText: e.target.value }))}
          />
        </Field>
      </div>
    </div>
  );
}
