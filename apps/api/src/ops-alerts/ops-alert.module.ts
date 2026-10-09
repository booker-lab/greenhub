import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpsAlertService } from './ops-alert.service';
import { OpsDigestService } from './ops-digest.service';

// 운영 알림은 여러 모듈(운영 이슈·알림톡·정기 작업)이 쓰므로 전역으로 둔다.
@Global()
@Module({
  providers: [
    {
      provide: OpsAlertService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new OpsAlertService(config),
    },
    OpsDigestService,
  ],
  exports: [OpsAlertService],
})
export class OpsAlertModule {}
