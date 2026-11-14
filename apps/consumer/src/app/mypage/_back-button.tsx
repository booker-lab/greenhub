'use client';

import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { TOUCH_ICON } from '@/lib/touch-target';
import { MYPAGE_BACK_FALLBACK_HREF, resolveMyPageBack } from './_back';

// MY 하위 화면(회원 탈퇴·알림 설정과 같은 모양)의 화면 안 뒤로가기 버튼.
// 직접 들어와 돌아갈 기록이 없으면 MY로 간다. 눌리는 영역은 44×44px이고 화살표는 왼쪽 끝에 둔다.
export function MyPageBackButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      className={`${TOUCH_ICON} justify-start px-0 hover:bg-transparent`}
      style={{ color: 'var(--color-text)' }}
      aria-label="뒤로 가기"
      onClick={() => {
        if (resolveMyPageBack(window.history.length) === 'back') router.back();
        else router.replace(MYPAGE_BACK_FALLBACK_HREF);
      }}
    >
      <ChevronLeft size={20} className="size-5" />
    </Button>
  );
}
