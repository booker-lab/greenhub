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
import {
  Button,
  Checkbox,
  Chip,
  Group,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
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

const CARE_FIELDS = [
  { key: 'watering', label: '물 주기' },
  { key: 'light', label: '빛' },
  { key: 'temperature', label: '온도' },
  { key: 'repotting', label: '분갈이·기타' },
] as const;

function numberInput(value: string, onChange: (value: string) => void, label: string, unit: string) {
  return (
    <TextInput
      label={label}
      inputMode="numeric"
      rightSection={<Text size="sm">{unit}</Text>}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value.replace(/[^0-9]/g, ''))}
      radius="md"
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
    <Stack gap="sm">
      {on.size && (
        <FieldCard label="크기">
          <SimpleGrid cols={2} spacing="xs">
            {numberInput(extras.heightCm, (heightCm) => patch({ heightCm }), '높이', 'cm')}
            {numberInput(extras.widthCm, (widthCm) => patch({ widthCm }), '폭', 'cm')}
            {numberInput(extras.potDiameterCm, (potDiameterCm) => patch({ potDiameterCm }), '화분 지름', 'cm')}
            {numberInput(extras.bloomCount, (bloomCount) => patch({ bloomCount }), '송이 수', '송이')}
          </SimpleGrid>
        </FieldCard>
      )}

      {on.size && (
        <FieldCard label="두는 곳·빛 (상품 상세에만 보여요)">
          <Stack gap="xs">
            <Chip.Group
              multiple
              value={extras.placements}
              onChange={(value) => patch({ placements: PLACEMENTS.filter((p) => value.includes(p)) })}
            >
              <Group gap={6}>
                {PLACEMENTS.map((placement) => (
                  <Chip key={placement} value={placement} color="green">
                    {PLACEMENT_LABELS[placement]}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            <Chip.Group
              value={extras.light}
              onChange={(value) => patch({ light: LIGHT_LEVELS.find((level) => level === value) ?? '' })}
            >
              <Group gap={6}>
                {LIGHT_LEVELS.map((level) => (
                  <Chip key={level} value={level} color="green">
                    {LIGHT_LABELS[level]}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </Stack>
        </FieldCard>
      )}

      {on.care && (
        <FieldCard label={`관리법 (항목마다 ${CARE_TEXT_MAX}자까지)`}>
          <Stack gap="xs">
            {CARE_FIELDS.map((field) => (
              <TextInput
                key={field.key}
                label={field.label}
                maxLength={CARE_TEXT_MAX}
                value={extras.careGuide[field.key]}
                onChange={(event) =>
                  patch({ careGuide: { ...extras.careGuide, [field.key]: event.currentTarget.value } })
                }
                radius="md"
              />
            ))}
          </Stack>
        </FieldCard>
      )}

      {on.options && (
        <FieldCard label={`옵션 (묶음 ${PRODUCT_OPTION_GROUP_MAX}개, 선택지 ${PRODUCT_OPTION_CHOICE_MAX}개까지)`}>
          <Stack gap="sm">
            {extras.options.map((group, groupIndex) => (
              <Stack key={group.id} gap={6} p="sm" style={{ border: 'var(--border)', borderRadius: 12 }}>
                <Group gap="xs" wrap="nowrap">
                  <TextInput
                    aria-label="옵션 묶음 이름"
                    placeholder="예: 화분"
                    maxLength={20}
                    value={group.name}
                    onChange={(event) => {
                      const next = [...extras.options];
                      next[groupIndex] = { ...group, name: event.currentTarget.value };
                      setGroups(next);
                    }}
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="subtle"
                    color="gray"
                    onClick={() => setGroups(extras.options.filter((_, index) => index !== groupIndex))}
                  >
                    묶음 삭제
                  </Button>
                </Group>
                {group.choices.map((choice, choiceIndex) => (
                  <Stack key={choice.id} gap={4}>
                  <Group gap="xs" wrap="nowrap">
                    <TextInput
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
                      style={{ flex: 1 }}
                    />
                    <TextInput
                      aria-label="추가 금액"
                      placeholder="+0"
                      inputMode="numeric"
                      rightSection={<Text size="sm">원</Text>}
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
                      w={110}
                    />
                  </Group>
                  {/* 직접 출력한 화분처럼 개수가 정해진 선택지: 주문마다 재고가 줄고 모자라면 주문을 받지 않는다 */}
                  <NativeSelect
                    size="xs"
                    label="재고 연결"
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
                  </Stack>
                ))}
                {group.choices.length < PRODUCT_OPTION_CHOICE_MAX && (
                  <Button
                    variant="light"
                    color="green"
                    size="xs"
                    onClick={() => {
                      const next = [...extras.options];
                      next[groupIndex] = {
                        ...group,
                        choices: [
                          ...group.choices,
                          { id: nextOptionId('c', allChoiceIds), label: '', priceDelta: '', stockId: '' },
                        ],
                      };
                      setGroups(next);
                    }}
                  >
                    + 선택지
                  </Button>
                )}
              </Stack>
            ))}
            {optionStocksError && (
              <Text role="alert" size="sm" c="var(--color-danger)">
                {optionStocksError}
              </Text>
            )}
            {extras.options.length < PRODUCT_OPTION_GROUP_MAX && (
              <Button
                variant="outline"
                color="green"
                radius="xl"
                onClick={() =>
                  setGroups([
                    ...extras.options,
                    {
                      id: nextOptionId('g', extras.options.map((group) => group.id)),
                      name: '',
                      choices: [{ id: nextOptionId('c', allChoiceIds), label: '', priceDelta: '', stockId: '' }],
                    },
                  ])
                }
              >
                + 옵션 묶음 추가
              </Button>
            )}
          </Stack>
        </FieldCard>
      )}

      {on.guarantee && (
        <FieldCard label="품질 보장">
          <Checkbox
            color="green"
            label="가게의 품질 보장 대상 상품이에요"
            checked={extras.guaranteed}
            onChange={(event) => patch({ guaranteed: event.currentTarget.checked })}
          />
        </FieldCard>
      )}

      {on.search && (
        <FieldCard label="검색용 다른 이름 (쉼표로 구분)">
          <TextInput
            placeholder="예: 호접란, Phalaenopsis"
            value={extras.aliases}
            onChange={(event) => patch({ aliases: event.currentTarget.value })}
            radius="md"
          />
        </FieldCard>
      )}

      <FieldCard label="상품 정보 고시 (손님 상품 화면에 항상 보여요)">
        <Stack gap="xs">
          {PRODUCT_NOTICE_FIELDS.map((field) => (
            <TextInput
              key={field.key}
              label={field.label}
              placeholder={field.key === 'itemName' ? '비우면 상품 이름을 보여줘요' : undefined}
              maxLength={field.maxLength}
              value={extras.notice[field.key]}
              onChange={(event) =>
                patch({ notice: { ...extras.notice, [field.key]: event.currentTarget.value } })
              }
              radius="md"
            />
          ))}
        </Stack>
      </FieldCard>
    </Stack>
  );
}
