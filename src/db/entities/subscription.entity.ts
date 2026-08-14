import {
  Column, CreateDateColumn, Entity, ManyToOne, OneToMany,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { SubscriptionPlanEntity } from './subscription-plan.entity';
import { PaymentLogEntity } from './payment-log.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  CANCELLED = 'cancelled',
  GRACE_PERIOD = 'grace_period',
  FAILED = 'failed',
}

@Entity('subscriptions')
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'subscriber_address' }) subscriberAddress: string;

  @Column({ name: 'plan_id' }) planId: string;

  @ManyToOne(() => SubscriptionPlanEntity, (p) => p.subscriptions)
  plan: SubscriptionPlanEntity;

  @Column({ name: 'next_billing_at', type: 'timestamptz' }) nextBillingAt: Date;

  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
  status: SubscriptionStatus;

  @Column({ default: 0 }) retries: number;

  /** Earliest time a failed charge may be retried; mirrors the contract. */
  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  /** On-chain plan id this subscription was opened against. */
  @Column({ name: 'on_chain_plan_id', type: 'bigint', nullable: true })
  onChainPlanId: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' }) startedAt: Date;

  @OneToMany(() => PaymentLogEntity, (p) => p.subscription)
  payments: PaymentLogEntity[];

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
