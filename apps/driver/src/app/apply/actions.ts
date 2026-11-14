'use server';

import { validateDriverApplicationForm } from '@greenhub/shared';
import { RedirectType, redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { saveMyDriverApplication } from '@/lib/driver-application-api';
import {
  clearDriverApplicationTicket,
  readDriverApplicationTicket,
} from '@/lib/driver-application-cookie';
import { DRIVER_DEFAULT_RETURN_PATH } from '@/lib/login-redirect';
import {
  type ApplyActionState,
  applyStateForFailure,
  readApplyFormValues,
} from './_lib/apply-form';

// 가입 신청 저장. 폼 값을 같은 규칙으로 먼저 검증하고, 티켓 쿠키로 API에 보낸다.
// 저장되면 티켓 쿠키를 지운다(다시 고치려면 카카오로 다시 로그인해 새 티켓을 받는다).
// 티켓이 없거나 만료됐으면 쿠키를 지우고 다시 로그인 안내, 이미 승인된 기사는 작업 보드로 보낸다.
export async function submitDriverApplication(
  _previous: ApplyActionState,
  formData: FormData,
): Promise<ApplyActionState> {
  const values = readApplyFormValues(formData);
  const ticket = await readDriverApplicationTicket();
  if (!ticket) {
    await clearDriverApplicationTicket();
    return { kind: 'expired' };
  }
  const validation = validateDriverApplicationForm(values);
  if (!validation.ok)
    return { kind: 'editing', values, errors: validation.errors, failure: 'invalid' };

  const result = await saveMyDriverApplication(ticket, validation.input);
  if (result.ok) {
    await clearDriverApplicationTicket();
    return { kind: 'submitted' };
  }
  if (result.failure === 'approved') {
    await clearDriverApplicationTicket();
    redirect(DRIVER_DEFAULT_RETURN_PATH, RedirectType.replace);
  }
  if (result.failure === 'expired' || result.failure === 'not-allowed') {
    await clearDriverApplicationTicket();
  }
  return applyStateForFailure(result.failure, values);
}

// "카카오로 다시 로그인": 남은 티켓 쿠키를 지우고 카카오 인증 화면으로 간다(로그인 화면의 카카오 버튼과 같은 방식).
// 승인 전이면 로그인 콜백이 새 티켓을 담아 다시 이 화면이나 접수 안내로 보낸다.
export async function restartKakaoLogin(): Promise<void> {
  await clearDriverApplicationTicket();
  const authorizeUrl = await signIn('kakao', {
    redirectTo: DRIVER_DEFAULT_RETURN_PATH,
    redirect: false,
  });
  redirect(authorizeUrl, RedirectType.replace);
}
