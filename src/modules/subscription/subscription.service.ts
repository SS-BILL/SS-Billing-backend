import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionEntity, SubscriptionStatus } from '../../db/entities/subscription.entity';
import { SubscriptionPlanEntity } from '../../db/entities/subscription-plan.entity';
import { PaymentLogEntity } from '../../db/entities/payment-log.entity';
import { CreateSubscriptionDto } from './subscription.dto';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(SubscriptionEntity) private repo: Repository<SubscriptionEntity>,
    @InjectRepository(SubscriptionPlanEntity) private planRepo: Repository<SubscriptionPlanEntity>,
    @InjectRepository(PaymentLogEntity) private paymentRepo: Repository<PaymentLogEntity>,
  ) {}

  async create(dto: CreateSubscriptionDto): Promise<SubscriptionEntity> {
    const plan = await this.planRepo.findOne({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const now = new Date();
    const sub = this.repo.create({
      subscriberAddress: dto.subscriberAddress,
      planId: dto.planId,
      nextBillingAt: new Date(now.getTime() + Number(plan.interval) * 1000),
      status: SubscriptionStatus.ACTIVE,
      startedAt: now,
    });
    return this.repo.save(sub);
  }

  async findById(id: string): Promise<SubscriptionEntity> {
    const sub = await this.repo.findOne({ where: { id }, relations: ['plan', 'payments'] });
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  async findBySubscriber(address: string): Promise<SubscriptionEntity[]> {
    return this.repo.find({ where: { subscriberAddress: address }, relations: ['plan'] });
  }

  async findDue(): Promise<SubscriptionEntity[]> {
    return this.repo
      .createQueryBuilder('s')
      .where('s.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('s.next_billing_at <= NOW()')
      .leftJoinAndSelect('s.plan', 'plan')
      .getMany();
  }

  async updateStatus(id: string, status: SubscriptionStatus): Promise<void> {
    await this.repo.update(id, { status });
  }

  async pause(id: string): Promise<SubscriptionEntity> {
    await this.repo.update(id, { status: SubscriptionStatus.PAUSED });
    return this.findById(id);
  }

  async resume(id: string): Promise<SubscriptionEntity> {
    const sub = await this.findById(id);
    const plan = await this.planRepo.findOne({ where: { id: sub.planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    const nextBillingAt = new Date(Date.now() + Number(plan.interval) * 1000);
    await this.repo.update(id, { status: SubscriptionStatus.ACTIVE, nextBillingAt });
    return this.findById(id);
  }

  async cancel(id: string): Promise<SubscriptionEntity> {
    await this.repo.update(id, { status: SubscriptionStatus.CANCELLED });
    return this.findById(id);
  }

  async getPaymentHistory(subscriptionId: string): Promise<PaymentLogEntity[]> {
    return this.paymentRepo.find({ where: { subscriptionId }, order: { createdAt: 'DESC' } });
  }
}
