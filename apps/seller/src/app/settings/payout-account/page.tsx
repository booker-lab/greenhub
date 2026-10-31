'use client';

import { Autocomplete } from '@greenhub/ui/components/autocomplete';
import { Button } from '@greenhub/ui/components/button';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { notify } from '@/components/AppToaster';
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

// ① 외형 유지(UI 교체 P2b): Mantine Paper(흰 바탕·모서리 16·그림자 xs·안쪽 16)와 Text(p, 여백 0) 값.
const PAPER = 'block rounded-[16px] bg-white p-4 shadow-mantine-xs';
const TEXT = 'm-0 p-0 text-base';
const TEXT_SM = 'm-0 p-0 text-sm';

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
          setForm({
            bankName: account.bankName,
            accountHolder: account.accountHolder,
            accountNumber: '',
          });
        }
        setLoadError(null);
      })
      .catch(() => setLoadError('저장된 계좌를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'))
      .finally(() => setLoaded(true));
  }, [storeId, hasToken, tokenRef]);

  const patch = (next: Partial<PayoutAccountForm>) =>
    setForm((current) => ({ ...current, ...next }));

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
      notify({ message: '정산 계좌를 저장했어요' });
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell>
      <PageHeader title="정산 계좌" />
      <div className="mx-auto max-w-[720px] p-4">
        {!loaded ? (
          <LoadingState />
        ) : (
          <div className="flex flex-col gap-3">
            <div className={PAPER}>
              <div className="flex flex-col gap-1">
                <p className={`${TEXT} font-bold`}>저장된 계좌</p>
                {loadError ? (
                  <p role="alert" className={TEXT_SM} style={{ color: 'var(--color-danger)' }}>
                    {loadError}
                  </p>
                ) : saved ? (
                  <p className={TEXT_SM}>{describeSavedAccount(saved)}</p>
                ) : (
                  <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
                    아직 없어요. 정산금을 받을 계좌를 등록해 주세요.
                  </p>
                )}
              </div>
            </div>

            <div className={PAPER}>
              <div className="flex flex-col gap-3">
                <p className={`${TEXT} font-bold`}>{saved ? '계좌 바꾸기' : '계좌 등록'}</p>
                <Field>
                  <FieldLabel htmlFor="payout-bank">은행</FieldLabel>
                  <Autocomplete
                    id="payout-bank"
                    placeholder="예: 국민은행"
                    items={COMMON_BANKS}
                    maxLength={20}
                    value={form.bankName}
                    onValueChange={(bankName) => patch({ bankName })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="payout-holder">예금주</FieldLabel>
                  <Input
                    id="payout-holder"
                    maxLength={ACCOUNT_HOLDER_MAX_LENGTH}
                    value={form.accountHolder}
                    onChange={(event) => patch({ accountHolder: event.currentTarget.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="payout-number">계좌번호</FieldLabel>
                  <Input
                    id="payout-number"
                    placeholder="숫자와 하이픈(-)만"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={ACCOUNT_NUMBER_MAX_LENGTH}
                    value={form.accountNumber}
                    onChange={(event) =>
                      patch({ accountNumber: event.currentTarget.value.replace(/[^0-9-]/g, '') })
                    }
                  />
                </Field>
                <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
                  사업자 정보와 같은 명의의 계좌를 써 주세요. 계좌는 관리자만 정산 지급에 사용하고,
                  저장한 번호는 끝 4자리만 보여요.
                </p>
                {error && (
                  <p role="alert" className={TEXT_SM} style={{ color: 'var(--color-danger)' }}>
                    {error}
                  </p>
                )}
                <Button size="md" disabled={saving} aria-busy={saving} onClick={save}>
                  저장
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
