import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KakaoLoginDto } from './kakao-login.dto';

describe('KakaoLoginDto', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };

  it('kakaoAccessToken과 허용된 targetRole만 받는다', async () => {
    const dto = plainToInstance(KakaoLoginDto, {
      kakaoAccessToken: 'access-token',
      targetRole: 'consumer',
    });

    await expect(validate(dto, options)).resolves.toHaveLength(0);
  });

  it('kakaoAccessToken이 없으면 실패한다', async () => {
    const dto = plainToInstance(KakaoLoginDto, { targetRole: 'consumer' });

    await expect(validate(dto, options)).resolves.toEqual([
      expect.objectContaining({ property: 'kakaoAccessToken' }),
    ]);
  });

  it('클라이언트가 보낸 kakaoId, email, name은 계약 밖 필드로 거부한다', async () => {
    const dto = plainToInstance(KakaoLoginDto, {
      kakaoAccessToken: 'access-token',
      kakaoId: 'forged',
      email: 'forged@example.com',
      name: '위조사용자',
    });

    await expect(validate(dto, options)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'kakaoId' }),
        expect.objectContaining({ property: 'email' }),
        expect.objectContaining({ property: 'name' }),
      ]),
    );
  });
});
