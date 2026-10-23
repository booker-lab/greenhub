/**
 * 카카오 로그인 프로필 사진 주소를 화면에 그릴 주소로 바꾼다.
 *
 * Auth.js Kakao 공급자는 `kakao_account.profile.profile_image_url`을 그대로 세션 `user.image`로
 * 넘긴다. 사용자 정보 요청에 secure_resource를 붙이지 않아 주소가 http로 올 수 있다.
 * 이미지 최적화(`/_next/image`)는 Firebase Storage 버킷만 허용하므로 프로필 사진은 최적화 없이
 * 브라우저가 카카오 CDN에서 바로 받는다. 정해진 카카오 이미지 호스트만 https로 바꿔 쓰고,
 * 그 밖의 주소는 그리지 않는다(화면은 이름 첫 글자로 대신 보인다).
 */

// 카카오 프로필 사진(k), 기본 프로필 썸네일(img1·t1) 호스트. CSP img-src도 이 목록을 쓴다.
export const KAKAO_PROFILE_IMAGE_HOSTS = [
  'k.kakaocdn.net',
  'img1.kakaocdn.net',
  't1.kakaocdn.net',
] as const;

const allowedHosts: ReadonlySet<string> = new Set(KAKAO_PROFILE_IMAGE_HOSTS);

export function profileImageSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  if (!allowedHosts.has(url.hostname)) return null;
  url.protocol = 'https:';
  return url.toString();
}
