'use client';

import type { ProductOptionGroup } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { CloseIcon, closeButtonClassName } from '@greenhub/ui/components/close-button';
import { DialogOverlay, DialogPopup, DialogPortal } from '@greenhub/ui/components/dialog';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetHeader,
  SheetTitle,
} from '@greenhub/ui/components/sheet';
import { cn } from '@greenhub/ui/lib/utils';
import { useEffect, useRef, useState } from 'react';
import {
  choiceRemaining,
  choiceStockLabel,
  firstAvailableChoiceId,
  isChoiceSoldOut,
  maxQuantityFor,
  type OptionAvailabilityMap,
} from '@/lib/option-availability';

// 옵션 시트(option-sheet). 하단 고정 바의 장바구니·바로 구매를 누르면 아래에서 올라온다.
// 옵션 묶음마다 하나씩 고르고, 고른 조합의 가격과 수량을 보여준 뒤 담거나 바로 산다.
// 축하 문구는 미리 출력한 토퍼 선택지로 고른다. 자유 문구(포장 라벨)는 결제할 때 주문마다 한 번 받는다.
// 직접 출력한 화분처럼 재고에 연결된 선택지는 품절이면 고를 수 없고, 남은 수량보다 많이 담을 수 없다.

// Mantine ActionIcon(size 40·subtle dark·radius xl) 계산값(상품 상세 수량 버튼과 같다): 40px 정사각, 모서리 32px,
// 투명 1px 테두리, dark-9 글자, 줄 높이 1, 글꼴은 물려받는다. hover(가능한 기기만) dark-2 면, 비활성은 gray-2 면·gray-5 글자.
const QUANTITY_BUTTON =
  'relative m-0 inline-flex size-10 min-h-10 min-w-10 cursor-pointer appearance-none items-center justify-center overflow-hidden rounded-[32px] border border-solid border-transparent bg-transparent p-0 text-left leading-none text-[#141414] no-underline select-none [font-family:inherit] [font-size:inherit] [font-weight:inherit] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid active:translate-y-px enabled:[@media(hover:hover)]:hover:bg-[#828282] disabled:cursor-not-allowed disabled:bg-[#e9ecef] disabled:text-[#adb5bd] disabled:active:translate-y-0';
// Mantine Text 크기별 계산값(글꼴 크기 토큰·줄 높이 sm 1.45·md 1.55·lg 1.6, 여백 0).
const TEXT_SM = 'm-0 p-0 text-[length:var(--font-size-sm)] leading-[1.45]';
const TEXT_MD = 'm-0 p-0 text-[length:var(--font-size-md)] leading-[1.55]';
const TEXT_LG = 'm-0 p-0 text-[length:var(--font-size-lg)] leading-[1.6]';

export interface OptionSelection {
  choiceIds: string[];
  label: string;
  priceDelta: number;
}

export function describeSelection(
  groups: ProductOptionGroup[],
  picked: Record<string, string>,
): OptionSelection | null {
  const parts: string[] = [];
  const choiceIds: string[] = [];
  let priceDelta = 0;
  for (const group of groups) {
    const choice = group.choices.find((c) => c.id === picked[group.id]);
    if (!choice) return null;
    parts.push(`${group.name}: ${choice.label}`);
    choiceIds.push(choice.id);
    priceDelta += choice.priceDelta;
  }
  return { choiceIds, label: parts.join(' · '), priceDelta };
}

export default function OptionSheet({
  opened,
  onClose,
  groups,
  basePrice,
  initialQuantity,
  intent,
  onConfirm,
  availability = null,
}: {
  opened: boolean;
  onClose: () => void;
  groups: ProductOptionGroup[];
  basePrice: number;
  initialQuantity: number;
  intent: 'cart' | 'buy';
  onConfirm: (selection: OptionSelection, quantity: number, intent: 'cart' | 'buy') => void;
  /** 선택지별 남은 수량. 모르면 null(제한 없이 그리고 서버가 주문 때 막는다). */
  availability?: OptionAvailabilityMap | null;
}) {
  // 첫 선택지(보통 기본 화분 같은 0원 선택지)를 미리 골라 두어 한 번에 담을 수 있게 한다.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(initialQuantity);
  useEffect(() => {
    if (!opened) return;
    setPicked(Object.fromEntries(groups.map((g) => [g.id, g.choices[0]?.id ?? ''])));
    setQuantity(initialQuantity);
  }, [groups, initialQuantity, opened]);
  // 남은 수량은 시트가 열린 뒤 도착한다. 품절인 선택지를 골라 둔 묶음만 다른 선택지로 바꾼다.
  useEffect(() => {
    if (!opened || !availability) return;
    setPicked((current) =>
      Object.fromEntries(
        groups.map((g) => {
          const choiceId = current[g.id] ?? '';
          return [
            g.id,
            isChoiceSoldOut(availability, choiceId)
              ? firstAvailableChoiceId(g.choices, availability)
              : choiceId,
          ];
        }),
      ),
    );
  }, [availability, groups, opened]);

  const pickedChoiceIds = groups.map((group) => picked[group.id] ?? '');
  const maxQuantity = maxQuantityFor(availability, pickedChoiceIds);
  const overStock = quantity > maxQuantity;
  const selection = overStock ? null : describeSelection(groups, picked);
  const unitPrice = basePrice + (selection?.priceDelta ?? 0);

  // ① 외형 유지: Mantine Drawer(bottom·size auto·radius lg, 제목 800·lg, 최대 높이 85dvh)를 packages/ui Sheet로 그린다.
  // 하단 고정 바(ProductCTABar z 100) 위를 덮도록 Mantine Drawer와 같은 z 200을 써야 하는데 SheetContent는 배경·본체
  // z가 50으로 고정이라, 기사 배송 보류 창처럼 Portal·배경·본체를 풀어서 둔다. 본체 클래스는 SheetContent(side bottom)와 같되,
  // 폭은 Mantine에서 content를 flex 0 0 auto로 덮어쓴 결과대로 내용 폭(max-content, 화면 폭 이하)이고 왼쪽에 붙는다.
  // Mantine 본체는 Transition(slide-up, entered)의 transform·backface-visibility로 따로 합성된다. 같게 두지 않으면 위 모서리
  // 안티앨리어싱이 달라진다. 열고 닫는 움직임은 Tailwind translate(transform과 별개 속성)가 맡는다.
  // 본체는 SheetContent와 같은 DialogPopup이라 Tab·Shift+Tab이 시트 안에서만 돌고 aria-modal="true"가 붙는다.
  // Esc·바깥 누르기로 닫히면 onClose를 부른다(Mantine Drawer와 같다).
  // 첫 초점은 Mantine Drawer처럼 닫기 버튼이다(Mantine은 머리의 닫기 버튼이 첫 Tab 대상). 닫기 버튼은 Sheet처럼 본체 끝에
  // 있으므로 initialFocus로 지정하고 data-autofocus로 표시한다.
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Sheet
      open={opened}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="z-[200]" />
        <DialogPopup
          initialFocus={closeRef}
          data-slot="sheet-content"
          data-side="bottom"
          className="fixed bottom-0 left-0 z-[200] flex h-auto w-max max-w-full [transform:translateY(0)] backface-hidden max-h-[85dvh] flex-col overflow-y-auto rounded-lg bg-background text-black shadow-[0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_36px_28px_-7px,rgba(0,0,0,0.04)_0_17px_17px_-7px] transition duration-200 ease-in-out outline-none data-ending-style:translate-y-10 data-ending-style:opacity-0 data-starting-style:translate-y-10 data-starting-style:opacity-0"
        >
          <SheetHeader>
            <SheetTitle className="text-lg leading-none font-extrabold">옵션 고르기</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {/* Mantine Stack(gap lg 20px, 아래 여백 md 16px) */}
            <div className="flex flex-col items-stretch justify-start gap-5 pb-4">
              {groups.map((group) => (
                <fieldset key={group.id} style={{ border: 0, margin: 0, padding: 0 }}>
                  <legend className={`${TEXT_SM} mb-2 font-extrabold`}>{group.name}</legend>
                  <div className="flex flex-col items-stretch justify-start gap-1.5">
                    {group.choices.map((choice) => {
                      const selected = picked[group.id] === choice.id;
                      const soldOut = isChoiceSoldOut(availability, choice.id);
                      const stockLabel = choiceStockLabel(choiceRemaining(availability, choice.id));
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          aria-pressed={selected}
                          disabled={soldOut}
                          onClick={() =>
                            setPicked((current) => ({ ...current, [group.id]: choice.id }))
                          }
                          style={{
                            alignItems: 'center',
                            background: selected
                              ? 'var(--color-primary-surface)'
                              : 'var(--color-bg)',
                            border: selected ? '2px solid var(--color-primary)' : 'var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            color: soldOut ? 'var(--color-text-disabled)' : 'var(--color-text)',
                            cursor: soldOut ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            fontSize: 'var(--font-size-sm)',
                            gap: 8,
                            fontWeight: selected ? 800 : 400,
                            justifyContent: 'space-between',
                            minHeight: 'var(--touch-target)',
                            padding: '0 14px',
                            textAlign: 'left',
                          }}
                        >
                          <span>
                            {choice.label}
                            {stockLabel && (
                              <span
                                style={{
                                  color: soldOut
                                    ? 'var(--color-text-disabled)'
                                    : 'var(--color-danger)',
                                  fontSize: 'var(--font-size-xs)',
                                  fontWeight: 700,
                                  marginLeft: 6,
                                }}
                              >
                                {stockLabel}
                              </span>
                            )}
                          </span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {choice.priceDelta > 0
                              ? `+${choice.priceDelta.toLocaleString()}원`
                              : '추가 금액 없음'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}

              {/* Mantine Group(justify space-between, 줄바꿈 없음, gap md 16px) */}
              <div className="flex flex-row flex-nowrap items-center justify-between gap-4">
                <p className={`${TEXT_SM} font-extrabold`}>수량</p>
                <div
                  className="flex flex-row flex-nowrap items-center justify-start gap-1"
                  style={{
                    background: 'var(--color-surface-muted)',
                    borderRadius: 'var(--radius-full)',
                  }}
                >
                  <button
                    type="button"
                    className={QUANTITY_BUTTON}
                    aria-label="수량 줄이기"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  >
                    −
                  </button>
                  <p
                    className={`${TEXT_MD} w-8 text-center font-extrabold`}
                    aria-live="polite"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {quantity}
                  </p>
                  <button
                    type="button"
                    className={QUANTITY_BUTTON}
                    aria-label="수량 늘리기"
                    disabled={quantity >= maxQuantity}
                    onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Mantine Group(justify space-between, 줄바꿈 허용, gap md 16px) */}
              <div className="flex flex-row flex-wrap items-center justify-between gap-4">
                <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
                  {overStock
                    ? maxQuantity > 0
                      ? `고른 옵션은 ${maxQuantity}개까지 담을 수 있어요`
                      : '고른 옵션이 품절이에요'
                    : (selection?.label ?? '옵션을 골라 주세요')}
                </p>
                <p
                  className={`${TEXT_LG} font-extrabold`}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {(unitPrice * quantity).toLocaleString()}원
                </p>
              </div>

              <Button
                size="lg"
                disabled={!selection}
                onClick={() => selection && onConfirm(selection, quantity, intent)}
              >
                {intent === 'cart' ? '장바구니 담기' : '바로 구매'}
              </Button>
            </div>
          </SheetBody>
          {/* preflight 없이 연결한 앱이라 버튼 기본 테두리·여백을 지운다. */}
          <SheetClose
            ref={closeRef}
            data-autofocus
            aria-label="닫기"
            className={cn(closeButtonClassName, 'appearance-none border-0 p-0')}
          >
            <CloseIcon />
          </SheetClose>
        </DialogPopup>
      </DialogPortal>
    </Sheet>
  );
}
