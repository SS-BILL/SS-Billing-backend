import { registerAs } from '@nestjs/config';

/**
 * Configuration accessors.
 *
 * These deliberately contain no fallbacks for secrets. Presence and shape are
 * enforced once at boot by `validateEnv`, so anything reaching this point has
 * already been checked — see `env.validation.ts` for why silent defaults were
 * removed.
 */

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  jwtSecret: process.env.JWT_SECRET as string,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  corsOrigins:
    process.env.CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? [],
  isProduction: process.env.NODE_ENV === 'production',
}));

export const stellarConfig = registerAs('stellar', () => ({
  network: process.env.STELLAR_NETWORK ?? 'testnet',
  rpcUrl: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  contractId: process.env.CONTRACT_ID ?? '',
  signerSecret: process.env.SIGNER_SECRET ?? '',
  billingEnabled: (process.env.BILLING_ENABLED ?? 'true').toLowerCase() !== 'false',
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
}));

export const webhookConfig = registerAs('webhook', () => ({
  /**
   * Permit webhook delivery to private address ranges. Off by default: a
   * merchant-supplied URL pointing at 169.254.169.254 or 127.0.0.1 turns the
   * billing service into an SSRF proxy for its own infrastructure. Enable only
   * for local development.
   */
  allowPrivateTargets: process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === 'true',
  timeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? '5000', 10),
  maxAttempts: parseInt(process.env.WEBHOOK_MAX_ATTEMPTS ?? '5', 10),
}));
