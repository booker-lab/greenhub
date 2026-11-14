import { AppButton } from '@/components/app-button';
import { text } from '@/components/look';
import { DRIVER_OPS_CONTACT } from '@/lib/ops-contact';
import type { ApplyNotice } from './_lib/apply-form';
import { restartKakaoLogin } from './actions';

// 신청 화면 안내 상자. 로그인 화면 안내와 같은 모양(노랑 안내·빨강 오류)과 운영팀 연락처를 쓴다.
export function ApplyNoticeBox({ notice }: { notice: ApplyNotice }) {
  return (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={
        notice.tone === 'error'
          ? 'relative overflow-hidden rounded-[8px] border border-transparent bg-ui-red-light p-4 text-ui-red-light-text'
          : 'relative overflow-hidden rounded-[8px] border border-transparent bg-status-warning p-4 text-status-warning-foreground'
      }
    >
      <div className="text-sm/[1.55] text-ui-ink">
        <p
          className={`${text} mb-1`}
          style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}
        >
          {notice.title}
        </p>
        <p className={text} style={{ fontSize: 'var(--font-size-sm)' }}>
          {notice.body}
        </p>
        {notice.showOpsContact && (
          <p className={`${text} mt-2`} style={{ fontSize: 'var(--font-size-sm)' }}>
            {DRIVER_OPS_CONTACT.label}{' '}
            <a
              href={DRIVER_OPS_CONTACT.phoneHref}
              className="font-bold underline underline-offset-2"
            >
              {DRIVER_OPS_CONTACT.phone}
            </a>
            <br />
            운영 시간 {DRIVER_OPS_CONTACT.hours}
          </p>
        )}
      </div>
    </div>
  );
}

// 티켓이 없거나 만료됐을 때: 남은 쿠키를 지우고 카카오 로그인을 다시 시작한다.
export function RestartKakaoLoginForm() {
  return (
    <form action={restartKakaoLogin}>
      <AppButton
        type="submit"
        fullWidth
        size="md"
        style={{ backgroundColor: '#FEE500', color: '#191919' }}
      >
        카카오로 다시 로그인
      </AppButton>
    </form>
  );
}
