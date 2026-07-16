import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { RetentionService } from './retention.service';

@Module({
  imports: [FirestoreModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
