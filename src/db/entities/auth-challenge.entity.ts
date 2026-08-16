import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A single-use nonce issued for wallet-signature login.
 *
 * Persisted rather than held in memory so that challenges survive a restart
 * and, more importantly, so that consuming one is atomic across replicas —
 * two API pods must not both accept the same signature.
 */
@Entity('auth_challenges')
@Index(['address', 'consumedAt'])
export class AuthChallengeEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  /** Stellar account address (G...) the challenge was issued to. */
  @Index()
  @Column()
  address: string;

  /** The exact text the wallet must sign. */
  @Column({ type: 'text' }) message: string;

  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;

  /** Set the moment the challenge is redeemed; enforces single use. */
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
