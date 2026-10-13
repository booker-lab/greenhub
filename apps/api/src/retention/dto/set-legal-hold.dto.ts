import { IsBoolean, IsString, Length, Matches } from 'class-validator';

export class SetLegalHoldDto {
  @IsBoolean()
  hold!: boolean;

  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: 'reason에는 공백이 아닌 문자가 있어야 합니다.' })
  reason!: string;
}
