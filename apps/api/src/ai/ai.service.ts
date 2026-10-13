import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FinishReason, GoogleGenAI, type GenerateContentResponse } from '@google/genai';
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

const GEMINI_MODEL = 'gemini-3-flash-preview';

/** 첫 후보가 이 사유로 끝나면 본문을 쓰지 않고 생성 실패로 처리한다. */
const BLOCKED_FINISH_REASONS: ReadonlySet<FinishReason> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.LANGUAGE,
]);

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client?: GoogleGenAI;

  constructor(private readonly config: ConfigService) {}

  async generateProductContent(params: GenerateContentParams): Promise<GenerateContentResult> {
    const prompt = buildProductContentPrompt(params);
    const client = this.getClient();

    let text: string;
    try {
      const response = await this.callWithTimeout(client, prompt);
      text = extractResponseText(response).trim();
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

  private getClient(): GoogleGenAI {
    if (this.client) return this.client;

    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.error('GEMINI_API_KEY가 설정되지 않았습니다.');
      throw new ServiceUnavailableException(AI_UNAVAILABLE_MESSAGE);
    }

    // 환경 변수(GOOGLE_GENAI_USE_VERTEXAI 등)와 무관하게 Gemini API 키 방식으로 고정한다.
    this.client = new GoogleGenAI({ apiKey, vertexai: false });
    return this.client;
  }

  private async callWithTimeout(
    client: GoogleGenAI,
    prompt: string,
  ): Promise<GenerateContentResponse> {
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
        client.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: { abortSignal: controller.signal },
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 응답에서 첫 후보의 텍스트를 꺼낸다. 프롬프트가 차단됐거나 첫 후보가 차단 사유로 끝났으면
 * 사유를 담은 오류를 던지고, 텍스트가 없으면 빈 문자열을 돌려준다.
 */
function extractResponseText(response: GenerateContentResponse): string {
  const candidate = response.candidates?.[0];
  if (!candidate) {
    const feedback = response.promptFeedback;
    if (feedback) {
      const reason = feedback.blockReason ? ` due to ${feedback.blockReason}` : '';
      const detail = feedback.blockReasonMessage ? `: ${feedback.blockReasonMessage}` : '';
      throw new Error(`Text not available. Response was blocked${reason}${detail}`);
    }
    return '';
  }
  if (candidate.finishReason && BLOCKED_FINISH_REASONS.has(candidate.finishReason)) {
    const detail = candidate.finishMessage ? `: ${candidate.finishMessage}` : '';
    throw new Error(`Candidate was blocked due to ${candidate.finishReason}${detail}`);
  }
  return response.text ?? '';
}
