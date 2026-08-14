import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { SubscriptionPlanEntity } from './subscription-plan.entity';

@Entity('merchants')
export class MerchantEntity {
  @PrimaryColumn() id: string; // Stellar address

  @Column() name: string;

  @Column({ name: 'treasury_wallet' }) treasuryWallet: string;

  @Column({ default: true }) active: boolean;

  /**
   * SHA-256 of the API key. The key itself is never stored.
   *
   * `select: false` keeps it out of every `find` that does not ask for it by
   * name — the previous plaintext `apiKey` column was returned in full by
   * `GET /merchants/:id`, which was an unauthenticated endpoint.
   */
  @Column({ name: 'api_key_hash', unique: true, select: false })
  apiKeyHash: string;

  /** Leading characters of the key, for identifying it in a UI. Not a secret. */
  @Column({ name: 'api_key_prefix', nullable: true })
  apiKeyPrefix: string | null;

  @Column({ name: 'api_key_rotated_at', type: 'timestamptz', nullable: true })
  apiKeyRotatedAt: Date | null;

  @Column({ name: 'webhook_url', nullable: true }) webhookUrl: string;

  /** HMAC signing secret for webhook deliveries. Never serialized to a client. */
  @Column({ name: 'webhook_secret', nullable: true, select: false })
  webhookSecret: string;

  @OneToMany(() => SubscriptionPlanEntity, (p) => p.merchant)
  plans: SubscriptionPlanEntity[];

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
