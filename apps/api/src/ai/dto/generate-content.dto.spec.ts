import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COLOR_OPTIONS } from '@greenhub/shared';
import { GenerateContentDto } from './generate-content.dto';

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
