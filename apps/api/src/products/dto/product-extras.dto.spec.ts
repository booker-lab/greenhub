import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { findProductOptionIdConflict } from './product-extras.dto';
import { UpdateProductDto } from './update-product.dto';

const validProduct = {
  name: '호접란 빅립',
  images: [],
  price: 30000,
  category: 'orchid',
  saleType: 'normal',
  deliverySize: 'medium',
};

const extras = {
  listPrice: 39000,
  size: { heightCm: 60, widthCm: 40, potDiameterCm: 15, bloomCount: 18 },
  light: 'medium',
  placements: ['living', 'office'],
  petSafe: false,
  curations: ['gift'],
  careGuide: {
    watering: '겉흙이 마르면 일주일에 한 번',
    light: '직사광선을 피한 밝은 곳',
    temperature: '18~25도',
    repotting: '꽃이 지고 난 뒤 1~2년마다',
  },
  options: [
    {
      id: 'pot',
      name: '화분',
      choices: [
        { id: 'basic', label: '기본 화분', priceDelta: 0 },
        { id: 'ceramic', label: '도자기 화분', priceDelta: 8000 },
      ],
    },
  ],
  guaranteed: true,
  aliases: ['팔레놉시스', 'phalaenopsis'],
};

describe('상품 추가 정보(벤치마킹 비교) 계약', () => {
  it('추가 정보 전체를 상품 등록·수정에서 허용한다', async () => {
    expect(await validate(plainToInstance(CreateProductDto, { ...validProduct, ...extras }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateProductDto, extras))).toHaveLength(0);
  });

  it('추가 정보가 없어도 기존 상품 입력은 그대로 통과한다', async () => {
    expect(await validate(plainToInstance(CreateProductDto, validProduct))).toHaveLength(0);
  });

  it.each([
    ['모르는 빛 조건', { light: 'dark' }],
    ['모르는 놓을 곳', { placements: ['garage'] }],
    ['음수 옵션 금액', { options: [{ id: 'pot', name: '화분', choices: [{ id: 'a', label: 'A', priceDelta: -1 }] }] }],
    ['선택지 없는 옵션 묶음', { options: [{ id: 'pot', name: '화분', choices: [] }] }],
    ['id 형식이 틀린 옵션', { options: [{ id: 'p o t', name: '화분', choices: [{ id: 'a', label: 'A', priceDelta: 0 }] }] }],
    ['0cm 키', { size: { heightCm: 0 } }],
    ['너무 긴 관리 안내', { careGuide: { ...extras.careGuide, watering: '가'.repeat(121) } }],
  ])('%s을 거부한다', async (_label, patch) => {
    expect(await validate(plainToInstance(UpdateProductDto, patch))).not.toHaveLength(0);
  });

  it('옵션 묶음·선택지 id 중복을 찾는다', () => {
    expect(findProductOptionIdConflict(extras.options)).toBeNull();
    expect(
      findProductOptionIdConflict([
        { id: 'pot', choices: [{ id: 'a' }] },
        { id: 'pot', choices: [{ id: 'b' }] },
      ]),
    ).toContain('pot');
    expect(findProductOptionIdConflict([{ id: 'pot', choices: [{ id: 'a' }, { id: 'a' }] }])).toContain(
      'pot/a',
    );
  });
});
