import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum WebhookStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  FAILED = 'failed',
}

@Entity('webhook_deliveries')
// The retry sweep filters on exactly these columns every minute.
@Index(['status', 'nextRetryAt'])
export class WebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column({ name: 'merchant_id' })
  merchantId: string;

  @Column() event: string;

  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;

  @Column({ name: 'webhook_url' }) webhookUrl: string;

  @Column({ type: 'enum', enum: WebhookStatus, default: WebhookStatus.PENDING })
  status: WebhookStatus;

  // Nullable columns are typed nullable. Without `| null` the compiler rejects
  // clearing them, which is why retry state was previously written as
  // `undefined` and silently left unchanged.
  @Column({ name: 'response_code', type: 'int', nullable: true })
  responseCode: number | null;

  @Column({ default: 0 }) attempts: number;

  /** Last transport or status failure, truncated. Aids merchant support. */
  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true })
  errorMessage: string | null;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
