import { readFileSync } from 'node:fs';
import { getImageProps } from 'next/image';
import { describe, expect, it } from 'vitest';
import { profileImageSrc } from './profile-image';

const profilePageSource = readFileSync(new URL('../app/profile/page.tsx', import.meta.url), 'utf8');

describe('카카오 프로필 사진 주소', () => {
  it('카카오 CDN 주소는 https로 바꿔 그대로 쓴다', () => {
    expect(profileImageSrc('http://k.kakaocdn.net/dn/abc/img_640x640.jpg')).toBe(
      'https://k.kakaocdn.net/dn/abc/img_640x640.jpg',
    );
    expect(profileImageSrc('https://k.kakaocdn.net/dn/abc/img_640x640.jpg')).toBe(
      'https://k.kakaocdn.net/dn/abc/img_640x640.jpg',
    );
    expect(
      profileImageSrc(
        'http://img1.kakaocdn.net/thumb/R640x640.q70/?fname=http://t1.kakaocdn.net/account_images/default_profile.jpeg',
      ),
    ).toBe(
      'https://img1.kakaocdn.net/thumb/R640x640.q70/?fname=http://t1.kakaocdn.net/account_images/default_profile.jpeg',
    );
  });

  it('정해진 카카오 호스트가 아니거나 형식이 틀리면 그리지 않는다', () => {
    for (const value of [
      undefined,
      null,
      '',
      'not a url',
      'https://example.com/a.jpg',
      'https://kakaocdn.net/a.jpg',
      'https://evil.k.kakaocdn.net/a.jpg',
      'https://k.kakaocdn.net.evil.com/a.jpg',
      'https://user@k.kakaocdn.net/a.jpg',
      'https://k.kakaocdn.net:8443/a.jpg',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
    ]) {
      expect(profileImageSrc(value)).toBeNull();
    }
  });

  it('최적화 없이 그리면 /_next/image를 거치지 않고 카카오 주소를 바로 쓴다', () => {
    const src = 'https://k.kakaocdn.net/dn/abc/img_640x640.jpg';
    const { props } = getImageProps({
      src,
      alt: '프로필',
      width: 60,
      height: 60,
      unoptimized: true,
    });
    expect(props.src).toBe(src);
  });

  it('프로필 화면은 변환한 주소를 최적화 없이 그린다', () => {
    expect(profilePageSource).toContain('profileImageSrc(user.image)');
    expect(profilePageSource).toMatch(/<Image\s+src=\{imageSrc\}[^>]*\bunoptimized\b/);
    expect(profilePageSource).not.toContain('src={user.image}');
  });
});
