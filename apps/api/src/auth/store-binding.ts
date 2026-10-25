/**
 * 토큰에 담긴 매장 연결이 사용자 문서의 현재 매장 연결과 맞는지 판단한다.
 *
 * - 같으면 그대로 쓴다.
 * - 토큰에 매장이 없고 사용자 문서에 매장이 생긴 경우(판매자 가게 등록 직후, 관리자에게 매장 연결)
 *   허용한다. 요청 권한은 언제나 사용자 문서의 매장으로 다시 정하고, 다음 회전 토큰에 새 매장을
 *   담으므로 권한이 넓어지지 않는다. 이 전이를 거부하면 가게 등록 직후 세션 확인·refresh가 모두
 *   거부돼 막 가입한 판매자가 로그아웃된다.
 * - 매장이 다른 매장으로 바뀌거나 사라지면 거부한다(이전 매장 권한을 들고 다니지 못하게).
 */
export function isTokenStoreBindingCurrent(
  tokenStoreId: string | null,
  currentStoreId: string | null,
): boolean {
  if (tokenStoreId === currentStoreId) return true;
  return tokenStoreId === null && currentStoreId !== null;
}
