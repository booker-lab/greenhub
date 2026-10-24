import {
  type CareGuide,
  LIGHT_LEVELS,
  type LightLevel,
  type OptionStock,
  PLACEMENTS,
  PRODUCT_OPTION_CHOICE_MAX,
  PRODUCT_OPTION_GROUP_MAX,
  PRODUCT_OPTION_PRICE_DELTA_MAX,
  PRODUCT_NOTICE_DEFAULT_CERTIFICATION,
  PRODUCT_NOTICE_DEFAULT_ORIGIN,
  PRODUCT_NOTICE_FIELDS,
  type Placement,
  type ProductExtras,
  type ProductNotice,
  type ProductOptionGroup,
} from '@greenhub/shared';

// 상품 등록·수정의 팔도감 벤치마킹 추가 정보(크기·두는 곳·관리법·옵션 등).
// 화면 입력은 문자열로 받고, 제출할 때 API 계약(ProductExtras)으로 바꾼다.
// 상품정보제공고시(notice)만은 법정 표시라 기능 토글과 상관없이 항상 입력받고 보낸다.

export const CARE_TEXT_MAX = 120;
export const ALIAS_MAX = 10;
export const ALIAS_MAX_LENGTH = 30;

export interface OptionChoiceForm {
  id: string;
  label: string;
  priceDelta: string;
  /** 손님이 문구를 직접 쓰는 선택지(스티커 라벨·3D 토퍼) */
  needsText: boolean;
  /** 연결한 옵션 재고 품목 id(직접 출력한 화분 등). 빈 문자열이면 수량 제한 없음. */
  stockId: string;
}

export interface OptionGroupForm {
  id: string;
  name: string;
  choices: OptionChoiceForm[];
}

export interface ProductExtrasForm {
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
  notice: Required<ProductNotice>;
}

/** 매장 정보에서 오는 고시 기본값. 매장 조회 전이거나 실패하면 빈 값이다. */
export interface NoticeStoreDefaults {
  producer: string;
  csPhone: string;
}

export function defaultExtras(): ProductExtrasForm {
  return {
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
    notice: {
      itemName: '',
      origin: PRODUCT_NOTICE_DEFAULT_ORIGIN,
      producer: '',
      certification: PRODUCT_NOTICE_DEFAULT_CERTIFICATION,
      csPhone: '',
    },
  };
}

/**
 * 비어 있는 고시 칸만 기본값으로 미리 채운다(판매자가 쓴 값은 그대로 둔다).
 * 품명은 상품 이름이 바뀔 수 있어 미리 채우지 않고, 비우면 손님 화면이 상품 이름을 보여준다.
 */
export function fillNoticeDefaults(
  notice: Required<ProductNotice>,
  store: NoticeStoreDefaults,
): Required<ProductNotice> {
  const fill = (value: string, fallback: string) => (value.trim() ? value : fallback);
  return {
    ...notice,
    origin: fill(notice.origin, PRODUCT_NOTICE_DEFAULT_ORIGIN),
    producer: fill(notice.producer, store.producer),
    certification: fill(notice.certification, PRODUCT_NOTICE_DEFAULT_CERTIFICATION),
    csPhone: fill(notice.csPhone, store.csPhone),
  };
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** 저장된 고시 값 → 입력 상태. 저장된 칸은 그대로, 빈 칸은 고정 기본값으로 둔다. */
function noticeFromProduct(notice: ProductNotice | undefined): Required<ProductNotice> {
  return fillNoticeDefaults(
    {
      itemName: text(notice?.itemName),
      origin: text(notice?.origin),
      producer: text(notice?.producer),
      certification: text(notice?.certification),
      csPhone: text(notice?.csPhone),
    },
    { producer: '', csPhone: '' },
  );
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
        stockId: typeof choice.stockId === 'string' ? choice.stockId : '',
      })),
    })),
    guaranteed: data.guaranteed === true,
    aliases: Array.isArray(data.aliases) ? data.aliases.join(', ') : '',
    notice: noticeFromProduct(data.notice),
  };
}

/** 지금 있는 id와 겹치지 않는 새 id(영문·숫자만). */
/**
 * 선택지의 "재고 연결" 목록. 첫 줄은 연결 안 함(수량 제한 없음).
 * 저장된 품목이 목록에 없으면(불러오기 실패 등) 지우지 않도록 그 값을 그대로 남긴다.
 */
export function optionStockSelectData(
  stocks: readonly OptionStock[],
  currentStockId: string,
): Array<{ value: string; label: string }> {
  const data = [
    { value: '', label: '연결 안 함 (수량 제한 없음)' },
    ...stocks.map((stock) => ({ value: stock.id, label: `${stock.name} (남은 ${stock.remainingQuantity}개)` })),
  ];
  if (currentStockId && !stocks.some((stock) => stock.id === currentStockId)) {
    data.push({ value: currentStockId, label: '연결된 재고 (목록에서 찾지 못함)' });
  }
  return data;
}

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
export type NoticeBodyResult = { ok: true; body: ProductNotice } | { ok: false; error: string };

/** 고시 입력 → API 본문. 앞뒤 공백을 걷고 빈 칸은 빼서 보낸다(손님 화면이 기본값으로 채운다). */
export function noticeBody(notice: Required<ProductNotice>): NoticeBodyResult {
  const body: ProductNotice = {};
  for (const field of PRODUCT_NOTICE_FIELDS) {
    const value = notice[field.key].trim();
    if (value.length > field.maxLength) {
      return { ok: false, error: `상품 정보 고시의 ${field.label}은(는) ${field.maxLength}자까지 쓸 수 있어요.` };
    }
    if (value) body[field.key] = value;
  }
  return { ok: true, body };
}

/**
 * 입력 상태 → API 본문. 수정 화면에서 값을 지울 수 있도록 목록·관리법·여부 값은 항상 보낸다.
 * 고시(notice)는 토글과 상관없이 보내야 해서 따로 noticeBody로 만든다.
 */
export function extrasBody(form: ProductExtrasForm): ExtrasBodyResult {
  try {
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
          ...(choice.stockId ? { stockId: choice.stockId } : {}),
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
    const definedSize = Object.fromEntries(Object.entries(size).filter(([, value]) => value !== undefined));
    if (Object.keys(definedSize).length > 0) body.size = definedSize;
    if (form.light) body.light = form.light;
    if (hasCare) body.careGuide = Object.fromEntries(careEntries) as unknown as CareGuide;
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '입력값을 확인해 주세요.' };
  }
}
