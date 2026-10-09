import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';
import { UpdateMeDto } from './update-me.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

const validRegister = {
  email: 'user@example.com',
  password: 'password123',
  name: '김그린',
  role: 'consumer',
};

async function errorProperties(dto: object) {
  const errors = await validate(dto, options);
  return errors.map((error) => error.property);
}

describe('프로필 이름·전화번호 입력 제약 (RegisterDto, UpdateMeDto)', () => {
  it.each([
    '김그린',
    'Kim Green',
    '홍길동2',
    '가'.repeat(20),
  ])('정상 이름(%s)은 통과한다', async (name) => {
    await expect(
      errorProperties(plainToInstance(RegisterDto, { ...validRegister, name })),
    ).resolves.toEqual([]);
    await expect(errorProperties(plainToInstance(UpdateMeDto, { name }))).resolves.toEqual([]);
  });

  it.each([
    ['20자 초과', '가'.repeat(21)],
    ['줄바꿈', '김그린\n결제오류'],
    ['탭', '김\t그린'],
    ['zero-width', '김\u200B그린'],
    ['양방향 제어', '김\u202E그린'],
    ['URL', '환불 http://x.test'],
    ['www', 'www.example'],
    ['도메인', 'bit.ly/abc'],
  ])('%s 이름은 거부한다', async (_label, name) => {
    await expect(
      errorProperties(plainToInstance(RegisterDto, { ...validRegister, name })),
    ).resolves.toEqual(['name']);
    await expect(errorProperties(plainToInstance(UpdateMeDto, { name }))).resolves.toEqual([
      'name',
    ]);
  });

  it.each([
    '01012345678',
    '010-1234-5678',
    '+82 10-1234-5678',
  ])('전화번호 1개(%s)는 통과한다', async (phone) => {
    await expect(
      errorProperties(plainToInstance(RegisterDto, { ...validRegister, phone })),
    ).resolves.toEqual([]);
    await expect(errorProperties(plainToInstance(UpdateMeDto, { phone }))).resolves.toEqual([]);
  });

  it.each([
    '01012345678,01087654321',
    '010-1234-5678\n',
    '010',
  ])('여러 번호·형식 밖 전화번호(%j)는 거부한다', async (phone) => {
    await expect(
      errorProperties(plainToInstance(RegisterDto, { ...validRegister, phone })),
    ).resolves.toEqual(['phone']);
    await expect(errorProperties(plainToInstance(UpdateMeDto, { phone }))).resolves.toEqual([
      'phone',
    ]);
  });

  it('UpdateMeDto는 필드를 생략할 수 있다', async () => {
    await expect(errorProperties(plainToInstance(UpdateMeDto, {}))).resolves.toEqual([]);
  });
});
