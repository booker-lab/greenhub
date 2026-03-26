import { IsString, IsBoolean, IsOptional } from 'class-validator';

export class AddressDto {
  @IsString()
  label: string;

  @IsString()
  address: string;

  @IsString()
  addressDetail: string;

  @IsString()
  zipCode: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
