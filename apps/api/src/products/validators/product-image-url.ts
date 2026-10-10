import { registerDecorator, type ValidationOptions } from 'class-validator';

type EnvValues = Record<string, string | undefined>;

const FIREBASE_DOWNLOAD_HOST = 'firebasestorage.googleapis.com';
const GCS_PUBLIC_HOST = 'storage.googleapis.com';
const LOCAL_STORAGE_EMULATOR_HOSTS = new Set(['127.0.0.1:9199', 'localhost:9199']);
const DEFAULT_BUCKET_SUFFIX = /^(.+)\.(?:appspot\.com|firebasestorage\.app)$/;
const PRODUCT_IMAGE_PATH = /^products\/([^/]+)\/([^/]+)$/;

/** 공백·역슬래시·제어 문자(U+0000–U+0020, U+007F)를 포함하는지. */
function hasUnsafeUrlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return /\s/.test(value);
}

function read(env: EnvValues, key: string): string {
  return (env[key] ?? '').trim();
}

/**
 * 상품 이미지가 있어도 되는 Storage bucket 목록.
 * 구성된 `FIREBASE_STORAGE_BUCKET`과 `FIREBASE_PROJECT_ID`의 기본 bucket 두 이름
 * (`<project>.appspot.com`, `<project>.firebasestorage.app`)을 허용한다.
 */
export function resolveAllowedImageBuckets(env: EnvValues = process.env): Set<string> {
  const buckets = new Set<string>();
  const projectIds = new Set<string>();
  const configuredBucket = read(env, 'FIREBASE_STORAGE_BUCKET');
  const projectId = read(env, 'FIREBASE_PROJECT_ID');

  if (configuredBucket) {
    buckets.add(configuredBucket);
    const match = DEFAULT_BUCKET_SUFFIX.exec(configuredBucket);
    if (match) projectIds.add(match[1]);
  }
  if (projectId) projectIds.add(projectId);
  for (const id of projectIds) {
    buckets.add(`${id}.appspot.com`);
    buckets.add(`${id}.firebasestorage.app`);
  }
  return buckets;
}

function isLocalEmulatorRuntime(env: EnvValues): boolean {
  return read(env, 'GREENHUB_LOCAL_RUNTIME') === 'true' && read(env, 'NODE_ENV') !== 'production';
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * 허용 bucket의 Firebase Storage 다운로드 URL 또는 GCS 공개 URL이면 객체 경로를 돌려준다.
 * - `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded path>?...`
 * - `https://storage.googleapis.com/<bucket>/<path>`
 * - local runtime 한정: `http://127.0.0.1:9199/v0/b/<bucket>/o/<encoded path>?...`
 */
export function parseStorageObjectPath(
  value: unknown,
  env: EnvValues = process.env,
): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  // 공백·역슬래시·제어 문자는 URL 파서가 조용히 고치므로 원문 단계에서 거부한다.
  if (hasUnsafeUrlCharacter(value)) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash) return null;

  const allowedBuckets = resolveAllowedImageBuckets(env);
  const segments = url.pathname.split('/');

  const isFirebaseDownload =
    (url.protocol === 'https:' && url.host === FIREBASE_DOWNLOAD_HOST) ||
    (url.protocol === 'http:' &&
      LOCAL_STORAGE_EMULATOR_HOSTS.has(url.host) &&
      isLocalEmulatorRuntime(env));

  if (isFirebaseDownload) {
    // ['', 'v0', 'b', bucket, 'o', encodedPath]
    if (segments.length !== 6) return null;
    const [, version, b, bucket, o, encodedPath] = segments;
    if (version !== 'v0' || b !== 'b' || o !== 'o') return null;
    if (!allowedBuckets.has(bucket)) return null;
    return safeDecode(encodedPath);
  }

  if (url.protocol === 'https:' && url.host === GCS_PUBLIC_HOST) {
    // ['', bucket, ...pathSegments]
    if (segments.length < 3) return null;
    const [, bucket, ...rest] = segments;
    if (!allowedBuckets.has(bucket)) return null;
    const decoded = rest.map(safeDecode);
    if (decoded.some((segment) => segment === null || segment.includes('/'))) return null;
    return decoded.join('/');
  }

  return null;
}

/**
 * 상품 이미지 URL이면 이미지가 속한 storeId를 돌려준다.
 * 객체 경로는 Storage 규칙과 같은 `products/<storeId>/<fileName>` 한 단계여야 한다.
 */
export function readProductImageStoreId(
  value: unknown,
  env: EnvValues = process.env,
): string | null {
  const objectPath = parseStorageObjectPath(value, env);
  if (objectPath === null) return null;
  const match = PRODUCT_IMAGE_PATH.exec(objectPath);
  if (!match) return null;
  const [, storeId, fileName] = match;
  if ([storeId, fileName].some((part) => part === '.' || part === '..')) return null;
  // 디코딩된 경로에 제어 문자·역슬래시가 있으면 거부한다(공백은 파일명에 쓰일 수 있다).
  for (let index = 0; index < objectPath.length; index += 1) {
    const code = objectPath.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return null;
  }
  return storeId;
}

export function isProductImageUrl(value: unknown, env: EnvValues = process.env): boolean {
  return readProductImageStoreId(value, env) !== null;
}

/** 자사 Storage bucket의 `products/<storeId>/<fileName>` 이미지 URL만 허용한다. */
export function IsProductImageUrl(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isProductImageUrl',
      target: object.constructor,
      propertyName: String(propertyName),
      options: {
        message: '상품 이미지는 자사 Storage의 상품 이미지 주소만 사용할 수 있습니다.',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => isProductImageUrl(value),
      },
    });
  };
}
