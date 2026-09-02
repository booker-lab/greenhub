import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AiService, type GenerateContentParams } from './ai.service';

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(),
}));

const GoogleGenerativeAIMock = GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>;
const TEST_API_KEY = 'test-only-gemini-key';
const params: GenerateContentParams = {
  variety: null,
  selection: {
    colors: [],
    fragrance: 'none',
    bloomCondition: 'bud',
    stemType: '외대',
    bundleUnit: '1단',
  },
  sellerNote: '테스트 메모',
};

function createConfig(apiKey?: string) {
  const get = jest.fn((key: string) => (key === 'GEMINI_API_KEY' ? apiKey : undefined));
  return { config: { get } as unknown as ConfigService, get };
}

function mockModel(responseText = '{"headline":"테스트 헤드라인","description":"테스트 설명"}') {
  const generateContent = jest.fn().mockResolvedValue({
    response: { text: jest.fn().mockReturnValue(responseText) },
  });
  const getGenerativeModel = jest.fn().mockReturnValue({ generateContent });

  GoogleGenerativeAIMock.mockImplementation(
    () => ({ getGenerativeModel }) as unknown as GoogleGenerativeAI,
  );

  return { generateContent, getGenerativeModel };
}

describe('AiService', () => {
  beforeEach(() => {
    GoogleGenerativeAIMock.mockReset();
  });

  it('키가 없어도 Nest 서비스 구성이 성공하고 실제 호출 시 설정 오류를 반환한다', async () => {
    const { config, get } = createConfig();
    const moduleRef = await Test.createTestingModule({
      providers: [AiService, { provide: ConfigService, useValue: config }],
    }).compile();

    try {
      const service = moduleRef.get(AiService);

      expect(service).toBeInstanceOf(AiService);
      expect(GoogleGenerativeAIMock).not.toHaveBeenCalled();

      await expect(service.generateProductContent(params)).rejects.toThrow(
        'GEMINI_API_KEY가 설정되지 않았습니다.',
      );
      expect(get).toHaveBeenCalledWith('GEMINI_API_KEY');
      expect(GoogleGenerativeAIMock).not.toHaveBeenCalled();
    } finally {
      await moduleRef.close();
    }
  });

  it('생성자에서는 Gemini SDK와 모델을 초기화하지 않는다', () => {
    const { config, get } = createConfig(TEST_API_KEY);
    const { getGenerativeModel } = mockModel();

    new AiService(config);

    expect(get).not.toHaveBeenCalled();
    expect(GoogleGenerativeAIMock).not.toHaveBeenCalled();
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it('유효한 모의 키에서는 첫 AI 호출 때 모델을 만들고 기존 응답을 반환한다', async () => {
    const { config } = createConfig(TEST_API_KEY);
    const { generateContent, getGenerativeModel } = mockModel();
    const service = new AiService(config);

    await expect(service.generateProductContent(params)).resolves.toEqual({
      headline: '테스트 헤드라인',
      description: '테스트 설명',
    });

    expect(GoogleGenerativeAIMock).toHaveBeenCalledTimes(1);
    expect(GoogleGenerativeAIMock).toHaveBeenCalledWith(TEST_API_KEY);
    expect(getGenerativeModel).toHaveBeenCalledTimes(1);
    expect(getGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-3-flash-preview' });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith(expect.stringContaining('테스트 메모'));
  });

  it('같은 서비스 인스턴스의 반복 호출에서는 모델 초기화를 반복하지 않는다', async () => {
    const { config } = createConfig(TEST_API_KEY);
    const { generateContent, getGenerativeModel } = mockModel();
    const service = new AiService(config);

    await service.generateProductContent(params);
    await service.generateProductContent({ ...params, sellerNote: '두 번째 테스트 메모' });

    expect(GoogleGenerativeAIMock).toHaveBeenCalledTimes(1);
    expect(getGenerativeModel).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
