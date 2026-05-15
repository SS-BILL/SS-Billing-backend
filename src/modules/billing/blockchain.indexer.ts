import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { PaymentLogEntity } from '../../db/entities/payment-log.entity';
import { SubscriptionEntity, SubscriptionStatus } from '../../db/entities/subscription.entity';

@Injectable()
export class BlockchainIndexer {
  private readonly logger = new Logger(BlockchainIndexer.name);
  private readonly server: SorobanRpc.Server;
  private readonly contractId: string;
  private lastLedger = 0;

  constructor(
    private config: ConfigService,
    @InjectRepository(PaymentLogEntity) private paymentRepo: Repository<PaymentLogEntity>,
    @InjectRepository(SubscriptionEntity) private subRepo: Repository<SubscriptionEntity>,
  ) {
    this.server = new SorobanRpc.Server(config.get<string>('stellar.rpcUrl')!);
    this.contractId = config.get<string>('stellar.contractId')!;
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async indexEvents() {
    if (!this.contractId) return;
    try {
      const latest = await this.server.getLatestLedger();
      const startLedger = this.lastLedger || latest.sequence - 100;

      const events = await this.server.getEvents({
        startLedger,
        filters: [{ type: 'contract', contractIds: [this.contractId] }],
        limit: 200,
      });

      for (const event of events.events) {
        await this.handleEvent(event);
      }

      this.lastLedger = latest.sequence;
    } catch (err: any) {
      this.logger.error(`Indexer error: ${err.message}`);
    }
  }

  private async handleEvent(event: SorobanRpc.Api.EventResponse) {
    const topic = event.topic[0]?.value();
    if (!topic) return;

    const topicStr = topic.toString();
    this.logger.debug(`Event: ${topicStr}`);

    // Events are already handled by the billing scheduler writing to DB.
    // Indexer reconciles on-chain state for missed events.
    if (topicStr.includes('pay_ok')) {
      // Mark any grace-period subs as active if on-chain payment succeeded
      const subAddr = event.topic[1]?.value()?.toString();
      if (subAddr) {
        await this.subRepo.update(
          { subscriberAddress: subAddr, status: SubscriptionStatus.GRACE_PERIOD },
          { status: SubscriptionStatus.ACTIVE, retries: 0 },
        );
      }
    }
  }
}
