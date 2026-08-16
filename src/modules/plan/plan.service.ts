import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionPlanEntity } from '../../db/entities/subscription-plan.entity';
import { CreatePlanDto, UpdatePlanDto } from './plan.dto';

/** Matches the contract's rule: retries require a positive retry interval. */
const DEFAULT_RETRY_INTERVAL = '3600';
const DEFAULT_GRACE_PERIOD = '86400';
const DEFAULT_RETRY_LIMIT = 3;

@Injectable()
export class PlanService {
  constructor(
    @InjectRepository(SubscriptionPlanEntity)
    private readonly repo: Repository<SubscriptionPlanEntity>,
  ) {}

  /**
   * `merchantId` is taken from the authenticated principal, not the body.
   * The DTO used to carry it, so any token could create plans that collected
   * into another merchant's treasury.
   */
  async create(merchantId: string, dto: CreatePlanDto): Promise<SubscriptionPlanEntity> {
    return this.repo.save(
      this.repo.create({
        merchantId,
        name: dto.name,
        amount: dto.amount,
        token: dto.token,
        interval: dto.interval,
        gracePeriod: dto.gracePeriod ?? DEFAULT_GRACE_PERIOD,
        retryLimit: dto.retryLimit ?? DEFAULT_RETRY_LIMIT,
        retryInterval: dto.retryInterval ?? DEFAULT_RETRY_INTERVAL,
      }),
    );
  }

  /** Always scoped: there is no "list every plan in the system" query. */
  async findAllForMerchant(merchantId: string): Promise<SubscriptionPlanEntity[]> {
    return this.repo.find({ where: { merchantId }, order: { createdAt: 'DESC' } });
  }

  /** Public plan detail, for a subscriber deciding whether to sign up. */
  async findPublic(id: string): Promise<SubscriptionPlanEntity> {
    const plan = await this.repo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async findOwned(id: string, merchantId: string): Promise<SubscriptionPlanEntity> {
    const plan = await this.repo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.merchantId !== merchantId) {
      throw new ForbiddenException('You do not own this plan');
    }
    return plan;
  }

  async update(
    id: string,
    merchantId: string,
    dto: UpdatePlanDto,
  ): Promise<SubscriptionPlanEntity> {
    const plan = await this.findOwned(id, merchantId);

    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.amount !== undefined) plan.amount = dto.amount;
    if (dto.interval !== undefined) plan.interval = dto.interval;
    if (dto.gracePeriod !== undefined) plan.gracePeriod = dto.gracePeriod;
    if (dto.retryLimit !== undefined) plan.retryLimit = dto.retryLimit;
    if (dto.retryInterval !== undefined) plan.retryInterval = dto.retryInterval;
    if (dto.active !== undefined) plan.active = dto.active;

    return this.repo.save(plan);
  }

  async disable(id: string, merchantId: string): Promise<SubscriptionPlanEntity> {
    return this.update(id, merchantId, { active: false });
  }
}
