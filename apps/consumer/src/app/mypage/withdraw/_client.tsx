'use client';

import { Alert, AlertDescription } from '@greenhub/ui/components/alert';
import { Button } from '@greenhub/ui/components/button';
import { Checkbox } from '@greenhub/ui/components/checkbox';
import { LoadingButton } from '@greenhub/ui/components/loading-button';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';
import {
  requestWithdrawal,
  WITHDRAW_ERASED_ITEMS,
  WITHDRAW_FAILED_MESSAGE,
  WITHDRAW_KEPT_ITEMS,
} from './_lib';

// ① 외형 유지(UI 교체 P5): Mantine Container size sm(720px·좌우 16)·Group(gap xs 10)·Stack(gap lg 20)·
// Text(p, 줄 높이 1.55)·List(아래 WithdrawList)·Checkbox(sm)·
// Alert light red·Button transparent(왼쪽 여백 0)·Button md red와 같은 값.
const TEXT = 'm-0 p-0 leading-[1.55]';

const sectionTitleStyle = {
  fontSize: 'var(--font-size-md)',
  fontWeight: 'var(--fw-bold)',
  color: 'var(--color-text)',
} as const;

const bodyTextStyle = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-secondary)',
} as const;

export default function WithdrawClient() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'unauthenticated') {
    router.replace('/login');
    return null;
  }

  async function handleWithdraw() {
    const token = session?.user?.accessToken;
    if (!token) {
      setError(WITHDRAW_FAILED_MESSAGE);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await requestWithdrawal(getApiBaseUrl(), token);
    if (result.ok) {
      await signOut({ callbackUrl: '/' });
      return;
    }
    setError(result.message);
    setSubmitting(false);
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 pt-5 pb-20">
      <div className="mb-5 flex flex-row flex-wrap items-center justify-start gap-2.5">
        <Button
          type="button"
          variant="ghost"
          className="ps-0 hover:bg-transparent"
          style={{ color: 'var(--color-text)' }}
          onClick={() => router.back()}
          aria-label="뒤로 가기"
        >
          <ChevronLeft size={20} className="size-5" />
        </Button>
        <h1
          className={TEXT}
          style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' }}
        >
          회원 탈퇴
        </h1>
      </div>

      <div className="flex flex-col items-stretch justify-start gap-5">
        <div>
          <p className={`${TEXT} mb-2.5`} style={sectionTitleStyle}>
            탈퇴하면 지워지는 정보
          </p>
          <WithdrawList items={WITHDRAW_ERASED_ITEMS} />
        </div>

        <div>
          <p className={`${TEXT} mb-2.5`} style={sectionTitleStyle}>
            탈퇴해도 남는 정보
          </p>
          <WithdrawList items={WITHDRAW_KEPT_ITEMS} />
        </div>

        <p className={TEXT} style={bodyTextStyle}>
          진행 중인 주문(결제 대기·준비·배송 중, 취소나 재배송비 결제 진행 중)이 있으면 그 주문이
          끝난 뒤 탈퇴할 수 있습니다. 같은 카카오 계정으로 다시 가입하면 새 계정으로 시작합니다.
        </p>

        <Checkbox
          checked={confirmed}
          onCheckedChange={setConfirmed}
          label="위 내용을 확인했고 탈퇴합니다."
          data-testid="withdraw-confirm"
        />

        {error && (
          <Alert role="alert" variant="destructive" data-testid="withdraw-error">
            <AlertDescription>
              <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                {error}
              </p>
            </AlertDescription>
          </Alert>
        )}

        <LoadingButton
          type="button"
          variant="destructive"
          size="md"
          className="w-full"
          disabled={!confirmed}
          loading={submitting}
          onClick={handleWithdraw}
          data-testid="withdraw-submit"
        >
          탈퇴하기
        </LoadingButton>
      </div>
    </div>
  );
}

// 소비자 globals.css는 Mantine List.css를 불러오지 않아, 교체 전 List는 브라우저 기본 ul(왼쪽 40px·위아래 1em,
// spacing은 CSS 변수뿐이라 항목 간격 없음)과 스타일 없는 li > div > span으로 그려졌다. 그 모양을 그대로 둔다.
function WithdrawList({ items }: { items: readonly string[] }) {
  return (
    <ul className="my-[1em] ps-10" style={bodyTextStyle}>
      {items.map((item) => (
        <li key={item}>
          <div>
            <span>{item}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
