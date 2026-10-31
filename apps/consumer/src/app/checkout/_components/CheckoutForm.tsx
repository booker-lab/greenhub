'use client';

import {
  type DeliveryAddress,
  type DeliveryMethod,
  ORDER_REQUEST_NOTE_MAX_LENGTH,
} from '@greenhub/shared';
import { Alert, AlertDescription } from '@greenhub/ui/components/alert';
import { Button } from '@greenhub/ui/components/button';
import { Checkbox } from '@greenhub/ui/components/checkbox';
import { Field, FieldDescription, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { LoadingButton } from '@greenhub/ui/components/loading-button';
import { Textarea } from '@greenhub/ui/components/textarea';
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from 'react';
import GiftFields, { type GiftState } from '@/components/benchmark/GiftFields';
import PackageLabelFields, {
  type PackageLabelState,
} from '@/components/benchmark/PackageLabelFields';
import { type CartItem, isRoundCartItem } from '@/hooks/useCart';
import type { PaymentMethod } from '@/hooks/usePayment';
import { PAYMENT_METHOD_OPTIONS, paymentButtonLabel } from '@/lib/payment-method-options';

const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
};

export interface CheckoutFormProps {
  items: CartItem[];
  /** 화면에 보일 결제 금액. null이면 서버 금액을 확인하는 중으로 표시하고, 0이면 줄을 숨긴다. */
  totalAmount: number | null;
  address: DeliveryAddress;
  onAddressChange: (a: DeliveryAddress) => void;
  deliveryPhone: string;
  onDeliveryPhoneChange: (phone: string) => void;
  /** 연락처 칸을 벗어난 뒤 보여 줄 형식 오류. 회차 주문만 넘긴다. */
  deliveryPhoneError?: string | null;
  /** 회차 주문에서만 넘긴다. 없으면 요청사항 칸을 그리지 않는다. */
  requestNote?: string;
  onRequestNoteChange?: (note: string) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (m: PaymentMethod) => void;
  isLoading: boolean;
  canPay: boolean;
  error: string | null;
  onPay: () => void;
  singleSummary?: {
    quantity: number;
    deliveryMethod: DeliveryMethod;
    requestedDeliveryDate?: string;
  };
  /** 벤치마킹 비교 기능(도착 시각·선물·포장 라벨). 회차 결제에서만 넘긴다. */
  benchmark?: {
    arrivalLabel?: string | null;
    gift?: { value: GiftState; onChange: (next: GiftState) => void };
    packageLabel?: { value: PackageLabelState; onChange: (next: PackageLabelState) => void };
  };
}

export function isIcheonDeliveryAddress(value: string): boolean {
  return /^(?:(?:경기도|경기)\s+)?이천시(?:\s|$)/.test(value.trim());
}

function formatDeliveryDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

// ① 외형 유지: Mantine TextInput·Textarea(InputWrapper)와 같은 구조·연결. 라벨(for) → 설명(p) → 입력칸 → 오류(p).
// 입력칸은 오류·설명을 aria-describedby로 가리키고 오류가 있으면 aria-invalid다. Mantine 감싸개는 역할이 없는
// div라 Field의 role="group"은 지운다. 필수 표시는 FieldLabel required(" *", aria-hidden)와 입력칸 required.
function useFieldIds(description: ReactNode, error: ReactNode) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return {
    id,
    descriptionId,
    errorId,
    describedBy: [errorId, descriptionId].filter(Boolean).join(' ') || undefined,
  };
}

function FieldFrame({
  id,
  label,
  description,
  descriptionId,
  error,
  errorId,
  required,
  style,
  children,
}: {
  id: string;
  label?: ReactNode;
  description?: ReactNode;
  descriptionId?: string;
  error?: ReactNode;
  errorId?: string;
  required?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useValidAriaRole: Field 기본 role="group"을 지워 Mantine 감싸개(역할 없는 div)와 같은 접근성 트리로 둔다.
    <Field role={undefined} style={style}>
      {label && (
        <FieldLabel htmlFor={id} required={required}>
          {label}
        </FieldLabel>
      )}
      {description && (
        <FieldDescription id={descriptionId} className="m-0">
          {description}
        </FieldDescription>
      )}
      {children}
      {error && (
        <p
          id={errorId}
          data-slot="field-error"
          className="m-0 text-xs leading-[1.2] font-normal text-[#fa5252]"
        >
          {error}
        </p>
      )}
    </Field>
  );
}

function TextInput({
  label,
  description,
  error,
  required,
  style,
  ...props
}: Omit<ComponentProps<typeof Input>, 'size'> & {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}) {
  const { id, descriptionId, errorId, describedBy } = useFieldIds(description, error);
  return (
    <FieldFrame
      id={id}
      label={label}
      description={description}
      descriptionId={descriptionId}
      error={error}
      errorId={errorId}
      required={required}
      style={style}
    >
      <Input
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
    </FieldFrame>
  );
}

function TextareaField({
  label,
  description,
  ...props
}: ComponentProps<typeof Textarea> & { label?: ReactNode; description?: ReactNode }) {
  const { id, descriptionId, describedBy } = useFieldIds(description, null);
  return (
    <FieldFrame id={id} label={label} description={description} descriptionId={descriptionId}>
      <Textarea id={id} aria-describedby={describedBy} {...props} />
    </FieldFrame>
  );
}

export default function CheckoutForm({
  items,
  totalAmount,
  address,
  onAddressChange,
  deliveryPhone,
  onDeliveryPhoneChange,
  deliveryPhoneError,
  requestNote,
  onRequestNoteChange,
  paymentMethod,
  onPaymentMethodChange,
  isLoading,
  canPay,
  error,
  onPay,
  singleSummary,
  benchmark,
}: CheckoutFormProps) {
  const [roundDetailsConfirmed, setRoundDetailsConfirmed] = useState(false);
  const [deliveryPhoneTouched, setDeliveryPhoneTouched] = useState(false);
  const isRoundCheckout = items.length > 0 && items.every(isRoundCartItem);
  // 선물하기(gift)를 켜면 배송 연락처(받는 분 휴대폰)를 선물 칸의 "받는 분" 묶음으로 옮긴다.
  const giftOn = isRoundCheckout && Boolean(benchmark?.gift?.value.enabled);
  const isIcheonAddress = isIcheonDeliveryAddress(address.address);
  const confirmationKey = isRoundCheckout
    ? items
        .map(
          (item) =>
            `${item.roundId}:${item.roundItemId}:${item.productId}:${item.price}:${item.quantity}`,
        )
        .join('|')
    : '';
  const effectiveCanPay =
    canPay && (!isRoundCheckout || (isIcheonAddress && roundDetailsConfirmed));

  useEffect(() => {
    if (confirmationKey) setRoundDetailsConfirmed(false);
  }, [confirmationKey]);

  useEffect(() => {
    if (!isLoading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isLoading]);

  function openAddressSearch() {
    new window.daum.Postcode({
      oncomplete(data) {
        onAddressChange({
          ...address,
          address: data.address,
          zipCode: data.zonecode,
          addressDetail: '',
        });
      },
    }).open();
  }

  const buttonLabel = isLoading ? '처리 중...' : paymentButtonLabel(paymentMethod);

  return (
    // Mantine Container(sm 720px·px md·py lg)·Title order 1(줄 높이 1.3, mb lg) 계산값
    <div className="mx-auto max-w-[720px] px-4 py-5">
      <h1
        className="m-0 mb-5 leading-[1.3]"
        style={{ fontSize: 22, fontWeight: 'var(--fw-extrabold)', letterSpacing: '-0.01em' }}
      >
        결제
      </h1>

      {/* 주문 요약: 회색 바탕 위 회색 글자는 대비가 약해 흰 카드·본문 색 글자로 둔다 */}
      {/* Mantine Paper(p md·mb xl·withBorder = gray-3 1px) 계산값 */}
      <div
        className="mb-8 border border-solid border-[#dee2e6] p-4"
        style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius)' }}
      >
        <p
          className="m-0 mb-2.5 leading-[1.55]"
          style={{ fontWeight: 'var(--fw-extrabold)', fontSize: 'var(--font-size-md)' }}
        >
          주문 정보
        </p>
        {items.length > 0 && (
          <p className="m-0 mb-2.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            총 {items.reduce((sum, item) => sum + item.quantity, 0)}개 상품
          </p>
        )}
        <div className="flex flex-col gap-1">
          {items.length > 0
            ? items.map((item) => (
                <div key={item.productId} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <p
                      className="m-0 leading-[1.55]"
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'var(--fw-medium)',
                        color: 'var(--color-text)',
                        flex: 1,
                      }}
                    >
                      {item.name} × {item.quantity}
                    </p>
                    <p
                      className="m-0 leading-[1.55]"
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'var(--fw-bold)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {(item.price * item.quantity).toLocaleString()}원
                    </p>
                  </div>
                  {item.optionLabel && (
                    <p
                      className="m-0 leading-[1.55]"
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {item.optionLabel}
                    </p>
                  )}
                  {item.requestedDeliveryDate && (
                    <p
                      className="m-0 leading-[1.55]"
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      배송 희망일 {formatDeliveryDate(item.requestedDeliveryDate)}
                    </p>
                  )}
                </div>
              ))
            : singleSummary && (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p
                    className="m-0 leading-[1.55]"
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    수량
                  </p>
                  <p className="m-0 leading-[1.55]" style={{ fontSize: 'var(--font-size-sm)' }}>
                    {singleSummary.quantity}개
                  </p>
                </div>
              )}
          {singleSummary && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p
                className="m-0 leading-[1.55]"
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                배송 방법
              </p>
              <p className="m-0 leading-[1.55]" style={{ fontSize: 'var(--font-size-sm)' }}>
                {DELIVERY_LABELS[singleSummary.deliveryMethod]}
              </p>
            </div>
          )}
          {singleSummary?.requestedDeliveryDate && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p
                className="m-0 leading-[1.55]"
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                배송 희망일
              </p>
              <p className="m-0 leading-[1.55]" style={{ fontSize: 'var(--font-size-sm)' }}>
                {formatDeliveryDate(singleSummary.requestedDeliveryDate)}
              </p>
            </div>
          )}
          {benchmark?.arrivalLabel && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p
                className="m-0 leading-[1.55]"
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                도착
              </p>
              <p
                className="m-0 leading-[1.55]"
                style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}
              >
                {benchmark.arrivalLabel}까지
              </p>
            </div>
          )}
          {(totalAmount === null || totalAmount > 0) && (
            <div
              className="mt-2 flex flex-wrap items-baseline justify-between gap-4 pt-2.5"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <p
                className="m-0 leading-[1.55]"
                style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}
              >
                결제 금액
              </p>
              {totalAmount === null ? (
                <p
                  className="m-0 leading-[1.55]"
                  aria-live="polite"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  금액 확인 중...
                </p>
              ) : (
                <p
                  className="m-0 leading-[1.55]"
                  style={{
                    fontSize: 22,
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 'var(--fw-extrabold)',
                  }}
                >
                  {totalAmount.toLocaleString()}원
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 배송지: Mantine Stack(gap sm·mb xl) */}
      <div className="mb-8 flex flex-col gap-3">
        <p
          className="m-0 leading-[1.55]"
          style={{ fontWeight: 'var(--fw-extrabold)', fontSize: 'var(--font-size-md)' }}
        >
          배송지
        </p>
        <div className="flex flex-wrap items-end justify-start gap-2.5">
          <TextInput
            style={{ flex: 1 }}
            label={isRoundCheckout ? '이천시 배송 가능 주소' : undefined}
            placeholder="주소 검색 후 자동 입력 *"
            value={address.address}
            readOnly
            error={
              isRoundCheckout && address.address && !isIcheonAddress
                ? '경기도 이천시 주소만 주문할 수 있습니다.'
                : undefined
            }
          />
          <Button variant="outline-gray" onClick={openAddressSearch}>
            주소 검색
          </Button>
        </div>
        <TextInput
          placeholder="상세 주소"
          value={address.addressDetail}
          onChange={(e) => onAddressChange({ ...address, addressDetail: e.target.value })}
        />
        <TextInput placeholder="우편번호 (자동 입력)" value={address.zipCode} readOnly />
        {!giftOn && (
          <TextInput
            label={isRoundCheckout ? '배송 연락처 (필수)' : '연락처'}
            description={
              isRoundCheckout
                ? '주문·결제·배송 안내를 위한 정보성 연락에 사용하며 마케팅 동의와 별개입니다.'
                : undefined
            }
            placeholder="010-1234-5678"
            type="tel"
            value={deliveryPhone}
            onChange={(e) => onDeliveryPhoneChange(e.target.value)}
            onBlur={() => setDeliveryPhoneTouched(true)}
            error={deliveryPhoneTouched && deliveryPhoneError ? deliveryPhoneError : undefined}
            autoComplete="tel"
            required
          />
        )}
        {isRoundCheckout && benchmark?.gift && (
          // 선물하기(gift): 받는 분·보내는 분·카드 문구를 따로 받고, 배송 연락처는 받는 분 묶음으로 옮긴다.
          <GiftFields
            value={benchmark.gift.value}
            onChange={benchmark.gift.onChange}
            senderIsPackageLabel={Boolean(benchmark.packageLabel)}
            phoneSlot={
              giftOn ? (
                <TextInput
                  label="휴대폰 (배송 연락처)"
                  description="배송 안내가 이 번호로 가요."
                  placeholder="010-1234-5678"
                  type="tel"
                  value={deliveryPhone}
                  onChange={(e) => onDeliveryPhoneChange(e.target.value)}
                  onBlur={() => setDeliveryPhoneTouched(true)}
                  error={
                    deliveryPhoneTouched && deliveryPhoneError ? deliveryPhoneError : undefined
                  }
                  autoComplete="tel"
                  required
                />
              ) : null
            }
          />
        )}
        {isRoundCheckout && benchmark?.packageLabel && !giftOn && (
          // 포장 라벨(무료): 선물이면 보내는 분 이름이 라벨이라 이 칸을 숨긴다.
          <PackageLabelFields
            value={benchmark.packageLabel.value}
            onChange={benchmark.packageLabel.onChange}
          />
        )}
        {isRoundCheckout && onRequestNoteChange && (
          <TextareaField
            label="요청사항 (선택)"
            description={
              benchmark?.gift
                ? `배송 요청을 적어 주세요. 선물 받는 분·카드 문구는 위 선물 칸에 적어요. (${
                    requestNote?.length ?? 0
                  }/${ORDER_REQUEST_NOTE_MAX_LENGTH})`
                : `받는 분 성함·연락처, 선물 문구, 배송 요청을 적어 주세요. (${
                    requestNote?.length ?? 0
                  }/${ORDER_REQUEST_NOTE_MAX_LENGTH})`
            }
            placeholder={
              benchmark?.gift
                ? '예) 경비실에 맡겨 주세요'
                : '예) 받는 분 김그린 010-0000-0000 / 문구: 개업을 축하합니다'
            }
            value={requestNote ?? ''}
            onChange={(e) => onRequestNoteChange(e.target.value)}
            maxLength={ORDER_REQUEST_NOTE_MAX_LENGTH}
            autosize
            minRows={2}
          />
        )}
      </div>

      {isRoundCheckout && (
        <div className="mb-8 flex flex-col gap-4">
          <div className="p-4" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
            <p className="m-0 mb-2.5 text-sm" style={{ fontWeight: 'var(--fw-extrabold)' }}>
              필수 고지
            </p>
            <div className="flex flex-col gap-2.5">
              <p
                className="m-0 text-sm"
                style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-primary-dark)' }}
              >
                경기도 이천시 직접배송만 제공하며 화요일 오전 9시까지 문 앞 배송합니다.
              </p>
              <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                안전한 배송이 어려운 기상 상황에는 배송이 연기될 수 있으며, 판매자 책임으로 재배송비
                없이 새 배송 일정을 안내합니다.
              </p>
              <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                주문 마감 후 경매 매입·배송 준비가 시작되었거나 고객의 취급·시간 경과로 상품 가치가
                현저히 감소한 경우 단순 변심 청약철회가 제한될 수 있습니다. 표시·광고 또는 계약
                내용과 다르게 이행된 경우는 제외됩니다.
              </p>
            </div>
          </div>

          <div
            className="p-4"
            style={{ background: 'var(--color-deadline-surface)', borderRadius: 'var(--radius)' }}
          >
            <p
              className="m-0 mb-1 text-sm"
              style={{ fontWeight: 'var(--fw-extrabold)', color: 'var(--color-deadline-text)' }}
            >
              결제 직전 확인
            </p>
            <p className="m-0 mb-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              상품 정보가 변경되면 상품·수량·회차 가격과 총 결제 금액을 다시 확인해야 합니다.
            </p>
            <Checkbox
              label="상품·가격·회차 변경 내용을 확인했습니다."
              checked={roundDetailsConfirmed}
              onCheckedChange={(checked) => setRoundDetailsConfirmed(checked)}
            />
          </div>
        </div>
      )}

      {/* 결제 수단: Mantine Stack(gap xs·mb xl) */}
      <div className="mb-8 flex flex-col gap-2.5">
        <p
          className="m-0 leading-[1.55]"
          style={{ fontWeight: 'var(--fw-extrabold)', fontSize: 'var(--font-size-md)' }}
        >
          결제 수단
        </p>
        {PAYMENT_METHOD_OPTIONS.map(({ method, label, dot }) => {
          const isSelected = paymentMethod === method;
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Mantine Paper(div onClick) 구조 그대로(① 외형 유지)
            <div
              key={method}
              className="block p-4"
              onClick={() => onPaymentMethodChange(method)}
              style={{
                border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius)',
                background: isSelected ? 'var(--color-primary-surface)' : 'var(--color-bg)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden
                style={{
                  background: dot,
                  borderRadius: 'var(--radius-full)',
                  display: 'inline-block',
                  height: 14,
                  width: 14,
                }}
              />
              <p
                className="m-0 leading-[1.55]"
                style={{
                  fontWeight: isSelected ? 'var(--fw-bold)' : 'var(--fw-medium)',
                  fontSize: 'var(--font-size-sm)',
                }}
              >
                {label}
              </p>
            </div>
          );
        })}
      </div>

      {error && (
        // Mantine Alert(light red·mb sm, role="alert") 계산값
        <Alert variant="destructive" role="alert" className="mb-3">
          <AlertDescription>
            <p className="m-0 leading-[1.55]" style={{ fontSize: 'var(--font-size-sm)' }}>
              {error}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <LoadingButton
        size="lg"
        className="w-full"
        disabled={!effectiveCanPay}
        loading={isLoading}
        onClick={() => {
          if (effectiveCanPay) onPay();
        }}
      >
        {buttonLabel}
      </LoadingButton>
    </div>
  );
}
