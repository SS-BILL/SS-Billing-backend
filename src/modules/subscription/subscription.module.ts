import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionEntity } from '../../db/entities/subscription.entity';
import { SubscriptionPlanEntity } from '../../db/entities/subscription-plan.entity';
import { PaymentLogEntity } from '../../db/entities/payment-log.entity';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SubscriptionEntity, SubscriptionPlanEntity, PaymentLogEntity])],
  providers: [SubscriptionService],
  controllers: [SubscriptionController],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
