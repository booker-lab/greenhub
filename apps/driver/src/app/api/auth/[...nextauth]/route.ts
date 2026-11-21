import { withSignedOutMarkerOnSignOut } from '@greenhub/shared';
import { handlers } from '@/auth';

export const { GET } = handlers;
// 로그아웃 응답에 로그아웃 시각 표시 쿠키를 더한다. 늦은 세션 응답이 되살린 쿠키를 다음 요청에서 정리한다.
export const POST = withSignedOutMarkerOnSignOut(handlers.POST);
