import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COLOR_OPTIONS } from '@greenhub/shared';
import {
  CreateVarietyDto,
  VARIETY_NAME_MAX_LENGTH,
  VARIETY_NOTES_MAX_LENGTH,
} from './create-variety.dto';
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

describe('품종 입력 상한', () => {
  it('생성 시 상한을 넘는 문자열과 배열을 거부한다', async () => {
    const errors = await validate(
      plainToInstance(CreateVarietyDto, {
        ...validCreate,
        name: 'a'.repeat(VARIETY_NAME_MAX_LENGTH + 1),
        notes: 'a'.repeat(VARIETY_NOTES_MAX_LENGTH + 1),
        typicalColors: [...COLOR_OPTIONS, COLOR_OPTIONS[0]],
      }),
    );

    expect(errors.map((error) => error.property).sort()).toEqual([
      'name',
      'notes',
      'typicalColors',
    ]);
  });

  it('수정 시 상한을 넘는 notes와 줄기 배열을 거부한다', async () => {
    const errors = await validate(
      plainToInstance(UpdateVarietyDto, {
        notes: 'a'.repeat(VARIETY_NOTES_MAX_LENGTH + 1),
        availableStemTypes: ['외대', '쌍대', '가지', '3대', '외대'],
      }),
    );

    expect(errors.map((error) => error.property).sort()).toEqual(['availableStemTypes', 'notes']);
  });

  it('상한 이내 값은 허용한다', async () => {
    const errors = await validate(
      plainToInstance(UpdateVarietyDto, { notes: 'a'.repeat(VARIETY_NOTES_MAX_LENGTH) }),
    );

    expect(errors).toHaveLength(0);
  });
});
