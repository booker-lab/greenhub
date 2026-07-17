import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { OperationIssuesModule } from '../operations/operation-issues.module';
import { RetentionService } from './retention.service';

@Module({
  imports: [FirestoreModule, OperationIssuesModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
