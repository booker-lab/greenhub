import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { buildProductContentPrompt } from './prompts/product-content.prompt';
import type { Selection, Variety } from '@greenhub/shared';

export interface GenerateContentParams {
  variety: Variety | null;
  selection: Selection;
  sellerNote: string;
  category?: string;
}

export interface GenerateContentResult {
  headline: string;
  description: string;
}

/** Gemini 응답 대기 상한. 넘기면 요청을 중단하고 504를 반환한다. */
export const GEMINI_TIMEOUT_MS = 25_000;
export const AI_UNAVAILABLE_MESSAGE = 'AI 기능을 지금 사용할 수 없습니다.';
export const AI_GENERATION_FAILED_MESSAGE =
  'AI 콘텐츠 생성에 실패했습니다. 잠시 후 다시 시도해주세요.';
export const AI_TIMEOUT_MESSAGE = 'AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private model?: GenerativeModel;

  constructor(private readonly config: ConfigService) {}

  async generateProductContent(params: GenerateContentParams): Promise<GenerateContentResult> {
    const prompt = buildProductContentPrompt(params);
    const model = this.getModel();

    let text: string;
    try {
      const result = await this.callWithTimeout(model, prompt);
      text = result.response.text().trim();
    } catch (e: unknown) {
      if (e instanceof GatewayTimeoutException) {
        this.logger.warn(`Gemini 호출 시간 초과 (${GEMINI_TIMEOUT_MS}ms)`);
        throw e;
      }
      this.logger.error(`Gemini 호출 실패: ${e instanceof Error ? e.message : String(e)}`);
      throw new BadGatewayException(AI_GENERATION_FAILED_MESSAGE);
    }

    // 앞뒤 설명 텍스트·코드블록과 무관하게 JSON 객체 블록 직접 추출
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.error(`AI 응답에서 JSON을 찾을 수 없음. 원문: ${text.slice(0, 200)}`);
      throw new BadGatewayException(AI_GENERATION_FAILED_MESSAGE);
    }

    let parsed: { headline?: unknown; description?: unknown };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // 문자열 값 내 리터럴 줄바꿈 이스케이프 후 재시도
      // ("(?:[^"\\]|\\.)*") 는 \" 포함 JSON 문자열을 올바르게 매칭함
      const fixed = jsonMatch[0].replace(/("(?:[^"\\]|\\.)*")/gs, (m) =>
        m.replace(/\n/g, '\\n').replace(/\r/g, ''),
      );
      try {
        parsed = JSON.parse(fixed);
      } catch {
        this.logger.error(`AI 응답 파싱 실패. 원문: ${jsonMatch[0].slice(0, 200)}`);
        throw new BadGatewayException(AI_GENERATION_FAILED_MESSAGE);
      }
    }

    return {
      headline: typeof parsed.headline === 'string' ? parsed.headline : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
    };
  }

  private getModel(): GenerativeModel {
    if (this.model) return this.model;

    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.error('GEMINI_API_KEY가 설정되지 않았습니다.');
      throw new ServiceUnavailableException(AI_UNAVAILABLE_MESSAGE);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    return this.model;
  }

  private async callWithTimeout(model: GenerativeModel, prompt: string) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new GatewayTimeoutException(AI_TIMEOUT_MESSAGE));
      }, GEMINI_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        model.generateContent(prompt, { signal: controller.signal }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
