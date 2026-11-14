/**
 * 기사 가입 신청 화면(`/apply`)의 폼 읽기·결과 안내 (Next·DOM 의존 없음, vitest로 검증).
 * 검증 규칙은 `@greenhub/shared`의 validateDriverApplicationForm(API DTO와 같은 규칙)이다.
 */
import type {
  DriverApplicationFieldErrors,
  DriverApplicationFormValues,
  DriverApplicationView,
} from '@greenhub/shared';
import type { DriverApplicationFailure } from '@/lib/driver-application-api';

export const APPLY_FIELD = {
  realName: 'realName',
  phone: 'phone',
  vehicleType: 'vehicleType',
  availableDays: 'availableDays',
  availableArea: 'availableArea',
  consent: 'consent',
} as const;

type FormDataLike = {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
};

function stringOf(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

/** 서버 액션이 받은 폼 값을 읽는다. 체크박스(동의)는 값이 있으면 체크한 것이다. */
export function readApplyFormValues(formData: FormDataLike): DriverApplicationFormValues {
  return {
    realName: stringOf(formData.get(APPLY_FIELD.realName)),
    phone: stringOf(formData.get(APPLY_FIELD.phone)),
    vehicleType: stringOf(formData.get(APPLY_FIELD.vehicleType)),
    availableDays: formData
      .getAll(APPLY_FIELD.availableDays)
      .filter((value): value is string => typeof value === 'string'),
    availableArea: stringOf(formData.get(APPLY_FIELD.availableArea)),
    consent: formData.get(APPLY_FIELD.consent) !== null,
  };
}

/** 저장된 신청(또는 처음 값)으로 폼 처음 값을 만든다. 동의는 매번 다시 체크하게 비워 둔다. */
export function initialApplyFormValues(
  application: DriverApplicationView | null,
  prefillRealName: string,
): DriverApplicationFormValues {
  if (!application) {
    return {
      realName: prefillRealName,
      phone: '',
      vehicleType: '',
      availableDays: [],
      availableArea: '',
      consent: false,
    };
  }
  return {
    realName: application.realName,
    phone: application.phone,
    vehicleType: application.vehicleType,
    availableDays: application.availableDays ?? [],
    availableArea: application.availableArea ?? '',
    consent: false,
  };
}

export type ApplyActionState =
  | {
      kind: 'editing';
      values: DriverApplicationFormValues;
      errors: DriverApplicationFieldErrors;
      failure?: 'invalid' | 'failed';
    }
  | { kind: 'submitted' }
  | { kind: 'expired' }
  | { kind: 'not-allowed' }
  | { kind: 'revision-limit' };

/** API 거절을 화면 상태로 바꾼다. 이미 승인된 기사(approved)는 서버 액션이 작업 보드로 보낸다. */
export function applyStateForFailure(
  failure: Exclude<DriverApplicationFailure, 'approved'>,
  values: DriverApplicationFormValues,
): ApplyActionState {
  if (failure === 'expired') return { kind: 'expired' };
  if (failure === 'not-allowed') return { kind: 'not-allowed' };
  if (failure === 'revision-limit') return { kind: 'revision-limit' };
  return { kind: 'editing', values, errors: {}, failure };
}

export type ApplyNotice = {
  title: string;
  body: string;
  showOpsContact: boolean;
  tone: 'info' | 'error';
};

/** 신청 화면 안내 문구(해요체). 오류 상세(code·서버 메시지)는 보이지 않는다. */
export const APPLY_NOTICE = {
  submitted: {
    title: '신청이 접수됐어요',
    body: '관리자가 승인하면 다시 로그인해 주세요.',
    showOpsContact: true,
    tone: 'info',
  },
  expired: {
    title: '신청 확인 시간이 지났어요',
    body: '보안을 위해 신청 화면은 로그인 뒤 30분 동안만 열려요. 카카오로 다시 로그인해 주세요.',
    showOpsContact: false,
    tone: 'info',
  },
  'not-allowed': {
    title: '가입 신청을 할 수 없는 계정이에요',
    body: '운영팀에 문의해 주세요.',
    showOpsContact: true,
    tone: 'error',
  },
  'revision-limit': {
    title: '신청 내용을 더 고칠 수 없어요',
    body: '고칠 내용이 있으면 운영팀에 알려 주세요.',
    showOpsContact: true,
    tone: 'error',
  },
  invalid: {
    title: '입력한 내용을 다시 확인해 주세요',
    body: '표시된 칸을 고친 뒤 다시 신청해 주세요.',
    showOpsContact: false,
    tone: 'error',
  },
  failed: {
    title: '신청하지 못했어요',
    body: '잠시 후 다시 시도해 주세요. 계속 안 되면 운영팀에 문의해 주세요.',
    showOpsContact: true,
    tone: 'error',
  },
} as const satisfies Record<string, ApplyNotice>;
