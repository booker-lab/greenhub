'use client';

import type { SalesMode } from '@greenhub/shared';
import { NumberInput } from '@greenhub/ui/components/number-input';
import { useOptionStocks } from '@/hooks/useOptionStocks';
import { isFeatureOn } from '@/lib/features';
import { showsGroupBuyChoice } from '@/lib/sales-mode';
import { ChoiceRow, FieldCard } from '../FormPrimitives';
import GroupConfigSection from '../GroupConfigSection';
import { ProductExtrasSection } from '../ProductExtrasSection';
import { DELIVERY_SIZES, type GroupConfigForm, type ProductFormData } from '../productForm.types';

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·Group·Stack 값.
const TEXT = 'm-0 p-0 text-base font-normal';

interface Step5PricingProps {
  storeId: string;
  token: string;
  form: ProductFormData;
  set: <K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) => void;
  setGroupConfig: <K extends keyof GroupConfigForm>(key: K, value: GroupConfigForm[K]) => void;
  salesMode: SalesMode | undefined;
}

export function Step5Pricing({
  storeId,
  token,
  form,
  set,
  setGroupConfig,
  salesMode,
}: Step5PricingProps) {
  const optionStocks = useOptionStocks(storeId, token, isFeatureOn('option-sheet'));
  return (
    <div className="flex flex-col gap-3">
      <NumberInput
        placeholder="가격"
        leftSection={
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            ₩
          </p>
        }
        thousandSeparator=","
        min={0}
        max={100_000_000}
        value={form.price === '' ? '' : Number(form.price)}
        onValueChange={(val) => set('price', val === '' ? '' : String(val))}
        size="md"
        className="rounded-xl"
      />
      <FieldCard label="배송 사이즈">
        <ChoiceRow
          options={DELIVERY_SIZES}
          value={form.deliverySize}
          onChange={(v) => set('deliverySize', v)}
        />
      </FieldCard>
      {/* 공동구매는 예전 판매 방식 가게 전용 — 회차 판매 가게에는 판매 방식 선택을 숨긴다. */}
      {showsGroupBuyChoice(salesMode, form.saleType) && (
        <FieldCard label="판매 방식" labelGap="sm">
          <div className="flex flex-row flex-wrap items-center justify-start gap-8">
            {(['normal', 'group'] as const).map((type) => (
              <label
                key={type}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              >
                <input
                  type="radio"
                  name="saleType"
                  checked={form.saleType === type}
                  onChange={() => set('saleType', type)}
                  style={{ accentColor: 'var(--color-primary)', width: 16, height: 16 }}
                />
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  {type === 'normal' ? '일반 판매' : '공동구매'}
                </p>
              </label>
            ))}
          </div>
          <GroupConfigSection
            visible={form.saleType === 'group'}
            config={form.groupConfig}
            setGroupConfig={setGroupConfig}
          />
        </FieldCard>
      )}
      <ProductExtrasSection
        extras={form.extras}
        onChange={(next) => set('extras', next)}
        optionStocks={optionStocks.stocks}
        optionStocksError={optionStocks.error}
      />
    </div>
  );
}
