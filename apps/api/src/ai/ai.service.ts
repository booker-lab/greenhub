import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { buildProductContentPrompt } from './prompts/product-content.prompt';
import type { Selection, Variety } from '@greenhub/shared';

export interface GenerateContentParams {
  variety: Variety | null
  selection: Selection
  sellerNote: string
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

    const result = await this.model.generateContent(prompt);
    const text = result.response.text().trim();

    // JSON 코드블록 제거 후 파싱
    const jsonText = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

    try {
      const parsed = JSON.parse(jsonText);
      return {
        headline: parsed.headline ?? '',
        description: parsed.description ?? '',
      };
    } catch {
      throw new InternalServerErrorException('AI 응답을 파싱할 수 없습니다.');
    }
  }
}
