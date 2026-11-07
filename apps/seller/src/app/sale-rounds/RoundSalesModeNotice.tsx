'use client';

import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { useSession } from 'next-auth/react';
import { useStoreSalesMode } from '@/hooks/useStoreSalesMode';
import { showsRoundSalesModeWarning } from './sales-mode-notice';

/** 회차 판매가 켜져 있지 않은(또는 확인하지 못한) 가게에 회차가 손님에게 보이지 않을 수 있음을 알린다. */
export function RoundSalesModeNotice() {
  const { data: session } = useSession();
  const salesMode = useStoreSalesMode(session?.user.storeId, session?.user.accessToken);
  if (!showsRoundSalesModeWarning(salesMode)) return null;
  return (
    <Alert variant="warning" role="alert">
      <AlertTitle>이 가게는 아직 회차 판매로 바뀌지 않았을 수 있어요</AlertTitle>
      <AlertDescription>
        회차 판매가 켜져 있지 않으면 손님에게 회차가 보이지 않아요. 운영팀에 회차 판매 전환을 요청해
        주세요.
      </AlertDescription>
    </Alert>
  );
}
