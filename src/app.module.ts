import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { appConfig, redisConfig, stellarConfig, webhookConfig } from './config';
import { MerchantModule } from './modules/merchant/merchant.module';
import { PlanModule } from './modules/plan/plan.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { BillingModule } from './modules/billing/billing.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { AuthModule } from './modules/auth/auth.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, stellarConfig, redisConfig, webhookConfig],
      cache: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        // Never true, in any environment. `synchronize` in development and
        // migrations in production means the two schemas drift apart and the
        // migrations are only ever exercised in production. Use
        // `npm run migration:run` everywhere.
        synchronize: false,
        logging: config.get('NODE_ENV') === 'development',
        // The billing scheduler holds advisory locks; a pool of one would
        // deadlock the keeper against its own queries.
        extra: { max: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10) },
      }),
    }),
    ScheduleModule.forRoot(),
    // Default limit for every route; individual endpoints tighten it with
    // @Throttle. The API previously had no rate limiting of any kind.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    AuthModule,
    MerchantModule,
    PlanModule,
    SubscriptionModule,
    BillingModule,
    WebhookModule,
    AnalyticsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
