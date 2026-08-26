import 'reflect-metadata';
import { COLOR_OPTIONS } from '@greenhub/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { ProductQueryDto } from './product-query.dto';
import { UpdateProductDto } from './update-product.dto';

const validProduct = {
  name: '테스트 상품',
  images: ['https://example.com/product.jpg'],
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
