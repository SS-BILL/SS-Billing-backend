import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookDeliveryEntity } from '../../db/entities/webhook-delivery.entity';
import { MerchantEntity } from '../../db/entities/merchant.entity';
import { WebhookService } from './webhook.service';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookDeliveryEntity, MerchantEntity])],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
