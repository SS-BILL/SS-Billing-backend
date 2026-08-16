import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionEntity } from '../../db/entities/subscription.entity';
import { PaymentLogEntity } from '../../db/entities/payment-log.entity';
import { IndexerCursorEntity } from '../../db/entities/indexer-cursor.entity';
import { StellarService } from './stellar.service';
import { BillingScheduler } from './billing.scheduler';
import { BlockchainIndexer } from './blockchain.indexer';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionEntity, PaymentLogEntity, IndexerCursorEntity]),
    WebhookModule,
  ],
  providers: [StellarService, BillingScheduler, BlockchainIndexer],
  exports: [StellarService],
})
export class BillingModule {}
