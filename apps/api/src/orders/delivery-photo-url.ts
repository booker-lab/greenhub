import { registerDecorator, type ValidationOptions } from 'class-validator';
import { parseStorageObjectPath } from '../products/validators/product-image-url';

type EnvValues = Record<string, string | undefined>;

/**
 * 거점(legacy) 배송 사진 객체 경로.
 * 기사 앱은 `deliveryPhotos/<orderId>_<epochMs>.jpg`에 올리고(storage.rules가 같은 이름만 허용)
 * `getDownloadURL()` 결과를 그대로 보낸다. orderId는 storage.rules와 같은 문자 집합이다.
 */
const LEGACY_DELIVERY_PHOTO_PATH = /^deliveryPhotos\/([A-Za-z0-9_-]{1,128})_[0-9]+\.jpg$/;

export const LEGACY_DELIVERY_PHOTO_URL_MESSAGE =
  '배송 사진은 자사 Storage에 올린 해당 주문의 사진 주소만 사용할 수 있습니다.';

/**
 * 자사 Storage bucket(상품 이미지와 같은 허용 규칙)의 거점 배송 사진 URL이면 객체 경로를 돌려준다.
 * local runtime의 Storage emulator URL 허용 규칙도 상품 이미지 검증과 같다.
 */
function readLegacyDeliveryPhotoPath(value: unknown, env: EnvValues): string | null {
  const objectPath = parseStorageObjectPath(value, env);
  if (objectPath === null || !LEGACY_DELIVERY_PHOTO_PATH.test(objectPath)) return null;
  return objectPath;
}

/** 형식만 확인한다(주문 일치는 {@link isLegacyDeliveryPhotoUrlForOrder}가 확인). */
export function isLegacyDeliveryPhotoUrl(value: unknown, env: EnvValues = process.env): boolean {
  return readLegacyDeliveryPhotoPath(value, env) !== null;
}

/** 해당 주문의 거점 배송 사진(`deliveryPhotos/<orderId>_<digits>.jpg`)을 가리키는지 확인한다. */
export function isLegacyDeliveryPhotoUrlForOrder(
  value: unknown,
  orderId: string,
  env: EnvValues = process.env,
): boolean {
  if (!orderId) return false;
  const objectPath = readLegacyDeliveryPhotoPath(value, env);
  if (objectPath === null) return false;
  const prefix = `deliveryPhotos/${orderId}_`;
  if (!objectPath.startsWith(prefix)) return false;
  return /^[0-9]+\.jpg$/.test(objectPath.slice(prefix.length));
}

/** 자사 Storage bucket의 거점 배송 사진 URL만 허용한다. */
export function IsLegacyDeliveryPhotoUrl(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isLegacyDeliveryPhotoUrl',
      target: object.constructor,
      propertyName: String(propertyName),
      options: {
        message: LEGACY_DELIVERY_PHOTO_URL_MESSAGE,
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => isLegacyDeliveryPhotoUrl(value),
      },
    });
  };
}
