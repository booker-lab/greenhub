import {
  type CareGuide,
  LIGHT_LEVELS,
  type LightLevel,
  PLACEMENTS,
  PRODUCT_OPTION_CHOICE_MAX,
  PRODUCT_OPTION_GROUP_MAX,
  PRODUCT_OPTION_PRICE_DELTA_MAX,
  type Placement,
  type ProductExtras,
  type ProductOptionGroup,
} from '@greenhub/shared';

// 상품 등록·수정의 팔도감 벤치마킹 추가 정보(정상가·크기·두는 곳·관리법·옵션 등).
// 화면 입력은 문자열로 받고, 제출할 때 API 계약(ProductExtras)으로 바꾼다.

export const CARE_TEXT_MAX = 120;
export const ALIAS_MAX = 10;
export const ALIAS_MAX_LENGTH = 30;

export interface OptionChoiceForm {
  id: string;
  label: string;
  priceDelta: string;
  /** 손님이 문구를 직접 쓰는 선택지(스티커 라벨·3D 토퍼) */
  needsText: boolean;
}

export interface OptionGroupForm {
  id: string;
  name: string;
  choices: OptionChoiceForm[];
}

export interface ProductExtrasForm {
  listPrice: string;
  heightCm: string;
  widthCm: string;
  potDiameterCm: string;
  bloomCount: string;
  light: '' | LightLevel;
  placements: Placement[];
  careGuide: CareGuide;
  options: OptionGroupForm[];
  guaranteed: boolean;
  /** 쉼표로 구분 */
  aliases: string;
}

export function defaultExtras(): ProductExtrasForm {
  return {
    listPrice: '',
    heightCm: '',
    widthCm: '',
    potDiameterCm: '',
    bloomCount: '',
    light: '',
    placements: [],
    careGuide: { watering: '', light: '', temperature: '', repotting: '' },
    options: [],
    guaranteed: false,
    aliases: '',
  };
}

const numText = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

function pick<T extends string>(values: readonly T[], input: unknown): T[] {
  return Array.isArray(input) ? values.filter((value) => input.includes(value)) : [];
}

/** API 상품 응답 → 입력 상태. 알 수 없는 값은 버린다. */
export function extrasFromProduct(data: Partial<ProductExtras> | null | undefined): ProductExtrasForm {
  const base = defaultExtras();
  if (!data) return base;
  const options = Array.isArray(data.options) ? data.options : [];
  return {
    listPrice: numText(data.listPrice),
    heightCm: numText(data.size?.heightCm),
    widthCm: numText(data.size?.widthCm),
    potDiameterCm: numText(data.size?.potDiameterCm),
    bloomCount: numText(data.size?.bloomCount),
    light: LIGHT_LEVELS.includes(data.light as LightLevel) ? (data.light as LightLevel) : '',
    placements: pick(PLACEMENTS, data.placements),
    careGuide: { ...base.careGuide, ...(data.careGuide ?? {}) },
    options: options.map((group) => ({
      id: group.id,
      name: group.name,
      choices: group.choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        priceDelta: String(choice.priceDelta),
        needsText: choice.needsText === true,
      })),
    })),
    guaranteed: data.guaranteed === true,
    aliases: Array.isArray(data.aliases) ? data.aliases.join(', ') : '',
  };
}

/** 지금 있는 id와 겹치지 않는 새 id(영문·숫자만). */
export function nextOptionId(prefix: 'g' | 'c', taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

function optionalInt(text: string, label: string, min: number, max: number): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label}은(는) ${min}~${max} 사이 숫자로 입력해 주세요.`);
  }
  return value;
}

export type ExtrasBodyResult = { ok: true; body: ProductExtras } | { ok: false; error: string };

/**
 * 입력 상태 → API 본문. 수정 화면에서 값을 지울 수 있도록 목록·관리법·여부 값은 항상 보낸다.
 * 정상가가 판매가 이하이면 할인처럼 보이지 않도록 막는다(price는 원 단위 정수).
 */
export function extrasBody(form: ProductExtrasForm, price: number): ExtrasBodyResult {
  try {
    const listPrice = optionalInt(form.listPrice, '정상가', 0, 100_000_000);
    if (listPrice !== undefined && listPrice > 0 && listPrice <= price) {
      return { ok: false, error: '정상가는 판매가보다 높을 때만 입력해 주세요.' };
    }
    const size = {
      heightCm: optionalInt(form.heightCm, '높이', 1, 500),
      widthCm: optionalInt(form.widthCm, '폭', 1, 500),
      potDiameterCm: optionalInt(form.potDiameterCm, '화분 지름', 1, 200),
      bloomCount: optionalInt(form.bloomCount, '송이 수', 1, 500),
    };
    const careEntries = Object.entries(form.careGuide).map(([key, value]) => [key, value.trim()]);
    if (careEntries.some(([, value]) => value.length > CARE_TEXT_MAX)) {
      return { ok: false, error: `관리법은 항목마다 ${CARE_TEXT_MAX}자까지 쓸 수 있어요.` };
    }
    const hasCare = careEntries.some(([, value]) => value.length > 0);

    if (form.options.length > PRODUCT_OPTION_GROUP_MAX) {
      return { ok: false, error: `옵션 묶음은 ${PRODUCT_OPTION_GROUP_MAX}개까지예요.` };
    }
    const options: ProductOptionGroup[] = [];
    for (const group of form.options) {
      const name = group.name.trim();
      const choices = group.choices
        .map((choice) => ({ ...choice, label: choice.label.trim() }))
        .filter((choice) => choice.label);
      if (!name || choices.length === 0) {
        return { ok: false, error: '옵션 묶음마다 이름과 선택지를 하나 이상 넣어 주세요.' };
      }
      if (choices.length > PRODUCT_OPTION_CHOICE_MAX) {
        return { ok: false, error: `선택지는 묶음마다 ${PRODUCT_OPTION_CHOICE_MAX}개까지예요.` };
      }
      options.push({
        id: group.id,
        name,
        choices: choices.map((choice) => ({
          id: choice.id,
          label: choice.label,
          priceDelta: optionalInt(choice.priceDelta, '추가 금액', 0, PRODUCT_OPTION_PRICE_DELTA_MAX) ?? 0,
          ...(choice.needsText ? { needsText: true } : {}),
        })),
      });
    }

    const aliases = form.aliases
      .split(',')
      .map((alias) => alias.trim())
      .filter(Boolean);
    if (aliases.length > ALIAS_MAX || aliases.some((alias) => alias.length > ALIAS_MAX_LENGTH)) {
      return {
        ok: false,
        error: `다른 이름은 ${ALIAS_MAX}개까지, 하나에 ${ALIAS_MAX_LENGTH}자까지 쓸 수 있어요.`,
      };
    }

    const body: ProductExtras = {
      placements: form.placements,
      options,
      guaranteed: form.guaranteed,
      aliases,
    };
    if (listPrice !== undefined) body.listPrice = listPrice;
    const definedSize = Object.fromEntries(Object.entries(size).filter(([, value]) => value !== undefined));
    if (Object.keys(definedSize).length > 0) body.size = definedSize;
    if (form.light) body.light = form.light;
    if (hasCare) body.careGuide = Object.fromEntries(careEntries) as unknown as CareGuide;
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '입력값을 확인해 주세요.' };
  }
}
