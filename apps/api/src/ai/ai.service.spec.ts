import { ConfigService } from '@nestjs/config';
import { AiService, type GenerateContentParams } from './ai.service';

describe('AiService', () => {
  it('GEMINI_API_KEY가 없어도 생성자에서 실패하지 않고 호출 시 설정 오류를 반환한다', async () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new AiService(config);
    const params = {
      variety: null,
      selection: {
        colors: [],
        fragrance: 'none',
        bloomCondition: 'bud',
        stemType: '외대',
      },
      sellerNote: '',
    } as GenerateContentParams;

    await expect(service.generateProductContent(params)).rejects.toThrow(
      'GEMINI_API_KEY가 설정되지 않았습니다.',
    );
    expect(config.get).toHaveBeenCalledWith('GEMINI_API_KEY');
  });
});
