import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { text } from '@/components/look';
import { fetchMyDriverApplication } from '@/lib/driver-application-api';
import { readDriverApplicationTicket } from '@/lib/driver-application-cookie';
import { DRIVER_DEFAULT_RETURN_PATH } from '@/lib/login-redirect';
import { APPLY_NOTICE, initialApplyFormValues } from './_lib/apply-form';
import { ApplyForm } from './apply-form';
import { ApplyNoticeBox, RestartKakaoLoginForm } from './apply-notice';

export const metadata: Metadata = { title: '기사 가입 신청' };

function ApplyShell({ lead, children }: { lead?: string; children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        justifyContent: 'center',
        backgroundColor: 'var(--color-bg)',
        padding: '24px 16px',
      }}
    >
      <div className="w-full" style={{ maxWidth: 440 }}>
        <div className="rounded-[16px] bg-card p-6" style={{ border: 'var(--border)' }}>
          <h1
            className="m-0 mb-1 leading-[1.35]"
            style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-primary-dark)' }}
          >
            기사 가입 신청
          </h1>
          {lead && (
            <p
              className={`${text} mb-5`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              {lead}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

// 승인 전 기사의 가입 신청 화면. 세션 대신 카카오 로그인 콜백이 담은 신청 티켓 쿠키(경로 /apply, 30분)로만 연다.
// 화면 그리기 중에는 쿠키를 바꿀 수 없으므로 읽기만 하고, 지우기는 서버 액션(저장·다시 로그인)이 한다.
export default async function ApplyPage() {
  const ticket = await readDriverApplicationTicket();
  if (!ticket) {
    return (
      <ApplyShell>
        <div className="flex flex-col gap-4">
          <ApplyNoticeBox notice={APPLY_NOTICE.expired} />
          <RestartKakaoLoginForm />
        </div>
      </ApplyShell>
    );
  }

  const mine = await fetchMyDriverApplication(ticket);
  if (!mine.ok) {
    if (mine.failure === 'approved') redirect(DRIVER_DEFAULT_RETURN_PATH);
    const notice =
      mine.failure === 'expired'
        ? APPLY_NOTICE.expired
        : mine.failure === 'not-allowed'
          ? APPLY_NOTICE['not-allowed']
          : APPLY_NOTICE.failed;
    return (
      <ApplyShell>
        <div className="flex flex-col gap-4">
          <ApplyNoticeBox notice={notice} />
          {mine.failure !== 'not-allowed' && <RestartKakaoLoginForm />}
        </div>
      </ApplyShell>
    );
  }

  const editing = mine.data.status === 'submitted';
  return (
    <ApplyShell
      lead={
        editing
          ? '이미 낸 신청 내용이에요. 바꿀 곳을 고친 뒤 다시 보내 주세요. 관리자가 승인하면 다시 로그인해 주세요.'
          : '관리자가 확인하고 승인하면 기사 앱을 쓸 수 있어요. 차량 번호·면허·계좌는 묻지 않아요.'
      }
    >
      <ApplyForm
        initialValues={initialApplyFormValues(
          mine.data.application,
          mine.data.prefill?.realName ?? '',
        )}
        editing={editing}
      />
    </ApplyShell>
  );
}
