import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { AuditService } from '../common/audit/audit.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { AuthService, SAVED_ADDRESS_MAX_COUNT } from './auth.service';
import type { KakaoClient } from './kakao.client';

type SavedAddress = Record<string, unknown> & { id: string; label: string; isDefault: boolean };
type UserDoc = Record<string, unknown> & { savedAddresses?: SavedAddress[] };

// 사용자 문서 하나를 가진 Firestore 대역. 트랜잭션은 한 번에 하나씩 실행해(직렬화) 실제
// Firestore가 같은 문서의 동시 트랜잭션을 재시도로 직렬화하는 결과를 흉내 낸다. 트랜잭션 밖의
// ref.get/update는 막아 둬서 배송지 변경이 읽기·쓰기를 모두 트랜잭션 안에서 하는지 확인한다.
function makeAddressHarness(initial: UserDoc | null) {
  let user: UserDoc | null = initial ? structuredClone(initial) : null;
  let queue: Promise<unknown> = Promise.resolve();
  const userRef = {
    get: jest.fn(() => {
      throw new Error('배송지 변경은 트랜잭션 밖에서 사용자 문서를 읽지 않는다');
    }),
    update: jest.fn(() => {
      throw new Error('배송지 변경은 트랜잭션 밖에서 사용자 문서를 쓰지 않는다');
    }),
  };
  const firestore = {
    doc: jest.fn((path: string) => {
      if (path === 'users/user-1') return userRef;
      throw new Error(`예상하지 못한 문서 경로: ${path}`);
    }),
    runTransaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => {
      const run = queue.then(async () => {
        const pending: Array<() => void> = [];
        const result = await fn({
          get: async () => {
            // 다른 요청이 읽기와 쓰기 사이에 끼어들 틈을 준다.
            await new Promise((resolve) => setImmediate(resolve));
            const snapshot = user ? structuredClone(user) : null;
            return { exists: snapshot !== null, data: () => snapshot };
          },
          update: (_ref: unknown, data: UserDoc) => {
            pending.push(() => {
              user = { ...(user ?? {}), ...structuredClone(data) };
            });
          },
        });
        for (const write of pending) write();
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    }),
    Timestamp: { now: jest.fn(() => 'now') },
  };
  const service = new AuthService(
    firestore as unknown as FirestoreService,
    {} as JwtService,
    { get: jest.fn() } as unknown as ConfigService,
    {} as KakaoClient,
    { log: jest.fn() } as unknown as AuditService,
  );
  return { firestore, service, current: () => user };
}

function address(id: string, isDefault = false): SavedAddress {
  return { id, label: id, address: '서울시', addressDetail: '1층', zipCode: '01234', isDefault };
}

const NEW_ADDRESS = { label: '집', address: '서울시 중구', addressDetail: '2층', zipCode: '04500' };

describe('AuthService 배송지 트랜잭션', () => {
  it('동시에 추가한 배송지가 서로를 덮어쓰지 않는다', async () => {
    const { firestore, service, current } = makeAddressHarness({ savedAddresses: [] });

    await Promise.all([
      service.addAddress('user-1', { ...NEW_ADDRESS, label: 'A' }),
      service.addAddress('user-1', { ...NEW_ADDRESS, label: 'B' }),
    ]);

    const saved = current()?.savedAddresses ?? [];
    expect(saved.map((a) => a.label).sort()).toEqual(['A', 'B']);
    expect(saved.filter((a) => a.isDefault)).toHaveLength(1);
    expect(firestore.runTransaction).toHaveBeenCalledTimes(2);
  });

  it(`배송지는 ${SAVED_ADDRESS_MAX_COUNT}개까지 저장하고 넘으면 400이다`, async () => {
    const full = Array.from({ length: SAVED_ADDRESS_MAX_COUNT }, (_, i) =>
      address(`a-${i}`, i === 0),
    );
    const { service, current } = makeAddressHarness({ savedAddresses: full });

    await expect(service.addAddress('user-1', NEW_ADDRESS)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(current()?.savedAddresses).toHaveLength(SAVED_ADDRESS_MAX_COUNT);
  });

  it(`${SAVED_ADDRESS_MAX_COUNT - 1}개에서는 하나 더 추가할 수 있다`, async () => {
    const almost = Array.from({ length: SAVED_ADDRESS_MAX_COUNT - 1 }, (_, i) =>
      address(`a-${i}`, i === 0),
    );
    const { service, current } = makeAddressHarness({ savedAddresses: almost });

    await service.addAddress('user-1', NEW_ADDRESS);

    expect(current()?.savedAddresses).toHaveLength(SAVED_ADDRESS_MAX_COUNT);
  });

  it('동시에 삭제와 추가를 해도 두 변경이 모두 남는다', async () => {
    const { service, current } = makeAddressHarness({
      savedAddresses: [address('keep', true), address('remove')],
    });

    await Promise.all([
      service.deleteAddress('user-1', 'remove'),
      service.addAddress('user-1', { ...NEW_ADDRESS, label: 'new' }),
    ]);

    const labels = (current()?.savedAddresses ?? []).map((a) => a.label).sort();
    expect(labels).toEqual(['keep', 'new']);
  });

  it('동시에 수정과 기본 지정을 해도 기본 배송지는 하나이고 수정도 남는다', async () => {
    const { service, current } = makeAddressHarness({
      savedAddresses: [address('a', true), address('b')],
    });

    await Promise.all([
      service.updateAddress('user-1', 'a', { ...NEW_ADDRESS, label: 'a-수정' }),
      service.setDefaultAddress('user-1', 'b'),
    ]);

    const saved = current()?.savedAddresses ?? [];
    expect(saved.find((a) => a.id === 'a')?.label).toBe('a-수정');
    expect(saved.filter((a) => a.isDefault).map((a) => a.id)).toEqual(['b']);
  });

  it('없는 사용자·배송지는 쓰기 없이 404다', async () => {
    const missingUser = makeAddressHarness(null);
    await expect(missingUser.service.addAddress('user-1', NEW_ADDRESS)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const { service, current } = makeAddressHarness({ savedAddresses: [address('a', true)] });
    await expect(service.setDefaultAddress('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.updateAddress('user-1', 'missing', NEW_ADDRESS)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(current()?.savedAddresses).toEqual([address('a', true)]);
  });
});
