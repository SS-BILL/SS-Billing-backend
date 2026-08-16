import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SubscriptionEntity, SubscriptionStatus } from '../../db/entities/subscription.entity';
import { PaymentLogEntity } from '../../db/entities/payment-log.entity';
import { ContractCallError, PaymentOutcome, StellarService } from './stellar.service';
import { WebhookService } from '../webhook/webhook.service';

/**
 * Postgres advisory lock key for the billing sweep. Any constant works; it
 * only needs to be stable across replicas and distinct from other locks.
 */
const BILLING_LOCK_KEY = 0x55_b1_11_10;

/** Cap per tick so one sweep cannot run past the next. */
const MAX_PER_TICK = 100;

@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PaymentLogEntity)
    private readonly paymentRepo: Repository<PaymentLogEntity>,
    private readonly dataSource: DataSource,
    private readonly stellar: StellarService,
    private readonly webhook: WebhookService,
  ) {}

  /**
   * Bill everything due.
   *
   * Guarded by a Postgres advisory lock. The previous implementation ran an
   * unguarded `@Cron(EVERY_MINUTE)` in every replica: two API pods meant two
   * concurrent sweeps over the same rows, and each would submit its own
   * `process_payment` for the same subscription. The contract's own due-date
   * check is the only reason that would not have double-charged, and relying
   * on it means paying a transaction fee for every duplicate.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processDueBillings(): Promise<void> {
    if (!this.stellar.enabled) return;

    const lock = await this.dataSource.query<[{ locked: boolean }]>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [BILLING_LOCK_KEY],
    );

    if (!lock[0]?.locked) {
      this.logger.debug('Another replica holds the billing lock; skipping this tick');
      return;
    }

    try {
      await this.sweep();
    } finally {
      await this.dataSource.query('SELECT pg_advisory_unlock($1)', [BILLING_LOCK_KEY]);
    }
  }

  private async sweep(): Promise<void> {
    const due = await this.subRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.plan', 'plan')
      .where('s.status IN (:...statuses)', {
        statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE_PERIOD],
      })
      .andWhere('s.next_billing_at <= NOW()')
      // Respect the contract's retry throttle. Without this the keeper submits
      // a transaction the contract rejects with BillingNotDue and pays the fee
      // anyway, once per minute per delinquent subscription.
      .andWhere('(s.next_retry_at IS NULL OR s.next_retry_at <= NOW())')
      .andWhere('plan.active = true')
      .orderBy('s.next_billing_at', 'ASC')
      .limit(MAX_PER_TICK)
      .getMany();

    if (due.length === 0) return;
    this.logger.log(`Processing ${due.length} due subscriptions`);

    let paid = 0;
    let retrying = 0;
    let failed = 0;

    for (const sub of due) {
      const outcome = await this.processSingle(sub);
      if (outcome === PaymentOutcome.PAID) paid++;
      else if (outcome === PaymentOutcome.RETRYING) retrying++;
      else if (outcome === PaymentOutcome.FAILED) failed++;
    }

    this.logger.log(`Billing sweep complete: ${paid} paid, ${retrying} retrying, ${failed} failed`);
  }

  /**
   * Bill one subscription and reconcile local state to what the contract said.
   *
   * The chain is authoritative. The previous implementation wrote
   * `nextBillingAt = Date.now() + interval` from the API's own clock, so the
   * database and the contract drifted apart a little on every cycle, and it
   * recorded a successful payment whenever the transaction did not throw —
   * even though the contract reports a failed charge as a successful
   * transaction returning `Retrying`.
   */
  private async processSingle(sub: SubscriptionEntity): Promise<PaymentOutcome | null> {
    const onChainPlanId = sub.onChainPlanId ?? sub.plan.onChainPlanId;
    if (onChainPlanId == null) {
      this.logger.warn(`Subscription ${sub.id} has no on-chain plan id; skipping`);
      return null;
    }

    try {
      const outcome = (await this.stellar.invokeContract('process_payment', [
        this.stellar.addressToScVal(sub.subscriberAddress),
        this.stellar.u64ToScVal(BigInt(onChainPlanId)),
      ])) as PaymentOutcome | string | undefined;

      return await this.reconcile(sub, this.normalizeOutcome(outcome));
    } catch (err: unknown) {
      const permanent = err instanceof ContractCallError ? err.permanent : true;
      const message = err instanceof Error ? err.message : 'unknown error';

      // A transient failure (unconfirmed submission, RPC timeout) must not be
      // recorded as a payment failure — the transaction may still land, and
      // marking it failed here would double-count against the retry budget.
      if (!permanent) {
        this.logger.warn(`Billing ${sub.id} unresolved, leaving state untouched: ${message}`);
        return null;
      }

      this.logger.error(`Billing ${sub.id} failed: ${message}`);
      await this.recordPayment(sub, false, message);
      return null;
    }
  }

  /** The SDK decodes the enum as either a bare string or a single-key object. */
  private normalizeOutcome(value: unknown): PaymentOutcome {
    const raw =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object'
          ? Object.keys(value as Record<string, unknown>)[0]
          : undefined;

    switch (raw) {
      case 'Paid':
        return PaymentOutcome.PAID;
      case 'Retrying':
        return PaymentOutcome.RETRYING;
      case 'Failed':
        return PaymentOutcome.FAILED;
      default:
        // An unrecognised value is safer treated as a failed charge than as a
        // successful one.
        this.logger.warn(`Unrecognised PaymentOutcome ${JSON.stringify(value)}`);
        return PaymentOutcome.RETRYING;
    }
  }

  private async reconcile(
    sub: SubscriptionEntity,
    outcome: PaymentOutcome,
  ): Promise<PaymentOutcome> {
    const intervalMs = Number(sub.plan.interval) * 1000;
    const retryIntervalMs = Number(sub.plan.retryInterval ?? '3600') * 1000;

    if (outcome === PaymentOutcome.PAID) {
      await this.recordPayment(sub, true);

      // Anchored advance, matching the contract exactly, so the two schedules
      // cannot drift.
      const anchored = sub.nextBillingAt.getTime() + intervalMs;
      const nextBillingAt = new Date(anchored <= Date.now() ? Date.now() + intervalMs : anchored);

      await this.subRepo.update(sub.id, {
        status: SubscriptionStatus.ACTIVE,
        retries: 0,
        nextRetryAt: null,
        nextBillingAt,
      });

      await this.webhook.dispatch(sub.plan.merchantId, 'subscription.payment.success', {
        subscriptionId: sub.id,
        subscriberAddress: sub.subscriberAddress,
        amount: sub.plan.amount,
        nextBillingAt: nextBillingAt.toISOString(),
      });
      return outcome;
    }

    await this.recordPayment(sub, false, `contract reported ${outcome}`);
    const retries = sub.retries + 1;

    if (outcome === PaymentOutcome.FAILED) {
      await this.subRepo.update(sub.id, {
        status: SubscriptionStatus.FAILED,
        retries,
        nextRetryAt: null,
      });
      await this.webhook.dispatch(sub.plan.merchantId, 'subscription.payment.failed', {
        subscriptionId: sub.id,
        subscriberAddress: sub.subscriberAddress,
        retries,
      });
      return outcome;
    }

    await this.subRepo.update(sub.id, {
      status: SubscriptionStatus.GRACE_PERIOD,
      retries,
      nextRetryAt: new Date(Date.now() + retryIntervalMs),
    });
    await this.webhook.dispatch(sub.plan.merchantId, 'subscription.payment.retrying', {
      subscriptionId: sub.id,
      subscriberAddress: sub.subscriberAddress,
      retries,
    });
    return outcome;
  }

  private async recordPayment(
    sub: SubscriptionEntity,
    success: boolean,
    errorMessage?: string,
  ): Promise<void> {
    await this.paymentRepo.save(
      this.paymentRepo.create({
        subscriptionId: sub.id,
        subscriberAddress: sub.subscriberAddress,
        merchantAddress: sub.plan.merchantId,
        amount: sub.plan.amount,
        success,
        errorMessage: errorMessage?.slice(0, 500),
      }),
    );
  }
}
