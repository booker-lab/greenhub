import {
  isProductImageUrl,
  parseStorageObjectPath,
  readProductImageStoreId,
  resolveAllowedImageBuckets,
} from './product-image-url';

const productionEnv = {
  FIREBASE_PROJECT_ID: 'green-e4fe3',
  FIREBASE_STORAGE_BUCKET: 'green-e4fe3.appspot.com',
};

const STORE_ID = '80189070-2c3d-45f2-bc11-68a870b13951';

function downloadUrl(
  bucket: string,
  objectPath: string,
  host = 'https://firebasestorage.googleapis.com',
) {
  return `${host}/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=8df4ed49`;
}

describe('상품 이미지 허용 bucket', () => {
  it('구성 bucket과 project 기본 bucket 두 이름을 허용한다', () => {
    expect([...resolveAllowedImageBuckets(productionEnv)].sort()).toEqual([
      'green-e4fe3.appspot.com',
      'green-e4fe3.firebasestorage.app',
    ]);
  });

  it('bucket만 구성돼도 같은 project의 기본 bucket 이름을 함께 허용한다', () => {
    expect(
      resolveAllowedImageBuckets({ FIREBASE_STORAGE_BUCKET: 'stage-1.firebasestorage.app' }),
    ).toEqual(new Set(['stage-1.firebasestorage.app', 'stage-1.appspot.com']));
  });

  it('구성이 없으면 아무 bucket도 허용하지 않는다', () => {
    expect(resolveAllowedImageBuckets({}).size).toBe(0);
    expect(isProductImageUrl(downloadUrl('green-e4fe3.appspot.com', 'products/s/a.jpg'), {})).toBe(
      false,
    );
  });
});

describe('상품 이미지 URL 판정', () => {
  it('운영에 저장된 Firebase 다운로드 URL 형태를 허용하고 storeId를 읽는다', () => {
    const url =
      'https://firebasestorage.googleapis.com/v0/b/green-e4fe3.firebasestorage.app/o/products%2F80189070-2c3d-45f2-bc11-68a870b13951%2F1776891228036_%EC%8A%A4%ED%81%AC%EB%A6%B0%EC%83%B7%202026-04-21%20002526.png?alt=media&token=8df4ed49-2dab-4687-b13c-70094f5cf24e';

    expect(readProductImageStoreId(url, productionEnv)).toBe(STORE_ID);
  });

  it('appspot.com bucket 다운로드 URL과 GCS 공개 URL을 허용한다', () => {
    expect(
      readProductImageStoreId(
        downloadUrl('green-e4fe3.appspot.com', `products/${STORE_ID}/1_a.jpg`),
        productionEnv,
      ),
    ).toBe(STORE_ID);
    expect(
      readProductImageStoreId(
        `https://storage.googleapis.com/green-e4fe3.appspot.com/products/${STORE_ID}/1_a.jpg`,
        productionEnv,
      ),
    ).toBe(STORE_ID);
  });

  it.each([
    ['외부 호스트', 'https://example.com/products/s/a.jpg'],
    [
      'http Firebase',
      downloadUrl(
        'green-e4fe3.appspot.com',
        'products/s/a.jpg',
        'http://firebasestorage.googleapis.com',
      ),
    ],
    [
      '비슷한 호스트',
      downloadUrl(
        'green-e4fe3.appspot.com',
        'products/s/a.jpg',
        'https://firebasestorage.googleapis.com.example.com',
      ),
    ],
    [
      '포트가 붙은 호스트',
      downloadUrl(
        'green-e4fe3.appspot.com',
        'products/s/a.jpg',
        'https://firebasestorage.googleapis.com:8443',
      ),
    ],
    [
      '사용자 정보 포함',
      downloadUrl(
        'green-e4fe3.appspot.com',
        'products/s/a.jpg',
        'https://u:p@firebasestorage.googleapis.com',
      ),
    ],
    ['다른 bucket', downloadUrl('other-project.appspot.com', 'products/s/a.jpg')],
    ['배너 경로', downloadUrl('green-e4fe3.appspot.com', 'banners/main_hero/a.png')],
    ['로고 경로', downloadUrl('green-e4fe3.appspot.com', 'logos/uid_1')],
    ['중첩 경로', downloadUrl('green-e4fe3.appspot.com', 'products/s/nested/a.jpg')],
    ['상위 경로', downloadUrl('green-e4fe3.appspot.com', 'products/../a.jpg')],
    [
      '인코딩 안 된 경로',
      'https://firebasestorage.googleapis.com/v0/b/green-e4fe3.appspot.com/o/products/s/a.jpg',
    ],
    [
      '깨진 인코딩',
      'https://firebasestorage.googleapis.com/v0/b/green-e4fe3.appspot.com/o/products%2Fs%2F%E0%A4%A',
    ],
    ['GCS 다른 bucket', 'https://storage.googleapis.com/other.appspot.com/products/s/a.jpg'],
    [
      'GCS 인코딩된 구분자',
      'https://storage.googleapis.com/green-e4fe3.appspot.com/products/s%2Fx/a.jpg',
    ],
    ['공백 포함', ` ${downloadUrl('green-e4fe3.appspot.com', 'products/s/a.jpg')}`],
    ['fragment 포함', `${downloadUrl('green-e4fe3.appspot.com', 'products/s/a.jpg')}#x`],
    [
      'ftp',
      'ftp://firebasestorage.googleapis.com/v0/b/green-e4fe3.appspot.com/o/products%2Fs%2Fa.jpg',
    ],
    ['data URL', 'data:image/png;base64,AAAA'],
  ])('%s URL을 거부한다', (_label, url) => {
    expect(isProductImageUrl(url, productionEnv)).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}]])('문자열이 아닌 값 %p를 거부한다', (value) => {
    expect(parseStorageObjectPath(value, productionEnv)).toBeNull();
  });

  it('Storage emulator URL은 local runtime에서만 허용한다', () => {
    const localEnv = {
      FIREBASE_PROJECT_ID: 'greenhub-local',
      FIREBASE_STORAGE_BUCKET: 'greenhub-local.appspot.com',
    };
    const url = downloadUrl(
      'greenhub-local.appspot.com',
      'products/store-1/1_a.jpg',
      'http://127.0.0.1:9199',
    );

    expect(isProductImageUrl(url, localEnv)).toBe(false);
    expect(isProductImageUrl(url, { ...localEnv, GREENHUB_LOCAL_RUNTIME: 'true' })).toBe(true);
    expect(
      isProductImageUrl(url, {
        ...localEnv,
        GREENHUB_LOCAL_RUNTIME: 'true',
        NODE_ENV: 'production',
      }),
    ).toBe(false);
  });
});
