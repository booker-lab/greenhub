import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { GuardrailValidatorService } from './guardrail-validator.service';
import { VarietiesService } from '../varieties/varieties.service';
import { GenerateContentDto } from './dto/generate-content.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { Selection, Variety } from '@greenhub/shared';

// 상품 설명 생성은 판매자 상품 등록 화면만 쓴다. 유료 Gemini 호출이라 소비자·기사 토큰으로는 막는다.
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly validator: GuardrailValidatorService,
    private readonly varietiesService: VarietiesService,
  ) {}

  @Post('generate-content')
  async generateContent(@Body() dto: GenerateContentDto) {
    const variety = dto.varietyId
      ? ((await this.varietiesService.findOne(dto.varietyId)) as unknown as Variety)
      : null;

    const selection = dto.selection as unknown as Selection;
    const sellerNote = dto.sellerNote ?? '';

    const conflicts = this.validator.validate(sellerNote, selection, variety);
    const content = await this.aiService.generateProductContent({
      variety,
      selection,
      sellerNote,
      category: dto.category,
    });

    return { ...content, conflicts };
  }
}
