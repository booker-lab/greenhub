'use client';

import { Button, Checkbox, Container, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { notFound } from 'next/navigation';
import { useState } from 'react';
import ProductTopBar from '@/components/ProductTopBar';
import { BenchmarkApiError, createPartnerInquiry } from '@/lib/benchmark-api';
import { isFeatureOn } from '@/lib/features';

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
  const ready = form.farmName.trim() && form.region.trim() && form.contact.trim() && form.message.trim() && consent;

  if (state === 'done') {
    return (
      <Container size="sm" p={0}>
        <ProductTopBar />
        <Stack px="md" style={{ paddingTop: 'calc(76px + env(safe-area-inset-top))' }}>
          <Title order={1} style={{ fontSize: 22, fontWeight: 800 }}>
            문의를 받았어요
          </Title>
          <Text>남겨 주신 연락처로 영업일 기준 3일 안에 연락드릴게요.</Text>
        </Stack>
      </Container>
    );
  }

  return (
    <Container size="sm" p={0} pb={100}>
      <ProductTopBar />
      <Stack gap="md" px="md" style={{ paddingTop: 'calc(68px + env(safe-area-inset-top))' }}>
        <Title order={1} style={{ fontSize: 22, fontWeight: 800 }}>
          입점 문의
        </Title>
        <Text size="sm" c="var(--color-text-secondary)">
          농가·화원에서 그린러브에 함께하고 싶다면 알려 주세요.
        </Text>
        <TextInput label="농가·화원 이름" required maxLength={40} value={form.farmName} onChange={(e) => setForm({ ...form, farmName: e.target.value })} />
        <TextInput label="지역" required maxLength={30} placeholder="예) 경기 용인" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
        <TextInput label="연락처" required maxLength={80} placeholder="휴대폰 번호나 이메일" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
        <Textarea label="소개와 문의 내용" required maxLength={500} autosize minRows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        <Checkbox
          checked={consent}
          onChange={(e) => setConsent(e.currentTarget.checked)}
          label="입점 상담을 위해 이름·지역·연락처를 받고, 문의일로부터 1년 뒤 지우는 데 동의합니다."
        />
        {error && (
          <Text role="alert" size="sm" c="var(--color-danger)">
            {error}
          </Text>
        )}
        <Button
          size="lg"
          radius="xl"
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
              setError(e instanceof BenchmarkApiError ? e.message : '보내지 못했어요. 잠시 뒤 다시 시도해 주세요.');
            }
          }}
        >
          문의 보내기
        </Button>
      </Stack>
    </Container>
  );
}
