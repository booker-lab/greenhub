import { Module } from '@nestjs/common';
import { VarietiesController } from './varieties.controller';
import { VarietiesService } from './varieties.service';

@Module({
  controllers: [VarietiesController],
  providers: [VarietiesService],
  exports: [VarietiesService],
})
export class VarietiesModule {}
