'use client';

import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { useSession } from 'next-auth/react';
import { useStoreSalesModeState } from '@/hooks/useStoreSalesMode';
import { resolveRoundSalesModeNotice } from './sales-mode-notice';

/** 회차 판매가 켜져 있지 않은 가게에 손님에게 회차가 보이지 않음을 알린다. 조회 실패는 약하게 안내한다. */
export function RoundSalesModeNotice() {
  const { data: session } = useSession();
  const state = useStoreSalesModeState(session?.user.storeId, session?.user.accessToken);
  const notice = resolveRoundSalesModeNotice(state);
  if (notice === 'unknown') {
    return (
      <Alert variant="secondary" role="status">
        <AlertDescription>
          판매 방식을 확인하지 못했어요. 회차 판매가 켜져 있지 않으면 손님에게 회차가 보이지 않아요.
        </AlertDescription>
      </Alert>
    );
  }
  if (notice !== 'not_round_direct') return null;
  return (
    <Alert variant="warning" role="alert">
      <AlertTitle>이 가게는 회차 판매가 켜져 있지 않아요</AlertTitle>
      <AlertDescription>
        이 가게는 회차 판매가 켜져 있지 않아 손님에게 회차가 보이지 않아요. 운영팀에 회차 판매
        전환을 요청해 주세요.
      </AlertDescription>
    </Alert>
  );
}
