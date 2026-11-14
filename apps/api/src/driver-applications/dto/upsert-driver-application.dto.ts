import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import {
  DRIVER_APPLICATION_AREA_MAX_LENGTH,
  DRIVER_APPLICATION_AREA_PATTERN,
  DRIVER_APPLICATION_CONSENT_VERSION,
  DRIVER_APPLICATION_PHONE_PATTERN,
  DRIVER_APPLICATION_REAL_NAME_MAX_LENGTH,
  DRIVER_APPLICATION_REAL_NAME_PATTERN,
  DRIVER_AVAILABLE_DAYS,
  DRIVER_VEHICLE_TYPES,
  type DriverAvailableDay,
  type DriverVehicleType,
} from "@greenhub/shared";

// 기사 가입 신청(PUT /driver-applications/me). 기사 앱이 정규화한 값(앞뒤 공백 없는 실명, 010+8자리 휴대폰,
// 정렬한 요일)을 보낸다. 규칙은 `@greenhub/shared`의 driver-application과 같다.
// 차량 번호·면허번호·생년월일·계좌·사진·자유 메모는 받지 않는다(전역 ValidationPipe의
// whitelist + forbidNonWhitelisted가 모르는 칸을 400으로 거부한다).
export class UpsertDriverApplicationDto {
  @IsString()
  @MaxLength(DRIVER_APPLICATION_REAL_NAME_MAX_LENGTH)
  @Matches(DRIVER_APPLICATION_REAL_NAME_PATTERN, {
    message: "실명은 2~20자 글자로 적어야 합니다.",
  })
  realName: string;

  @IsString()
  @Matches(DRIVER_APPLICATION_PHONE_PATTERN, {
    message: "휴대폰 번호는 010으로 시작하는 11자리 숫자여야 합니다.",
  })
  phone: string;

  @IsIn(DRIVER_VEHICLE_TYPES)
  vehicleType: DriverVehicleType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DRIVER_AVAILABLE_DAYS.length)
  @ArrayUnique()
  @IsIn(DRIVER_AVAILABLE_DAYS, { each: true })
  availableDays?: DriverAvailableDay[];

  @IsOptional()
  @IsString()
  @MaxLength(DRIVER_APPLICATION_AREA_MAX_LENGTH)
  @Matches(DRIVER_APPLICATION_AREA_PATTERN, {
    message: "활동 가능 지역에는 줄바꿈이나 제어문자를 쓸 수 없습니다.",
  })
  availableArea?: string;

  // 개인정보 수집·이용 동의. 체크하지 않은 신청은 받지 않는다.
  @Equals(true)
  consent: true;

  // 동의한 문안 버전. 기사 앱이 보여 준 문안과 서버가 아는 현재 문안이 같아야 받는다.
  @IsIn([DRIVER_APPLICATION_CONSENT_VERSION])
  consentVersion: string;
}
