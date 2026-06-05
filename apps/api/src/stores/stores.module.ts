import { Module } from '@nestjs/common';
import { PublicStoresController, StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({
  controllers: [StoresController, PublicStoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
