'use client';

import { Checkbox } from '@greenhub/ui/components/checkbox';
import { FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { LoadingButton } from '@greenhub/ui/components/loading-button';
import { Textarea } from '@greenhub/ui/components/textarea';
import { notFound } from 'next/navigation';
import { useId, useState } from 'react';
import ProductTopBar from '@/components/ProductTopBar';
import { BenchmarkApiError, createPartnerInquiry } from '@/lib/benchmark-api';
import { isFeatureOn } from '@/lib/features';

// ① 외형 유지(UI 교체 P5): Mantine Container sm(720px, 안쪽 0, 아래 100)·Stack(gap md 16)·Title h1(줄 높이 1.3)·
// Text(p, 크기 지정 없으면 md·줄 높이 1.55, sm은 줄 높이 1.45)·TextInput·Textarea(required, radius 16)·Checkbox(sm)·
// Button(lg, loading)과 같은 값.
const TITLE = 'm-0 text-[22px] leading-[1.3] font-extrabold';
const TEXT = 'm-0 p-0 leading-[1.55]';
const SMALL_TEXT = 'm-0 p-0 leading-[1.45]';
const SMALL = { fontSize: 'var(--font-size-sm)' } as const;

// Mantine TextInput·Textarea(label required + 입력칸)와 같은 구조: 감싸는 상자는 역할 없는 div, 라벨 뒤 " *".
function RequiredField({
  label,
  children,
}: {
  label: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      {children(id)}
    </div>
  );
}

// 입점 문의(partner-inquiry, 벤치마킹 비교 기능). 연락처를 받으므로 수집·이용 동의를 함께 받는다.
export default function PartnerPage() {
  if (!isFeatureOn('partner-inquiry')) notFound();
  return <PartnerForm />;
}

function PartnerForm() {
  const [form, setForm] = useState({ farmName: '', region: '', contact: '', message: '' });
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const ready =
    form.farmName.trim() &&
    form.region.trim() &&
    form.contact.trim() &&
    form.message.trim() &&
    consent;

  if (state === 'done') {
    return (
      <div className="mx-auto max-w-[720px]">
        <ProductTopBar />
        <div
          className="flex flex-col gap-4 px-4"
          style={{ paddingTop: 'calc(76px + env(safe-area-inset-top))' }}
        >
          <h1 className={TITLE}>문의를 받았어요</h1>
          <p className={TEXT} style={{ fontSize: 'var(--font-size-md)' }}>
            남겨 주신 연락처로 영업일 기준 3일 안에 연락드릴게요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] pb-[100px]">
      <ProductTopBar />
      <div
        className="flex flex-col gap-4 px-4"
        style={{ paddingTop: 'calc(68px + env(safe-area-inset-top))' }}
      >
        <h1 className={TITLE}>입점 문의</h1>
        <p className={SMALL_TEXT} style={{ ...SMALL, color: 'var(--color-text-secondary)' }}>
          농가·화원에서 그린러브에 함께하고 싶다면 알려 주세요.
        </p>
        <RequiredField label="농가·화원 이름">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={40}
              value={form.farmName}
              onChange={(e) => setForm({ ...form, farmName: e.target.value })}
            />
          )}
        </RequiredField>
        <RequiredField label="지역">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={30}
              placeholder="예) 경기 용인"
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
            />
          )}
        </RequiredField>
        <RequiredField label="연락처">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={80}
              placeholder="휴대폰 번호나 이메일"
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
            />
          )}
        </RequiredField>
        <RequiredField label="소개와 문의 내용">
          {(id) => (
            <Textarea
              id={id}
              required
              maxLength={500}
              autosize
              minRows={4}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          )}
        </RequiredField>
        <Checkbox
          checked={consent}
          onCheckedChange={setConsent}
          label="입점 상담을 위해 이름·지역·연락처를 받고, 문의일로부터 1년 뒤 지우는 데 동의합니다."
        />
        {error && (
          <p role="alert" className={SMALL_TEXT} style={{ ...SMALL, color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}
        <LoadingButton
          size="lg"
          disabled={!ready || state === 'sending'}
          loading={state === 'sending'}
          onClick={async () => {
            setState('sending');
            setError(null);
            try {
              await createPartnerInquiry({
                farmName: form.farmName.trim(),
                region: form.region.trim(),
                contact: form.contact.trim(),
                message: form.message.trim(),
                privacyConsent: true,
              });
              setState('done');
            } catch (e) {
              setState('idle');
              setError(
                e instanceof BenchmarkApiError
                  ? e.message
                  : '보내지 못했어요. 잠시 뒤 다시 시도해 주세요.',
              );
            }
          }}
        >
          문의 보내기
        </LoadingButton>
      </div>
    </div>
  );
}
