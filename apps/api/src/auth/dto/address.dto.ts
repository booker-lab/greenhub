import { IsString, IsBoolean, IsOptional } from 'class-validator';

export class AddressDto {
  @IsString()
  label: string;

  @IsString()
  roadAddress: string;

  @IsString()
  detailAddress: string;

  @IsString()
  zipCode: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
