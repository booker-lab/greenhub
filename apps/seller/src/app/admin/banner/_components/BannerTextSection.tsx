'use client';

import { Input } from '@greenhub/ui/components/input';
import { Textarea } from '@greenhub/ui/components/textarea';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminBanner } from '@/hooks/useAdmin';
import { Field, FieldLabel } from '../../../../components/Field';

interface BannerTextSectionProps {
  form: AdminBanner;
  setForm: Dispatch<SetStateAction<AdminBanner>>;
}

// 배너 글자 구역 — 위쪽 1px 선으로 앞 구역과 나누고 구역 제목은 16/800(어드민 틀 규칙). 입력칸은 공용 부품 그대로.
export function BannerTextSection({ form, setForm }: BannerTextSectionProps) {
  return (
    <section className="block border-t border-rule pt-4">
      <h2 className="m-0 mb-3 text-[16px] leading-[24px] font-extrabold">텍스트</h2>
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
    </section>
  );
}
