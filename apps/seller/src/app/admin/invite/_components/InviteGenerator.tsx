'use client';

import { Button } from '@greenhub/ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { type ChangeEvent, useId } from 'react';
import type { IssuedInvite } from '@/hooks/useAdmin';
import { formatKstDateTime, INVITE_RECIPIENT_EMAIL_MAX_LENGTH } from '../_lib';

// ② 방향(design-direction.md §5 어드민, §8 D7): 쉬는 상자에 그림자·색 면을 쓰지 않고 1px rule 테두리만 둔다.
// 입력칸·버튼은 ① 외형(Mantine TextInput·Button과 같은 값)을 유지한다.
const TEXT = 'm-0 p-0 text-base font-normal';

interface RecipientEmailInputProps {
  label: string;
  description: string;
  required: boolean;
  placeholder: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  error: string | null;
  maxLength: number;
  disabled: boolean;
}

/** Mantine TextInput(label·description·required·error)과 같은 배치: 라벨(필수 표시 *) → 설명 → 입력칸 → 오류. */
function RecipientEmailInput({
  label,
  description,
  required,
  error,
  ...inputProps
}: RecipientEmailInputProps) {
  const id = useId();
  return (
    <Field data-invalid={error ? true : undefined} className="mb-4">
      <FieldLabel htmlFor={id}>
        {label}
        {required && (
          // Mantine 필수 표시: 라벨 글자 바로 뒤 공백 + red-6 별표(라벨 칸 간격 8px는 지운다).
          <span aria-hidden="true" className="-ms-2 text-[#fa5252]">
            {'\u00a0*'}
          </span>
        )}
      </FieldLabel>
      <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
      <Input
        id={id}
        type="email"
        required={required}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-description`}
        {...inputProps}
      />
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

interface InviteGeneratorProps {
  generating: boolean;
  lastToken: IssuedInvite | null;
  /** 발급 직후 초대의 링크(/invite/[token]). lastToken이 있을 때만 값이 있다. */
  lastLink: string | null;
  copied: boolean;
  /** useAdminInvite 발급 command 실패 메시지. null이면 마지막 발급이 실패하지 않았음. */
  generateError: string | null;
  /** 받는 사람 이메일 입력값(필수). 비어 있으면 생성 버튼을 막는다. */
  recipientEmail: string;
  /** 받는 사람 이메일 입력 오류. null이면 오류 없음. */
  recipientEmailError: string | null;
  onRecipientEmailChange: (value: string) => void;
  onGenerate: () => void;
  onCopy: () => void;
}

export function InviteGenerator({
  generating,
  lastToken,
  lastLink,
  copied,
  generateError,
  recipientEmail,
  recipientEmailError,
  onRecipientEmailChange,
  onGenerate,
  onCopy,
}: InviteGeneratorProps) {
  // 받는 사람 이메일은 필수다. 비어 있으면 생성 버튼을 막고, 형식 오류는 누른 뒤 입력란에 보여 준다.
  const recipientMissing = recipientEmail.trim() === '';

  return (
    <div className="mb-8 block rounded-[8px] border border-rule bg-white p-4 min-[641px]:p-5">
      <p className={`${TEXT} mb-4 text-[15px] leading-[22px] text-[var(--color-text-secondary)]`}>
        판매자 초대 링크를 만듭니다. 링크는 발급 후 <strong>72시간</strong> 동안 한 번만 쓸 수 있고,
        받는 분이 링크를 열어 카카오로 로그인하면 판매자로 가입돼요.
      </p>

      <RecipientEmailInput
        label="받는 사람 이메일"
        description="카카오 계정 이메일이 있으면 이 이메일과 같아야 가입할 수 있어요."
        required
        placeholder="seller@example.com"
        value={recipientEmail}
        onChange={(event) => onRecipientEmailChange(event.currentTarget.value)}
        error={recipientEmailError}
        maxLength={INVITE_RECIPIENT_EMAIL_MAX_LENGTH}
        disabled={generating}
      />

      <Button onClick={onGenerate} disabled={generating || recipientMissing} size="md">
        {generating ? '만드는 중…' : '새 초대 링크 만들기'}
      </Button>

      {/* 발급 command 실패는 성공과 구분해 사용자에게 알린다. 성공한 경우에만 lastToken이 갱신되므로 이 블록은 이전 성공 토큰을 덮어쓰지 않는다. */}
      {generateError !== null && (
        <div className="mt-4 rounded-[8px] border border-rule p-4">
          <p
            className={`${TEXT} mb-1`}
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-danger)',
            }}
          >
            초대 링크 발급에 실패했습니다.
          </p>
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            {generateError}
          </p>
        </div>
      )}

      {lastToken && (
        <div className="mt-4 rounded-[8px] border border-rule p-4">
          <p
            className={`${TEXT} mb-2.5`}
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text)',
              fontWeight: 'var(--fw-bold)',
            }}
          >
            생성된 초대 링크
          </p>
          <div className="flex flex-row flex-nowrap items-start justify-start gap-3">
            <code
              className={`${TEXT} font-mono`}
              style={{
                flex: 1,
                minWidth: 0,
                wordBreak: 'break-all',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text)',
              }}
            >
              {lastLink ?? lastToken.token}
            </code>
            <Button onClick={onCopy} size="xs" variant="outline" className="rounded-[8px]">
              {copied ? '복사됨!' : '링크 복사'}
            </Button>
          </div>
          <p
            className={`${TEXT} mt-2.5`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            만료: {formatKstDateTime(lastToken.expiresAt)}
          </p>
          {lastToken.recipientEmail && (
            <p
              className={`${TEXT} mt-1`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              받는 사람: {lastToken.recipientEmail}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
