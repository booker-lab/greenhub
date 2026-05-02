import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { GuardrailValidatorService } from './guardrail-validator.service';
import { VarietiesService } from '../varieties/varieties.service';
import { GenerateContentDto } from './dto/generate-content.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { Selection, Variety } from '@greenhub/shared';

@Controller('ai')
@UseGuards(JwtAuthGuard)
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
