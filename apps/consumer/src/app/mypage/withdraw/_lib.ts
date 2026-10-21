// 회원 탈퇴 요청(`DELETE /auth/me`)과 응답 해석. 화면과 테스트가 같은 규칙을 쓴다.

export const WITHDRAW_FAILED_MESSAGE = '탈퇴하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
export const WITHDRAW_ACTIVE_ORDER_FALLBACK =
  '진행 중인 주문이 있어 탈퇴할 수 없습니다. 배송이 끝나거나 주문을 취소한 뒤 다시 시도해 주세요.';

export type WithdrawResult = { ok: true } | { ok: false; message: string };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// 409(진행 중 주문)는 서버 안내 문구를 그대로 보여 준다. 그 밖의 실패는 고정 문구로 바꾼다.
export async function requestWithdrawal(
  apiUrl: string,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<WithdrawResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${apiUrl}/auth/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { ok: false, message: WITHDRAW_FAILED_MESSAGE };
  }
  if (res.ok) return { ok: true };
  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === 'string' ? body.message : '';
    return { ok: false, message: message || WITHDRAW_ACTIVE_ORDER_FALLBACK };
  }
  return { ok: false, message: WITHDRAW_FAILED_MESSAGE };
}

// 탈퇴하면 지우는 것과 남는 것. 개인정보처리방침 2절·7절과 같은 내용이다.
export const WITHDRAW_ERASED_ITEMS = [
  '이름·전화번호·이메일',
  '저장한 배송지',
  '알림 수신 설정과 알림 내역',
  '재입고 알림 신청',
  '카카오 로그인 연결',
] as const;

export const WITHDRAW_KEPT_ITEMS = [
  '주문·결제 기록(주문 당시 받는 분 이름·연락처·주소 포함)은 전자상거래법에 따라 5년간 보관합니다.',
  '작성한 후기는 가려진 이름으로 남습니다.',
] as const;
