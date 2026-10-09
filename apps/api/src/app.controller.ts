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

  // commit: 배포 뒤 실행 중인 코드가 승인한 SHA인지 확인하는 용도(Railway가 GitHub 배포에 넣는 값).
  // CLI 업로드처럼 값이 없으면 null.
  @Get('health')
  health(): { status: string; timestamp: string; commit: string | null } {
    const commit = process.env.RAILWAY_GIT_COMMIT_SHA?.trim();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      commit: commit && /^[0-9a-f]{7,40}$/.test(commit) ? commit : null,
    };
  }

  @Get('banner')
  async getBanner() {
    const snap = await this.firestore.doc('banners/main_hero').get();
    return snap.exists ? snap.data() : null;
  }
}
