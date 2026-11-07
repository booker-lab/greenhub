// MY 하위 화면의 화면 안 뒤로가기 판단. 이 탭에 이전 기록이 있으면 브라우저 뒤로가기를 쓰고,
// 주소를 직접 열어 돌아갈 기록이 없으면(기록 1개) MY로 보낸다.
export const MYPAGE_BACK_FALLBACK_HREF = '/mypage';

export type MyPageBackAction = 'back' | 'fallback';

/** window.history.length로 뒤로가기 방식을 정한다. 읽을 수 없는 값은 MY로 보낸다. */
export function resolveMyPageBack(historyLength: unknown): MyPageBackAction {
  return typeof historyLength === 'number' &&
    Number.isSafeInteger(historyLength) &&
    historyLength > 1
    ? 'back'
    : 'fallback';
}
