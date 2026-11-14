'use client';

import {
  DRIVER_APPLICATION_AREA_MAX_LENGTH,
  DRIVER_APPLICATION_CONSENT_SUMMARY,
  DRIVER_APPLICATION_REAL_NAME_MAX_LENGTH,
  DRIVER_AVAILABLE_DAY_LABELS,
  DRIVER_AVAILABLE_DAYS,
  DRIVER_VEHICLE_TYPE_LABELS,
  DRIVER_VEHICLE_TYPES,
  type DriverApplicationFieldErrors,
  type DriverApplicationFormValues,
} from '@greenhub/shared';
import { useActionState, useState } from 'react';
import { AppButton } from '@/components/app-button';
import { CheckboxField, RadioGroupField, TextField } from '@/components/fields';
import { text } from '@/components/look';
import { submitDriverApplication } from './actions';
import { APPLY_FIELD, APPLY_NOTICE, type ApplyActionState } from './_lib/apply-form';
import { ApplyNoticeBox, RestartKakaoLoginForm } from './apply-notice';

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className={`${text} mt-1 text-ui-red`} style={{ fontSize: 'var(--font-size-sm)' }}>
      {message}
    </p>
  );
}

// 입력 칸은 상태로 들고 있어 서버 액션이 끝난 뒤(React가 폼을 비워도) 값이 그대로 남는다.
// 차량 종류·요일·동의는 화면 부품이 만든 이름 대신 숨은 입력으로 같은 이름(APPLY_FIELD)을 보낸다.
function ApplyFields({
  initial,
  errors,
  pending,
  editing,
}: {
  initial: DriverApplicationFormValues;
  errors: DriverApplicationFieldErrors;
  pending: boolean;
  editing: boolean;
}) {
  const [realName, setRealName] = useState(initial.realName);
  const [phone, setPhone] = useState(initial.phone);
  const [vehicleType, setVehicleType] = useState(initial.vehicleType);
  const [availableDays, setAvailableDays] = useState<string[]>(initial.availableDays);
  const [availableArea, setAvailableArea] = useState(initial.availableArea);
  const [consent, setConsent] = useState(initial.consent);

  const toggleDay = (day: string, checked: boolean) =>
    setAvailableDays((current) =>
      checked ? [...current.filter((d) => d !== day), day] : current.filter((d) => d !== day),
    );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <TextField
          label="실명"
          name={APPLY_FIELD.realName}
          required
          autoComplete="name"
          maxLength={DRIVER_APPLICATION_REAL_NAME_MAX_LENGTH}
          value={realName}
          onChange={(event) => setRealName(event.currentTarget.value)}
          aria-invalid={errors.realName ? true : undefined}
          aria-describedby={errors.realName ? 'apply-realName-error' : undefined}
        />
        <FieldError id="apply-realName-error" message={errors.realName} />
      </div>

      <div>
        <TextField
          label="휴대폰 번호"
          name={APPLY_FIELD.phone}
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="010-1234-5678"
          value={phone}
          onChange={(event) => setPhone(event.currentTarget.value)}
          aria-invalid={errors.phone ? true : undefined}
          aria-describedby={errors.phone ? 'apply-phone-error' : undefined}
        />
        <FieldError id="apply-phone-error" message={errors.phone} />
      </div>

      <div>
        <RadioGroupField
          label="차량 종류 *"
          value={vehicleType}
          onChange={setVehicleType}
          options={DRIVER_VEHICLE_TYPES.map((type) => ({
            value: type,
            label: DRIVER_VEHICLE_TYPE_LABELS[type],
          }))}
        />
        <input type="hidden" name={APPLY_FIELD.vehicleType} value={vehicleType} />
        <FieldError id="apply-vehicleType-error" message={errors.vehicleType} />
      </div>

      <fieldset className="m-0 border-0 p-0">
        <legend className={`${text} mb-2.5 text-sm font-semibold`}>활동 가능 요일 (선택)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2.5">
          {DRIVER_AVAILABLE_DAYS.map((day) => (
            <CheckboxField
              key={day}
              label={DRIVER_AVAILABLE_DAY_LABELS[day]}
              checked={availableDays.includes(day)}
              onChange={(checked) => toggleDay(day, checked)}
            />
          ))}
        </div>
        {availableDays.map((day) => (
          <input key={day} type="hidden" name={APPLY_FIELD.availableDays} value={day} />
        ))}
        <FieldError id="apply-availableDays-error" message={errors.availableDays} />
      </fieldset>

      <div>
        <TextField
          label="활동 가능 지역 (선택)"
          name={APPLY_FIELD.availableArea}
          maxLength={DRIVER_APPLICATION_AREA_MAX_LENGTH}
          placeholder="예: 이천시 전역, 여주시 일부"
          value={availableArea}
          onChange={(event) => setAvailableArea(event.currentTarget.value)}
          aria-invalid={errors.availableArea ? true : undefined}
          aria-describedby={errors.availableArea ? 'apply-availableArea-error' : undefined}
        />
        <FieldError id="apply-availableArea-error" message={errors.availableArea} />
      </div>

      <div
        className="rounded-[8px] p-3"
        style={{ border: 'var(--border)', backgroundColor: 'var(--color-bg)' }}
      >
        <p className={`${text} mb-1 font-semibold`} style={{ fontSize: 'var(--font-size-sm)' }}>
          개인정보 수집·이용 동의 (필수)
        </p>
        <ul className={`${text} mb-3 list-disc ps-5`} style={{ fontSize: 'var(--font-size-sm)' }}>
          <li>수집 항목: {DRIVER_APPLICATION_CONSENT_SUMMARY.items}</li>
          <li>이용 목적: {DRIVER_APPLICATION_CONSENT_SUMMARY.purpose}</li>
          <li>보유 기간: {DRIVER_APPLICATION_CONSENT_SUMMARY.retention}</li>
          <li>동의하지 않으면 기사 가입 신청을 할 수 없어요.</li>
        </ul>
        <CheckboxField
          label="위 내용을 읽었고 개인정보 수집·이용에 동의해요"
          checked={consent}
          onChange={setConsent}
        />
        {consent && <input type="hidden" name={APPLY_FIELD.consent} value="agree" />}
        <FieldError id="apply-consent-error" message={errors.consent} />
      </div>

      <AppButton type="submit" fullWidth size="xl" loading={pending}>
        {editing ? '신청 내용 고치기' : '가입 신청하기'}
      </AppButton>
    </div>
  );
}

export function ApplyForm({
  initialValues,
  editing,
}: {
  initialValues: DriverApplicationFormValues;
  /** 이미 낸 신청을 고치는 중인지(버튼 문구). */
  editing: boolean;
}) {
  const [state, formAction, pending] = useActionState<ApplyActionState, FormData>(
    submitDriverApplication,
    { kind: 'editing', values: initialValues, errors: {} },
  );

  if (state.kind === 'submitted') {
    return (
      <div className="flex flex-col gap-4">
        <ApplyNoticeBox notice={APPLY_NOTICE.submitted} />
        <AppButton href="/login" fullWidth size="md" tone="default">
          로그인 화면으로
        </AppButton>
      </div>
    );
  }
  if (state.kind === 'expired') {
    return (
      <div className="flex flex-col gap-4">
        <ApplyNoticeBox notice={APPLY_NOTICE.expired} />
        <RestartKakaoLoginForm />
      </div>
    );
  }
  if (state.kind === 'not-allowed' || state.kind === 'revision-limit') {
    return <ApplyNoticeBox notice={APPLY_NOTICE[state.kind]} />;
  }

  return (
    <form action={formAction} noValidate>
      {state.failure && (
        <div className="mb-4">
          <ApplyNoticeBox notice={APPLY_NOTICE[state.failure]} />
        </div>
      )}
      <ApplyFields
        initial={state.values}
        errors={state.errors}
        pending={pending}
        editing={editing}
      />
    </form>
  );
}
