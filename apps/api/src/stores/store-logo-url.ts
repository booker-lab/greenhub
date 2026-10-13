/**
 * 상점 로고 URL 허용 규칙.
 *
 * 판매자 앱은 로고를 Firebase Storage `logos/<uid>_<epochMs>`에 올리고(storage.rules가
 * 본인 uid 이름만 허용) `getDownloadURL()` 결과를 그대로 보낸다. 서버는 그 모양만 받는다.
 * - https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded object path>[?alt=media&token=…]
 * - https://storage.googleapis.com/<bucket>/<object path>
 * - (local runtime 한정) http://127.0.0.1:9199 또는 http://localhost:9199 의 Storage emulator URL
 * bucket은 API가 쓰는 Firebase storage bucket과 같아야 하고, 객체 경로는 요청자 본인의 로고여야 한다.
 */
export const STORE_LOGO_URL_MAX_LENGTH = 2048;

const FIREBASE_STORAGE_HOST = 'firebasestorage.googleapis.com';
const GCS_HOST = 'storage.googleapis.com';
const LOCAL_STORAGE_EMULATOR_HOSTS = new Set(['127.0.0.1', 'localhost']);
const LOCAL_STORAGE_EMULATOR_PORT = '9199';

export interface StoreLogoUrlPolicy {
  bucket: string;
  allowLocalEmulator: boolean;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function extractObjectPath(url: URL, policy: StoreLogoUrlPolicy): string | null {
  if (url.username || url.password || url.hash) return null;

  const isLocalEmulator =
    policy.allowLocalEmulator &&
    url.protocol === 'http:' &&
    LOCAL_STORAGE_EMULATOR_HOSTS.has(url.hostname) &&
    url.port === LOCAL_STORAGE_EMULATOR_PORT;

  if (!isLocalEmulator && (url.protocol !== 'https:' || url.port !== '')) return null;

  if (url.hostname === FIREBASE_STORAGE_HOST || isLocalEmulator) {
    const prefix = `/v0/b/${policy.bucket}/o/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const encodedObject = url.pathname.slice(prefix.length);
    // 객체 경로는 한 segment로 인코딩되어야 한다(`logos%2F…`).
    if (!encodedObject || encodedObject.includes('/')) return null;
    return safeDecode(encodedObject);
  }

  if (url.hostname === GCS_HOST && !isLocalEmulator) {
    const prefix = `/${policy.bucket}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    return safeDecode(url.pathname.slice(prefix.length));
  }

  return null;
}

/** 요청자 본인의 로고 객체(`logos/<ownerId>_<digits>`)를 가리키는 자사 bucket URL인지 판정한다. */
export function isAllowedStoreLogoUrl(
  value: string,
  ownerId: string,
  policy: StoreLogoUrlPolicy,
): boolean {
  if (!policy.bucket || !ownerId) return false;
  if (value.length === 0 || value.length > STORE_LOGO_URL_MAX_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const objectPath = extractObjectPath(url, policy);
  if (objectPath === null) return false;

  const ownerPrefix = `logos/${ownerId}_`;
  if (!objectPath.startsWith(ownerPrefix)) return false;
  return /^[0-9]+$/.test(objectPath.slice(ownerPrefix.length));
}
