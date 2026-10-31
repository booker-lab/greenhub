'use client';

import {
  LIGHT_LABELS,
  LIGHT_LEVELS,
  PLACEMENT_LABELS,
  PLACEMENTS,
  PRODUCT_NOTICE_FIELDS,
  PRODUCT_OPTION_CHOICE_MAX,
  PRODUCT_OPTION_GROUP_MAX,
  type OptionStock,
} from '@greenhub/shared';
import { Button, ButtonLabel } from '@greenhub/ui/components/button';
import { Checkbox } from '@greenhub/ui/components/checkbox';
import { Chip } from '@greenhub/ui/components/chip';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { NativeSelect } from '@greenhub/ui/components/native-select';
import { useId } from 'react';
import { isFeatureOn } from '@/lib/features';
import { FieldCard } from './FormPrimitives';
import {
  CARE_TEXT_MAX,
  nextOptionId,
  type OptionGroupForm,
  optionStockSelectData,
  type ProductExtrasForm,
} from './productExtras';

// 상품 등록·수정 마지막 단계의 추가 정보. 기능 토글이 꺼진 칸은 그리지 않는다.
// 상품정보제공고시 칸은 법정 표시라 토글과 상관없이 항상 그린다.
// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·Group·Stack·SimpleGrid 값. 색 green = Mantine green-6.
const TEXT = 'm-0 p-0 text-base font-normal';
const GREEN = '#40c057';
const GREEN_HOVER = '#37b24d';
const UNIT_CLASS = `${TEXT} text-sm`;

const CARE_FIELDS = [
  { key: 'watering', label: '물 주기' },
  { key: 'light', label: '빛' },
  { key: 'temperature', label: '온도' },
  { key: 'repotting', label: '분갈이·기타' },
] as const;

/** Mantine TextInput(label)과 같은 흐름: 라벨 → 입력칸. */
function LabeledInput({ label, ...props }: { label: string } & React.ComponentProps<typeof Input>) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} className="rounded-[8px]" {...props} />
    </Field>
  );
}

function numberInput(
  value: string,
  onChange: (value: string) => void,
  label: string,
  unit: string,
) {
  return (
    <LabeledInput
      label={label}
      inputMode="numeric"
      rightSection={<p className={UNIT_CLASS}>{unit}</p>}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value.replace(/[^0-9]/g, ''))}
    />
  );
}

export function ProductExtrasSection({
  extras,
  onChange,
  optionStocks = [],
  optionStocksError = null,
}: {
  extras: ProductExtrasForm;
  onChange: (next: ProductExtrasForm) => void;
  /** 선택지에 연결할 매장 옵션 재고(직접 출력한 화분 등) */
  optionStocks?: readonly OptionStock[];
  optionStocksError?: string | null;
}) {
  const on = {
    size: isFeatureOn('size-info'),
    care: isFeatureOn('care-guide'),
    options: isFeatureOn('option-sheet'),
    guarantee: isFeatureOn('quality-guarantee'),
    search: isFeatureOn('plant-search'),
  };

  const patch = (next: Partial<ProductExtrasForm>) => onChange({ ...extras, ...next });
  const setGroups = (options: OptionGroupForm[]) => patch({ options });
  const allChoiceIds = extras.options.flatMap((group) => group.choices.map((choice) => choice.id));

  return (
    <div className="flex flex-col gap-3">
      {on.size && (
        <FieldCard label="크기">
          <div className="grid grid-cols-2 gap-2.5">
            {numberInput(extras.heightCm, (heightCm) => patch({ heightCm }), '높이', 'cm')}
            {numberInput(extras.widthCm, (widthCm) => patch({ widthCm }), '폭', 'cm')}
            {numberInput(
              extras.potDiameterCm,
              (potDiameterCm) => patch({ potDiameterCm }),
              '화분 지름',
              'cm',
            )}
            {numberInput(
              extras.bloomCount,
              (bloomCount) => patch({ bloomCount }),
              '송이 수',
              '송이',
            )}
          </div>
        </FieldCard>
      )}

      {on.size && (
        <FieldCard label="두는 곳·빛 (상품 상세에만 보여요)">
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-row flex-wrap items-center justify-start gap-1.5">
              {PLACEMENTS.map((placement) => (
                <Chip
                  key={placement}
                  value={placement}
                  color={GREEN}
                  hoverColor={GREEN_HOVER}
                  checked={extras.placements.includes(placement)}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...extras.placements, placement]
                      : extras.placements.filter((p) => p !== placement);
                    patch({ placements: PLACEMENTS.filter((p) => next.includes(p)) });
                  }}
                >
                  {PLACEMENT_LABELS[placement]}
                </Chip>
              ))}
            </div>
            <div className="flex flex-row flex-wrap items-center justify-start gap-1.5">
              {LIGHT_LEVELS.map((level) => (
                <Chip
                  key={level}
                  type="radio"
                  name="product-extras-light"
                  value={level}
                  color={GREEN}
                  hoverColor={GREEN_HOVER}
                  checked={extras.light === level}
                  onCheckedChange={(checked) => checked && patch({ light: level })}
                >
                  {LIGHT_LABELS[level]}
                </Chip>
              ))}
            </div>
          </div>
        </FieldCard>
      )}

      {on.care && (
        <FieldCard label={`관리법 (항목마다 ${CARE_TEXT_MAX}자까지)`}>
          <div className="flex flex-col gap-2.5">
            {CARE_FIELDS.map((field) => (
              <LabeledInput
                key={field.key}
                label={field.label}
                maxLength={CARE_TEXT_MAX}
                value={extras.careGuide[field.key]}
                onChange={(event) =>
                  patch({
                    careGuide: { ...extras.careGuide, [field.key]: event.currentTarget.value },
                  })
                }
              />
            ))}
          </div>
        </FieldCard>
      )}

      {on.options && (
        <FieldCard
          label={`옵션 (묶음 ${PRODUCT_OPTION_GROUP_MAX}개, 선택지 ${PRODUCT_OPTION_CHOICE_MAX}개까지)`}
        >
          <div className="flex flex-col gap-3">
            {extras.options.map((group, groupIndex) => (
              <div
                key={group.id}
                className="flex flex-col gap-1.5 p-3"
                style={{ border: 'var(--border)', borderRadius: 12 }}
              >
                <div className="flex flex-row flex-nowrap items-center justify-start gap-2.5">
                  <Input
                    aria-label="옵션 묶음 이름"
                    placeholder="예: 화분"
                    maxLength={20}
                    value={group.name}
                    onChange={(event) => {
                      const next = [...extras.options];
                      next[groupIndex] = { ...group, name: event.currentTarget.value };
                      setGroups(next);
                    }}
                    rootClassName="flex-1"
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setGroups(extras.options.filter((_, index) => index !== groupIndex))
                    }
                  >
                    <ButtonLabel>묶음 삭제</ButtonLabel>
                  </Button>
                </div>
                {group.choices.map((choice, choiceIndex) => (
                  <div key={choice.id} className="flex flex-col gap-1">
                    <div className="flex flex-row flex-nowrap items-center justify-start gap-2.5">
                      <Input
                        aria-label="선택지 이름"
                        placeholder="예: 도자기 화분"
                        maxLength={30}
                        value={choice.label}
                        onChange={(event) => {
                          const choices = [...group.choices];
                          choices[choiceIndex] = { ...choice, label: event.currentTarget.value };
                          const next = [...extras.options];
                          next[groupIndex] = { ...group, choices };
                          setGroups(next);
                        }}
                        className="flex-1"
                      />
                      <Input
                        aria-label="추가 금액"
                        placeholder="+0"
                        inputMode="numeric"
                        rightSection={<p className={UNIT_CLASS}>원</p>}
                        rootClassName="w-[110px] shrink-0"
                        value={choice.priceDelta}
                        onChange={(event) => {
                          const choices = [...group.choices];
                          choices[choiceIndex] = {
                            ...choice,
                            priceDelta: event.currentTarget.value.replace(/[^0-9]/g, ''),
                          };
                          const next = [...extras.options];
                          next[groupIndex] = { ...group, choices };
                          setGroups(next);
                        }}
                      />
                    </div>
                    {/* 직접 출력한 화분처럼 개수가 정해진 선택지: 주문마다 재고가 줄고 모자라면 주문을 받지 않는다 */}
                    <NativeSelect
                      label="재고 연결"
                      size="xs"
                      data={optionStockSelectData(optionStocks, choice.stockId)}
                      value={choice.stockId}
                      onChange={(event) => {
                        const choices = [...group.choices];
                        choices[choiceIndex] = { ...choice, stockId: event.currentTarget.value };
                        const next = [...extras.options];
                        next[groupIndex] = { ...group, choices };
                        setGroups(next);
                      }}
                    />
                  </div>
                ))}
                {group.choices.length < PRODUCT_OPTION_CHOICE_MAX && (
                  <Button
                    variant="light-green"
                    size="xs"
                    onClick={() => {
                      const next = [...extras.options];
                      next[groupIndex] = {
                        ...group,
                        choices: [
                          ...group.choices,
                          {
                            id: nextOptionId('c', allChoiceIds),
                            label: '',
                            priceDelta: '',
                            stockId: '',
                          },
                        ],
                      };
                      setGroups(next);
                    }}
                  >
                    <ButtonLabel>+ 선택지</ButtonLabel>
                  </Button>
                )}
              </div>
            ))}
            {optionStocksError && (
              <p
                role="alert"
                className={`${TEXT} text-sm`}
                style={{ color: 'var(--color-danger)' }}
              >
                {optionStocksError}
              </p>
            )}
            {extras.options.length < PRODUCT_OPTION_GROUP_MAX && (
              <Button
                variant="outline-green"
                onClick={() =>
                  setGroups([
                    ...extras.options,
                    {
                      id: nextOptionId(
                        'g',
                        extras.options.map((group) => group.id),
                      ),
                      name: '',
                      choices: [
                        {
                          id: nextOptionId('c', allChoiceIds),
                          label: '',
                          priceDelta: '',
                          stockId: '',
                        },
                      ],
                    },
                  ])
                }
              >
                <ButtonLabel>+ 옵션 묶음 추가</ButtonLabel>
              </Button>
            )}
          </div>
        </FieldCard>
      )}

      {on.guarantee && (
        <FieldCard label="품질 보장">
          <Checkbox
            color={GREEN}
            label="가게의 품질 보장 대상 상품이에요"
            checked={extras.guaranteed}
            onCheckedChange={(guaranteed) => patch({ guaranteed })}
          />
        </FieldCard>
      )}

      {on.search && (
        <FieldCard label="검색용 다른 이름 (쉼표로 구분)">
          <Input
            placeholder="예: 호접란, Phalaenopsis"
            value={extras.aliases}
            onChange={(event) => patch({ aliases: event.currentTarget.value })}
            className="rounded-[8px]"
          />
        </FieldCard>
      )}

      <FieldCard label="상품 정보 고시 (손님 상품 화면에 항상 보여요)">
        <div className="flex flex-col gap-2.5">
          {PRODUCT_NOTICE_FIELDS.map((field) => (
            <LabeledInput
              key={field.key}
              label={field.label}
              placeholder={field.key === 'itemName' ? '비우면 상품 이름을 보여줘요' : undefined}
              maxLength={field.maxLength}
              value={extras.notice[field.key]}
              onChange={(event) =>
                patch({ notice: { ...extras.notice, [field.key]: event.currentTarget.value } })
              }
            />
          ))}
        </div>
      </FieldCard>
    </div>
  );
}
