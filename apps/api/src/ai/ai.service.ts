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

    // JSON 코드블록 제거
    const jsonText = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

    // Gemini가 JSON 문자열 안에 실제 줄바꿈을 출력할 경우 이스케이프 처리
    const fixedJson = jsonText.replace(/"[^"]*"/gs, (m) =>
      m.replace(/\n/g, '\\n').replace(/\r/g, ''),
    );

    try {
      const parsed = JSON.parse(fixedJson);
      return {
        headline: parsed.headline ?? '',
        description: parsed.description ?? '',
      };
    } catch {
      throw new InternalServerErrorException(`AI 응답 파싱 실패. 원문: ${jsonText.slice(0, 200)}`);
    }
  }
}
