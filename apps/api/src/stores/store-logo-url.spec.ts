import { isAllowedStoreLogoUrl, STORE_LOGO_URL_MAX_LENGTH } from './store-logo-url';

const BUCKET = 'green-e4fe3.firebasestorage.app';
const policy = { bucket: BUCKET, allowLocalEmulator: false };
const owner = 'f3b0c2d4-1111-4222-8333-944455556666';
const objectPath = `logos/${owner}_1760000000000`;
const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(
  objectPath,
)}?alt=media&token=0b1c2d3e`;

describe('isAllowedStoreLogoUrl', () => {
  it.each([
    ['Firebase download URL', downloadUrl],
    ['token 없는 Firebase URL', downloadUrl.split('?')[0]],
    ['GCS 공개 URL', `https://storage.googleapis.com/${BUCKET}/${objectPath}`],
  ])('%s는 허용한다', (_label, url) => {
    expect(isAllowedStoreLogoUrl(url, owner, policy)).toBe(true);
  });

  it.each([
    ['외부 호스트', 'https://evil.example/logo.png'],
    ['http', downloadUrl.replace('https://', 'http://')],
    ['다른 bucket', downloadUrl.replace(BUCKET, 'other-project.appspot.com')],
    ['다른 판매자 로고', downloadUrl.replace(owner, 'someone-else')],
    [
      '상품 이미지 경로',
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent('products/s-1/a.jpg')}`,
    ],
    [
      '인코딩 안 된 객체 경로',
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${objectPath}`,
    ],
    ['숫자가 아닌 접미사', downloadUrl.replace('1760000000000', '1760000000000.svg')],
    [
      '상위 경로 이동',
      downloadUrl.replace(encodeURIComponent('logos/'), encodeURIComponent('logos/../')),
    ],
    ['사용자 정보 포함', downloadUrl.replace('https://', 'https://user:pw@')],
    ['포트 지정', downloadUrl.replace('googleapis.com/', 'googleapis.com:8443/')],
    ['fragment', `${downloadUrl}#x`],
    ['호스트 접미사 위장', downloadUrl.replace('googleapis.com', 'googleapis.com.evil.example')],
    ['javascript 스킴', 'javascript:alert(1)'],
    ['data URL', 'data:image/png;base64,AAAA'],
    ['빈 문자열', ''],
    ['너무 긴 URL', `${downloadUrl}&pad=${'a'.repeat(STORE_LOGO_URL_MAX_LENGTH)}`],
    ['잘못된 퍼센트 인코딩', `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/%E0%A4%A`],
  ])('%s는 거부한다', (_label, url) => {
    expect(isAllowedStoreLogoUrl(url, owner, policy)).toBe(false);
  });

  it('local runtime에서만 Storage emulator URL을 허용한다', () => {
    const emulatorUrl = downloadUrl.replace(
      'https://firebasestorage.googleapis.com',
      'http://127.0.0.1:9199',
    );
    const localPolicy = { ...policy, allowLocalEmulator: true };
    expect(isAllowedStoreLogoUrl(emulatorUrl, owner, policy)).toBe(false);
    expect(isAllowedStoreLogoUrl(emulatorUrl, owner, localPolicy)).toBe(true);
    expect(
      isAllowedStoreLogoUrl(emulatorUrl.replace('127.0.0.1', '10.0.0.5'), owner, localPolicy),
    ).toBe(false);
  });

  it('bucket이나 owner가 비어 있으면 거부한다', () => {
    expect(isAllowedStoreLogoUrl(downloadUrl, owner, { ...policy, bucket: '' })).toBe(false);
    expect(isAllowedStoreLogoUrl(downloadUrl, '', policy)).toBe(false);
  });
});
