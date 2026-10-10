import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import type { AuditService } from '../common/audit/audit.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { AuthService } from './auth.service';
import type { KakaoClient } from './kakao.client';

jest.mock('firebase-admin', () => ({ auth: jest.fn() }));

function makeService(kakaoId = '4242') {
  const occ = createOccFirestore();
  const jwt = { sign: jest.fn(() => 'signed-token'), verify: jest.fn() };
  const config = { get: jest.fn((_key: string, fallback?: string) => fallback ?? 'secret') };
  const kakaoClient = {
    getUser: jest.fn().mockResolvedValue({
      kakaoId,
      email: 'kakao@example.com',
      name: '카카오사용자',
    }),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new AuthService(
    occ.firestore as unknown as FirestoreService,
    jwt as unknown as JwtService,
    config as unknown as ConfigService,
    kakaoClient as unknown as KakaoClient,
    audit as unknown as AuditService,
  );
  return { occ, service };
}

describe('카카오 첫 로그인 사용자 생성 단일화', () => {
  it('같은 카카오 계정의 동시 첫 로그인은 사용자 문서를 하나만 만든다', async () => {
    const { occ, service } = makeService();

    const results = await Promise.all([
      service.kakaoLogin({ kakaoAccessToken: 'token-a', targetRole: 'consumer' }),
      service.kakaoLogin({ kakaoAccessToken: 'token-b', targetRole: 'consumer' }),
      service.kakaoLogin({ kakaoAccessToken: 'token-c', targetRole: 'consumer' }),
    ]);

    const users = occ.listData('users/');
    expect(users).toHaveLength(1);
    const userId = users[0]['id'];
    expect(results.map((result) => result.user['id'])).toEqual([userId, userId, userId]);
    expect(occ.getData('kakaoIdentities/4242')).toMatchObject({ userId });
  });

  it('기존 연결이 있으면 새 사용자를 만들지 않고 연결된 사용자를 쓴다', async () => {
    const { occ, service } = makeService();
    occ.seed('kakaoIdentities/4242', { userId: 'user-linked' });
    occ.seed('users/user-linked', {
      id: 'user-linked',
      // 조회용 kakaoId가 비어 있는 상태(쿼리로는 찾지 못함)에서도 연결 문서로 수렴한다.
      role: 'consumer',
      storeId: null,
    });

    const result = await service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'consumer' });

    expect(result.user['id']).toBe('user-linked');
    expect(occ.listData('users/')).toHaveLength(1);
  });

  it('연결 문서의 사용자가 없어졌으면 새 사용자를 만들고 연결을 갱신한다', async () => {
    const { occ, service } = makeService();
    occ.seed('kakaoIdentities/4242', { userId: 'user-removed' });

    const result = await service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'consumer' });

    const users = occ.listData('users/');
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ kakaoId: '4242', role: 'consumer', providers: ['kakao'] });
    expect(occ.getData('kakaoIdentities/4242')).toMatchObject({ userId: result.user['id'] });
  });

  it('kakaoId로 찾은 기존 사용자는 연결 문서 없이 그대로 로그인한다', async () => {
    const { occ, service } = makeService();
    occ.seed('users/legacy-1', {
      id: 'legacy-1',
      kakaoId: '4242',
      role: 'consumer',
      storeId: null,
    });

    const result = await service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'consumer' });

    expect(result.user['id']).toBe('legacy-1');
    expect(occ.listData('users/')).toHaveLength(1);
    expect(occ.getData('kakaoIdentities/4242')).toBeUndefined();
  });

  it('문서 id로 쓸 수 없는 카카오 id는 사용자를 만들지 않는다', async () => {
    const { occ, service } = makeService('bad/id');

    await expect(
      service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'consumer' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(occ.listData('users/')).toHaveLength(0);
  });
});
