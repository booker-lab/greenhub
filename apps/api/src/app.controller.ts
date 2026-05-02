import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { FirestoreService } from './firestore/firestore.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly firestore: FirestoreService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('banner')
  async getBanner() {
    const snap = await this.firestore.doc('banners/main_hero').get();
    return snap.exists ? snap.data() : null;
  }
}
