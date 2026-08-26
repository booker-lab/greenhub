import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COLOR_OPTIONS } from '@greenhub/shared';
import { CreateVarietyDto } from './create-variety.dto';
import { UpdateVarietyDto } from './update-variety.dto';

const validCreate = {
  name: '테스트 품종',
  category: 'orchid',
  subCategory: 'phalaenopsis',
  flowerSize: 'small',
  plantSize: 'medium',
  availableStemTypes: ['외대'],
  hasFragrance: false,
  fragranceLevel: 'none',
  bloomDuration: '60~90일',
  careLevel: 'normal',
  typicalColors: [...COLOR_OPTIONS],
};

describe('품종 ColorOption 계약', () => {
  it('생성 시 현재 19개 색상을 허용한다', async () => {
    const errors = await validate(plainToInstance(CreateVarietyDto, validCreate));

    expect(errors).toHaveLength(0);
  });

  it('생성 시 잘못된 색상을 거부한다', async () => {
    const errors = await validate(
      plainToInstance(CreateVarietyDto, { ...validCreate, typicalColors: ['레드', '오류'] }),
    );

    expect(errors).not.toHaveLength(0);
  });
});

describe('품종 PATCH 계약', () => {
  it('mutable 품종 속성을 부분 수정할 수 있다', async () => {
    const dto = plainToInstance(UpdateVarietyDto, {
      flowerSize: 'large',
      plantSize: 'small',
      availableStemTypes: ['쌍대', '3대'],
      typicalColors: ['핑크', '화이트'],
      notes: '수정된 메모',
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('기존 enum validation을 유지한다', async () => {
    const errors = await validate(
      plainToInstance(UpdateVarietyDto, {
        flowerSize: 'huge',
        availableStemTypes: ['알 수 없는 줄기'],
      }),
    );

    expect(errors).not.toHaveLength(0);
  });
});
