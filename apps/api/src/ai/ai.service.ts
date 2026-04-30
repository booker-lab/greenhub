import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { buildProductContentPrompt } from './prompts/product-content.prompt';
import type { Selection, Variety } from '@greenhub/shared';

export interface GenerateContentParams {
  variety: Variety | null
  selection: Selection
  sellerNote: string
  category?: string
}

export interface GenerateContentResult {
  headline: string
  description: string
}

@Injectable()
export class AiService {
  private readonly model: GenerativeModel;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) throw new InternalServerErrorException('GEMINI_API_KEY가 설정되지 않았습니다.');
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  }

  async generateProductContent(params: GenerateContentParams): Promise<GenerateContentResult> {
    const prompt = buildProductContentPrompt(params);

    let text: string;
    try {
      const result = await this.model.generateContent(prompt);
      text = result.response.text().trim();
    } catch (e: any) {
      throw new InternalServerErrorException(`Gemini 호출 실패: ${e?.message ?? e}`);
    }

    // 앞뒤 설명 텍스트·코드블록과 무관하게 JSON 객체 블록 직접 추출
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new InternalServerErrorException(
        `AI 응답에서 JSON을 찾을 수 없습니다. 원문: ${text.slice(0, 200)}`,
      );
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
        throw new InternalServerErrorException(
          `AI 응답 파싱 실패. 원문: ${jsonMatch[0].slice(0, 200)}`,
        );
      }
    }

    return {
      headline: typeof parsed.headline === 'string' ? parsed.headline : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
    };
  }
}
