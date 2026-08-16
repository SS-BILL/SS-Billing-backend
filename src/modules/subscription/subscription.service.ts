import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionEntity, SubscriptionStatus } from '../../db/entities/subscription.entity';
import { SubscriptionPlanEntity } from '../../db/entities/subscription-plan.entity';
import { PaymentLogEntity } from '../../db/entities/payment-log.entity';
import { CreateSubscriptionDto } from './subscription.dto';

/** Terminal states cannot transition further. */
const TERMINAL = [SubscriptionStatus.CANCELLED, SubscriptionStatus.FAILED];

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly repo: Repository<SubscriptionEntity>,
    @InjectRepository(SubscriptionPlanEntity)
    private readonly planRepo: Repository<SubscriptionPlanEntity>,
    @InjectRepository(PaymentLogEntity)
    private readonly paymentRepo: Repository<PaymentLogEntity>,
  ) {}

  async create(subscriberAddress: string, dto: CreateSubscriptionDto): Promise<SubscriptionEntity> {
    const plan = await this.planRepo.findOne({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.active) throw new ForbiddenException('Plan is not accepting new subscriptions');

    const existing = await this.repo.findOne({
      where: { subscriberAddress, planId: dto.planId },
    });
    if (existing && !TERMINAL.includes(existing.status)) {
      throw new ForbiddenException('Already subscribed to this plan');
    }

    const now = new Date();
    return this.repo.save(
      this.repo.create({
        subscriberAddress,
        planId: dto.planId,
        onChainPlanId: plan.onChainPlanId != null ? String(plan.onChainPlanId) : null,
        nextBillingAt: new Date(now.getTime() + Number(plan.interval) * 1000),
        status: SubscriptionStatus.ACTIVE,
        startedAt: now,
        nextRetryAt: null,
      }),
    );
  }

  /**
   * Load a subscription the caller is party to.
   *
   * Both the subscriber and the plan's merchant have a legitimate need to read
   * it; nobody else does. Every route here previously took an id straight from
   * the path with no ownership check at all, so any authenticated token could
   * read, pause, resume or cancel any subscription in the system.
   */
  async findForParticipant(id: string, callerAddress: string): Promise<SubscriptionEntity> {
    const sub = await this.repo.findOne({
      where: { id },
      relations: ['plan', 'payments'],
    });
    if (!sub) throw new NotFoundException('Subscription not found');

    const isSubscriber = sub.subscriberAddress === callerAddress;
    const isMerchant = sub.plan?.merchantId === callerAddress;
    if (!isSubscriber && !isMerchant) {
      throw new NotFoundException('Subscription not found');
    }
    return sub;
  }

  /** Only the subscriber may pause, resume or cancel. */
  private async findAsSubscriber(id: string, callerAddress: string): Promise<SubscriptionEntity> {
    const sub = await this.findForParticipant(id, callerAddress);
    if (sub.subscriberAddress !== callerAddress) {
      throw new ForbiddenException('Only the subscriber can change this subscription');
    }
    return sub;
  }

  async findMine(callerAddress: string): Promise<SubscriptionEntity[]> {
    return this.repo.find({
      where: { subscriberAddress: callerAddress },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });
  }

  async pause(id: string, callerAddress: string): Promise<SubscriptionEntity> {
    const sub = await this.findAsSubscriber(id, callerAddress);
    if (TERMINAL.includes(sub.status)) {
      throw new ForbiddenException(`Cannot pause a ${sub.status} subscription`);
    }
    await this.repo.update(id, { status: SubscriptionStatus.PAUSED });
    return this.findForParticipant(id, callerAddress);
  }

  /**
   * Resume without moving the billing date.
   *
   * This mirrors the contract fix: resetting `nextBillingAt` to
   * `now + interval` let a subscriber pause just before the due date and
   * resume just after to skip the cycle indefinitely. The DB must agree with
   * the chain or the keeper will bill against a date the contract rejects.
   */
  async resume(id: string, callerAddress: string): Promise<SubscriptionEntity> {
    const sub = await this.findAsSubscriber(id, callerAddress);
    if (sub.status !== SubscriptionStatus.PAUSED) {
      throw new ForbiddenException('Subscription is not paused');
    }
    await this.repo.update(id, { status: SubscriptionStatus.ACTIVE });
    return this.findForParticipant(id, callerAddress);
  }

  async cancel(id: string, callerAddress: string): Promise<SubscriptionEntity> {
    const sub = await this.findAsSubscriber(id, callerAddress);
    if (sub.status === SubscriptionStatus.CANCELLED) {
      throw new ForbiddenException('Subscription is already cancelled');
    }
    await this.repo.update(id, { status: SubscriptionStatus.CANCELLED });
    return this.findForParticipant(id, callerAddress);
  }

  async getPaymentHistory(id: string, callerAddress: string): Promise<PaymentLogEntity[]> {
    await this.findForParticipant(id, callerAddress);
    return this.paymentRepo.find({
      where: { subscriptionId: id },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }
}
