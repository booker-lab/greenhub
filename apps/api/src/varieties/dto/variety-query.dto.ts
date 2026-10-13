import type { Category } from '@greenhub/shared';
import { IsIn, ValidateIf } from 'class-validator';

export const VARIETY_CATEGORY_VALUES: readonly Category[] = ['cut_flower', 'orchid', 'foliage'];

// `GET /varieties`. category가 없거나 빈 값이면 지금처럼 전체 목록을 돌려주고,
// 값이 있으면 정의된 카테고리 하나만 받는다(배열·그 밖의 문자열은 400).
export class VarietyQueryDto {
  @ValidateIf((_object, value) => value !== undefined && value !== '')
  @IsIn(VARIETY_CATEGORY_VALUES)
  category?: Category | '';
}
