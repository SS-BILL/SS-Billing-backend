import { Logger } from '@nestjs/common';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Fail-fast validation of the process environment.
 *
 * Every one of these used to have a silent fallback — `JWT_SECRET` defaulted
 * to the literal string `'change-me'`, and `SIGNER_SECRET` to `''`. A
 * misconfigured deploy therefore booted successfully and signed tokens anyone
 * could forge. Configuration problems must stop the process, not degrade it.
 */

const REQUIRED_ALWAYS = ['DATABASE_URL', 'JWT_SECRET'] as const;

/** Minimum entropy for a signing secret, in characters. */
const MIN_SECRET_LENGTH = 32;

const KNOWN_WEAK_SECRETS = new Set([
  'change-me',
  'changeme',
  'secret',
  'jwt-secret',
  'development',
  'test',
]);

export interface ValidatedEnv {
  isProduction: boolean;
  /** True when the billing keeper should run in this process. */
  billingEnabled: boolean;
}

function fail(problems: string[]): never {
  const detail = problems.map((p) => `  - ${p}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${detail}`);
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): ValidatedEnv {
  const logger = new Logger('EnvValidation');
  const problems: string[] = [];

  for (const key of REQUIRED_ALWAYS) {
    if (!env[key]?.trim()) {
      problems.push(`${key} is required`);
    }
  }

  const jwtSecret = env.JWT_SECRET?.trim();
  if (jwtSecret) {
    if (KNOWN_WEAK_SECRETS.has(jwtSecret.toLowerCase())) {
      problems.push(`JWT_SECRET is a known placeholder value — generate a real secret`);
    } else if (jwtSecret.length < MIN_SECRET_LENGTH) {
      problems.push(
        `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${jwtSecret.length})`,
      );
    }
  }

  const network = env.STELLAR_NETWORK?.trim() ?? 'testnet';
  if (!['testnet', 'mainnet'].includes(network)) {
    problems.push(`STELLAR_NETWORK must be "testnet" or "mainnet" (got "${network}")`);
  }

  // The keeper is opt-in. Without it the API still serves reads, which is what
  // you want for extra replicas that must not double-bill.
  const billingEnabled = (env.BILLING_ENABLED ?? 'true').toLowerCase() !== 'false';

  if (billingEnabled) {
    const contractId = env.CONTRACT_ID?.trim();
    const signerSecret = env.SIGNER_SECRET?.trim();

    if (!contractId) {
      problems.push('CONTRACT_ID is required when BILLING_ENABLED is not "false"');
    } else if (!StrKey.isValidContract(contractId)) {
      problems.push(`CONTRACT_ID is not a valid contract address (expected C...)`);
    }

    if (!signerSecret) {
      problems.push('SIGNER_SECRET is required when BILLING_ENABLED is not "false"');
    } else if (!StrKey.isValidEd25519SecretSeed(signerSecret)) {
      // Deliberately never echoes the value.
      problems.push('SIGNER_SECRET is not a valid Stellar secret seed (expected S...)');
    }
  }

  const isProduction = env.NODE_ENV === 'production';

  if (isProduction) {
    if (!env.CORS_ORIGINS?.trim()) {
      problems.push('CORS_ORIGINS is required in production — refusing to allow all origins');
    }
    if (env.DATABASE_URL && !/sslmode=/.test(env.DATABASE_URL)) {
      logger.warn('DATABASE_URL does not specify sslmode; connection may be unencrypted');
    }
  }

  if (problems.length > 0) {
    fail(problems);
  }

  logger.log(
    `Environment OK (network=${network}, billing=${billingEnabled ? 'enabled' : 'disabled'})`,
  );

  return { isProduction, billingEnabled };
}
