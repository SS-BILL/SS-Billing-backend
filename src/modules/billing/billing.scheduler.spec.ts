import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BillingScheduler } from './billing.scheduler';
import { ContractCallError, PaymentOutcome, StellarService } from './stellar.service';
import { WebhookService } from '../webhook/webhook.service';
import { SubscriptionEntity, SubscriptionStatus } from '../../db/entities/subscription.entity';
import { SubscriptionPlanEntity } from '../../db/entities/subscription-plan.entity';
import { PaymentLogEntity } from '../../db/entities/payment-log.entity';

/**
 * Every case here guards a bug that was live in production code:
 * unguarded concurrent sweeps, clock-based (drifting) billing anchors, and
 * "no exception thrown" being mistaken for "the customer paid".
 */
describe('BillingScheduler', () => {
  const HOUR_SECONDS = 3600;
  const INTERVAL_MS = HOUR_SECONDS * 1000;
  const RETRY_INTERVAL_SECONDS = 900;

  let scheduler: BillingScheduler;
  let subRepo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let paymentRepo: { create: jest.Mock; save: jest.Mock };
  let dataSource: { query: jest.Mock };
  let stellar: {
    enabled: boolean;
    invokeContract: jest.Mock;
    addressToScVal: jest.Mock;
    u64ToScVal: jest.Mock;
  };
  let webhook: { dispatch: jest.Mock };

  /** Rows the sweep's query builder will return this test. */
  let due: SubscriptionEntity[];

  const makePlan = (overrides: Partial<SubscriptionPlanEntity> = {}): SubscriptionPlanEntity =>
    ({
      id: 'plan-1',
      merchantId: 'GMERCHANT',
      name: 'Pro',
      amount: '1000000',
      token: 'CTOKEN',
      interval: String(HOUR_SECONDS),
      gracePeriod: '86400',
      retryLimit: 3,
      retryInterval: String(RETRY_INTERVAL_SECONDS),
      active: true,
      onChainPlanId: 7,
      ...overrides,
    }) as SubscriptionPlanEntity;

  const makeSub = (overrides: Partial<SubscriptionEntity> = {}): SubscriptionEntity =>
    ({
      id: 'sub-1',
      subscriberAddress: 'GSUBSCRIBER',
      planId: 'plan-1',
      plan: makePlan(),
      // Due ten seconds ago: the keeper is always slightly late, which is
      // exactly the condition the drift bug needed.
      nextBillingAt: new Date(Date.now() - 10_000),
      status: SubscriptionStatus.ACTIVE,
      retries: 0,
      nextRetryAt: null,
      onChainPlanId: '7',
      startedAt: new Date(Date.now() - INTERVAL_MS),
      ...overrides,
    }) as SubscriptionEntity;

  /** Last payload passed to `subRepo.update` (the reconciliation result). */
  const lastUpdate = (): Record<string, unknown> =>
    subRepo.update.mock.calls[subRepo.update.mock.calls.length - 1][1] as Record<string, unknown>;

  beforeEach(async () => {
    due = [];

    subRepo = {
      createQueryBuilder: jest.fn(() => {
        const qb: Record<string, unknown> = {};
        for (const method of ['innerJoinAndSelect', 'where', 'andWhere', 'orderBy', 'limit']) {
          qb[method] = jest.fn(() => qb);
        }
        qb.getMany = jest.fn(async () => due);
        return qb;
      }),
      update: jest.fn(async () => ({ affected: 1 })),
    };

    paymentRepo = {
      create: jest.fn((row: unknown) => row),
      save: jest.fn(async (row: unknown) => row),
    };

    dataSource = {
      query: jest.fn(async (sql: string) =>
        sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [{ unlocked: true }],
      ),
    };

    stellar = {
      enabled: true,
      invokeContract: jest.fn(async () => PaymentOutcome.PAID),
      addressToScVal: jest.fn((a: string) => a),
      u64ToScVal: jest.fn((v: bigint) => v),
    };

    webhook = { dispatch: jest.fn(async () => undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        BillingScheduler,
        { provide: getRepositoryToken(SubscriptionEntity), useValue: subRepo },
        { provide: getRepositoryToken(PaymentLogEntity), useValue: paymentRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: StellarService, useValue: stellar },
        { provide: WebhookService, useValue: webhook },
      ],
    }).compile();

    scheduler = moduleRef.get(BillingScheduler);
  });

  describe('the advisory lock', () => {
    it('does nothing at all when another replica already holds the lock', async () => {
      // Two API pods both run the cron. Without this guard both sweep the same
      // rows and both submit process_payment for the same subscription — a
      // duplicate transaction fee per replica, per cycle.
      dataSource.query.mockImplementation(async (sql: string) =>
        sql.includes('pg_try_advisory_lock') ? [{ locked: false }] : [{}],
      );
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(subRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(stellar.invokeContract).not.toHaveBeenCalled();
      expect(subRepo.update).not.toHaveBeenCalled();
      expect(paymentRepo.save).not.toHaveBeenCalled();
    });

    it('does not attempt to unlock a lock it never acquired', async () => {
      dataSource.query.mockImplementation(async (sql: string) =>
        sql.includes('pg_try_advisory_lock') ? [{ locked: false }] : [{}],
      );

      await scheduler.processDueBillings();

      const unlocks = dataSource.query.mock.calls.filter((c) =>
        String(c[0]).includes('pg_advisory_unlock'),
      );
      expect(unlocks).toHaveLength(0);
    });

    it('sweeps and then releases the lock on the happy path', async () => {
      due = [makeSub()];

      await scheduler.processDueBillings();

      const unlocks = dataSource.query.mock.calls.filter((c) =>
        String(c[0]).includes('pg_advisory_unlock'),
      );
      expect(unlocks).toHaveLength(1);
    });

    it('releases the lock even when the sweep throws', async () => {
      // A leaked session-level advisory lock stops every future tick in every
      // replica until the connection is recycled — billing silently halts.
      subRepo.createQueryBuilder.mockImplementation(() => {
        throw new Error('database is on fire');
      });

      await expect(scheduler.processDueBillings()).rejects.toThrow('database is on fire');

      const unlocks = dataSource.query.mock.calls.filter((c) =>
        String(c[0]).includes('pg_advisory_unlock'),
      );
      expect(unlocks).toHaveLength(1);
    });
  });

  describe('when billing is disabled', () => {
    it('returns before even taking the lock', async () => {
      stellar.enabled = false;
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(dataSource.query).not.toHaveBeenCalled();
      expect(stellar.invokeContract).not.toHaveBeenCalled();
    });
  });

  describe('a Paid outcome', () => {
    beforeEach(() => {
      stellar.invokeContract.mockResolvedValue(PaymentOutcome.PAID);
    });

    it('records a successful payment row', async () => {
      const sub = makeSub();
      due = [sub];

      await scheduler.processDueBillings();

      expect(paymentRepo.save).toHaveBeenCalledTimes(1);
      expect(paymentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: sub.id,
          subscriberAddress: sub.subscriberAddress,
          merchantAddress: sub.plan.merchantId,
          amount: sub.plan.amount,
          success: true,
        }),
      );
    });

    it('returns the subscription to ACTIVE and clears the retry state', async () => {
      // A subscription that recovers mid-grace-period must not keep its old
      // retry counter or retry throttle, or the next failure fails it early.
      due = [makeSub({ status: SubscriptionStatus.GRACE_PERIOD, retries: 2 })];

      await scheduler.processDueBillings();

      expect(lastUpdate()).toEqual(
        expect.objectContaining({
          status: SubscriptionStatus.ACTIVE,
          retries: 0,
          nextRetryAt: null,
        }),
      );
    });

    it('dispatches subscription.payment.success to the plan merchant', async () => {
      const sub = makeSub();
      due = [sub];

      await scheduler.processDueBillings();

      expect(webhook.dispatch).toHaveBeenCalledTimes(1);
      expect(webhook.dispatch).toHaveBeenCalledWith(
        sub.plan.merchantId,
        'subscription.payment.success',
        expect.objectContaining({
          subscriptionId: sub.id,
          subscriberAddress: sub.subscriberAddress,
          amount: sub.plan.amount,
        }),
      );
    });

    it('advances nextBillingAt from the previous anchor, not from now', async () => {
      // The drift bug: writing `Date.now() + interval` pushes the schedule
      // later by however late the keeper ran, every single cycle, until the
      // database and the contract disagree about when payment is due.
      const anchor = new Date(Date.now() - 10_000);
      due = [makeSub({ nextBillingAt: anchor })];

      await scheduler.processDueBillings();

      const next = lastUpdate().nextBillingAt as Date;
      expect(next.getTime()).toBe(anchor.getTime() + INTERVAL_MS);
      // And specifically NOT the clock-based value the old code produced.
      expect(next.getTime()).toBeLessThan(Date.now() + INTERVAL_MS);
    });

    it('resets to now + interval when the anchored date is already in the past', async () => {
      // After a long outage, anchor + interval can still be behind: advancing
      // to it would make the row instantly due again and spin the keeper.
      const anchor = new Date(Date.now() - 5 * INTERVAL_MS);
      due = [makeSub({ nextBillingAt: anchor })];

      const before = Date.now();
      await scheduler.processDueBillings();
      const after = Date.now();

      const next = (lastUpdate().nextBillingAt as Date).getTime();
      expect(next).toBeGreaterThanOrEqual(before + INTERVAL_MS);
      expect(next).toBeLessThanOrEqual(after + INTERVAL_MS);
    });
  });

  describe('a Retrying outcome', () => {
    beforeEach(() => {
      stellar.invokeContract.mockResolvedValue(PaymentOutcome.RETRYING);
    });

    it('writes a FAILED payment row, not a success row', async () => {
      // The contract reports a failed charge as a *successful transaction*
      // returning Retrying. Inferring success from "it did not throw" logged
      // revenue that never arrived.
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('moves the subscription into GRACE_PERIOD and increments retries', async () => {
      due = [makeSub({ retries: 1 })];

      await scheduler.processDueBillings();

      expect(lastUpdate()).toEqual(
        expect.objectContaining({
          status: SubscriptionStatus.GRACE_PERIOD,
          retries: 2,
        }),
      );
    });

    it('throttles the next attempt using the plan retry interval', async () => {
      // Without nextRetryAt the once-a-minute keeper burns the whole retry
      // budget in three minutes instead of across the grace window.
      due = [makeSub()];

      const before = Date.now();
      await scheduler.processDueBillings();
      const after = Date.now();

      const retryAt = (lastUpdate().nextRetryAt as Date).getTime();
      expect(retryAt).toBeGreaterThanOrEqual(before + RETRY_INTERVAL_SECONDS * 1000);
      expect(retryAt).toBeLessThanOrEqual(after + RETRY_INTERVAL_SECONDS * 1000);
    });

    it('does not move nextBillingAt', async () => {
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(lastUpdate()).not.toHaveProperty('nextBillingAt');
    });
  });

  describe('a Failed outcome', () => {
    beforeEach(() => {
      stellar.invokeContract.mockResolvedValue(PaymentOutcome.FAILED);
    });

    it('marks the subscription FAILED and stops retrying', async () => {
      due = [makeSub({ retries: 2 })];

      await scheduler.processDueBillings();

      expect(lastUpdate()).toEqual(
        expect.objectContaining({
          status: SubscriptionStatus.FAILED,
          retries: 3,
          nextRetryAt: null,
        }),
      );
    });

    it('dispatches subscription.payment.failed', async () => {
      const sub = makeSub({ retries: 2 });
      due = [sub];

      await scheduler.processDueBillings();

      expect(webhook.dispatch).toHaveBeenCalledWith(
        sub.plan.merchantId,
        'subscription.payment.failed',
        expect.objectContaining({ subscriptionId: sub.id, retries: 3 }),
      );
    });

    it('records a failed payment row', async () => {
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });
  });

  describe('contract call errors', () => {
    it('leaves state completely untouched for a transient failure', async () => {
      // An unconfirmed submission may still land on chain. Recording a failure
      // here would double-count against the retry budget and, worse, the next
      // tick would re-bill a subscription that was in fact already charged.
      stellar.invokeContract.mockRejectedValue(
        new ContractCallError('process_payment not confirmed within 60000ms', false),
      );
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(subRepo.update).not.toHaveBeenCalled();
      expect(paymentRepo.save).not.toHaveBeenCalled();
      expect(paymentRepo.create).not.toHaveBeenCalled();
      expect(webhook.dispatch).not.toHaveBeenCalled();
    });

    it('records a failed payment for a permanent failure', async () => {
      stellar.invokeContract.mockRejectedValue(
        new ContractCallError('process_payment rejected: insufficient fee', true),
      );
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(paymentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: expect.stringContaining('insufficient fee'),
        }),
      );
      // A permanent error is not a contract verdict, so status is left for the
      // next tick rather than guessed at.
      expect(subRepo.update).not.toHaveBeenCalled();
    });

    it('treats a non-ContractCallError as permanent', async () => {
      // An unknown throw is not evidence the transaction is still in flight.
      stellar.invokeContract.mockRejectedValue(new TypeError('cannot read property of undefined'));
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('truncates a long error message to the column limit', async () => {
      stellar.invokeContract.mockRejectedValue(new Error('x'.repeat(2000)));
      due = [makeSub()];

      await scheduler.processDueBillings();

      const row = paymentRepo.create.mock.calls[0][0] as { errorMessage: string };
      expect(row.errorMessage).toHaveLength(500);
    });
  });

  describe('outcome normalisation', () => {
    it('accepts the bare string form the SDK sometimes returns', async () => {
      stellar.invokeContract.mockResolvedValue('Paid');
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(lastUpdate()).toEqual(expect.objectContaining({ status: SubscriptionStatus.ACTIVE }));
      expect(paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('accepts the single-key object form the SDK sometimes returns', async () => {
      // scValToNative decodes a unit enum variant either way depending on the
      // XDR shape; both must reconcile identically.
      stellar.invokeContract.mockResolvedValue({ Paid: undefined });
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('maps the object form of Retrying to a grace period', async () => {
      stellar.invokeContract.mockResolvedValue({ Retrying: [] });
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(lastUpdate()).toEqual(
        expect.objectContaining({ status: SubscriptionStatus.GRACE_PERIOD }),
      );
    });

    it.each([
      ['an unknown string', 'Something'],
      ['undefined', undefined],
      ['null', null],
      ['a number', 42],
    ])('degrades %s to RETRYING rather than PAID', async (_label, value) => {
      // Guessing PAID on an unrecognised value books revenue that never
      // arrived and advances the billing date past a cycle nobody paid for.
      stellar.invokeContract.mockResolvedValue(value);
      due = [makeSub()];

      await scheduler.processDueBillings();

      expect(lastUpdate()).toEqual(
        expect.objectContaining({ status: SubscriptionStatus.GRACE_PERIOD }),
      );
      expect(paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });
  });

  describe('subscriptions without an on-chain plan id', () => {
    it('skips them instead of submitting a doomed transaction', async () => {
      due = [makeSub({ onChainPlanId: null, plan: makePlan({ onChainPlanId: null as never }) })];

      await scheduler.processDueBillings();

      expect(stellar.invokeContract).not.toHaveBeenCalled();
      expect(subRepo.update).not.toHaveBeenCalled();
    });

    it('falls back to the plan on-chain id when the subscription has none', async () => {
      due = [makeSub({ onChainPlanId: null, plan: makePlan({ onChainPlanId: 42 }) })];

      await scheduler.processDueBillings();

      expect(stellar.u64ToScVal).toHaveBeenCalledWith(BigInt(42));
    });
  });

  it('processes every due subscription in one tick', async () => {
    due = [makeSub({ id: 'a' }), makeSub({ id: 'b' }), makeSub({ id: 'c' })];

    await scheduler.processDueBillings();

    expect(stellar.invokeContract).toHaveBeenCalledTimes(3);
  });

  it('skips the contract entirely when nothing is due', async () => {
    due = [];

    await scheduler.processDueBillings();

    expect(stellar.invokeContract).not.toHaveBeenCalled();
  });
});

// Keeps `Repository` referenced for the generic typing of the mocks above
// without tripping noUnusedLocals.
export type SubscriptionRepository = Repository<SubscriptionEntity>;
