import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { OperationIssuesModule } from '../operations/operation-issues.module';
import { RetentionService } from './retention.service';
import { RetentionAdminController } from './retention-admin.controller';

@Module({
  imports: [FirestoreModule, OperationIssuesModule],
  controllers: [RetentionAdminController],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
