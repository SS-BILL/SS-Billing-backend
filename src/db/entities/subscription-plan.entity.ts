import {
  Column, CreateDateColumn, Entity, ManyToOne, OneToMany,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { MerchantEntity } from './merchant.entity';
import { SubscriptionEntity } from './subscription.entity';

@Entity('subscription_plans')
export class SubscriptionPlanEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'on_chain_plan_id', nullable: true }) onChainPlanId: number;

  @Column({ name: 'merchant_id' }) merchantId: string;

  @ManyToOne(() => MerchantEntity, (m) => m.plans)
  merchant: MerchantEntity;

  @Column() name: string;

  @Column({ type: 'bigint' }) amount: string; // stored as string to avoid JS precision loss

  @Column() token: string; // token contract address

  @Column({ type: 'bigint' }) interval: string; // seconds

  @Column({ name: 'grace_period', type: 'bigint', default: '86400' }) gracePeriod: string;

  @Column({ name: 'retry_limit', default: 3 }) retryLimit: number;

  /**
   * Seconds between retry attempts after a failed charge. Mirrors the field
   * the contract gained: without it a keeper polling every minute burns the
   * entire retry budget in minutes rather than across the grace window.
   */
  @Column({ name: 'retry_interval', type: 'bigint', default: '3600' })
  retryInterval: string;

  @Column({ default: true }) active: boolean;

  @OneToMany(() => SubscriptionEntity, (s) => s.plan)
  subscriptions: SubscriptionEntity[];

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
