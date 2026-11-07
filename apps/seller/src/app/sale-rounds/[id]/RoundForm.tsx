'use client';

import type { Product } from '@greenhub/shared';
import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Button } from '@greenhub/ui/components/button';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { LoadingButton } from '@greenhub/ui/components/loading-button';
import { Save } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMarketSummaries } from '@/hooks/useMarketPrices';
import type {
  CreateSaleRoundInput,
  SaleRoundItemInput,
  SellerSaleRound,
} from '@/hooks/useSaleRounds';
import {
  isRoundDraftDirty,
  parseRoundDraft,
  ROUND_DRAFT_SAVE_DELAY_MS,
  resolveRoundDraft,
  roundDraftStorageKey,
  serializeRoundDraft,
} from './RoundForm.draft';
import {
  parseKstDateTimeInput,
  readSafeHttpUrl,
  roundEditLockNotice,
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

// ① 외형 유지(UI 교체 P4): Mantine Stack(md 16px)·Alert·TextInput·Button(md, 저장 중 loading)과 같은 값.
// 저장 중은 LoadingButton measured(글자·아이콘을 숨긴 Mantine Button loading 실측 모양)다.

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
  /** 서버가 수정을 받지 않는 회차(판매 시작 뒤 등) — 내용만 보여 주고 저장 버튼을 숨긴다. */
  readOnly?: boolean;
  /** 새 회차 화면 — 임시저장 키를 'new'로 쓰고 서버 updatedAt과 비교하지 않는다. */
  isNew?: boolean;
}

/** 임시저장 복원 안내: 불러옴 / 서버 회차가 더 새로워 버림. */
type DraftNotice = 'restored' | 'stale' | null;

// localStorage는 사생활 보호 모드·저장 공간 부족 등으로 던질 수 있어 모두 감싼다.
function readStoredDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredDraft(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function removeStoredDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {}
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
  readOnly = false,
  isNew = false,
}: RoundFormProps) {
  const [draft, setDraft] = useState(() => createDraft(round));
  // 입력이 바뀌었는지 비교할 기준(서버 값·새 회차 기본값).
  const [baseline, setBaseline] = useState(() => createDraft(round));
  const [draftNotice, setDraftNotice] = useState<DraftNotice>(null);
  // 저장에 성공한 뒤 다시 고치기 전까지는 임시저장·이탈 경고를 쉰다.
  const [draftSuspended, setDraftSuspended] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const nameId = useId();
  const [saveFeedback, setSaveFeedback] = useState<CopyFeedback | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const busy = disabled || submitting;
  // 읽기 전용이면 입력을 잠그되 당근 링크 복사는 그대로 쓸 수 있게 둔다.
  const locked = busy || readOnly;
  // 읽기 전용 회차(판매 시작 뒤)는 임시저장을 쓰지도 복원하지도 않는다.
  const draftEnabled = !readOnly;
  const draftKey = roundDraftStorageKey(round.storeId, isNew ? null : round.id);
  const baseUpdatedAt = isNew ? null : round.updatedAt;
  const savingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWriteRef = useRef<(() => void) | null>(null);
  // 마지막으로 저장(또는 복원)한 입력. 같은 입력을 다시 쓰지 않고, null이면 저장된 초안이 없다.
  const lastStoredRef = useRef<string | null>(null);

  const cancelPendingDraft = useCallback(() => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    pendingWriteRef.current = null;
  }, []);

  const flushDraft = useCallback(() => {
    const write = pendingWriteRef.current;
    cancelPendingDraft();
    write?.();
  }, [cancelPendingDraft]);

  useEffect(() => {
    // 회차가 바뀌기 전에 미뤄 둔 임시저장을 먼저 써 두고 다시 읽는다.
    flushDraft();
    const next = createDraft(round);
    let initial = next;
    let notice: DraftNotice = null;
    lastStoredRef.current = null;
    // 저장 중 받은 새 회차는 저장 결과이므로 초안을 복원하지 않는다.
    if (draftEnabled && !savingRef.current) {
      const raw = readStoredDraft(draftKey);
      const resolution = resolveRoundDraft({
        stored: parseRoundDraft(raw),
        roundUpdatedAt: baseUpdatedAt,
        now: new Date(),
      });
      if (resolution.kind === 'restore' && isRoundDraftDirty(resolution.draft, next)) {
        initial = resolution.draft;
        notice = 'restored';
        lastStoredRef.current = JSON.stringify(resolution.draft);
      } else if (raw !== null) {
        // 만료·형식 오류·서버가 더 새로운 초안·기본값과 같은 초안은 지운다.
        removeStoredDraft(draftKey);
        if (resolution.kind === 'stale') notice = 'stale';
      }
    }
    setBaseline(next);
    setDraft(initial);
    setDraftNotice(notice);
    setDraftSuspended(false);
    setValidationErrors([]);
    setSaveFeedback(null);
    setCopyFeedback(null);
  }, [round, draftEnabled, draftKey, baseUpdatedAt, flushDraft]);

  const dirty = useMemo(() => isRoundDraftDirty(draft, baseline), [draft, baseline]);

  // 입력이 멈추면 임시저장한다. 기준과 같아지면 저장된 초안을 지운다.
  useEffect(() => {
    if (!draftEnabled || submitting || draftSuspended) {
      cancelPendingDraft();
      return;
    }
    const serialized = JSON.stringify(draft);
    if (dirty ? serialized === lastStoredRef.current : lastStoredRef.current === null) {
      cancelPendingDraft();
      return;
    }
    pendingWriteRef.current = () => {
      if (dirty) {
        writeStoredDraft(draftKey, serializeRoundDraft(draft, new Date(), baseUpdatedAt));
        lastStoredRef.current = serialized;
      } else {
        removeStoredDraft(draftKey);
        lastStoredRef.current = null;
      }
    };
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushDraft, ROUND_DRAFT_SAVE_DELAY_MS);
  }, [
    draft,
    dirty,
    draftEnabled,
    submitting,
    draftSuspended,
    draftKey,
    baseUpdatedAt,
    cancelPendingDraft,
    flushDraft,
  ]);

  // 다른 메뉴로 이동(언마운트)하거나 탭을 닫기 직전에 미뤄 둔 임시저장을 바로 쓴다.
  useEffect(() => {
    window.addEventListener('pagehide', flushDraft);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      flushDraft();
    };
  }, [flushDraft]);

  // 저장하지 않은 변경이 있으면 브라우저 이탈(새로고침·탭 닫기)을 경고한다. 저장 중·저장 뒤에는 끈다.
  const warnBeforeUnload = draftEnabled && dirty && !submitting && !draftSuspended;
  useEffect(() => {
    if (!warnBeforeUnload) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flushDraft();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [warnBeforeUnload, flushDraft]);

  const discardDraft = () => {
    cancelPendingDraft();
    removeStoredDraft(draftKey);
    lastStoredRef.current = null;
    setDraft(baseline);
    setDraftNotice(null);
    setValidationErrors([]);
    setSaveFeedback(null);
  };

  const selectedProductIds = useMemo(
    () => new Set(draft.items.map((item) => item.productId)),
    [draft.items],
  );
  // 경매 시세는 참고값이라 불러오지 못해도 양식은 그대로 쓴다.
  const { data: session } = useSession();
  const { summaries: marketSummaries } = useMarketSummaries(
    round.storeId,
    session?.user.accessToken,
    [...selectedProductIds],
  );
  const availableProducts = products.filter((product) => !selectedProductIds.has(product.id));
  const productPrices = useMemo(
    () => new Map(products.map((product) => [product.id, product.price])),
    [products],
  );
  const representativeUrl = readSafeHttpUrl(carrotLinks.representativeUrl);

  const changeDraft = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveFeedback(null);
    setDraftSuspended(false);
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
    if (readOnly) return;
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
    savingRef.current = true;
    // 저장이 실패해도 입력이 남도록 미뤄 둔 임시저장을 먼저 쓴다.
    flushDraft();
    try {
      await onSave(input);
      if (draftEnabled) {
        cancelPendingDraft();
        removeStoredDraft(draftKey);
        lastStoredRef.current = null;
      }
      setDraftSuspended(true);
      setDraftNotice(null);
      setSaveFeedback({ kind: 'success', message: '검증된 회차 편집 내용을 저장했습니다.' });
    } catch (error) {
      setSaveFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : '회차를 저장하지 못했습니다.',
      });
    } finally {
      savingRef.current = false;
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
      <div className="flex flex-col items-stretch justify-start gap-4">
        {readOnly && (
          <Alert variant="secondary" role="status">
            <AlertTitle>고칠 수 없는 회차예요</AlertTitle>
            <AlertDescription>
              회차 내용은 판매 시작 전에만 고칠 수 있어요. 아래는 저장된 내용이에요.
            </AlertDescription>
          </Alert>
        )}
        {draftNotice === 'restored' && (
          <Alert variant="secondary" role="status">
            <AlertTitle>저장하지 않은 입력을 불러왔어요</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col items-start justify-start gap-2.5">
                <span>이 기기에 임시로 남아 있던 입력이에요. 회차 저장을 눌러야 반영돼요.</span>
                <Button
                  type="button"
                  size="xs"
                  variant="light"
                  onClick={discardDraft}
                  disabled={busy}
                >
                  버리기
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {draftNotice === 'stale' && (
          <Alert variant="warning" role="status">
            <AlertTitle>임시로 남은 입력을 버렸어요</AlertTitle>
            <AlertDescription>
              입력을 남긴 뒤에 회차가 다시 저장되어, 지금 저장된 내용을 보여 드려요.
            </AlertDescription>
          </Alert>
        )}
        {saveFeedback && (
          <Alert
            variant={saveFeedback.kind === 'success' ? 'default' : 'destructive'}
            role={saveFeedback.kind === 'success' ? 'status' : 'alert'}
          >
            <AlertTitle>{saveFeedback.kind === 'success' ? '저장 완료' : '저장 실패'}</AlertTitle>
            <AlertDescription>{saveFeedback.message}</AlertDescription>
          </Alert>
        )}

        <FormSection title="회차 기본 정보">
          <Field>
            <FieldLabel htmlFor={nameId} required>
              회차 이름
            </FieldLabel>
            <Input
              id={nameId}
              value={draft.name}
              onChange={(event) => changeDraft('name', event.currentTarget.value)}
              disabled={locked}
              required
            />
          </Field>
        </FormSection>
        <ScheduleSection
          draft={draft}
          busy={locked}
          onChange={(key, value) => changeDraft(key, value)}
        />
        <DeliveryRegionSection
          region={round.deliveryRegion}
          enabled={draft.deliveryRegionEnabled}
          busy={locked}
          onChange={(value) => changeDraft('deliveryRegionEnabled', value)}
        />
        <LimitsSection
          maxDeliveryAddresses={draft.maxDeliveryAddresses}
          maxItemQuantity={draft.maxItemQuantity}
          busy={locked}
          onChange={(key, value) => changeDraft(key, value)}
        />
        {!readOnly && (
          <Alert variant="secondary" role="status">
            <AlertTitle>주문이 시작되면 고칠 수 없어요</AlertTitle>
            <AlertDescription>{roundEditLockNotice(draft.orderOpenAt)}</AlertDescription>
          </Alert>
        )}
        <ProductsSection
          items={draft.items}
          availableProducts={availableProducts}
          productPrices={productPrices}
          busy={locked}
          onAdd={addProduct}
          onRemove={(key) =>
            changeDraft(
              'items',
              draft.items.filter((item) => item.key !== key),
            )
          }
          onUpdate={updateItem}
          marketSummaries={marketSummaries}
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
          <Alert variant="destructive" role="alert">
            <AlertTitle>입력 내용을 확인해 주세요</AlertTitle>
            <AlertDescription>
              <ul className="m-0 pl-4">
                {validationErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {!readOnly && (
          <LoadingButton measured type="submit" size="md" loading={submitting} disabled={busy}>
            <Save className="size-[18px]" data-icon="inline-start" />
            회차 저장
          </LoadingButton>
        )}
      </div>
    </form>
  );
}
