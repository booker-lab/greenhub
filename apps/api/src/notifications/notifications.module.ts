import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveE2EProviderMode } from '../common/e2e-provider-mode';
import { OperationIssuesModule } from '../operations/operation-issues.module';
import { PaymentsModule } from '../payments/payments.module';
import { AligoClient } from './aligo.client';
import { E2EAligoClient } from './e2e-aligo.client';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

export function createAligoProvider(config: ConfigService): AligoClient {
  const mode = resolveE2EProviderMode(config);
  return mode.enabled
    ? (new E2EAligoClient(config) as unknown as AligoClient)
    : new AligoClient(config);
}

@Module({
  imports: [forwardRef(() => PaymentsModule), OperationIssuesModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: AligoClient,
      inject: [ConfigService],
      useFactory: createAligoProvider,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
