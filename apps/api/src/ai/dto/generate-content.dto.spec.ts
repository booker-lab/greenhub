import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COLOR_OPTIONS } from '@greenhub/shared';
import {
  BUNDLE_UNIT_MAX_LENGTH,
  GenerateContentDto,
  SELLER_NOTE_MAX_LENGTH,
} from './generate-content.dto';

const selection = {
  colors: [...COLOR_OPTIONS],
  stemType: '외대',
  fragrance: 'none',
  bloomCondition: 'half',
  bundleUnit: '1단',
};

describe('AI 상품 선택 색상 계약', () => {
  it('현재 19개 색상을 허용한다', async () => {
    const errors = await validate(plainToInstance(GenerateContentDto, { selection }));

    expect(errors).toHaveLength(0);
  });

  it('오타 색상을 거부한다', async () => {
    const errors = await validate(
      plainToInstance(GenerateContentDto, {
        selection: { ...selection, colors: ['레드', '오류'] },
      }),
    );

    expect(errors).not.toHaveLength(0);
  });
});

describe('AI 생성 입력 상한', () => {
  it('상한 길이의 sellerNote는 허용한다', async () => {
    const errors = await validate(
      plainToInstance(GenerateContentDto, {
        selection,
        sellerNote: 'a'.repeat(SELLER_NOTE_MAX_LENGTH),
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('상한을 넘는 sellerNote를 거부한다', async () => {
    const errors = await validate(
      plainToInstance(GenerateContentDto, {
        selection,
        sellerNote: 'a'.repeat(SELLER_NOTE_MAX_LENGTH + 1),
      }),
    );

    expect(errors.map((error) => error.property)).toEqual(['sellerNote']);
  });

  it('상한을 넘는 bundleUnit과 중복 색상 배열을 거부한다', async () => {
    const errors = await validate(
      plainToInstance(GenerateContentDto, {
        selection: {
          ...selection,
          colors: [...COLOR_OPTIONS, COLOR_OPTIONS[0]],
          bundleUnit: 'a'.repeat(BUNDLE_UNIT_MAX_LENGTH + 1),
        },
      }),
    );
    const selectionErrors = errors.find((error) => error.property === 'selection')?.children ?? [];

    expect(selectionErrors.map((error) => error.property).sort()).toEqual(['bundleUnit', 'colors']);
  });
});
