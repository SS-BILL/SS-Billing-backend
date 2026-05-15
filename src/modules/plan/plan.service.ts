import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionPlanEntity } from '../../db/entities/subscription-plan.entity';
import { CreatePlanDto, UpdatePlanDto } from './plan.dto';

@Injectable()
export class PlanService {
  constructor(
    @InjectRepository(SubscriptionPlanEntity)
    private repo: Repository<SubscriptionPlanEntity>,
  ) {}

  async create(dto: CreatePlanDto): Promise<SubscriptionPlanEntity> {
    const plan = this.repo.create({
      merchantId: dto.merchantId,
      name: dto.name,
      amount: dto.amount,
      token: dto.token,
      interval: dto.interval,
      gracePeriod: dto.gracePeriod ?? '86400',
      retryLimit: dto.retryLimit ?? 3,
    });
    return this.repo.save(plan);
  }

  async findAll(merchantId?: string): Promise<SubscriptionPlanEntity[]> {
    const where = merchantId ? { merchantId } : {};
    return this.repo.find({ where });
  }

  async findById(id: string): Promise<SubscriptionPlanEntity> {
    const plan = await this.repo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto): Promise<SubscriptionPlanEntity> {
    const plan = await this.findById(id);
    Object.assign(plan, dto);
    return this.repo.save(plan);
  }

  async disable(id: string): Promise<SubscriptionPlanEntity> {
    return this.update(id, { active: false });
  }
}
