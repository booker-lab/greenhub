import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { GuardrailValidatorService } from './guardrail-validator.service';
import { VarietiesModule } from '../varieties/varieties.module';

@Module({
  imports: [VarietiesModule],
  controllers: [AiController],
  providers: [AiService, GuardrailValidatorService],
})
export class AiModule {}
