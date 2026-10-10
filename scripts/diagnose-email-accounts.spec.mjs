import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHECK_PASSWORD_ENV,
  describeEmailAccount,
  findPasswordMatches,
  formatAccountRow,
  isEmailAccount,
  isKakaoOnlyAccount,
  maskEmail,
  passwordHashState,
  resolveCheckPassword,
} from './diagnose-email-accounts.mjs';

const user = {
  email: 'alice.kim@example.test',
  name: '김앨리스',
  phone: '010-1234-5678',
  role: 'seller',
  storeId: 'store-abcdefghijk',
  providers: ['email'],
  passwordHash: `$2b$12$${'x'.repeat(53)}`,
  suspended: false,
};

test('이메일은 첫 글자와 도메인만 남기고 마스킹한다', () => {
  assert.equal(maskEmail('alice.kim@example.test'), 'a***@example.test');
  assert.equal(maskEmail(' 홍길동@example.test '), '홍***@example.test');
  assert.equal(maskEmail('no-at-sign'), '***');
  assert.equal(maskEmail('@example.test'), '***');
  assert.equal(maskEmail('alice@'), '***');
  assert.equal(maskEmail(undefined), '(없음)');
  assert.equal(maskEmail(''), '(없음)');
});

test('출력 행에는 원본 이메일·이름·전화번호·해시가 없다', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const row = describeEmailAccount(id, user);
  assert.deepEqual(row, {
    id: '0f8fad5b',
    email: 'a***@example.test',
    role: 'seller',
    storeId: 'store-ab',
    hash: 'bcrypt',
    suspended: false,
  });
  const line = formatAccountRow(row);
  for (const secret of [user.email, 'alice.kim', user.name, user.phone, user.passwordHash, id]) {
    assert.ok(!line.includes(secret), `출력에 원본 값이 있으면 안 된다: ${secret.length}자`);
  }
  assert.ok(!line.includes('$2b$'), '해시 접두어도 출력하지 않는다');
});

test('해시 상태와 provider 분류', () => {
  assert.equal(passwordHashState(user.passwordHash), 'bcrypt');
  assert.equal(passwordHashState(undefined), 'none');
  assert.equal(passwordHashState('plain'), 'other');
  assert.equal(isEmailAccount(user), true);
  assert.equal(isEmailAccount({ providers: ['kakao'] }), false);
  assert.equal(isKakaoOnlyAccount({ providers: ['kakao'] }), true);
  assert.equal(isKakaoOnlyAccount({ providers: ['kakao', 'email'] }), false);
  assert.equal(isEmailAccount({ providers: 'email' }), false);
});

test('지정 비밀번호가 없으면 어떤 비밀번호도 대조하지 않는다', async () => {
  let calls = 0;
  const compare = async () => {
    calls++;
    return true;
  };
  const accounts = [{ id: 'u1', user }];
  assert.deepEqual(await findPasswordMatches(accounts, null, compare), []);
  assert.deepEqual(await findPasswordMatches(accounts, '', compare), []);
  assert.equal(calls, 0);
});

test('운영자가 준 값 하나만 bcrypt 해시와 대조하고, 결과는 마스킹한다', async () => {
  const supplied = 'operator-supplied-value';
  const seen = [];
  const compare = async (pw, hash) => {
    seen.push(pw);
    return hash === user.passwordHash;
  };
  const accounts = [
    { id: 'u1-aaaaaaaaaa', user },
    { id: 'u2-bbbbbbbbbb', user: { ...user, email: 'bob@example.test', passwordHash: undefined } },
    { id: 'u3-cccccccccc', user: { ...user, email: 'carol@example.test', passwordHash: 'x' } },
  ];
  const matches = await findPasswordMatches(accounts, supplied, compare);
  assert.deepEqual(seen, [supplied]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].email, 'a***@example.test');
  assert.ok(!JSON.stringify(matches).includes(supplied));
});

test('대조 값은 지정된 환경 변수에서만 읽는다', () => {
  assert.equal(CHECK_PASSWORD_ENV, 'DIAGNOSE_CHECK_PASSWORD');
  assert.equal(resolveCheckPassword({}), null);
  assert.equal(resolveCheckPassword({ [CHECK_PASSWORD_ENV]: '' }), null);
  assert.equal(resolveCheckPassword({ [CHECK_PASSWORD_ENV]: 'v' }), 'v');
});
