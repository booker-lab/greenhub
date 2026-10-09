import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiQuotaService } from './ai-quota.service';
import { GuardrailValidatorService } from './guardrail-validator.service';
import { VarietiesService } from '../varieties/varieties.service';
import { GenerateContentDto } from './dto/generate-content.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import type { Selection, Variety } from '@greenhub/shared';

// 판매자 상품 등록 화면의 AI 문구 생성 — 판매자·관리자만, 사용자별 일일 한도 적용
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly quota: AiQuotaService,
    private readonly validator: GuardrailValidatorService,
    private readonly varietiesService: VarietiesService,
  ) {}

  @Post('generate-content')
  async generateContent(@CurrentUser() user: JwtPayload, @Body() dto: GenerateContentDto) {
    const variety = dto.varietyId
      ? ((await this.varietiesService.findOne(dto.varietyId)) as unknown as Variety)
      : null;

    const selection = dto.selection as unknown as Selection;
    const sellerNote = dto.sellerNote ?? '';

    const conflicts = this.validator.validate(sellerNote, selection, variety);
    await this.quota.consume(user.sub);
    const content = await this.aiService.generateProductContent({
      variety,
      selection,
      sellerNote,
      category: dto.category,
    });

    return { ...content, conflicts };
  }
}
