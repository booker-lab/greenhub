import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import * as admin from 'firebase-admin';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateDeliveryConfigDto } from './dto/update-delivery-config.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

// 감사 S-01/S-02: 화면이 실제 보내는 본문을 DTO로 받아 Firestore에 쓸 때 undefined 값 때문에 500이 나던 회귀.
// 쓰기 값은 실제 Firestore SDK의 동기 검증(WriteBatch.set/update)을 거친다. 네트워크는 쓰지 않는다.

type Data = Record<string, unknown>;
type DtoClass = new () => object;

/** 셀러 상품 등록 화면이 기능 토글이 꺼진 기본 상태에서 보내는 본문(감사 재현 본문). */
const SCREEN_CREATE_BODY = {
  name: '감사용 장미 10송이',
  images: [],
  price: 25000,
  category: 'cut_flower',
  saleType: 'normal',
  deliverySize: 'small',
  selection: {
    colors: ['레드'],
    stemType: '외대',
    fragrance: 'none',
    bloomCondition: 'half',
    careLevel: 'normal',
    bundleUnit: '',
  },
  sellerNote: '',
  content: { headline: '', description: '', isEditedByUser: false },
  sellerOverride: false,
  notice: {
    origin: '국내산(경기도 이천)',
    producer: '감사 화원',
    certification: '해당 없음',
    csPhone: '010-1234-5678',
  },
};

/** 전역 ValidationPipe(운영과 같은 옵션)를 거친 컨트롤러 입력. */
async function viaGlobalPipe<T>(metatype: DtoClass, body: object): Promise<T> {
  const pipe = new ValidationPipe(sanitizedValidationPipeOptions());
  return (await pipe.transform(body, { type: 'body', metatype })) as T;
}

/** class-transformer가 만든 DTO 인스턴스 그대로. */
async function viaPlainToInstance<T>(metatype: DtoClass, body: object): Promise<T> {
  return plainToInstance(metatype, body) as T;
}

const DTO_SOURCES = [
  ['전역 ValidationPipe 결과', viaGlobalPipe],
  ['plainToInstance DTO 인스턴스', viaPlainToInstance],
] as const;

describe('상품 쓰기 경로 Firestore 값 검증(감사 S-01/S-02)', () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;

  beforeAll(() => {
    app = admin.initializeApp(
      { projectId: 'demo-products-write-spec' },
      `products-write-${Date.now()}`,
    );
    db = app.firestore();
  });

  afterAll(async () => {
    await app.delete();
  });

  /** 저장 전에 실제 SDK로 값을 검증하는 메모리 Firestore. undefined가 있으면 운영처럼 예외가 난다. */
  function makeFirestore(initial: Record<string, Data>) {
    const records = new Map(Object.entries(initial));
    const doc = (path: string) => ({
      path,
      get: async () => ({ exists: records.has(path), data: () => records.get(path) }),
      set: async (data: Data, options?: { merge?: boolean }) => {
        if (options) db.batch().set(db.doc(path), data, options);
        else db.batch().set(db.doc(path), data);
        records.set(path, options?.merge ? { ...(records.get(path) ?? {}), ...data } : data);
      },
      update: async (data: Data) => {
        db.batch().update(db.doc(path), data);
        records.set(path, { ...(records.get(path) ?? {}), ...data });
      },
    });
    const firestore = { doc, Timestamp: admin.firestore.Timestamp };
    return { service: new ProductsService(firestore as never), records };
  }

  const ownedStore = { 'stores/store-1': { id: 'store-1', ownerId: 'seller-1' } };

  function storedProduct(records: Map<string, Data>): Data {
    return [...records].find(([key]) => key.startsWith('products/'))![1];
  }

  it.each(DTO_SOURCES)('%s: 화면 등록 본문으로 상품을 만들 수 있다', async (_label, toDto) => {
    const dto = await toDto<CreateProductDto>(CreateProductDto, SCREEN_CREATE_BODY);
    // 전제: DTO에 값이 undefined인 선택 필드가 남아 있다(최상위·중첩 모두).
    expect(Object.hasOwn(dto, 'size')).toBe(true);
    expect(Object.hasOwn(dto.notice!, 'itemName')).toBe(true);
    const { service, records } = makeFirestore(ownedStore);

    await service.createProduct('store-1', 'seller-1', dto);

    const stored = storedProduct(records);
    expect(stored).toMatchObject({ ...SCREEN_CREATE_BODY, storeId: 'store-1', isActive: true });
    expect(stored).not.toHaveProperty('size');
    expect(stored).not.toHaveProperty('groupConfig');
    expect(stored['notice']).not.toHaveProperty('itemName');
  });

  it.each(DTO_SOURCES)(
    '%s: 옵션 선택지 안의 빈 선택 필드도 빼고 저장한다',
    async (_label, toDto) => {
      const dto = await toDto<CreateProductDto>(CreateProductDto, {
        ...SCREEN_CREATE_BODY,
        options: [
          { id: 'pot', name: '화분', choices: [{ id: 'basic', label: '기본', priceDelta: 0 }] },
        ],
      });
      const { service, records } = makeFirestore(ownedStore);

      await service.createProduct('store-1', 'seller-1', dto);

      expect(storedProduct(records)['options']).toEqual([
        { id: 'pot', name: '화분', choices: [{ id: 'basic', label: '기본', priceDelta: 0 }] },
      ]);
    },
  );

  it.each(DTO_SOURCES)(
    '%s: 공동구매 상품 등록도 모집 설정과 함께 저장된다',
    async (_label, toDto) => {
      const dto = await toDto<CreateProductDto>(CreateProductDto, {
        ...SCREEN_CREATE_BODY,
        saleType: 'group',
        groupConfig: {
          minQuantity: 5,
          targetQuantity: 10,
          maxPerPerson: 2,
          recruitDeadline: '2026-12-10T00:00:00.000Z',
          groupDeliveryDate: '2026-12-15T00:00:00.000Z',
          groupDeliveryMethod: 'direct',
          deliveryFeeDiscount: 0,
        },
      });
      const { service, records } = makeFirestore(ownedStore);

      await service.createProduct('store-1', 'seller-1', dto);

      const product = storedProduct(records);
      const productId = String(product['id']);
      expect(records.get(`groupProductConfig/${productId}`)).toMatchObject({
        productId: product['id'],
        minQuantity: 5,
        currentQuantity: 0,
        isProcessed: false,
        recruitDeadline: new Date('2026-12-10T00:00:00.000Z'),
      });
    },
  );

  it.each(DTO_SOURCES)(
    '%s: 수정에서 보내지 않은 필드는 그대로 두고 null은 지우기로 저장한다',
    async (_label, toDto) => {
      const existing = {
        id: 'p-1',
        storeId: 'store-1',
        name: '이전 이름',
        price: 10000,
        size: { heightCm: 40 },
        light: 'bright',
        marketRef: { flowerGubn: 1, pumName: '장미', unitsPerItem: 10 },
      };
      const { service, records } = makeFirestore({ ...ownedStore, 'products/p-1': existing });
      const { name: _name, ...screenFields } = SCREEN_CREATE_BODY;
      const dto = await toDto<UpdateProductDto>(UpdateProductDto, {
        ...screenFields,
        name: '바꾼 이름',
        marketRef: null,
      });

      await service.updateProduct('store-1', 'p-1', 'seller-1', dto);

      const stored = records.get('products/p-1')!;
      expect(stored).toMatchObject({
        name: '바꾼 이름',
        price: 25000,
        size: { heightCm: 40 },
        light: 'bright',
        marketRef: null,
      });
      expect(stored['notice']).not.toHaveProperty('itemName');
    },
  );

  it.each(DTO_SOURCES)('%s: 일부 필드만 보낸 수정도 저장된다', async (_label, toDto) => {
    const existing = { id: 'p-1', storeId: 'store-1', name: '이전 이름', price: 10000 };
    const { service, records } = makeFirestore({ ...ownedStore, 'products/p-1': existing });
    const dto = await toDto<UpdateProductDto>(UpdateProductDto, { price: 12000 });

    await service.updateProduct('store-1', 'p-1', 'seller-1', dto);

    expect(records.get('products/p-1')).toMatchObject({ name: '이전 이름', price: 12000 });
  });

  it.each(DTO_SOURCES)('%s: 배송비 일부 수정도 저장된다', async (_label, toDto) => {
    const { service, records } = makeFirestore({
      ...ownedStore,
      'deliveryFeeConfig/store-1': { storeId: 'store-1', directFee: 3000, hubFee: 1000 },
    });
    const dto = await toDto<UpdateDeliveryConfigDto>(UpdateDeliveryConfigDto, { directFee: 3500 });

    await service.updateDeliveryConfig('store-1', 'seller-1', dto);

    expect(records.get('deliveryFeeConfig/store-1')).toMatchObject({
      storeId: 'store-1',
      directFee: 3500,
      hubFee: 1000,
    });
  });
});
