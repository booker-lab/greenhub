import { IsEmail, IsString, MinLength, IsEnum, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  name: string;

  @IsEnum(['consumer', 'seller', 'driver'])
  role: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
