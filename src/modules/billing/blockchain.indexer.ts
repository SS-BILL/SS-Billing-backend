import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SorobanRpc, scValToNative } from '@stellar/stellar-sdk';
import { IndexerCursorEntity } from '../../db/entities/indexer-cursor.entity';
import { SubscriptionEntity, SubscriptionStatus } from '../../db/entities/subscription.entity';

const CURSOR_ID = 'contract-events';
const INDEXER_LOCK_KEY = 0x55_b1_11_11;
const PAGE_LIMIT = 200;

/**
 * Reconciles local subscription state against contract events.
 *
 * This is the safety net for anything the scheduler missed — a payment
 * submitted by someone other than our keeper, or a transaction that landed
 * after our confirmation poll timed out.
 */
@Injectable()
export class BlockchainIndexer {
  private readonly logger = new Logger(BlockchainIndexer.name);
  private readonly server: SorobanRpc.Server;
  private readonly contractId: string;

  constructor(
    config: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(IndexerCursorEntity)
    private readonly cursorRepo: Repository<IndexerCursorEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
  ) {
    this.server = new SorobanRpc.Server(config.getOrThrow<string>('stellar.rpcUrl'));
    this.contractId = config.get<string>('stellar.contractId') ?? '';
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async indexEvents(): Promise<void> {
    if (!this.contractId) return;

    // Same reasoning as the billing sweep: one indexer across all replicas.
    const lock = await this.dataSource.query<[{ locked: boolean }]>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [INDEXER_LOCK_KEY],
    );
    if (!lock[0]?.locked) return;

    try {
      await this.pump();
    } catch (err: unknown) {
      this.logger.error(`Indexer error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await this.dataSource.query('SELECT pg_advisory_unlock($1)', [INDEXER_LOCK_KEY]);
    }
  }

  /**
   * Advance the cursor by exactly what was read.
   *
   * The previous implementation kept the cursor in a private field, so a
   * restart silently rewound to `latest - 100` and reprocessed or skipped
   * arbitrarily. Worse, it set `lastLedger = latest.sequence` *after*
   * processing, discarding every ledger produced while the page was in
   * flight — a permanent, silent event loss on every single poll.
   */
  private async pump(): Promise<void> {
    const latest = await this.server.getLatestLedger();
    const cursor = await this.cursorRepo.findOne({ where: { id: CURSOR_ID } });

    // Cold start: begin just behind the tip rather than replaying history.
    const startLedger = cursor?.lastLedger
      ? cursor.lastLedger + 1
      : Math.max(latest.sequence - 100, 1);

    if (startLedger > latest.sequence) return;

    const response = await this.server.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [this.contractId] }],
      limit: PAGE_LIMIT,
    });

    for (const event of response.events) {
      await this.handleEvent(event);
    }

    // Advance only to what was actually covered. When a full page comes back
    // there may be more inside the same range, so we resume from the last
    // event's ledger instead of jumping to the tip.
    const reachedPageLimit = response.events.length >= PAGE_LIMIT;
    const lastEventLedger = response.events.at(-1)?.ledger;
    const nextCursor = reachedPageLimit && lastEventLedger ? lastEventLedger : latest.sequence;

    await this.cursorRepo.save({ id: CURSOR_ID, lastLedger: nextCursor });

    if (response.events.length > 0) {
      this.logger.debug(`Indexed ${response.events.length} events up to ledger ${nextCursor}`);
    }
  }

  private async handleEvent(event: SorobanRpc.Api.EventResponse): Promise<void> {
    const topic = this.decodeTopic(event, 0);
    if (!topic) return;

    // Matching was previously `topic.value().toString().includes('pay_ok')` on
    // a raw ScVal, which is a substring test against a stringified union —
    // fragile, and it silently matched nothing for several topic types.
    switch (topic) {
      case 'pay_ok':
        await this.onPaymentSucceeded(this.decodeTopic(event, 1));
        break;
      case 'sub_canc':
        await this.onStatusEvent(this.decodeTopic(event, 1), SubscriptionStatus.CANCELLED);
        break;
      case 'sub_pause':
        await this.onStatusEvent(this.decodeTopic(event, 1), SubscriptionStatus.PAUSED);
        break;
      default:
        break;
    }
  }

  private decodeTopic(event: SorobanRpc.Api.EventResponse, index: number): string | null {
    const raw = event.topic[index];
    if (!raw) return null;
    try {
      // scValToNative is typed `any` by the SDK; keep it `unknown` so the
      // typeof narrowing below is the only thing that lets a value through.
      const value: unknown = scValToNative(raw);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * A payment landed on-chain that we did not necessarily submit. Clear the
   * local grace state so the keeper stops retrying a subscription that is
   * already current.
   */
  private async onPaymentSucceeded(subscriberAddress: string | null): Promise<void> {
    if (!subscriberAddress) return;
    const result = await this.subRepo.update(
      { subscriberAddress, status: SubscriptionStatus.GRACE_PERIOD },
      { status: SubscriptionStatus.ACTIVE, retries: 0, nextRetryAt: null },
    );
    if (result.affected) {
      this.logger.log(`Reconciled ${result.affected} subscription(s) for ${subscriberAddress}`);
    }
  }

  private async onStatusEvent(
    subscriberAddress: string | null,
    status: SubscriptionStatus,
  ): Promise<void> {
    if (!subscriberAddress) return;
    await this.subRepo.update({ subscriberAddress, status: SubscriptionStatus.ACTIVE }, { status });
  }
}
