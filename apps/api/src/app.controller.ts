import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { FirestoreService } from './firestore/firestore.service';

// Firestore 확인이 이보다 오래 걸리면 실패로 본다(Railway 헬스체크 제한 30초 안에서 여러 번 재시도되게).
const HEALTH_FIRESTORE_TIMEOUT_MS = 5_000;

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

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
  // Firestore를 문서 한 건 읽어 확인한다. 읽지 못하면 503을 돌려 15분 uptime 점검과
  // Railway 배포 헬스체크가 잡게 한다(프로세스는 살아 있지만 주문을 못 받는 상태).
  @Get('health')
  async health(): Promise<{ status: string; timestamp: string; commit: string | null }> {
    const commit = process.env.RAILWAY_GIT_COMMIT_SHA?.trim();
    const body = {
      timestamp: new Date().toISOString(),
      commit: commit && /^[0-9a-f]{7,40}$/.test(commit) ? commit : null,
    };
    if (!(await this.firestoreReachable())) {
      throw new ServiceUnavailableException({ status: 'unavailable', firestore: 'error', ...body });
    }
    return { status: 'ok', ...body };
  }

  @Get('banner')
  async getBanner() {
    const snap = await this.firestore.doc('banners/main_hero').get();
    return snap.exists ? snap.data() : null;
  }

  private async firestoreReachable(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // 없는 문서여도 읽기는 성공한다. 연결·인증이 되는지만 본다.
      await Promise.race([
        this.firestore.doc('_health/ping').get(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), HEALTH_FIRESTORE_TIMEOUT_MS);
        }),
      ]);
      return true;
    } catch (error) {
      this.logger.warn(`health.firestore 실패: ${error instanceof Error ? error.name : 'unknown'}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
