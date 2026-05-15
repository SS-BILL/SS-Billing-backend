import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum WebhookStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  FAILED = 'failed',
}

@Entity('webhook_deliveries')
export class WebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'merchant_id' }) merchantId: string;

  @Column() event: string;

  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;

  @Column({ name: 'webhook_url' }) webhookUrl: string;

  @Column({ type: 'enum', enum: WebhookStatus, default: WebhookStatus.PENDING })
  status: WebhookStatus;

  @Column({ name: 'response_code', nullable: true }) responseCode: number;

  @Column({ default: 0 }) attempts: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true }) nextRetryAt: Date;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
