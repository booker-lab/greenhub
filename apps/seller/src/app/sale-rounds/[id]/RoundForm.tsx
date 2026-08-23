'use client';

import type { Product } from '@greenhub/shared';
import { Alert, Box, Button, Stack, TextInput } from '@mantine/core';
import { Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  CreateSaleRoundInput,
  SaleRoundItemInput,
  SellerSaleRound,
} from '@/hooks/useSaleRounds';
import {
  parseKstDateTimeInput,
  readSafeHttpUrl,
  toKstDateTimeInput,
  validateRoundFormInput,
} from './RoundForm.logic';
import {
  CarrotLinksSection,
  type CopyFeedback,
  DeliveryRegionSection,
  type FormDraft,
  FormSection,
  LimitsSection,
  type NumericValue,
  ProductsSection,
  ScheduleSection,
} from './RoundForm.sections';

export interface RoundFormProductLink {
  productId: string;
  url: string;
}

export interface RoundFormCarrotLinks {
  representativeUrl: string | null;
  productLinks: readonly RoundFormProductLink[];
}

export interface RoundFormProps {
  round: SellerSaleRound;
  products: readonly Product[];
  carrotLinks: RoundFormCarrotLinks;
  onSave: (input: CreateSaleRoundInput) => Promise<void>;
  disabled?: boolean;
}

function createDraft(round: SellerSaleRound): FormDraft {
  return {
    name: round.name,
    orderOpenAt: toKstDateTimeInput(round.schedule.orderOpenAt),
    orderCloseAt: toKstDateTimeInput(round.schedule.orderCloseAt),
    auctionAt: toKstDateTimeInput(round.schedule.auctionAt),
    deliveryStartAt: toKstDateTimeInput(round.schedule.deliveryStartAt),
    deliveryEndAt: toKstDateTimeInput(round.schedule.deliveryEndAt),
    deliveryRegionEnabled: round.deliveryRegion.enabled,
    maxDeliveryAddresses: round.limits.maxDeliveryAddresses,
    maxItemQuantity: round.limits.maxItemQuantity,
    items: [...round.items]
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map((item, index) => ({
        key: `${item.id}:${index}`,
        productId: item.productId,
        name: item.productNameSnapshot,
        roundPrice: item.roundPrice,
        saleLimitQuantity: item.saleLimitQuantity,
        displayOrder: item.displayOrder,
      })),
  };
}

function readInteger(value: NumericValue): number | null {
  const text = String(value);
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function RoundForm({
  round,
  products,
  carrotLinks,
  onSave,
  disabled = false,
}: RoundFormProps) {
  const [draft, setDraft] = useState(() => createDraft(round));
  const [submitting, setSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveFeedback, setSaveFeedback] = useState<CopyFeedback | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const busy = disabled || submitting;

  useEffect(() => {
    setDraft(createDraft(round));
    setValidationErrors([]);
    setSaveFeedback(null);
    setCopyFeedback(null);
  }, [round]);

  const selectedProductIds = useMemo(
    () => new Set(draft.items.map((item) => item.productId)),
    [draft.items],
  );
  const availableProducts = products.filter((product) => !selectedProductIds.has(product.id));
  const representativeUrl = readSafeHttpUrl(carrotLinks.representativeUrl);

  const changeDraft = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveFeedback(null);
  };

  const addProduct = (product: Product) => {
    if (!product.isActive || selectedProductIds.has(product.id)) return;
    changeDraft('items', [
      ...draft.items,
      {
        key: `new:${product.id}`,
        productId: product.id,
        name: product.name,
        roundPrice: '',
        saleLimitQuantity: '',
        displayOrder: '',
      },
    ]);
  };

  const updateItem = (
    key: string,
    field: 'roundPrice' | 'saleLimitQuantity' | 'displayOrder',
    value: NumericValue,
  ) => {
    changeDraft(
      'items',
      draft.items.map((item) => (item.key === key ? { ...item, [field]: value } : item)),
    );
  };

  const getProductLink = (productId: string) => {
    const matches = carrotLinks.productLinks.filter((link) => link.productId === productId);
    if (matches.length !== 1) return null;
    return readSafeHttpUrl(matches[0].url);
  };

  const copyLink = async (url: string, label: string) => {
    setCopyFeedback(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('클립보드를 사용할 수 없습니다.');
      await navigator.clipboard.writeText(url);
      setCopyFeedback({ kind: 'success', message: `${label}을(를) 복사했습니다.` });
    } catch {
      setCopyFeedback({
        kind: 'error',
        message: `${label}을(를) 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.`,
      });
    }
  };

  const submit = async () => {
    setValidationErrors([]);
    setSaveFeedback(null);

    const scheduleValues = [
      draft.orderOpenAt,
      draft.orderCloseAt,
      draft.auctionAt,
      draft.deliveryStartAt,
      draft.deliveryEndAt,
    ].map(parseKstDateTimeInput);
    const maxDeliveryAddresses = readInteger(draft.maxDeliveryAddresses);
    const maxItemQuantity = readInteger(draft.maxItemQuantity);
    const parsedItems: SaleRoundItemInput[] = [];

    for (const item of draft.items) {
      const roundPrice = readInteger(item.roundPrice);
      const saleLimitQuantity = readInteger(item.saleLimitQuantity);
      const displayOrder = readInteger(item.displayOrder);
      if (roundPrice === null || saleLimitQuantity === null || displayOrder === null) {
        setValidationErrors(['상품 가격·한도·노출 순서는 정수로 입력해 주세요.']);
        return;
      }
      parsedItems.push({ productId: item.productId, roundPrice, saleLimitQuantity, displayOrder });
    }

    if (scheduleValues.some((value) => value === null)) {
      setValidationErrors(['모든 일정을 올바른 Asia/Seoul 날짜와 시각으로 입력해 주세요.']);
      return;
    }
    if (maxDeliveryAddresses === null || maxItemQuantity === null) {
      setValidationErrors(['배송지 한도와 판매 수량 한도는 정수로 입력해 주세요.']);
      return;
    }

    const [orderOpenAt, orderCloseAt, auctionAt, deliveryStartAt, deliveryEndAt] =
      scheduleValues as string[];
    const input: CreateSaleRoundInput = {
      name: draft.name.trim(),
      schedule: {
        orderOpenAt,
        orderCloseAt,
        auctionAt,
        deliveryStartAt,
        deliveryEndAt,
        timezone: 'Asia/Seoul',
      },
      deliveryRegion: { ...round.deliveryRegion, enabled: draft.deliveryRegionEnabled },
      limits: { maxDeliveryAddresses, maxItemQuantity },
      items: parsedItems,
      ...(round.carrotLandingUrl ? { carrotLandingUrl: round.carrotLandingUrl } : {}),
    };
    const errors = validateRoundFormInput(input);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await onSave(input);
      setSaveFeedback({ kind: 'success', message: '검증된 회차 편집 내용을 저장했습니다.' });
    } catch (error) {
      setSaveFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : '회차를 저장하지 못했습니다.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Stack gap="md">
        {saveFeedback && (
          <Alert
            color={saveFeedback.kind === 'success' ? 'green' : 'red'}
            title={saveFeedback.kind === 'success' ? '저장 완료' : '저장 실패'}
            role={saveFeedback.kind === 'success' ? 'status' : 'alert'}
          >
            {saveFeedback.message}
          </Alert>
        )}

        <FormSection title="회차 기본 정보">
          <TextInput
            label="회차 이름"
            value={draft.name}
            onChange={(event) => changeDraft('name', event.currentTarget.value)}
            disabled={busy}
            required
          />
        </FormSection>
        <ScheduleSection
          draft={draft}
          busy={busy}
          onChange={(key, value) => changeDraft(key, value)}
        />
        <DeliveryRegionSection
          region={round.deliveryRegion}
          enabled={draft.deliveryRegionEnabled}
          busy={busy}
          onChange={(value) => changeDraft('deliveryRegionEnabled', value)}
        />
        <LimitsSection
          maxDeliveryAddresses={draft.maxDeliveryAddresses}
          maxItemQuantity={draft.maxItemQuantity}
          busy={busy}
          onChange={(key, value) => changeDraft(key, value)}
        />
        <ProductsSection
          items={draft.items}
          availableProducts={availableProducts}
          busy={busy}
          onAdd={addProduct}
          onRemove={(key) =>
            changeDraft(
              'items',
              draft.items.filter((item) => item.key !== key),
            )
          }
          onUpdate={updateItem}
        />
        <CarrotLinksSection
          items={draft.items}
          representativeUrl={representativeUrl}
          copyFeedback={copyFeedback}
          busy={busy}
          getProductLink={getProductLink}
          onCopy={copyLink}
        />

        {validationErrors.length > 0 && (
          <Alert color="red" title="입력 내용을 확인해 주세요" role="alert">
            <Box component="ul" m={0} pl="md">
              {validationErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </Box>
          </Alert>
        )}
        <Button
          type="submit"
          size="md"
          leftSection={<Save size={18} />}
          loading={submitting}
          disabled={busy}
        >
          회차 저장
        </Button>
      </Stack>
    </form>
  );
}
