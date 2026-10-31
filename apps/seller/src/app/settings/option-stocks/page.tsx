'use client';

import type { OptionStock } from '@greenhub/shared';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { notifications } from '@mantine/notifications';
import { useSession } from 'next-auth/react';
import { useEffect, useId, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { LoadingState } from '@/components/StateViews';
import { apiJson } from '@/lib/api';
import {
  describeStockCounts,
  OPTION_STOCK_NAME_MAX_LENGTH,
  readOptionStock,
  readOptionStocks,
  toAddBody,
  toCreateBody,
  toRemainingBody,
  upsertStock,
} from './_lib';
import { LoadingButton } from '../_components/LoadingButton';

// 옵션 재고(직접 출력한 화분 등). 상품 옵션 선택지에 연결하면 주문할 때마다 줄고, 결제 전 취소·환불이면
// 돌아온다. 남은 개수가 모자라면 손님 주문을 받지 않는다.

const onlyDigits = (value: string) => value.replace(/[^0-9]/g, '');

// ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px·좌우 md)·Paper(radius lg·shadow xs·p md)·
// Stack·Group(gap xs·아래 맞춤)·Text(sm = 15px·줄 높이 1.45)·TextInput(라벨)과 같은 값.
const TEXT = 'm-0 p-0 text-base';
const TEXT_SM = 'm-0 p-0 text-sm';
const PAPER = 'block rounded-[16px] bg-white p-4 shadow-mantine-xs';
const ROW = 'flex flex-row flex-nowrap items-end justify-start gap-2.5';

/** Mantine TextInput(label)과 같은 흐름: 라벨 → 입력칸. */
function LabeledInput({
  label,
  style,
  ...props
}: { label: string } & React.ComponentProps<typeof Input>) {
  const id = useId();
  return (
    <Field style={style}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} />
    </Field>
  );
}

function StockRow({
  stock,
  onSave,
}: {
  stock: OptionStock;
  onSave: (body: Record<string, number>) => Promise<boolean>;
}) {
  const [add, setAdd] = useState('');
  const [remaining, setRemaining] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'add' | 'remaining' | null>(null);

  const submit = async (kind: 'add' | 'remaining') => {
    const body = kind === 'add' ? toAddBody(add) : toRemainingBody(remaining);
    if (typeof body === 'string') {
      setError(body);
      return;
    }
    setBusy(kind);
    setError(null);
    const ok = await onSave(body);
    setBusy(null);
    if (ok) {
      setAdd('');
      setRemaining('');
    }
  };

  return (
    <div className={PAPER}>
      <div className="flex flex-col items-stretch justify-start gap-2.5">
        <div>
          <p className={`${TEXT} font-bold`}>{stock.name}</p>
          <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
            {describeStockCounts(stock)}
          </p>
        </div>
        <div className={ROW}>
          <LabeledInput
            label="새로 출력한 개수"
            placeholder="예: 5"
            inputMode="numeric"
            value={add}
            onChange={(event) => setAdd(onlyDigits(event.currentTarget.value))}
            style={{ flex: 1 }}
          />
          <LoadingButton
            variant="light-green"
            loading={busy === 'add'}
            onClick={() => submit('add')}
          >
            더하기
          </LoadingButton>
        </div>
        <div className={ROW}>
          <LabeledInput
            label="실제 남은 개수"
            placeholder={String(stock.remainingQuantity)}
            inputMode="numeric"
            value={remaining}
            onChange={(event) => setRemaining(onlyDigits(event.currentTarget.value))}
            style={{ flex: 1 }}
          />
          <LoadingButton
            variant="secondary"
            loading={busy === 'remaining'}
            onClick={() => submit('remaining')}
          >
            맞추기
          </LoadingButton>
        </div>
        {error && (
          <p role="alert" className={TEXT_SM} style={{ color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default function OptionStocksSettingsPage() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stocks, setStocks] = useState<OptionStock[]>([]);
  const [form, setForm] = useState({ name: '', quantity: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId || !token) return;
    apiJson(`/stores/${storeId}/option-stocks`, token)
      .then((body) => {
        setStocks(readOptionStocks(body));
        setLoadError(null);
      })
      .catch(() => setLoadError('재고를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'))
      .finally(() => setLoaded(true));
  }, [storeId, token]);

  const create = async () => {
    if (!storeId || !token) return;
    const body = toCreateBody(form);
    if (typeof body === 'string') {
      setCreateError(body);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const stock = readOptionStock(
        await apiJson(`/stores/${storeId}/option-stocks`, token, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
      if (stock) setStocks((current) => upsertStock(current, stock));
      setForm({ name: '', quantity: '' });
      notifications.show({ message: '재고를 추가했어요' });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : '추가하지 못했어요.');
    } finally {
      setCreating(false);
    }
  };

  const update = async (stockId: string, body: Record<string, number>) => {
    if (!storeId || !token) return false;
    try {
      const stock = readOptionStock(
        await apiJson(`/stores/${storeId}/option-stocks/${encodeURIComponent(stockId)}`, token, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
      );
      if (stock) setStocks((current) => upsertStock(current, stock));
      notifications.show({ message: '재고를 저장했어요' });
      return true;
    } catch (e) {
      notifications.show({
        color: 'red',
        message: e instanceof Error ? e.message : '저장하지 못했어요.',
      });
      return false;
    }
  };

  return (
    <PageShell>
      <PageHeader title="옵션 재고 (화분)" />
      <div className="mx-auto max-w-[720px] px-4 py-4">
        {!loaded ? (
          <LoadingState />
        ) : (
          <div className="flex flex-col items-stretch justify-start gap-3">
            <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
              직접 출력한 화분처럼 개수가 정해진 옵션을 관리해요. 상품 옵션 선택지에 연결하면 주문할
              때마다 줄고, 결제 전 취소·환불이면 다시 늘어요. 남은 개수가 모자라면 그 옵션으로는
              주문을 받지 않아요.
            </p>
            {loadError && (
              <p role="alert" className={TEXT_SM} style={{ color: 'var(--color-danger)' }}>
                {loadError}
              </p>
            )}

            {stocks.map((stock) => (
              <StockRow key={stock.id} stock={stock} onSave={(body) => update(stock.id, body)} />
            ))}
            {!loadError && stocks.length === 0 && (
              <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
                아직 재고가 없어요. 아래에서 추가해 주세요.
              </p>
            )}

            <div className={PAPER}>
              <div className="flex flex-col items-stretch justify-start gap-3">
                <p className={`${TEXT} font-bold`}>재고 추가</p>
                <LabeledInput
                  label="이름"
                  placeholder="예: 흰색 출력 화분"
                  maxLength={OPTION_STOCK_NAME_MAX_LENGTH}
                  value={form.name}
                  onChange={(event) => {
                    const name = event.currentTarget.value;
                    setForm((current) => ({ ...current, name }));
                  }}
                />
                <LabeledInput
                  label="지금 있는 개수"
                  placeholder="예: 10"
                  inputMode="numeric"
                  value={form.quantity}
                  onChange={(event) => {
                    const quantity = onlyDigits(event.currentTarget.value);
                    setForm((current) => ({ ...current, quantity }));
                  }}
                />
                {createError && (
                  <p role="alert" className={TEXT_SM} style={{ color: 'var(--color-danger)' }}>
                    {createError}
                  </p>
                )}
                <LoadingButton size="md" loading={creating} onClick={create}>
                  추가
                </LoadingButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
