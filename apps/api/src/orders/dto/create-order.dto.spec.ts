import 'reflect-metadata';
import { ORDER_REQUEST_NOTE_MAX_LENGTH } from '@greenhub/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ACQUISITION_TAG_MAX_LENGTH,
  CreateOrderDto,
  DELIVERY_ADDRESS_DETAIL_MAX_LENGTH,
  DELIVERY_ADDRESS_MAX_LENGTH,
  DELIVERY_ZIP_CODE_MAX_LENGTH,
  ORDER_ITEM_MAX_QUANTITY,
  ROUND_ORDER_MAX_ITEMS,
} from './create-order.dto';

const roundOrder = {
  clientOrderRequestId: 'payment-attempt-1',
  productId: 'product-1',
  quantity: 1,
  saleType: 'normal',
  deliveryMethod: 'direct',
  requestedDeliveryDate: '2026-11-10',
  roundId: 'round-1',
  roundItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
  deliveryPhone: '010-9999-0000',
  deliveryAddress: {
    address: '경기도 이천시 중리천로 1',
    addressDetail: '201호',
    zipCode: '17373',
  },
};

async function requestNoteErrors(requestNote: unknown) {
  const errors = await validate(plainToInstance(CreateOrderDto, { ...roundOrder, requestNote }));
  return errors.filter((error) => error.property === 'requestNote');
}

describe('주문 요청사항 입력 계약', () => {
  it('요청사항이 없어도 된다', async () => {
    await expect(requestNoteErrors(undefined)).resolves.toHaveLength(0);
  });

  it(`${ORDER_REQUEST_NOTE_MAX_LENGTH}자까지 허용하고 넘으면 거부한다`, async () => {
    await expect(
      requestNoteErrors('가'.repeat(ORDER_REQUEST_NOTE_MAX_LENGTH)),
    ).resolves.toHaveLength(0);
    await expect(
      requestNoteErrors('가'.repeat(ORDER_REQUEST_NOTE_MAX_LENGTH + 1)),
    ).resolves.not.toHaveLength(0);
  });

  it('문자열이 아니면 거부한다', async () => {
    await expect(requestNoteErrors({ text: '토퍼' })).resolves.not.toHaveLength(0);
  });
});

async function orderErrors(overrides: Record<string, unknown>) {
  return validate(plainToInstance(CreateOrderDto, { ...roundOrder, ...overrides }));
}

function roundItems(count: number, quantity = 1) {
  return Array.from({ length: count }, (_, index) => ({
    roundItemId: `round-item-${index + 1}`,
    quantity,
  }));
}

describe('주문 수량 입력 상한', () => {
  it(`회차 품목 수량은 1~${ORDER_ITEM_MAX_QUANTITY} 정수만 허용한다`, async () => {
    await expect(
      orderErrors({ roundItems: roundItems(1, ORDER_ITEM_MAX_QUANTITY) }),
    ).resolves.toHaveLength(0);
    await expect(
      orderErrors({ roundItems: roundItems(1, ORDER_ITEM_MAX_QUANTITY + 1) }),
    ).resolves.not.toHaveLength(0);
    await expect(orderErrors({ roundItems: roundItems(1, 0) })).resolves.not.toHaveLength(0);
    await expect(orderErrors({ roundItems: roundItems(1, 1.5) })).resolves.not.toHaveLength(0);
  });

  it(`회차 주문 품목은 ${ROUND_ORDER_MAX_ITEMS}개까지 허용한다`, async () => {
    await expect(
      orderErrors({ roundItems: roundItems(ROUND_ORDER_MAX_ITEMS) }),
    ).resolves.toHaveLength(0);
    await expect(
      orderErrors({ roundItems: roundItems(ROUND_ORDER_MAX_ITEMS + 1) }),
    ).resolves.not.toHaveLength(0);
    await expect(orderErrors({ roundItems: [] })).resolves.not.toHaveLength(0);
  });

  it(`일반 주문 수량은 1~${ORDER_ITEM_MAX_QUANTITY} 정수만 허용한다`, async () => {
    await expect(orderErrors({ quantity: 99 })).resolves.toHaveLength(0);
    await expect(orderErrors({ quantity: ORDER_ITEM_MAX_QUANTITY })).resolves.toHaveLength(0);
    await expect(orderErrors({ quantity: ORDER_ITEM_MAX_QUANTITY + 1 })).resolves.not.toHaveLength(
      0,
    );
    await expect(orderErrors({ quantity: 2.5 })).resolves.not.toHaveLength(0);
  });
});

function errorPaths(errors: Awaited<ReturnType<typeof validate>>, prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    return error.children?.length ? errorPaths(error.children, path) : [path];
  });
}

describe('배송지·유입 태그 길이 상한', () => {
  it('상한까지는 허용하고 넘으면 해당 필드만 거부한다', async () => {
    const atLimit = {
      deliveryAddress: {
        address: '가'.repeat(DELIVERY_ADDRESS_MAX_LENGTH),
        addressDetail: '가'.repeat(DELIVERY_ADDRESS_DETAIL_MAX_LENGTH),
        zipCode: '1'.repeat(DELIVERY_ZIP_CODE_MAX_LENGTH),
      },
    };
    await expect(orderErrors(atLimit)).resolves.toHaveLength(0);

    const over = await orderErrors({
      deliveryAddress: {
        address: '가'.repeat(DELIVERY_ADDRESS_MAX_LENGTH + 1),
        addressDetail: '가'.repeat(DELIVERY_ADDRESS_DETAIL_MAX_LENGTH + 1),
        zipCode: '1'.repeat(DELIVERY_ZIP_CODE_MAX_LENGTH + 1),
      },
    });
    expect(errorPaths(over).sort()).toEqual([
      'deliveryAddress.address',
      'deliveryAddress.addressDetail',
      'deliveryAddress.zipCode',
    ]);
  });

  it('유입 캠페인·콘텐츠 태그는 상한을 넘으면 거부한다', async () => {
    const acquisition = (tag: string) => ({
      acquisition: {
        source: 'carrot',
        campaign: tag,
        content: tag,
        capturedAt: '2026-10-12T00:00:00.000Z',
      },
    });
    await expect(
      orderErrors(acquisition('a'.repeat(ACQUISITION_TAG_MAX_LENGTH))),
    ).resolves.toHaveLength(0);
    const over = await orderErrors(acquisition('a'.repeat(ACQUISITION_TAG_MAX_LENGTH + 1)));
    expect(errorPaths(over).sort()).toEqual(['acquisition.campaign', 'acquisition.content']);
  });
});

describe('문서 식별자 형식', () => {
  it('영문·숫자·_·-로 된 식별자는 허용한다', async () => {
    await expect(
      orderErrors({ productId: 'a1B2_c3-d4', roundId: 'round-direct-e2e-1', hubId: 'hub_1' }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    ['productId', { productId: 'products/other' }],
    ['roundId', { roundId: '../round' }],
    ['hubId', { hubId: 'hub 1' }],
    ['productId', { productId: '' }],
    ['productId', { productId: 'a'.repeat(129) }],
  ])('경로 문자·공백·빈 값·과도한 길이의 %s는 거부한다', async (field, overrides) => {
    const errors = await orderErrors(overrides);
    expect(errorPaths(errors)).toEqual([field]);
  });

  it('회차 품목 식별자에 경로 문자가 있으면 거부한다', async () => {
    const errors = await orderErrors({
      roundItems: [{ roundItemId: 'saleRoundItems/x', quantity: 1 }],
    });
    expect(errorPaths(errors)).toEqual(['roundItems.0.roundItemId']);
  });
});

describe('공동구매 동의 시각', () => {
  it('ISO 8601 시각만 받는다', async () => {
    await expect(
      orderErrors({ groupBuyConsent: { agreed: true, agreedAt: '2026-10-12T00:00:00.000Z' } }),
    ).resolves.toHaveLength(0);
    const errors = await orderErrors({ groupBuyConsent: { agreed: true, agreedAt: 'not-a-date' } });
    expect(errorPaths(errors)).toEqual(['groupBuyConsent.agreedAt']);
  });
});
