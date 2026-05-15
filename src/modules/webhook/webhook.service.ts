import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import axios from 'axios';
import { WebhookDeliveryEntity, WebhookStatus } from '../../db/entities/webhook-delivery.entity';
import { MerchantEntity } from '../../db/entities/merchant.entity';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(WebhookDeliveryEntity) private deliveryRepo: Repository<WebhookDeliveryEntity>,
    @InjectRepository(MerchantEntity) private merchantRepo: Repository<MerchantEntity>,
  ) {}

  async dispatch(merchantId: string, event: string, payload: Record<string, unknown>) {
    const merchant = await this.merchantRepo.findOne({ where: { id: merchantId } });
    if (!merchant?.webhookUrl) return;

    const delivery = this.deliveryRepo.create({
      merchantId,
      event,
      payload,
      webhookUrl: merchant.webhookUrl,
    });
    await this.deliveryRepo.save(delivery);
    await this.send(delivery, merchant.webhookSecret);
  }

  private async send(delivery: WebhookDeliveryEntity, secret?: string | null) {
    const body = JSON.stringify({ event: delivery.event, ...delivery.payload });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (secret) {
      headers['x-webhook-signature'] = createHmac('sha256', secret).update(body).digest('hex');
    }

    try {
      const res = await axios.post(delivery.webhookUrl, body, { headers, timeout: 5000 });
      await this.deliveryRepo.update(delivery.id, {
        status: WebhookStatus.DELIVERED,
        responseCode: res.status,
        attempts: delivery.attempts + 1,
      });
    } catch (err: any) {
      const attempts = delivery.attempts + 1;
      const failed = attempts >= 5;
      await this.deliveryRepo.update(delivery.id, {
        status: failed ? WebhookStatus.FAILED : WebhookStatus.PENDING,
        attempts,
        nextRetryAt: failed ? undefined : new Date(Date.now() + attempts * 60_000),
      });
      this.logger.warn(`Webhook delivery ${delivery.id} failed (attempt ${attempts})`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryFailed() {
    const pending = await this.deliveryRepo
      .createQueryBuilder('d')
      .where('d.status = :status', { status: WebhookStatus.PENDING })
      .andWhere('d.next_retry_at <= NOW()')
      .andWhere('d.attempts < 5')
      .leftJoinAndSelect('d.merchant', 'merchant')
      .limit(50)
      .getMany();

    for (const delivery of pending) {
      const merchant = await this.merchantRepo.findOne({ where: { id: delivery.merchantId } });
      await this.send(delivery, merchant?.webhookSecret);
    }
  }
}
