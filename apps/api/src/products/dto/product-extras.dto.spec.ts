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
  size: { heightCm: 60, widthCm: 40, potDiameterCm: 15, bloomCount: 18 },
  light: 'medium',
  placements: ['living', 'office'],
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
    {
      id: 'message',
      name: '문구',
      choices: [
        { id: 'none', label: '문구 없음', priceDelta: 0 },
        { id: 'topper', label: '3D 토퍼', priceDelta: 5000, needsText: true },
      ],
    },
  ],
  guaranteed: true,
  aliases: ['팔레놉시스', 'phalaenopsis'],
  notice: {
    itemName: '호접란 빅립',
    origin: '국내산(경기도 이천)',
    producer: '디어 오키드',
    certification: '해당 없음',
    csPhone: '010-0000-0000',
  },
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
    ['문구 여부가 참·거짓이 아닌 선택지', { options: [{ id: 'msg', name: '문구', choices: [{ id: 'a', label: 'A', priceDelta: 0, needsText: 'yes' }] }] }],
    ['음수 옵션 금액', { options: [{ id: 'pot', name: '화분', choices: [{ id: 'a', label: 'A', priceDelta: -1 }] }] }],
    ['선택지 없는 옵션 묶음', { options: [{ id: 'pot', name: '화분', choices: [] }] }],
    ['id 형식이 틀린 옵션', { options: [{ id: 'p o t', name: '화분', choices: [{ id: 'a', label: 'A', priceDelta: 0 }] }] }],
    ['0cm 키', { size: { heightCm: 0 } }],
    ['너무 긴 관리 안내', { careGuide: { ...extras.careGuide, watering: '가'.repeat(121) } }],
    ['객체가 아닌 고시 정보', { notice: '국내산' }],
    ['문자가 아닌 고시 항목', { notice: { origin: 82 } }],
    ['너무 긴 품명', { notice: { itemName: '가'.repeat(61) } }],
    ['너무 긴 원산지', { notice: { origin: '가'.repeat(41) } }],
    ['너무 긴 생산자', { notice: { producer: '가'.repeat(41) } }],
    ['너무 긴 인증·허가 사항', { notice: { certification: '가'.repeat(101) } }],
    ['너무 긴 상담 전화', { notice: { csPhone: '0'.repeat(21) } }],
  ])('%s을 거부한다', async (_label, patch) => {
    expect(await validate(plainToInstance(UpdateProductDto, patch))).not.toHaveLength(0);
  });

  it('고시 정보는 일부 항목만 보내거나 비워 보내도 된다(빈 칸은 화면이 기본값으로 채운다)', async () => {
    expect(await validate(plainToInstance(UpdateProductDto, { notice: { origin: '국내산' } }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateProductDto, { notice: {} }))).toHaveLength(0);
  });

  it('고시 정보 안의 모르는 항목은 실제 파이프 옵션(whitelist)에서 거부한다', async () => {
    const errors = await validate(plainToInstance(UpdateProductDto, { notice: { maker: '누군가' } }), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((error) => error.property)).toContain('notice');
  });

  it('정상가(listPrice)는 더 이상 받지 않는다 — 할인 표시는 지난 회차 가격으로 서버가 계산한다', async () => {
    const errors = await validate(plainToInstance(UpdateProductDto, { listPrice: 39000 }), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((error) => error.property)).toContain('listPrice');
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
