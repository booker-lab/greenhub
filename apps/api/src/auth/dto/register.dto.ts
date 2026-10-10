import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PROFILE_FIELD_MESSAGES,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_NO_CONTROL_PATTERN,
  PROFILE_NAME_NO_LINK_PATTERN,
  PROFILE_PHONE_PATTERN,
} from './update-me.dto';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MaxLength(PROFILE_NAME_MAX_LENGTH, { message: PROFILE_FIELD_MESSAGES.nameMaxLength })
  @Matches(PROFILE_NAME_NO_CONTROL_PATTERN, { message: PROFILE_FIELD_MESSAGES.nameControl })
  @Matches(PROFILE_NAME_NO_LINK_PATTERN, { message: PROFILE_FIELD_MESSAGES.nameLink })
  name: string;

  @IsEnum(['consumer', 'seller', 'driver'])
  role: string;

  @IsOptional()
  @IsString()
  @Matches(PROFILE_PHONE_PATTERN, { message: PROFILE_FIELD_MESSAGES.phone })
  phone?: string;

  @IsOptional()
  @IsString()
  inviteToken?: string;
}
