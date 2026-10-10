import 'reflect-metadata';
import { COLOR_OPTIONS } from '@greenhub/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { ProductQueryDto } from './product-query.dto';
import { UpdateDailyCapDto } from './update-daily-cap.dto';
import { UpdateDeliveryConfigDto } from './update-delivery-config.dto';
import { UpdateProductDto } from './update-product.dto';

const validProduct = {
  name: '테스트 상품',
  images: [
    'https://firebasestorage.googleapis.com/v0/b/greenhub-api-unit-test.appspot.com/o/products%2Fstore-1%2F1700000000000_a.jpg?alt=media&token=t',
  ],
  price: 10000,
  category: 'cut_flower',
  saleType: 'normal',
  deliverySize: 'small',
  selection: {
    colors: [...COLOR_OPTIONS],
    stemType: '외대',
    fragrance: 'none',
    bloomCondition: 'half',
    bundleUnit: '1단',
  },
};

describe('상품 ColorOption 계약', () => {
  it('현재 19개 색상을 상품 입력에서 허용한다', async () => {
    const errors = await validate(plainToInstance(CreateProductDto, validProduct));

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['단일 잘못된 색상', ['알 수 없는 색상']],
    ['유효·잘못된 색상 혼합', ['레드', '알 수 없는 색상']],
  ])('%s을 거부한다', async (_label, colors) => {
    const errors = await validate(
      plainToInstance(CreateProductDto, {
        ...validProduct,
        selection: { ...validProduct.selection, colors },
      }),
    );

    expect(errors).not.toHaveLength(0);
  });

  it('배열이 아닌 단일 색상 값도 거부한다', async () => {
    const errors = await validate(
      plainToInstance(CreateProductDto, {
        ...validProduct,
        selection: { ...validProduct.selection, colors: '레드' },
      }),
    );

    expect(errors).not.toHaveLength(0);
  });
});

describe('상품 색상 조회 필터 계약', () => {
  it('반복·쉼표 구분 색상을 정규화하고 허용한다', async () => {
    const query = plainToInstance(ProductQueryDto, { colors: ['레드', '핑크,화이트'] });
    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    expect(query.colors).toEqual(['레드', '핑크', '화이트']);
  });

  it('잘못된 색상 필터를 거부한다', async () => {
    const errors = await validate(plainToInstance(ProductQueryDto, { colors: '레드,오류' }));

    expect(errors).not.toHaveLength(0);
  });
});

describe('상품 PATCH 계약', () => {
  const validSelection = {
    colors: ['레드'],
    stemType: '외대',
    fragrance: 'none',
    bloomCondition: 'half',
    bundleUnit: '1단',
  };

  it.each(COLOR_OPTIONS)('현재 canonical 색상 %s를 허용한다', async (color) => {
    const errors = await validate(
      plainToInstance(UpdateProductDto, {
        selection: { ...validSelection, colors: [color] },
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['잘못된 색상', { selection: { ...validSelection, colors: ['알 수 없는 색상'] } }],
    ['direct 판매 방식', { saleType: 'direct' }],
    ['임의 판매 방식', { saleType: 'legacy' }],
  ])('%s을 거부한다', async (_label, update) => {
    const errors = await validate(plainToInstance(UpdateProductDto, update));

    expect(errors).not.toHaveLength(0);
  });

  it.each(['normal', 'group'])('%s 판매 방식을 허용한다', async (saleType) => {
    const errors = await validate(plainToInstance(UpdateProductDto, { saleType }));

    expect(errors).toHaveLength(0);
  });
});

describe('상품 숫자·이미지 입력 계약', () => {
  const validGroupConfig = {
    minQuantity: 5,
    targetQuantity: 10,
    maxPerPerson: 2,
    recruitDeadline: '2026-09-10T00:00:00.000Z',
    groupDeliveryDate: '2026-09-15T00:00:00.000Z',
    groupDeliveryMethod: 'direct',
    deliveryFeeDiscount: 0,
  };

  it('정수 가격과 공동구매 설정을 허용한다', async () => {
    const errors = await validate(
      plainToInstance(CreateProductDto, {
        ...validProduct,
        saleType: 'group',
        groupConfig: validGroupConfig,
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['소수 가격', { price: 1000.5 }],
    ['음수 가격', { price: -1 }],
    ['상한 초과 가격', { price: 100_000_001 }],
    ['외부 호스트 이미지', { images: ['https://example.com/product.jpg'] }],
    ['http 이미지', { images: ['http://firebasestorage.googleapis.com/v0/b/x/o/y'] }],
    ['문자열 이미지', { images: 'https://example.com/product.jpg' }],
  ])('생성 입력의 %s를 거부한다', async (_label, patch) => {
    const errors = await validate(plainToInstance(CreateProductDto, { ...validProduct, ...patch }));

    expect(errors).not.toHaveLength(0);
  });

  it.each([
    ['소수 최소 수량', { minQuantity: 1.5 }],
    ['0 목표 수량', { targetQuantity: 0 }],
    ['소수 1인 최대 수량', { maxPerPerson: 2.5 }],
    ['소수 배송비 할인', { deliveryFeeDiscount: 100.1 }],
    ['날짜가 아닌 모집 마감', { recruitDeadline: 'tomorrow' }],
    ['없는 날짜의 배송일', { groupDeliveryDate: '2026-02-30T00:00:00.000Z' }],
  ])('공동구매 설정의 %s를 거부한다', async (_label, patch) => {
    const errors = await validate(
      plainToInstance(UpdateProductDto, { groupConfig: { ...validGroupConfig, ...patch } }),
    );

    expect(errors).not.toHaveLength(0);
  });

  it.each([
    ['소수 가격', { price: 9900.9 }],
    ['외부 이미지', { images: ['https://cdn.example.com/a.jpg'] }],
  ])('PATCH의 %s를 거부한다', async (_label, update) => {
    const errors = await validate(plainToInstance(UpdateProductDto, update));

    expect(errors).not.toHaveLength(0);
  });

  it.each([
    ['소수 직배송비', { directFee: 3000.5 }],
    ['음수 택배비', { parcelFee: -1 }],
    ['문자열 무료 기준', { freeThresholdHub: '30000' }],
  ])('배송비 설정의 %s를 거부한다', async (_label, update) => {
    const errors = await validate(plainToInstance(UpdateDeliveryConfigDto, update));

    expect(errors).not.toHaveLength(0);
  });

  it('정수 배송비 설정을 허용한다', async () => {
    const errors = await validate(
      plainToInstance(UpdateDeliveryConfigDto, { directFee: 3000, freeThresholdDirect: 50000 }),
    );

    expect(errors).toHaveLength(0);
  });

  it.each([
    [0, true],
    [20, true],
    [1.5, false],
    [-1, false],
    ['10', false],
  ])('daily cap totalCap %p 허용 여부는 %p다', async (totalCap, ok) => {
    const errors = await validate(plainToInstance(UpdateDailyCapDto, { totalCap }));

    expect(errors.length === 0).toBe(ok);
  });
});
