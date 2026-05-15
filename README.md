# SS-Billing — Backend

> NestJS API server for the [SS-Billing](https://github.com/brite-side0/SS-Billing) decentralized subscription billing platform on **Stellar Soroban**.

[![NestJS](https://img.shields.io/badge/NestJS-10-red)](https://nestjs.com)
[![Stellar](https://img.shields.io/badge/Network-Stellar%20Soroban-7B2FBE)](https://stellar.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://typescriptlang.org)

---

## Responsibilities

- **Billing scheduler** — polls due subscriptions every minute and calls `process_payment` on the Soroban contract
- **Blockchain indexer** — listens to on-chain events and syncs state to PostgreSQL
- **REST API** — merchants, plans, subscriptions, analytics
- **Webhook delivery** — HMAC-SHA256 signed event notifications
- **JWT auth** — Stellar keypair-based authentication

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 10 |
| Database | PostgreSQL + TypeORM |
| Cache / Queue | Redis + ioredis |
| Scheduler | `@nestjs/schedule` (cron) |
| Stellar SDK | `@stellar/stellar-sdk` |
| Auth | JWT + Passport |
| Docs | Swagger / OpenAPI |

---

## Modules

```
src/modules/
├── auth/          JWT strategy, Stellar signature verification
├── merchant/      Merchant registration and profile management
├── plan/          Subscription plan CRUD
├── subscription/  Subscription lifecycle (create, pause, resume, cancel)
├── billing/       Cron scheduler + on-chain event indexer
├── webhook/       HMAC-signed event delivery with retry
└── analytics/     MRR, churn rate, revenue time series
```

---

## API Reference

Base URL: `http://localhost:3001/api/v1`  
Swagger UI: `http://localhost:3001/docs`

```http
POST   /merchants
GET    /merchants/:id
PATCH  /merchants/:id

POST   /plans
GET    /plans?merchantId=<id>
PATCH  /plans/:id
DELETE /plans/:id

POST   /subscriptions
GET    /subscriptions/:id
PATCH  /subscriptions/:id/pause
PATCH  /subscriptions/:id/resume
DELETE /subscriptions/:id
GET    /subscriptions/:id/payments

GET    /analytics/merchants/:id/stats
GET    /analytics/merchants/:id/revenue
```

---

## Billing Scheduler

The scheduler runs every 60 seconds, queries subscriptions where `next_billing_at <= now`, and invokes `process_payment` on the Soroban contract for each.

```typescript
// src/modules/billing/billing.scheduler.ts
@Cron(CronExpression.EVERY_MINUTE)
async processDuePayments() {
  const due = await this.subscriptionRepo.find({
    where: { nextBillingAt: LessThanOrEqual(new Date()), status: 'active' },
  });

  for (const sub of due) {
    await this.stellarService.processPayment(sub.subscriberAddress, sub.planId);
  }
}
```

---

## Webhook Verification

```typescript
import { createHmac } from 'crypto';

function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  return expected === signature;
}
```

---

## Getting Started

```bash
pnpm install

# Configure environment
cp .env.example .env

# Start dependencies
docker compose up -d postgres redis

# Run dev server
pnpm dev
# → http://localhost:3001
```

---

## Environment Variables

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ss_billing
REDIS_URL=redis://localhost:6379
CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
SIGNER_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
JWT_SECRET=your-jwt-secret
WEBHOOK_SECRET=your-webhook-secret
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
```

---

## Testing

```bash
pnpm test          # unit tests
pnpm test:cov      # coverage report
```

---

## Part of SS-Billing

| Repo | Description |
|------|-------------|
| [SS-Billing](https://github.com/brite-side0/SS-Billing) | Monorepo |
| [SS-Billing-Frontend](https://github.com/brite-side0/SS-Billing-frontend) | Next.js dashboard |
| [SS-Billing-Contract](https://github.com/brite-side0/SS-Billing-contract) | Soroban smart contract |

---

MIT © [brite-side0](https://github.com/brite-side0)
