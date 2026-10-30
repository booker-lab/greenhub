import { Module } from '@nestjs/common';
import {
  AdminEngagementController,
  MyEngagementController,
  PublicEngagementController,
  SellerEngagementController,
} from './engagement.controller';
import { EngagementService } from './engagement.service';
import { ReviewsService } from './reviews.service';

@Module({
  controllers: [
    PublicEngagementController,
    MyEngagementController,
    SellerEngagementController,
    AdminEngagementController,
  ],
  providers: [ReviewsService, EngagementService],
  exports: [EngagementService],
})
export class EngagementModule {}
