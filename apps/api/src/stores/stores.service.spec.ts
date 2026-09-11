import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StoresService } from './stores.service';

function makeService(storeData: Record<string, unknown> | null) {
  const firestore = {
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: storeData !== null,
        data: () => storeData,
      }),
    }),
    collection: jest.fn(),
  };
  return new StoresService(firestore as never);
}

describe('public store profile contract', () => {
  it('allowlist 필드만 반환한다', async () => {
    const service = makeService({
      id: 's-1',
      ownerId: 'seller-1',
      name: '디어오키드',
      ceoName: '홍길동',
      phone: '010-1234-5678',
      address: '경기도 이천시',
      businessNumber: '123-45-67890',
      logoUrl: 'https://example.com/logo.png',
      status: 'active',
      salesMode: 'round_direct',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const profile = (await service.getPublicProfile('s-1')) as Record<string, unknown>;
    expect(Object.keys(profile).sort()).toEqual(['id', 'logoUrl', 'name', 'salesMode'].sort());
    expect(profile).toEqual({
      id: 's-1',
      name: '디어오키드',
      logoUrl: 'https://example.com/logo.png',
      salesMode: 'round_direct',
    });
    expect(profile).not.toHaveProperty('ownerId');
    expect(profile).not.toHaveProperty('ceoName');
    expect(profile).not.toHaveProperty('phone');
    expect(profile).not.toHaveProperty('address');
    expect(profile).not.toHaveProperty('businessNumber');
    expect(profile).not.toHaveProperty('status');
    expect(profile).not.toHaveProperty('createdAt');
    expect(profile).not.toHaveProperty('updatedAt');
  });

  it.each([['legacy'], [undefined], [null], ['unsupported']])(
    'salesMode %s는 legacy로 정규화한다 (round_direct만 공개 직배송)',
    async (salesMode) => {
      const service = makeService({ id: 's-1', name: '상점', logoUrl: null, salesMode });
      const profile = (await service.getPublicProfile('s-1')) as Record<string, unknown>;
      if (salesMode === 'legacy' || salesMode == null) {
        expect(profile['salesMode']).toBe('legacy');
      } else {
        // invalid 값은 legacy로 fail-closed한다.
        expect(profile['salesMode']).toBe('legacy');
      }
    },
  );

  it('존재하지 않는 store는 404한다', async () => {
    const service = makeService(null);
    await expect(service.getPublicProfile('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('owner store API regression', () => {
  it('owner 조회는 기존 계약을 유지한다', async () => {
    const service = makeService({
      ownerId: 'seller-1',
      name: '디어오키드',
      ceoName: '홍길동',
      phone: '010-1234-5678',
      address: '경기도 이천시',
      businessNumber: '123-45-67890',
      logoUrl: null,
    });

    await expect(service.getStore('s-1', 'seller-1')).resolves.toMatchObject({
      id: 's-1',
      name: '디어오키드',
    });
  });

  it('owner가 아닌 조회는 거부한다', async () => {
    const service = makeService({ ownerId: 'seller-1', name: '상점' });
    await expect(service.getStore('s-1', 'seller-2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('존재하지 않는 store는 404한다', async () => {
    const service = makeService(null);
    await expect(service.getStore('missing', 'seller-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
