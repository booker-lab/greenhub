import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BlockedReason, FinishReason, GenerateContentResponse, GoogleGenAI } from '@google/genai';
import {
  BadGatewayException,
  GatewayTimeoutException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AI_GENERATION_FAILED_MESSAGE,
  AI_TIMEOUT_MESSAGE,
  AI_UNAVAILABLE_MESSAGE,
  AiService,
  GEMINI_TIMEOUT_MS,
  type GenerateContentParams,
} from './ai.service';

jest.mock('@google/genai', () => ({
  ...jest.requireActual('@google/genai'),
  GoogleGenAI: jest.fn(),
}));

const GoogleGenAIMock = GoogleGenAI as jest.MockedClass<typeof GoogleGenAI>;
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

function buildResponse(fields: Partial<GenerateContentResponse>): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), fields);
}

function textResponse(text: string): GenerateContentResponse {
  return buildResponse({
    candidates: [
      { content: { role: 'model', parts: [{ text }] }, finishReason: FinishReason.STOP, index: 0 },
    ],
  });
}

function mockClient(responseText = '{"headline":"테스트 헤드라인","description":"테스트 설명"}') {
  const generateContent = jest.fn().mockResolvedValue(textResponse(responseText));

  GoogleGenAIMock.mockImplementation(
    () => ({ models: { generateContent } }) as unknown as GoogleGenAI,
  );

  return { generateContent };
}

describe('AiService', () => {
  beforeEach(() => {
    GoogleGenAIMock.mockReset();
  });

  it('키가 없어도 Nest 서비스 구성이 성공하고 실제 호출 시 설정 오류를 반환한다', async () => {
    const { config, get } = createConfig();
    const moduleRef = await Test.createTestingModule({
      providers: [AiService, { provide: ConfigService, useValue: config }],
    }).compile();

    try {
      const service = moduleRef.get(AiService);

      expect(service).toBeInstanceOf(AiService);
      expect(GoogleGenAIMock).not.toHaveBeenCalled();

      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const result = service.generateProductContent(params);
      await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(result).rejects.toThrow(AI_UNAVAILABLE_MESSAGE);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('GEMINI_API_KEY'));
      logError.mockRestore();
      expect(get).toHaveBeenCalledWith('GEMINI_API_KEY');
      expect(GoogleGenAIMock).not.toHaveBeenCalled();
    } finally {
      await moduleRef.close();
    }
  });

  it('생성자에서는 Gemini SDK 클라이언트를 초기화하지 않는다', () => {
    const { config, get } = createConfig(TEST_API_KEY);
    const { generateContent } = mockClient();

    new AiService(config);

    expect(get).not.toHaveBeenCalled();
    expect(GoogleGenAIMock).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('유효한 모의 키에서는 첫 AI 호출 때 클라이언트를 만들고 기존 응답을 반환한다', async () => {
    const { config } = createConfig(TEST_API_KEY);
    const { generateContent } = mockClient();
    const service = new AiService(config);

    await expect(service.generateProductContent(params)).resolves.toEqual({
      headline: '테스트 헤드라인',
      description: '테스트 설명',
    });

    expect(GoogleGenAIMock).toHaveBeenCalledTimes(1);
    expect(GoogleGenAIMock).toHaveBeenCalledWith({ apiKey: TEST_API_KEY, vertexai: false });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith({
      model: 'gemini-3-flash-preview',
      contents: expect.stringContaining('테스트 메모'),
      config: { abortSignal: expect.any(AbortSignal) },
    });
  });

  it('같은 서비스 인스턴스의 반복 호출에서는 클라이언트 초기화를 반복하지 않는다', async () => {
    const { config } = createConfig(TEST_API_KEY);
    const { generateContent } = mockClient();
    const service = new AiService(config);

    await service.generateProductContent(params);
    await service.generateProductContent({ ...params, sellerNote: '두 번째 테스트 메모' });

    expect(GoogleGenAIMock).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});

describe('AiService 오류 응답', () => {
  let logError: jest.SpyInstance;
  let logWarn: jest.SpyInstance;

  beforeEach(() => {
    GoogleGenAIMock.mockReset();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logError.mockRestore();
    logWarn.mockRestore();
    jest.useRealTimers();
  });

  it('Gemini 오류 원문을 응답에 넣지 않고 서버 로그에만 남긴다', async () => {
    const { config } = createConfig(TEST_API_KEY);
    const { generateContent } = mockClient();
    generateContent.mockRejectedValue(new Error('[429] quota exceeded for gemini-3-flash-preview'));
    const service = new AiService(config);

    const result = service.generateProductContent(params);
    await expect(result).rejects.toBeInstanceOf(BadGatewayException);
    await expect(result).rejects.toThrow(AI_GENERATION_FAILED_MESSAGE);
    await expect(result).rejects.not.toThrow(/quota|gemini/);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('quota exceeded'));
  });

  it('JSON이 없는 AI 응답 원문을 클라이언트에 돌려주지 않는다', async () => {
    const { config } = createConfig(TEST_API_KEY);
    mockClient('내부 지시문이 그대로 노출된 응답');
    const service = new AiService(config);

    const result = service.generateProductContent(params);
    await expect(result).rejects.toThrow(AI_GENERATION_FAILED_MESSAGE);
    await expect(result).rejects.not.toThrow(/내부 지시문/);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('내부 지시문'));
  });

  it('응답이 제한 시간을 넘으면 요청을 중단하고 504를 반환한다', async () => {
    jest.useFakeTimers();
    const { config } = createConfig(TEST_API_KEY);
    const { generateContent } = mockClient();
    generateContent.mockImplementation(() => new Promise(() => undefined));
    const service = new AiService(config);

    const result = service.generateProductContent(params);
    const settled = expect(result).rejects.toBeInstanceOf(GatewayTimeoutException);
    await jest.advanceTimersByTimeAsync(GEMINI_TIMEOUT_MS);
    await settled;
    await expect(result).rejects.toThrow(AI_TIMEOUT_MESSAGE);

    const { config: requestConfig } = generateContent.mock.calls[0][0] as {
      config: { abortSignal: AbortSignal };
    };
    expect(requestConfig.abortSignal.aborted).toBe(true);
  });

  it('프롬프트가 차단된 응답은 사유를 서버 로그에만 남기고 502를 반환한다', async () => {
    const { config } = createConfig(TEST_API_KEY);
    const { generateContent } = mockClient();
    generateContent.mockResolvedValue(
      buildResponse({
        candidates: [],
        promptFeedback: { blockReason: BlockedReason.SAFETY, blockReasonMessage: '차단 상세' },
      }),
    );
    const service = new AiService(config);

    const result = service.generateProductContent(params);
    await expect(result).rejects.toBeInstanceOf(BadGatewayException);
    await expect(result).rejects.toThrow(AI_GENERATION_FAILED_MESSAGE);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('Response was blocked due to SAFETY: 차단 상세'),
    );
  });

  it('첫 후보가 차단 사유로 끝나면 일부 본문이 있어도 쓰지 않고 502를 반환한다', async () => {
    const { config } = createConfig(TEST_API_KEY);
    const { generateContent } = mockClient();
    generateContent.mockResolvedValue(
      buildResponse({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: '{"headline":"부분","description":"부분"}' }],
            },
            finishReason: FinishReason.SAFETY,
            index: 0,
          },
        ],
      }),
    );
    const service = new AiService(config);

    const result = service.generateProductContent(params);
    await expect(result).rejects.toBeInstanceOf(BadGatewayException);
    await expect(result).rejects.toThrow(AI_GENERATION_FAILED_MESSAGE);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('Candidate was blocked due to SAFETY'),
    );
  });

  it('후보 본문이 비어 있으면 JSON 없음으로 처리해 502를 반환한다', async () => {
    const { config } = createConfig(TEST_API_KEY);
    const { generateContent } = mockClient();
    generateContent.mockResolvedValue(
      buildResponse({
        candidates: [{ content: { role: 'model', parts: [] }, finishReason: FinishReason.STOP }],
      }),
    );
    const service = new AiService(config);

    const result = service.generateProductContent(params);
    await expect(result).rejects.toBeInstanceOf(BadGatewayException);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('JSON을 찾을 수 없음'));
  });
});
