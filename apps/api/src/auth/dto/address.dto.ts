import { IsString, IsBoolean, IsOptional, MaxLength } from 'class-validator';

// 주문 배송지와 같은 길이 상한. 이름(label)은 "집"·"회사" 같은 짧은 별칭이다.
export const ADDRESS_LABEL_MAX_LENGTH = 50;
export const ADDRESS_MAX_LENGTH = 200;
export const ADDRESS_DETAIL_MAX_LENGTH = 100;
export const ADDRESS_ZIP_CODE_MAX_LENGTH = 10;

export class AddressDto {
  @IsString()
  @MaxLength(ADDRESS_LABEL_MAX_LENGTH)
  label: string;

  @IsString()
  @MaxLength(ADDRESS_MAX_LENGTH)
  address: string;

  @IsString()
  @MaxLength(ADDRESS_DETAIL_MAX_LENGTH)
  addressDetail: string;

  @IsString()
  @MaxLength(ADDRESS_ZIP_CODE_MAX_LENGTH)
  zipCode: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
