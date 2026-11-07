import { ValidationPipe } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as admin from 'firebase-admin';
import { AuditService } from '../common/audit/audit.service';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import type { FirestoreService } from '../firestore/firestore.service';
import { AuthService } from './auth.service';
import { AddressDto } from './dto/address.dto';
import { KakaoLoginDto } from './dto/kakao-login.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import type { KakaoClient } from './kakao.client';

// 전역 ValidationPipe를 거친 DTO에는 보내지 않은 선택 필드가 undefined 값으로 남아요.
// 그 값이 Firestore에 닿으면 500이 나던 회귀를 막아요. 쓰기 값은 실제 Firestore SDK의
// 동기 검증(WriteBatch.set/update)을 거쳐요. 네트워크는 쓰지 않아요.

type Data = Record<string, unknown>;
type DtoClass = new () => object;

/** 전역 ValidationPipe(운영과 같은 옵션)를 거친 컨트롤러 입력. */
async function viaGlobalPipe<T>(metatype: DtoClass, body: object): Promise<T> {
  const pipe = new ValidationPipe(sanitizedValidationPipeOptions());
  return (await pipe.transform(body, { type: 'body', metatype })) as T;
}

describe('인증 쓰기 경로 Firestore 값 검증', () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;

  beforeAll(() => {
    app = admin.initializeApp({ projectId: 'demo-auth-write-spec' }, `auth-write-${Date.now()}`);
    db = app.firestore();
  });

  afterAll(async () => {
    await app.delete();
  });

  /** 저장 전에 실제 SDK로 값을 검증하는 메모리 Firestore. undefined가 있으면 운영처럼 예외가 나요. */
  function makeFirestore(initial: Record<string, Data>) {
    const records = new Map(Object.entries(initial));
    const checkSet = (path: string, data: Data) => db.batch().set(db.doc(path), data);
    const checkUpdate = (path: string, data: Data) => db.batch().update(db.doc(path), data);
    const snapshot = (path: string) => ({
      exists: records.has(path),
      data: () => records.get(path),
    });
    const doc = (path: string) => ({
      path,
      get: async () => snapshot(path),
      set: async (data: Data) => {
        checkSet(path, data);
        records.set(path, data);
      },
      update: async (data: Data) => {
        checkUpdate(path, data);
        records.set(path, { ...(records.get(path) ?? {}), ...data });
      },
    });
    const collection = (name: string) => {
      const query = {
        where: () => query,
        limit: () => query,
        get: async () => {
          const docs = [...records]
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([path, data]) => ({ id: path.split('/')[1], data: () => data }));
          return { empty: docs.length === 0, docs };
        },
      };
      return query;
    };
    const runTransaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const pending: Array<() => void> = [];
      const result = await fn({
        get: async (ref: { path: string }) => snapshot(ref.path),
        update: (ref: { path: string }, data: Data) => {
          checkUpdate(ref.path, data);
          pending.push(() => records.set(ref.path, { ...(records.get(ref.path) ?? {}), ...data }));
        },
      });
      for (const write of pending) write();
      return result;
    };
    const firestore = {
      doc,
      collection,
      runTransaction,
      Timestamp: admin.firestore.Timestamp,
    } as unknown as FirestoreService;
    const config = { get: () => undefined } as unknown as ConfigService;
    const kakaoClient = {
      getUser: async () => ({ kakaoId: 'kakao-1', email: null, name: '판매자' }),
    } as unknown as KakaoClient;
    const service = new AuthService(
      firestore,
      {} as JwtService,
      config,
      kakaoClient,
      new AuditService(firestore, config),
    );
    return { service, records };
  }

  it('프로필 수정에서 이름만 보내도 저장되고 전화번호는 그대로 남아요', async () => {
    const { service, records } = makeFirestore({
      'users/user-1': { id: 'user-1', name: '옛 이름', phone: '010-1111-2222' },
    });
    const dto = await viaGlobalPipe<UpdateMeDto>(UpdateMeDto, { name: '새 이름' });
    // 전제: 보내지 않은 phone이 undefined 값의 자체 속성으로 남아 있어요.
    expect(Object.hasOwn(dto, 'phone')).toBe(true);

    await service.updateMe('user-1', dto);

    expect(records.get('users/user-1')).toMatchObject({
      name: '새 이름',
      phone: '010-1111-2222',
    });
  });

  it('배송지 수정에서 기본 배송지 여부를 보내지 않으면 기존 값을 그대로 둬요', async () => {
    const saved = {
      id: 'addr-1',
      label: '집',
      address: '서울시 중구',
      addressDetail: '1층',
      zipCode: '04500',
      isDefault: true,
    };
    const { service, records } = makeFirestore({
      'users/user-1': { id: 'user-1', savedAddresses: [saved] },
    });
    const dto = await viaGlobalPipe<AddressDto>(AddressDto, {
      label: '회사',
      address: '서울시 종로구',
      addressDetail: '3층',
      zipCode: '03100',
    });
    expect(Object.hasOwn(dto, 'isDefault')).toBe(true);

    await service.updateAddress('user-1', 'addr-1', dto);

    expect(records.get('users/user-1')!['savedAddresses']).toEqual([
      {
        id: 'addr-1',
        label: '회사',
        address: '서울시 종로구',
        addressDetail: '3층',
        zipCode: '03100',
        isDefault: true,
      },
    ]);
  });

  it('앱 구분 없이 들어온 카카오 로그인 거절도 403으로 끝나고 기록이 남아요', async () => {
    const { service, records } = makeFirestore({
      'users/seller-1': {
        id: 'seller-1',
        role: 'seller',
        kakaoId: 'kakao-1',
        storeId: 'store-1',
        suspended: false,
      },
    });
    const dto = await viaGlobalPipe<KakaoLoginDto>(KakaoLoginDto, { kakaoAccessToken: 'token' });

    await expect(service.kakaoLogin(dto)).rejects.toMatchObject({ status: 403 });

    const auditLog = [...records].find(([path]) => path.startsWith('auditLogs/'))?.[1];
    expect(auditLog).toMatchObject({
      action: 'auth.kakao.forbidden',
      userId: 'seller-1',
      detail: { actualRole: 'seller', targetRole: null },
    });
  });
});
