import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionEntity, SubscriptionStatus } from '../../db/entities/subscription.entity';
import { PaymentLogEntity } from '../../db/entities/payment-log.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(SubscriptionEntity) private subRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PaymentLogEntity) private paymentRepo: Repository<PaymentLogEntity>,
  ) {}

  async getMerchantStats(merchantId: string) {
    const [active, paused, cancelled, failed] = await Promise.all([
      this.subRepo.count({ where: { plan: { merchantId }, status: SubscriptionStatus.ACTIVE } }),
      this.subRepo.count({ where: { plan: { merchantId }, status: SubscriptionStatus.PAUSED } }),
      this.subRepo.count({ where: { plan: { merchantId }, status: SubscriptionStatus.CANCELLED } }),
      this.subRepo.count({ where: { plan: { merchantId }, status: SubscriptionStatus.FAILED } }),
    ]);

    const mrr = await this.paymentRepo
      .createQueryBuilder('p')
      .select('SUM(CAST(p.amount AS BIGINT))', 'total')
      .innerJoin('p.subscription', 's')
      .innerJoin('s.plan', 'plan')
      .where('plan.merchantId = :merchantId', { merchantId })
      .andWhere('p.success = true')
      .andWhere("p.created_at >= NOW() - INTERVAL '30 days'")
      .getRawOne<{ total: string }>();

    const total = await this.subRepo.count({ where: { plan: { merchantId } } });
    const churnRate = total > 0 ? ((cancelled + failed) / total) * 100 : 0;

    return {
      activeSubscriptions: active,
      pausedSubscriptions: paused,
      cancelledSubscriptions: cancelled,
      failedSubscriptions: failed,
      mrr: mrr?.total ?? '0',
      arr: String(BigInt(mrr?.total ?? '0') * 12n),
      churnRate: churnRate.toFixed(2),
    };
  }

  async getRevenueTimeline(merchantId: string, days = 30) {
    return this.paymentRepo
      .createQueryBuilder('p')
      .select("DATE_TRUNC('day', p.created_at)", 'date')
      .addSelect('SUM(CAST(p.amount AS BIGINT))', 'revenue')
      .addSelect('COUNT(*)', 'count')
      .innerJoin('p.subscription', 's')
      .innerJoin('s.plan', 'plan')
      .where('plan.merchantId = :merchantId', { merchantId })
      .andWhere('p.success = true')
      .andWhere('p.created_at >= NOW() - INTERVAL :days', { days: `${days} days` })
      .groupBy("DATE_TRUNC('day', p.created_at)")
      .orderBy('date', 'ASC')
      .getRawMany();
  }
}
