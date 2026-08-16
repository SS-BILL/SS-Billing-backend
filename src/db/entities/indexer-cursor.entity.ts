import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Persisted read position for the contract event indexer.
 *
 * Previously an in-memory field, so every restart rewound the indexer to
 * `latest - 100` and reprocessed or skipped events depending on timing.
 */
@Entity('indexer_cursors')
export class IndexerCursorEntity {
  @PrimaryColumn() id: string;

  @Column({ name: 'last_ledger', type: 'int' }) lastLedger: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
