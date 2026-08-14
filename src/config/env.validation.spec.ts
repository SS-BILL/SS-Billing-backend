import { validateEnv } from './env.validation';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

/**
 * These lock in fail-fast behaviour. Each case previously booted a running
 * server with a broken or forgeable configuration.
 */
describe('validateEnv', () => {
  const strongSecret = 'a'.repeat(48);
  const keeper = Keypair.random().secret();
  // A real StrKey with a valid checksum; a hand-written 'C...' string is
  // correctly rejected by the validator.
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 7));

  const base = (): NodeJS.ProcessEnv => ({
    DATABASE_URL: 'postgres://user:pw@localhost:5432/ssbilling',
    JWT_SECRET: strongSecret,
    BILLING_ENABLED: 'false',
    NODE_ENV: 'test',
  });

  it('accepts a valid configuration', () => {
    expect(() => validateEnv(base())).not.toThrow();
  });

  it.each([['DATABASE_URL'], ['JWT_SECRET']])('rejects a missing %s', (key) => {
    const env = base();
    delete env[key];
    expect(() => validateEnv(env)).toThrow(new RegExp(`${key} is required`));
  });

  it('rejects the placeholder JWT secret that used to be the default', () => {
    expect(() => validateEnv({ ...base(), JWT_SECRET: 'change-me' })).toThrow(
      /known placeholder/,
    );
  });

  it('rejects a JWT secret below the length floor', () => {
    expect(() => validateEnv({ ...base(), JWT_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('rejects an unrecognised network', () => {
    expect(() => validateEnv({ ...base(), STELLAR_NETWORK: 'devnet' })).toThrow(
      /STELLAR_NETWORK/,
    );
  });

  describe('when billing is enabled', () => {
    const billing = (): NodeJS.ProcessEnv => ({
      ...base(),
      BILLING_ENABLED: 'true',
      CONTRACT_ID: contractId,
      SIGNER_SECRET: keeper,
    });

    it('accepts a valid keeper configuration', () => {
      expect(() => validateEnv(billing())).not.toThrow();
    });

    it('requires a contract id', () => {
      const env = billing();
      delete env.CONTRACT_ID;
      expect(() => validateEnv(env)).toThrow(/CONTRACT_ID is required/);
    });

    it('rejects a malformed contract id', () => {
      expect(() => validateEnv({ ...billing(), CONTRACT_ID: 'not-a-contract' })).toThrow(
        /valid contract address/,
      );
    });

    it('rejects a malformed signer secret', () => {
      expect(() => validateEnv({ ...billing(), SIGNER_SECRET: 'nope' })).toThrow(
        /valid Stellar secret seed/,
      );
    });

    it('never echoes the signer secret in the error', () => {
      const secret = 'SUPERSECRETVALUE';
      try {
        validateEnv({ ...billing(), SIGNER_SECRET: secret });
        fail('expected validation to throw');
      } catch (err) {
        expect((err as Error).message).not.toContain(secret);
      }
    });
  });

  it('requires an explicit CORS allowlist in production', () => {
    expect(() => validateEnv({ ...base(), NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
  });

  it('reports every problem at once rather than one per restart', () => {
    const message = (() => {
      try {
        validateEnv({ NODE_ENV: 'test', BILLING_ENABLED: 'false' });
        return '';
      } catch (err) {
        return (err as Error).message;
      }
    })();

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('JWT_SECRET');
  });
});
