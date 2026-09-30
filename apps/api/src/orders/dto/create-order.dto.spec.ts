import 'reflect-metadata';
import { ORDER_REQUEST_NOTE_MAX_LENGTH } from '@greenhub/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';

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
  deliveryAddress: { address: '경기도 이천시 중리천로 1', addressDetail: '201호', zipCode: '17373' },
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
    await expect(requestNoteErrors('가'.repeat(ORDER_REQUEST_NOTE_MAX_LENGTH))).resolves.toHaveLength(
      0,
    );
    await expect(
      requestNoteErrors('가'.repeat(ORDER_REQUEST_NOTE_MAX_LENGTH + 1)),
    ).resolves.not.toHaveLength(0);
  });

  it('문자열이 아니면 거부한다', async () => {
    await expect(requestNoteErrors({ text: '토퍼' })).resolves.not.toHaveLength(0);
  });
});
