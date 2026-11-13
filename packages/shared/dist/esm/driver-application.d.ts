/**
 * 기사 가입 신청 정보 공유 정의 \u2014 SSOT
 *
 * 카카오로 처음 들어온 기사(승인 전)는 기사 앱 `/apply`에서 실명·휴대폰·차량 종류와 개인정보
 * 수집·이용 동의를 적어 낸다. 관리자는 이 정보를 보고 승인한다(2026-11-13 사용자 결정).
 * API(DTO 검증·저장)와 기사 앱(입력 검증·안내), 관리자 화면(표시)이 같은 규칙을 쓰도록 여기서만 정의한다.
 *
 * 받지 않는 정보: 차량 번호·면허번호·생년월일·계좌·사진·자유 메모.
 */
/** 차량 종류 값. 화면 표기는 DRIVER_VEHICLE_TYPE_LABELS. */
export declare const DRIVER_VEHICLE_TYPES: readonly ["sedan", "van", "truck", "motorcycle"];
export type DriverVehicleType = (typeof DRIVER_VEHICLE_TYPES)[number];
export declare const DRIVER_VEHICLE_TYPE_LABELS: Record<DriverVehicleType, string>;
/** 활동 가능 요일 값(월~일 순서). 화면 표기는 DRIVER_AVAILABLE_DAY_LABELS. */
export declare const DRIVER_AVAILABLE_DAYS: readonly ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export type DriverAvailableDay = (typeof DRIVER_AVAILABLE_DAYS)[number];
export declare const DRIVER_AVAILABLE_DAY_LABELS: Record<DriverAvailableDay, string>;
export declare const DRIVER_APPLICATION_REAL_NAME_MIN_LENGTH = 2;
export declare const DRIVER_APPLICATION_REAL_NAME_MAX_LENGTH = 20;
export declare const DRIVER_APPLICATION_AREA_MAX_LENGTH = 100;
/**
 * 실명: 글자로 시작하고 끝나며 2~20자. 글자 사이에는 공백·점·가운뎃점·하이픈·작은따옴표만 쓴다
 * (숫자·기호·줄바꿈·앞뒤 공백 없음). 길이는 코드 포인트 기준이다.
 */
export declare const DRIVER_APPLICATION_REAL_NAME_PATTERN: RegExp;
/** 저장하는 휴대폰 번호 형식: 010 + 8자리 숫자(하이픈 없음). */
export declare const DRIVER_APPLICATION_PHONE_PATTERN: RegExp;
/**
 * 활동 가능 지역: 줄바꿈·제어문자·보이지 않는 서식 문자 없이 100자 이하.
 * 앞뒤 공백은 저장 전에 지운다.
 */
export declare const DRIVER_APPLICATION_AREA_PATTERN: RegExp;
/**
 * 개인정보 수집·이용 동의 문안 버전. 문안(아래 DRIVER_APPLICATION_CONSENT_SUMMARY)을 바꾸면 버전도 바꾼다.
 * API는 이 버전과 같은 값만 받아 동의 시각과 함께 저장한다.
 */
export declare const DRIVER_APPLICATION_CONSENT_VERSION = "driver-application-2026-11-13";
/** 동의 체크박스 옆에 보이는 수집·이용 요약(2026-11-13 결정 항목·목적·보유기간). */
export declare const DRIVER_APPLICATION_CONSENT_SUMMARY: {
    readonly items: "실명, 휴대폰 번호, 차량 종류, 활동 가능 요일·지역";
    readonly purpose: "기사 가입 심사와 승인 뒤 배송 업무 연락";
    readonly retention: "승인되면 기사로 활동하는 동안, 승인되지 않은 신청은 신청 후 30일 뒤 파기";
};
/** 한 계정이 신청을 내고 고칠 수 있는 최대 횟수(처음 제출 포함). 넘으면 API가 409로 거절한다. */
export declare const DRIVER_APPLICATION_MAX_REVISION = 20;
/** 로그인 거절 응답과 신청 조회 응답의 신청 상태. */
export type DriverApplicationStatus = 'none' | 'submitted';
/** API가 기사 앱·관리자 화면에 내려주는 신청 정보(시각은 ISO8601 문자열). */
export interface DriverApplicationView {
    realName: string;
    phone: string;
    vehicleType: DriverVehicleType;
    availableDays: DriverAvailableDay[];
    availableArea: string | null;
    consentVersion: string;
    consentedAt: string;
    status: 'submitted';
    revision: number;
    submittedAt: string;
    updatedAt: string;
}
/** 기사 앱이 API에 보내는 신청 내용(PUT /driver-applications/me). */
export interface DriverApplicationInput {
    realName: string;
    phone: string;
    vehicleType: DriverVehicleType;
    availableDays?: DriverAvailableDay[];
    availableArea?: string;
    consent: true;
    consentVersion: string;
}
export declare function isDriverVehicleType(value: unknown): value is DriverVehicleType;
export declare function isDriverAvailableDay(value: unknown): value is DriverAvailableDay;
/**
 * 휴대폰 번호를 저장 형식(010 + 8자리)으로 바꾼다. 공백·하이픈·점·괄호는 지우고 국가번호(+82 10\u2026)는
 * 0으로 바꾼다. 010 휴대폰 번호가 아니면 null.
 */
export declare function normalizeDriverApplicationPhone(raw: unknown): string | null;
/** 저장 형식 번호를 화면 표기(010-1234-5678)로 바꾼다. 형식이 다르면 그대로 둔다. */
export declare function formatDriverApplicationPhone(phone: string): string;
export declare function isValidDriverApplicationRealName(value: unknown): value is string;
/**
 * 실명 칸의 처음 값. 카카오 이름이 자동 생성 이름(`kakao-{id}`)이거나 실명 규칙에 맞지 않으면 비운다.
 * 카카오 이름은 별명일 수 있으므로 기사가 확인해 고치게 한다.
 */
export declare function driverApplicationRealNamePrefill(kakaoName: unknown): string;
/** 요일 목록을 월~일 순서로 정렬하고 중복을 없앤다. 모르는 값은 버린다. */
export declare function sortDriverAvailableDays(days: readonly unknown[]): DriverAvailableDay[];
export type DriverApplicationFieldErrors = Partial<Record<'realName' | 'phone' | 'vehicleType' | 'availableDays' | 'availableArea' | 'consent', string>>;
/** 기사 앱 입력 폼에서 읽은 값(정규화 전). */
export interface DriverApplicationFormValues {
    realName: string;
    phone: string;
    vehicleType: string;
    availableDays: string[];
    availableArea: string;
    consent: boolean;
}
/**
 * 입력 폼 값을 검증하고, 통과하면 API에 보낼 값(정규화한 휴대폰·정렬한 요일·앞뒤 공백 없는 지역)을 준다.
 * 실패하면 칸별 안내 문구(해요체)를 준다. API DTO 검증과 같은 규칙이다.
 */
export declare function validateDriverApplicationForm(values: DriverApplicationFormValues): {
    ok: true;
    input: DriverApplicationInput;
} | {
    ok: false;
    errors: DriverApplicationFieldErrors;
};
//# sourceMappingURL=driver-application.d.ts.map