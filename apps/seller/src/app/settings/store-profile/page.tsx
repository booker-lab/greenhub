'use client';

import type { StoreProfileExtras } from '@greenhub/shared';
import { Checkbox } from '@greenhub/ui/components/checkbox';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { Textarea } from '@greenhub/ui/components/textarea';
import { notifications } from '@mantine/notifications';
import { notFound } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useId, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { LoadingState } from '@/components/StateViews';
import { apiJson } from '@/lib/api';
import { isFeatureOn } from '@/lib/features';
import { useTokenRef } from '@/lib/use-token-ref';
import { LoadingButton } from '../_components/LoadingButton';

// ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px·좌우 md)·Paper(radius lg·shadow xs·p md)·
// Stack(gap sm)·Text(sm = 15px·줄 높이 1.45)·TextInput·Textarea(autosize, 라벨)·Checkbox green(green-6)과 같은 값.
const TEXT = 'm-0 p-0 text-base';
const TEXT_SM = 'm-0 p-0 text-sm';
const PAPER = 'block rounded-[16px] bg-white p-4 shadow-mantine-xs';
const STACK = 'flex flex-col items-stretch justify-start gap-3';
const GREEN = '#40c057';

/** Mantine TextInput(label)과 같은 흐름: 라벨 → 입력칸. */
function LabeledInput({ label, ...props }: { label: string } & React.ComponentProps<typeof Input>) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} />
    </Field>
  );
}

/** Mantine Textarea(label, autosize)와 같은 흐름: 라벨 → 입력칸. */
function LabeledTextarea({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof Textarea>) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} {...props} />
    </Field>
  );
}

// 가게 소개(공개 페이지)·품질 보장 문구·남은 수량 공개 여부. 팔도감 벤치마킹 비교 기능.

// 빨리 알려 주면 좋은 점을 앞세운다. "받은 날만 환불" 같은 기한 제한은 쓰지 않는다
// (하자 상품의 청약철회 기간은 법으로 정해져 있어 이보다 줄인 약속은 효력이 없을 수 있다).
const DEFAULT_TERMS = [
  '받은 날 사진과 함께 알려 주시면 가장 빨리 다시 보내 드려요.',
  '꽃이 시들었거나 화분이 깨졌다면 다음 회차에 다시 보내 드리거나 환불해 드려요.',
];

interface FormState {
  intro: string;
  story: string;
  region: string;
  sinceYear: string;
  guaranteeEnabled: boolean;
  guaranteeTitle: string;
  guaranteeTerms: string;
  showDemandSignals: boolean;
}

function toForm(profile: StoreProfileExtras): FormState {
  return {
    intro: profile.intro ?? '',
    story: profile.story ?? '',
    region: profile.region ?? '',
    sinceYear: profile.sinceYear ? String(profile.sinceYear) : '',
    guaranteeEnabled: profile.guarantee?.enabled ?? false,
    guaranteeTitle: profile.guarantee?.title ?? '꽃 상태 보장',
    guaranteeTerms: (profile.guarantee?.terms ?? DEFAULT_TERMS).join('\n'),
    showDemandSignals: profile.showDemandSignals ?? false,
  };
}

function toBody(form: FormState): StoreProfileExtras | string {
  const sinceYear = form.sinceYear.trim() ? Number(form.sinceYear) : undefined;
  if (sinceYear !== undefined && (!Number.isInteger(sinceYear) || sinceYear < 1950 || sinceYear > 2100)) {
    return '운영 시작 연도를 확인해 주세요.';
  }
  const terms = form.guaranteeTerms
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (form.guaranteeEnabled && (!form.guaranteeTitle.trim() || terms.length === 0)) {
    return '품질 보장을 켜려면 제목과 내용을 한 줄 이상 써 주세요.';
  }
  if (terms.length > 6) return '보장 내용은 6줄까지 쓸 수 있어요.';
  return {
    intro: form.intro.trim(),
    story: form.story.trim(),
    region: form.region.trim(),
    ...(sinceYear ? { sinceYear } : {}),
    guarantee: { enabled: form.guaranteeEnabled, title: form.guaranteeTitle.trim(), terms },
    showDemandSignals: form.showDemandSignals,
  };
}

export default function StoreProfileSettingsPage() {
  const store = isFeatureOn('seller-store');
  const guarantee = isFeatureOn('quality-guarantee');
  const demand = isFeatureOn('demand-signals');
  if (!store && !guarantee && !demand) notFound();

  const { data: session } = useSession();
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 토큰 갱신만으로 소개를 다시 읽어 쓰는 중인 내용을 덮지 않는다.
  const { tokenRef, hasToken } = useTokenRef(token);

  useEffect(() => {
    if (!storeId || !hasToken) return;
    apiJson<StoreProfileExtras>(`/stores/${storeId}/public-profile`, tokenRef.current)
      .then((profile) => setForm(toForm(profile)))
      .catch(() => setForm(toForm({})));
  }, [storeId, hasToken, tokenRef]);

  const patch = (next: Partial<FormState>) => setForm((current) => (current ? { ...current, ...next } : current));

  return (
    <PageShell>
      <PageHeader title="가게 소개·품질 보장" />
      <div className="mx-auto max-w-[720px] px-4 py-4">
        {!form ? (
          <LoadingState />
        ) : (
          <div className={STACK}>
            {store && (
              <div className={PAPER}>
                <div className={STACK}>
                  <p className={`${TEXT} font-bold`}>소비자에게 보이는 가게 소개</p>
                  <LabeledInput
                    label="한 줄 소개"
                    maxLength={60}
                    placeholder="예: 매주 경매에서 직접 골라 보내는 이천 꽃집"
                    value={form.intro}
                    onChange={(event) => patch({ intro: event.currentTarget.value })}
                  />
                  <LabeledTextarea
                    label="고르는 기준·매입 이야기"
                    maxLength={600}
                    autosize
                    minRows={3}
                    value={form.story}
                    onChange={(event) => patch({ story: event.currentTarget.value })}
                  />
                  <LabeledInput
                    label="지역"
                    maxLength={30}
                    placeholder="예: 경기 이천"
                    value={form.region}
                    onChange={(event) => patch({ region: event.currentTarget.value })}
                  />
                  <LabeledInput
                    label="운영 시작 연도"
                    inputMode="numeric"
                    maxLength={4}
                    value={form.sinceYear}
                    onChange={(event) => patch({ sinceYear: event.currentTarget.value.replace(/[^0-9]/g, '') })}
                  />
                </div>
              </div>
            )}

            {guarantee && (
              <div className={PAPER}>
                <div className={STACK}>
                  <Checkbox
                    color={GREEN}
                    label="품질 보장을 보여 줘요 (보장 대상 상품에만 표시)"
                    checked={form.guaranteeEnabled}
                    onCheckedChange={(guaranteeEnabled) => patch({ guaranteeEnabled })}
                  />
                  <LabeledInput
                    label="보장 제목"
                    maxLength={40}
                    value={form.guaranteeTitle}
                    onChange={(event) => patch({ guaranteeTitle: event.currentTarget.value })}
                  />
                  <LabeledTextarea
                    label="보장 내용 (한 줄에 하나, 6줄까지)"
                    autosize
                    minRows={3}
                    value={form.guaranteeTerms}
                    onChange={(event) => patch({ guaranteeTerms: event.currentTarget.value })}
                  />
                  <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
                    실제로 지킬 수 있는 약속만 써 주세요. 소비자 화면에 그대로 보여요. &quot;받은 날만 환불&quot;처럼
                    기한을 줄이는 문구는 쓰지 마세요.
                  </p>
                </div>
              </div>
            )}

            {demand && (
              <div className={PAPER}>
                <Checkbox
                  color={GREEN}
                  label="남은 수량과 이번 회차 주문 수를 소비자에게 보여 줘요"
                  checked={form.showDemandSignals}
                  onCheckedChange={(showDemandSignals) => patch({ showDemandSignals })}
                />
              </div>
            )}

            {error && (
              <p role="alert" className={TEXT_SM} style={{ color: 'var(--color-danger)' }}>
                {error}
              </p>
            )}
            <LoadingButton
              size="md"
              loading={saving}
              onClick={async () => {
                if (!storeId || !token) return;
                const body = toBody(form);
                if (typeof body === 'string') {
                  setError(body);
                  return;
                }
                setSaving(true);
                setError(null);
                try {
                  await apiJson(`/stores/${storeId}`, token, { method: 'PATCH', body: JSON.stringify(body) });
                  notifications.show({ message: '저장했어요' });
                } catch (e) {
                  setError(e instanceof Error ? e.message : '저장하지 못했어요.');
                } finally {
                  setSaving(false);
                }
              }}
            >
              저장
            </LoadingButton>
          </div>
        )}
      </div>
    </PageShell>
  );
}
