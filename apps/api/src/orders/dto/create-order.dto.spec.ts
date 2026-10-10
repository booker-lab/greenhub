import 'reflect-metadata';
import { ORDER_REQUEST_NOTE_MAX_LENGTH } from '@greenhub/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto, ORDER_ITEM_MAX_QUANTITY, ROUND_ORDER_MAX_ITEMS } from './create-order.dto';

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
