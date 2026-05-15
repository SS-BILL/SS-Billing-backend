import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionEntity, SubscriptionStatus } from '../../db/entities/subscription.entity';
import { PaymentLogEntity } from '../../db/entities/payment-log.entity';
import { StellarService } from './stellar.service';
import { WebhookService } from '../webhook/webhook.service';

@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(
    @InjectRepository(SubscriptionEntity) private subRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PaymentLogEntity) private paymentRepo: Repository<PaymentLogEntity>,
    private stellar: StellarService,
    private webhook: WebhookService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processDueBillings() {
    const due = await this.subRepo
      .createQueryBuilder('s')
      .where('s.status IN (:...statuses)', {
        statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE_PERIOD],
      })
      .andWhere('s.next_billing_at <= NOW()')
      .leftJoinAndSelect('s.plan', 'plan')
      .getMany();

    this.logger.log(`Processing ${due.length} due subscriptions`);

    for (const sub of due) {
      await this.processSingle(sub);
    }
  }

  private async processSingle(sub: SubscriptionEntity) {
    try {
      await this.stellar.invokeContract('process_payment', [
        this.stellar.addressToScVal(sub.subscriberAddress),
        this.stellar.u64ToScVal(BigInt(sub.plan.onChainPlanId ?? 0)),
      ]);

      await this.paymentRepo.save(
        this.paymentRepo.create({
          subscriptionId: sub.id,
          subscriberAddress: sub.subscriberAddress,
          merchantAddress: sub.plan.merchantId,
          amount: sub.plan.amount,
          success: true,
        }),
      );

      const interval = Number(sub.plan.interval) * 1000;
      await this.subRepo.update(sub.id, {
        status: SubscriptionStatus.ACTIVE,
        retries: 0,
        nextBillingAt: new Date(Date.now() + interval),
      });

      await this.webhook.dispatch(sub.plan.merchantId, 'subscription.payment.success', {
        subscriptionId: sub.id,
        subscriberAddress: sub.subscriberAddress,
        amount: sub.plan.amount,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      const retries = sub.retries + 1;
      const maxRetries = sub.plan.retryLimit;

      await this.paymentRepo.save(
        this.paymentRepo.create({
          subscriptionId: sub.id,
          subscriberAddress: sub.subscriberAddress,
          merchantAddress: sub.plan.merchantId,
          amount: sub.plan.amount,
          success: false,
          errorMessage: err.message,
        }),
      );

      if (retries >= maxRetries) {
        await this.subRepo.update(sub.id, { status: SubscriptionStatus.FAILED, retries });
        await this.webhook.dispatch(sub.plan.merchantId, 'subscription.payment.failed', {
          subscriptionId: sub.id,
          retries,
        });
      } else {
        await this.subRepo.update(sub.id, { status: SubscriptionStatus.GRACE_PERIOD, retries });
      }

      this.logger.warn(`Billing failed for ${sub.id}: ${err.message}`);
    }
  }
}
