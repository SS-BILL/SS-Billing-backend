import {
  Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn, UpdateDateColumn,
} from 'typeorm';
import { SubscriptionPlanEntity } from './subscription-plan.entity';

@Entity('merchants')
export class MerchantEntity {
  @PrimaryColumn() id: string; // Stellar address

  @Column() name: string;

  @Column({ name: 'treasury_wallet' }) treasuryWallet: string;

  @Column({ default: true }) active: boolean;

  @Column({ name: 'api_key', unique: true }) apiKey: string;

  @Column({ name: 'webhook_url', nullable: true }) webhookUrl: string;

  @Column({ name: 'webhook_secret', nullable: true }) webhookSecret: string;

  @OneToMany(() => SubscriptionPlanEntity, (p) => p.merchant)
  plans: SubscriptionPlanEntity[];

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
