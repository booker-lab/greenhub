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
export const DRIVER_VEHICLE_TYPES = ['sedan', 'van', 'truck', 'motorcycle'];
export const DRIVER_VEHICLE_TYPE_LABELS = {
    sedan: '승용',
    van: '승합',
    truck: '화물',
    motorcycle: '오토바이',
};
/** 활동 가능 요일 값(월~일 순서). 화면 표기는 DRIVER_AVAILABLE_DAY_LABELS. */
export const DRIVER_AVAILABLE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DRIVER_AVAILABLE_DAY_LABELS = {
    mon: '월',
    tue: '화',
    wed: '수',
    thu: '목',
    fri: '금',
    sat: '토',
    sun: '일',
};
export const DRIVER_APPLICATION_REAL_NAME_MIN_LENGTH = 2;
export const DRIVER_APPLICATION_REAL_NAME_MAX_LENGTH = 20;
export const DRIVER_APPLICATION_AREA_MAX_LENGTH = 100;
/**
 * 실명: 글자로 시작하고 끝나며 2~20자. 글자 사이에는 공백·점·가운뎃점·하이픈·작은따옴표만 쓴다
 * (숫자·기호·줄바꿈·앞뒤 공백 없음). 길이는 코드 포인트 기준이다.
 */
export const DRIVER_APPLICATION_REAL_NAME_PATTERN = /^(?=[\s\S]{2,20}$)\p{L}(?:[\p{L} .·'-]*\p{L})?$/u;
/** 저장하는 휴대폰 번호 형식: 010 + 8자리 숫자(하이픈 없음). */
export const DRIVER_APPLICATION_PHONE_PATTERN = /^010\d{8}$/;
/**
 * 활동 가능 지역: 줄바꿈·제어문자·보이지 않는 서식 문자 없이 100자 이하.
 * 앞뒤 공백은 저장 전에 지운다.
 */
export const DRIVER_APPLICATION_AREA_PATTERN = 
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자를 거부하기 위한 패턴이다.
/^[^\u0000-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]*$/;
/**
 * 개인정보 수집·이용 동의 문안 버전. 문안(아래 DRIVER_APPLICATION_CONSENT_SUMMARY)을 바꾸면 버전도 바꾼다.
 * API는 이 버전과 같은 값만 받아 동의 시각과 함께 저장한다.
 */
export const DRIVER_APPLICATION_CONSENT_VERSION = 'driver-application-2026-11-13';
/** 동의 체크박스 옆에 보이는 수집·이용 요약(2026-11-13 결정 항목·목적·보유기간). */
export const DRIVER_APPLICATION_CONSENT_SUMMARY = {
    items: '실명, 휴대폰 번호, 차량 종류, 활동 가능 요일·지역',
    purpose: '기사 가입 심사와 승인 뒤 배송 업무 연락',
    retention: '승인되면 기사로 활동하는 동안, 승인되지 않은 신청은 신청 후 30일 뒤 파기',
};
/** 한 계정이 신청을 내고 고칠 수 있는 최대 횟수(처음 제출 포함). 넘으면 API가 409로 거절한다. */
export const DRIVER_APPLICATION_MAX_REVISION = 20;
export function isDriverVehicleType(value) {
    return typeof value === 'string' && DRIVER_VEHICLE_TYPES.includes(value);
}
export function isDriverAvailableDay(value) {
    return typeof value === 'string' && DRIVER_AVAILABLE_DAYS.includes(value);
}
/**
 * 휴대폰 번호를 저장 형식(010 + 8자리)으로 바꾼다. 공백·하이픈·점·괄호는 지우고 국가번호(+82 10\u2026)는
 * 0으로 바꾼다. 010 휴대폰 번호가 아니면 null.
 */
export function normalizeDriverApplicationPhone(raw) {
    if (typeof raw !== 'string')
        return null;
    let digits = raw.trim().replace(/[\s.()-]/g, '');
    if (digits.startsWith('+82'))
        digits = `0${digits.slice(3)}`;
    else if (digits.startsWith('82') && digits.length === 12)
        digits = `0${digits.slice(2)}`;
    return DRIVER_APPLICATION_PHONE_PATTERN.test(digits) ? digits : null;
}
/** 저장 형식 번호를 화면 표기(010-1234-5678)로 바꾼다. 형식이 다르면 그대로 둔다. */
export function formatDriverApplicationPhone(phone) {
    return DRIVER_APPLICATION_PHONE_PATTERN.test(phone)
        ? `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`
        : phone;
}
export function isValidDriverApplicationRealName(value) {
    return typeof value === 'string' && DRIVER_APPLICATION_REAL_NAME_PATTERN.test(value);
}
/**
 * 실명 칸의 처음 값. 카카오 이름이 자동 생성 이름(`kakao-{id}`)이거나 실명 규칙에 맞지 않으면 비운다.
 * 카카오 이름은 별명일 수 있으므로 기사가 확인해 고치게 한다.
 */
export function driverApplicationRealNamePrefill(kakaoName) {
    if (typeof kakaoName !== 'string')
        return '';
    const trimmed = kakaoName.trim();
    if (trimmed.toLowerCase().startsWith('kakao-'))
        return '';
    return isValidDriverApplicationRealName(trimmed) ? trimmed : '';
}
/** 요일 목록을 월~일 순서로 정렬하고 중복을 없앤다. 모르는 값은 버린다. */
export function sortDriverAvailableDays(days) {
    return DRIVER_AVAILABLE_DAYS.filter((day) => days.includes(day));
}
/**
 * 입력 폼 값을 검증하고, 통과하면 API에 보낼 값(정규화한 휴대폰·정렬한 요일·앞뒤 공백 없는 지역)을 준다.
 * 실패하면 칸별 안내 문구(해요체)를 준다. API DTO 검증과 같은 규칙이다.
 */
export function validateDriverApplicationForm(values) {
    const errors = {};
    const realName = values.realName.trim();
    if (!realName)
        errors.realName = '실명을 적어 주세요.';
    else if (!isValidDriverApplicationRealName(realName))
        errors.realName = `실명은 ${DRIVER_APPLICATION_REAL_NAME_MIN_LENGTH}~${DRIVER_APPLICATION_REAL_NAME_MAX_LENGTH}자 글자로 적어 주세요. 숫자와 기호는 쓸 수 없어요.`;
    const phone = normalizeDriverApplicationPhone(values.phone);
    if (!values.phone.trim())
        errors.phone = '휴대폰 번호를 적어 주세요.';
    else if (!phone)
        errors.phone = '010으로 시작하는 휴대폰 번호 11자리를 적어 주세요.';
    if (!isDriverVehicleType(values.vehicleType))
        errors.vehicleType = '차량 종류를 골라 주세요.';
    if (!values.availableDays.every(isDriverAvailableDay))
        errors.availableDays = '요일을 다시 골라 주세요.';
    const availableArea = values.availableArea.trim();
    if (availableArea.length > DRIVER_APPLICATION_AREA_MAX_LENGTH)
        errors.availableArea = `활동 가능 지역은 ${DRIVER_APPLICATION_AREA_MAX_LENGTH}자 이하로 적어 주세요.`;
    else if (!DRIVER_APPLICATION_AREA_PATTERN.test(availableArea))
        errors.availableArea = '활동 가능 지역은 한 줄로 적어 주세요.';
    if (!values.consent)
        errors.consent = '개인정보 수집·이용에 동의해야 신청할 수 있어요.';
    if (Object.keys(errors).length > 0 || !phone || !isDriverVehicleType(values.vehicleType)) {
        return { ok: false, errors };
    }
    const availableDays = sortDriverAvailableDays(values.availableDays);
    return {
        ok: true,
        input: {
            realName,
            phone,
            vehicleType: values.vehicleType,
            ...(availableDays.length > 0 ? { availableDays } : {}),
            ...(availableArea ? { availableArea } : {}),
            consent: true,
            consentVersion: DRIVER_APPLICATION_CONSENT_VERSION,
        },
    };
}
//# sourceMappingURL=driver-application.js.map