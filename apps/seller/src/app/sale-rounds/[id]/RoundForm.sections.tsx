'use client';

import type { Product, SaleRoundDeliveryRegion } from '@greenhub/shared';
import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { NumberInput } from '@greenhub/ui/components/number-input';
import { Switch } from '@greenhub/ui/components/switch';
import { Copy, Link2, PackagePlus, Trash2 } from 'lucide-react';
import { type ReactNode, useId } from 'react';

export type NumericValue = number | string;

export interface ItemDraft {
  key: string;
  productId: string;
  name: string;
  roundPrice: NumericValue;
  saleLimitQuantity: NumericValue;
  displayOrder: NumericValue;
}

export interface FormDraft {
  name: string;
  orderOpenAt: string;
  orderCloseAt: string;
  auctionAt: string;
  deliveryStartAt: string;
  deliveryEndAt: string;
  deliveryRegionEnabled: boolean;
  maxDeliveryAddresses: NumericValue;
  maxItemQuantity: NumericValue;
  items: ItemDraft[];
}

export interface CopyFeedback {
  kind: 'success' | 'error';
  message: string;
}

// ① 외형 유지(UI 교체 P4): Mantine Paper·Title·Text·Group·Stack·SimpleGrid·TextInput·NumberInput·Switch·Alert와
// 같은 값을 Tailwind와 @greenhub/ui로 그린다. Text = p(16px·줄 높이 1.55·여백 0), Title order 4 = h4(18px·800·1.45),
// Paper = 흰 바탕·모서리 16·그림자 xs(테두리 Paper는 gray-3 1px·모서리 8), SimpleGrid 간격 16px(sm = 48em부터 여러 칸).
const TEXT = 'm-0 p-0 text-base font-normal';
const ROW = 'flex flex-row flex-wrap items-center';
const COLUMN = 'flex flex-col items-stretch justify-start';
const BORDER_PAPER = 'block rounded-[8px] border border-solid border-[#dee2e6] bg-white p-3';

// Mantine NumberInput 값(숫자 또는 글자)을 @greenhub/ui NumberInput 값(숫자 또는 빈 칸)으로 옮긴다.
function toNumberValue(value: NumericValue): number | '' {
  if (typeof value === 'number') return value;
  if (value.trim() === '') return '';
  const parsed = Number(value.replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : '';
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="block rounded-[16px] bg-white p-4 shadow-mantine-xs">
      <div className={`${COLUMN} gap-4`}>
        <div>
          <h4 className="m-0 text-[18px] leading-[1.45] font-extrabold">{title}</h4>
          {description && (
            <p
              className={TEXT}
              style={{
                marginTop: 4,
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ScheduleSection({
  draft,
  busy,
  onChange,
}: {
  draft: FormDraft;
  busy: boolean;
  onChange: (
    key: 'orderOpenAt' | 'orderCloseAt' | 'auctionAt' | 'deliveryStartAt' | 'deliveryEndAt',
    value: string,
  ) => void;
}) {
  const id = useId();
  return (
    <FormSection
      title="일정"
      description="한국 시간 기준입니다. 주문 시작 → 주문 마감 → 경매 → 배송 시작 → 배송 종료 순서로 맞춰 주세요."
    >
      <div className="grid grid-cols-1 gap-4 min-[48em]:grid-cols-2">
        {(
          [
            ['orderOpenAt', '주문 시작'],
            ['orderCloseAt', '주문 마감'],
            ['auctionAt', '경매 시각'],
            ['deliveryStartAt', '배송 시작'],
            ['deliveryEndAt', '배송 종료'],
          ] as const
        ).map(([key, label]) => (
          <Field key={key}>
            <FieldLabel htmlFor={`${id}-${key}`} required>
              {label}
            </FieldLabel>
            <Input
              id={`${id}-${key}`}
              type="datetime-local"
              value={draft[key]}
              onChange={(event) => onChange(key, event.currentTarget.value)}
              disabled={busy}
              required
            />
          </Field>
        ))}
      </div>
    </FormSection>
  );
}

export function DeliveryRegionSection({
  region,
  enabled,
  busy,
  onChange,
}: {
  region: SaleRoundDeliveryRegion;
  enabled: boolean;
  busy: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const labelId = useId();
  return (
    <FormSection
      title="배송 지역"
      description="이 회차에서 주문을 받는 지역입니다. 끄면 이 지역 주문을 받지 않습니다."
    >
      <div className="flex flex-row flex-nowrap items-center justify-between gap-4">
        <p className={TEXT} style={{ fontWeight: 'var(--fw-medium)' }}>
          {region.label}
        </p>
        {/* Mantine Switch sm + 오른쪽 라벨(15px·줄 높이 20px·왼쪽 12px, 잠기면 gray-5). */}
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Switch가 감싼 label 안에 숨은 checkbox를 그린다(글자를 눌러도 켜고 끈다). 이름은 aria-labelledby로 준다. */}
        <label className="flex [-webkit-tap-highlight-color:transparent]">
          <Switch
            aria-labelledby={labelId}
            checked={enabled}
            onCheckedChange={(checked) => onChange(checked)}
            disabled={busy}
          />
          <span
            id={labelId}
            className={`inline-flex flex-col text-[15px] leading-5 ps-3 ${
              busy ? 'cursor-not-allowed text-[#adb5bd]' : 'cursor-pointer'
            }`}
          >
            배송 지역 활성
          </span>
        </label>
      </div>
      {!enabled && (
        <Alert variant="warning" role="alert">
          <AlertTitle>배송 지역 비활성</AlertTitle>
          <AlertDescription>
            저장하면 이 회차에서 해당 지역 주문을 받을 수 없습니다.
          </AlertDescription>
        </Alert>
      )}
    </FormSection>
  );
}

function NumberField({
  label,
  value,
  min,
  thousandSeparator,
  disabled,
  onChange,
}: {
  label: string;
  value: NumericValue;
  min: number;
  thousandSeparator?: string;
  disabled: boolean;
  onChange: (value: NumericValue) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <NumberInput
        id={id}
        withControls
        min={min}
        step={1}
        thousandSeparator={thousandSeparator}
        value={toNumberValue(value)}
        onValueChange={onChange}
        disabled={disabled}
        required
      />
    </Field>
  );
}

export function LimitsSection({
  maxDeliveryAddresses,
  maxItemQuantity,
  busy,
  onChange,
}: {
  maxDeliveryAddresses: NumericValue;
  maxItemQuantity: NumericValue;
  busy: boolean;
  onChange: (key: 'maxDeliveryAddresses' | 'maxItemQuantity', value: NumericValue) => void;
}) {
  return (
    <FormSection title="회차 한도">
      <div className="grid grid-cols-1 gap-4 min-[48em]:grid-cols-2">
        <NumberField
          label="배송지 한도"
          min={1}
          value={maxDeliveryAddresses}
          onChange={(value) => onChange('maxDeliveryAddresses', value)}
          disabled={busy}
        />
        <NumberField
          label="판매 수량 한도"
          min={1}
          value={maxItemQuantity}
          onChange={(value) => onChange('maxItemQuantity', value)}
          disabled={busy}
        />
      </div>
    </FormSection>
  );
}

export function ProductsSection({
  items,
  availableProducts,
  busy,
  onAdd,
  onRemove,
  onUpdate,
}: {
  items: ItemDraft[];
  availableProducts: readonly Product[];
  busy: boolean;
  onAdd: (product: Product) => void;
  onRemove: (key: string) => void;
  onUpdate: (
    key: string,
    field: 'roundPrice' | 'saleLimitQuantity' | 'displayOrder',
    value: NumericValue,
  ) => void;
}) {
  return (
    <FormSection
      title="회차 상품"
      description="회차 가격과 상품별 판매 한도는 1 이상, 노출 순서는 0부터 숫자로 적어 주세요(작은 숫자가 먼저 보입니다)."
    >
      {items.length === 0 && (
        <Alert variant="warning" role="alert">
          <AlertTitle>선택한 상품이 없습니다</AlertTitle>
          <AlertDescription>
            아래 상품 목록에서 회차에 포함할 상품을 추가해 주세요.
          </AlertDescription>
        </Alert>
      )}
      {items.map((item) => (
        <div key={item.key} className={BORDER_PAPER}>
          <div className={`${COLUMN} gap-3`}>
            <div className="flex flex-row flex-nowrap items-start justify-between gap-4">
              <div>
                <p className={TEXT} style={{ fontWeight: 'var(--fw-medium)' }}>
                  {item.name}
                </p>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {item.productId}
                </p>
              </div>
              <Button
                type="button"
                size="xs"
                variant="subtle-destructive"
                onClick={() => onRemove(item.key)}
                disabled={busy}
              >
                <Trash2 className="size-3.5" data-icon="inline-start" />
                제거
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 min-[48em]:grid-cols-3">
              <NumberField
                label="회차 가격"
                min={1}
                thousandSeparator=","
                value={item.roundPrice}
                onChange={(value) => onUpdate(item.key, 'roundPrice', value)}
                disabled={busy}
              />
              <NumberField
                label="상품별 한도"
                min={1}
                value={item.saleLimitQuantity}
                onChange={(value) => onUpdate(item.key, 'saleLimitQuantity', value)}
                disabled={busy}
              />
              <NumberField
                label="노출 순서"
                min={0}
                value={item.displayOrder}
                onChange={(value) => onUpdate(item.key, 'displayOrder', value)}
                disabled={busy}
              />
            </div>
          </div>
        </div>
      ))}

      <div className={`${COLUMN} gap-2.5`}>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}
        >
          추가 가능한 상품
        </p>
        {availableProducts.length === 0 && (
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            추가할 수 있는 상품이 없습니다. 상품 관리에서 판매 중인 상품을 먼저 등록해 주세요.
          </p>
        )}
        {availableProducts.map((product) => (
          <div
            key={product.id}
            className="flex flex-row flex-nowrap items-center justify-between gap-4"
          >
            <div>
              <div className={`${ROW} justify-start gap-2.5`}>
                <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                  {product.name}
                </p>
                {!product.isActive && <Badge variant="secondary">비활성</Badge>}
              </div>
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                상품 기준가 ₩{product.price.toLocaleString()}
              </p>
            </div>
            <Button
              type="button"
              size="xs"
              variant="light"
              onClick={() => onAdd(product)}
              disabled={busy || !product.isActive}
            >
              <PackagePlus className="size-3.5" data-icon="inline-start" />
              추가
            </Button>
          </div>
        ))}
      </div>
    </FormSection>
  );
}

function LinkRow({
  label,
  url,
  disabled,
  onCopy,
}: {
  label: string;
  url: string | null;
  disabled: boolean;
  onCopy: (url: string, label: string) => Promise<void>;
}) {
  return (
    <div className={BORDER_PAPER}>
      <div className="flex flex-row flex-nowrap items-center justify-between gap-4">
        <div
          className="flex flex-row flex-nowrap items-center justify-start gap-3"
          style={{ minWidth: 0 }}
        >
          <Link2 size={18} style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}
            >
              {label}
            </p>
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-sm)',
                color: url ? 'var(--color-text-secondary)' : 'var(--color-text-disabled)',
                wordBreak: 'break-all',
              }}
            >
              {url ?? '아직 공유 링크가 없습니다.'}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="xs"
          variant="light"
          onClick={() => url && void onCopy(url, label)}
          disabled={disabled || !url}
          style={{ flexShrink: 0 }}
        >
          <Copy className="size-3.5" data-icon="inline-start" />
          복사
        </Button>
      </div>
    </div>
  );
}

export function CarrotLinksSection({
  items,
  representativeUrl,
  copyFeedback,
  busy,
  getProductLink,
  onCopy,
}: {
  items: ItemDraft[];
  representativeUrl: string | null;
  copyFeedback: CopyFeedback | null;
  busy: boolean;
  getProductLink: (productId: string) => string | null;
  onCopy: (url: string, label: string) => Promise<void>;
}) {
  return (
    <FormSection
      title="당근 공유 링크"
      description="당근 게시글에 붙여 넣을 회차·상품 링크입니다. 복사해서 쓰세요."
    >
      <div className={`${COLUMN} gap-3`}>
        <LinkRow label="당근 대표 링크" url={representativeUrl} disabled={busy} onCopy={onCopy} />
        {items.map((item) => (
          <LinkRow
            key={`link:${item.key}`}
            label={`${item.name} 상품 링크`}
            url={getProductLink(item.productId)}
            disabled={busy}
            onCopy={onCopy}
          />
        ))}
      </div>
      {copyFeedback && (
        <Alert
          variant={copyFeedback.kind === 'success' ? 'default' : 'destructive'}
          role={copyFeedback.kind === 'success' ? 'status' : 'alert'}
        >
          <AlertTitle>
            {copyFeedback.kind === 'success' ? '링크 복사 완료' : '링크 복사 실패'}
          </AlertTitle>
          <AlertDescription>{copyFeedback.message}</AlertDescription>
        </Alert>
      )}
    </FormSection>
  );
}
