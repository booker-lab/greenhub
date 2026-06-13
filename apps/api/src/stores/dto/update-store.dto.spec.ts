import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStoreDto } from './update-store.dto';

describe('UpdateStoreDto', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };

  it('온보딩 저장 계약은 대표자명, 연락처, 소재지를 허용한다', async () => {
    const dto = plainToInstance(UpdateStoreDto, {
      name: '난플렉스',
      ceoName: '홍씨',
      phone: '010-1111-1122',
      address: '경기도 이천시 중포동 123 1234',
      businessNumber: '123-45-67890',
    });

    await expect(validate(dto, options)).resolves.toHaveLength(0);
  });

  it('온보딩 저장 계약에 없는 필드는 거부한다', async () => {
    const dto = plainToInstance(UpdateStoreDto, {
      name: '난플렉스',
      ceoName: '홍씨',
      phone: '010-1111-1122',
      address: '경기도 이천시 중포동 123 1234',
      unknownField: '허용하지 않는 값',
    });

    await expect(validate(dto, options)).resolves.toEqual([
      expect.objectContaining({ property: 'unknownField' }),
    ]);
  });
});
