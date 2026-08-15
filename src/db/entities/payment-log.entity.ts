import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SubscriptionEntity } from './subscription.entity';

@Entity('payment_logs')
export class PaymentLogEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'subscription_id' }) subscriptionId: string;

  @ManyToOne(() => SubscriptionEntity, (s) => s.payments)
  subscription: SubscriptionEntity;

  @Column({ name: 'on_chain_payment_id', nullable: true }) onChainPaymentId: number;

  @Column({ name: 'subscriber_address' }) subscriberAddress: string;

  @Column({ name: 'merchant_address' }) merchantAddress: string;

  @Column({ type: 'bigint' }) amount: string;

  @Column({ name: 'tx_hash', nullable: true }) txHash: string;

  @Column({ default: false }) success: boolean;

  @Column({ name: 'error_message', nullable: true }) errorMessage: string;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
