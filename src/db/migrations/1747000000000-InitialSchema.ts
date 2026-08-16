import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema.
 *
 * The repository shipped `migration:run` and `migration:generate` scripts
 * pointing at `src/db/migrations`, a directory that did not exist, with
 * `synchronize: false` in the data source. There was therefore no way to
 * create the database at all.
 *
 * Note the quoting on "interval": it is a reserved word in Postgres and the
 * column cannot be referenced unquoted.
 */
export class InitialSchema1747000000000 implements MigrationInterface {
  name = 'InitialSchema1747000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is built in from Postgres 13.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TYPE "subscription_status" AS ENUM (
        'active', 'paused', 'cancelled', 'grace_period', 'failed'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "webhook_status" AS ENUM ('pending', 'delivered', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE "merchants" (
        "id"                 varchar(56)  PRIMARY KEY,
        "name"               varchar(64)  NOT NULL,
        "treasury_wallet"    varchar(56)  NOT NULL,
        "active"             boolean      NOT NULL DEFAULT true,
        "api_key_hash"       varchar(64)  NOT NULL,
        "api_key_prefix"     varchar(32),
        "api_key_rotated_at" timestamptz,
        "webhook_url"        varchar(2048),
        "webhook_secret"     varchar(128),
        "created_at"         timestamptz  NOT NULL DEFAULT now(),
        "updated_at"         timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_merchants_api_key_hash" UNIQUE ("api_key_hash")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "subscription_plans" (
        "id"                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "on_chain_plan_id"  integer,
        "merchant_id"       varchar(56)  NOT NULL,
        "name"              varchar(64)  NOT NULL,
        "amount"            bigint       NOT NULL,
        "token"             varchar(56)  NOT NULL,
        "interval"          bigint       NOT NULL,
        "grace_period"      bigint       NOT NULL DEFAULT 86400,
        "retry_limit"       integer      NOT NULL DEFAULT 3,
        "retry_interval"    bigint       NOT NULL DEFAULT 3600,
        "active"            boolean      NOT NULL DEFAULT true,
        "created_at"        timestamptz  NOT NULL DEFAULT now(),
        "updated_at"        timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_plans_merchant" FOREIGN KEY ("merchant_id")
          REFERENCES "merchants"("id") ON DELETE CASCADE,
        CONSTRAINT "ck_plans_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "ck_plans_interval_positive" CHECK ("interval" > 0),
        -- Mirrors the contract's rule: retries require a retry interval.
        CONSTRAINT "ck_plans_retry_interval" CHECK (
          "retry_limit" = 0 OR "retry_interval" > 0
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_plans_merchant" ON "subscription_plans" ("merchant_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscriber_address" varchar(56) NOT NULL,
        "plan_id"            uuid        NOT NULL,
        "on_chain_plan_id"   bigint,
        "next_billing_at"    timestamptz NOT NULL,
        "next_retry_at"      timestamptz,
        "status"             "subscription_status" NOT NULL DEFAULT 'active',
        "retries"            integer     NOT NULL DEFAULT 0,
        "started_at"         timestamptz NOT NULL,
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_subscriptions_plan" FOREIGN KEY ("plan_id")
          REFERENCES "subscription_plans"("id") ON DELETE CASCADE
      )
    `);

    // One live subscription per (subscriber, plan). Terminal states are
    // excluded so a cancelled subscriber can sign up again.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_subscriptions_active" ON "subscriptions"
        ("subscriber_address", "plan_id")
        WHERE "status" NOT IN ('cancelled', 'failed')
    `);

    // Exactly the predicate the billing sweep runs every minute.
    await queryRunner.query(`
      CREATE INDEX "ix_subscriptions_due" ON "subscriptions"
        ("next_billing_at") WHERE "status" IN ('active', 'grace_period')
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_subscriptions_subscriber" ON "subscriptions" ("subscriber_address")`,
    );

    await queryRunner.query(`
      CREATE TABLE "payment_logs" (
        "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscription_id"     uuid        NOT NULL,
        "on_chain_payment_id" integer,
        "subscriber_address"  varchar(56) NOT NULL,
        "merchant_address"    varchar(56) NOT NULL,
        "amount"              bigint      NOT NULL,
        "tx_hash"             varchar(64),
        "success"             boolean     NOT NULL DEFAULT false,
        "error_message"       varchar(500),
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_payments_subscription" FOREIGN KEY ("subscription_id")
          REFERENCES "subscriptions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_payments_subscription" ON "payment_logs" ("subscription_id", "created_at" DESC)`,
    );
    // Supports the analytics revenue aggregation.
    await queryRunner.query(`
      CREATE INDEX "ix_payments_merchant_success" ON "payment_logs"
        ("merchant_address", "created_at") WHERE "success" = true
    `);

    await queryRunner.query(`
      CREATE TABLE "webhook_deliveries" (
        "id"            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
        "merchant_id"   varchar(56)   NOT NULL,
        "event"         varchar(64)   NOT NULL,
        "payload"       jsonb         NOT NULL,
        "webhook_url"   varchar(2048) NOT NULL,
        "status"        "webhook_status" NOT NULL DEFAULT 'pending',
        "response_code" integer,
        "attempts"      integer       NOT NULL DEFAULT 0,
        "error_message" varchar(500),
        "next_retry_at" timestamptz,
        "created_at"    timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "fk_webhooks_merchant" FOREIGN KEY ("merchant_id")
          REFERENCES "merchants"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_webhooks_retry" ON "webhook_deliveries"
        ("next_retry_at") WHERE "status" = 'pending'
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_webhooks_merchant" ON "webhook_deliveries" ("merchant_id", "created_at" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "auth_challenges" (
        "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "address"     varchar(56) NOT NULL,
        "message"     text        NOT NULL,
        "expires_at"  timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "created_at"  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_challenges_lookup" ON "auth_challenges" ("address", "consumed_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_challenges_expiry" ON "auth_challenges" ("expires_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "indexer_cursors" (
        "id"          varchar(64) PRIMARY KEY,
        "last_ledger" integer     NOT NULL,
        "updated_at"  timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "indexer_cursors"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_challenges"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscriptions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_plans"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "merchants"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "webhook_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscription_status"`);
  }
}
