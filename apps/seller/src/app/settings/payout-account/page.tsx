'use client';

import { Autocomplete, Button, Container, Paper, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { LoadingState } from '@/components/StateViews';
import { apiJson } from '@/lib/api';
import { useTokenRef } from '@/lib/use-token-ref';
import {
  ACCOUNT_HOLDER_MAX_LENGTH,
  ACCOUNT_NUMBER_MAX_LENGTH,
  COMMON_BANKS,
  describeSavedAccount,
  type MaskedPayoutAccount,
  type PayoutAccountForm,
  readMaskedPayoutAccount,
  toPayoutAccountBody,
} from './_lib';

// 판매자 정산 계좌(결정 ⑤). 판매자 본인·관리자만 보고, 관리자가 정산 지급할 때 이 계좌로 보낸다.
// 저장된 계좌번호는 끝 4자리 외를 가려 보이고, 바꿀 때는 번호를 처음부터 다시 입력한다.

const EMPTY_FORM: PayoutAccountForm = { bankName: '', accountHolder: '', accountNumber: '' };

export default function PayoutAccountSettingsPage() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<MaskedPayoutAccount | null>(null);
  const [form, setForm] = useState<PayoutAccountForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 토큰 갱신만으로 계좌를 다시 읽어 입력 중인 계좌번호를 지우지 않는다.
  const { tokenRef, hasToken } = useTokenRef(token);

  useEffect(() => {
    if (!storeId || !hasToken) return;
    apiJson(`/stores/${storeId}/payout-account`, tokenRef.current)
      .then((body) => {
        const account = readMaskedPayoutAccount(body);
        setSaved(account);
        if (account) {
          setForm({ bankName: account.bankName, accountHolder: account.accountHolder, accountNumber: '' });
        }
        setLoadError(null);
      })
      .catch(() => setLoadError('저장된 계좌를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'))
      .finally(() => setLoaded(true));
  }, [storeId, hasToken, tokenRef]);

  const patch = (next: Partial<PayoutAccountForm>) => setForm((current) => ({ ...current, ...next }));

  const save = async () => {
    if (!storeId || !token) return;
    const body = toPayoutAccountBody(form);
    if (typeof body === 'string') {
      setError(body);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await apiJson(`/stores/${storeId}/payout-account`, token, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const account = readMaskedPayoutAccount(response);
      setSaved(account);
      setForm((current) => ({ ...current, accountNumber: '' }));
      notifications.show({ message: '정산 계좌를 저장했어요' });
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell>
      <PageHeader title="정산 계좌" />
      <Container size="sm" px="md" py="md">
        {!loaded ? (
          <LoadingState />
        ) : (
          <Stack gap="sm">
            <Paper radius="lg" shadow="xs" p="md">
              <Stack gap={4}>
                <Text fw={700}>저장된 계좌</Text>
                {loadError ? (
                  <Text role="alert" size="sm" c="var(--color-danger)">
                    {loadError}
                  </Text>
                ) : saved ? (
                  <Text size="sm">{describeSavedAccount(saved)}</Text>
                ) : (
                  <Text size="sm" c="var(--color-text-secondary)">
                    아직 없어요. 정산금을 받을 계좌를 등록해 주세요.
                  </Text>
                )}
              </Stack>
            </Paper>

            <Paper radius="lg" shadow="xs" p="md">
              <Stack gap="sm">
                <Text fw={700}>{saved ? '계좌 바꾸기' : '계좌 등록'}</Text>
                <Autocomplete
                  label="은행"
                  placeholder="예: 국민은행"
                  data={[...COMMON_BANKS]}
                  maxLength={20}
                  value={form.bankName}
                  onChange={(bankName) => patch({ bankName })}
                />
                <TextInput
                  label="예금주"
                  maxLength={ACCOUNT_HOLDER_MAX_LENGTH}
                  value={form.accountHolder}
                  onChange={(event) => patch({ accountHolder: event.currentTarget.value })}
                />
                <TextInput
                  label="계좌번호"
                  placeholder="숫자와 하이픈(-)만"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={ACCOUNT_NUMBER_MAX_LENGTH}
                  value={form.accountNumber}
                  onChange={(event) =>
                    patch({ accountNumber: event.currentTarget.value.replace(/[^0-9-]/g, '') })
                  }
                />
                <Text size="sm" c="var(--color-text-secondary)">
                  사업자 정보와 같은 명의의 계좌를 써 주세요. 계좌는 관리자만 정산 지급에 사용하고,
                  저장한 번호는 끝 4자리만 보여요.
                </Text>
                {error && (
                  <Text role="alert" size="sm" c="var(--color-danger)">
                    {error}
                  </Text>
                )}
                <Button radius="xl" size="md" loading={saving} onClick={save}>
                  저장
                </Button>
              </Stack>
            </Paper>
          </Stack>
        )}
      </Container>
    </PageShell>
  );
}
